# Explicação do Código — ARX Send

Este documento explica como o ARX Send foi construído, para que você possa entender cada parte do sistema.

---

## Visão Geral da Arquitetura

O ARX Send é composto por duas partes que conversam entre si em tempo real:

```
┌─────────────────────────────────────────────┐
│              NAVEGADOR (usuário)            │
│           public/index.html                 │
│  Interface visual + JavaScript no cliente   │
└────────────────┬────────────────────────────┘
                 │  HTTP + WebSocket (Socket.IO)
┌────────────────▼────────────────────────────┐
│              SERVIDOR (Node.js)             │
│             src/server.js                   │
│  API REST + Socket.IO + WhatsApp            │
└────────────────┬────────────────────────────┘
                 │  Puppeteer (automação)
┌────────────────▼────────────────────────────┐
│           GOOGLE CHROME (headless)          │
│         WhatsApp Web rodando               │
│         invisível em background            │
└─────────────────────────────────────────────┘
```

**Headless** significa "sem janela visível" — o Chrome roda escondido, apenas fazendo o trabalho.

---

## Tecnologias Utilizadas

| Tecnologia | O que faz |
|---|---|
| **Node.js** | Ambiente de execução do servidor (roda JavaScript fora do navegador) |
| **Express** | Framework web — cria as rotas da API (os "endereços" que o app chama) |
| **Socket.IO** | Comunicação em tempo real entre servidor e navegador (sem precisar recarregar a página) |
| **whatsapp-web.js** | Biblioteca que automatiza o WhatsApp Web |
| **Puppeteer** | Controla o Chrome via código (abre páginas, clica, lê dados) |
| **Multer** | Gerencia uploads de arquivos com validação de tipo e tamanho |
| **XLSX** | Lê arquivos Excel (.xlsx) e CSV |
| **pkg** | Empacota tudo em um único .exe para distribuição |

---

## Arquivo: `src/server.js`

Este é o cérebro do sistema. Vamos entender parte por parte.

### 1. Importações e Configuração Inicial

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
```

`require()` é como o Node.js "importa" bibliotecas. É equivalente ao `import` de outras linguagens.

```javascript
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
```

- `app` = o aplicativo web Express
- `server` = o servidor HTTP que fica "ouvindo" conexões
- `io` = o servidor Socket.IO (comunicação em tempo real)
- `PORT` = porta onde o servidor vai rodar. `process.env.PORT` permite sobrescrever via variável de ambiente (usado no servidor Oracle). Se não existir, usa 3000.

```javascript
process.on('uncaughtException', (err) => {
  console.error('Erro não tratado:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Promise rejeitada sem tratamento:', reason);
});
```

Captura dois tipos de erros inesperados:

- `uncaughtException` — erros síncronos não capturados por nenhum `try/catch`. Logamos o erro completo (com stack trace) em vez de só a mensagem, para facilitar o diagnóstico.
- `unhandledRejection` — Promises que foram rejeitadas sem um `.catch()`. Em Node.js 15+, uma rejeição não tratada **derruba o processo** por padrão, então registrar um handler aqui evita crashes silenciosos (como o watchdog chamando `connectSession` e o Chrome não encontrado).

---

### 2. Diretórios

```javascript
const appDataBase = process.pkg
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'arx-send')
  : path.join(__dirname, '..');
```

`process.pkg` é `true` quando o app está rodando como `.exe` empacotado (via pkg). Nesse caso, usamos `AppData` (pasta do Windows para dados de aplicativos) em vez da pasta do código. Isso é necessário porque dentro do `.exe` não é possível gravar arquivos.

- **Rodando como .exe**: salva em `C:\Users\yuri\AppData\Local\arx-send\`
- **Rodando via `node src/server.js`**: salva na pasta do projeto

---

### 3. Upload de Arquivos (Multer)

```javascript
const ALLOWED_UPLOAD_EXTS = new Set([
  '.jpg', '.jpeg', '.png', /* ... */ '.pdf', '.docx', '.xlsx', '.zip', '.txt'
]);

const upload = multer({
  storage,
  limits: { fileSize: 64 * 1024 * 1024 },  // 64 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_UPLOAD_EXTS.has(ext)) return cb(null, true);
    cb(new Error(`Tipo de arquivo não permitido: ${ext}`));
  }
});
```

O Multer gerencia o recebimento de arquivos enviados pelo navegador. Três controles importantes:

- **`limits.fileSize`** — rejeita arquivos maiores que 64 MB antes mesmo de salvar em disco.
- **`fileFilter`** — verifica a extensão do arquivo. Se não estiver na lista permitida, rejeita com erro 400. Isso impede o upload de executáveis (`.exe`, `.bat`) ou outros tipos não esperados.
- **`path.basename(file.originalname)`** — remove qualquer componente de diretório do nome original (`../../etc/passwd` vira `passwd`), evitando que o arquivo seja gravado fora da pasta de uploads.

```javascript
// Middleware de erro logo após as rotas de upload
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'Arquivo muito grande (máx. 64 MB)' });
  if (err instanceof multer.MulterError || err?.message?.startsWith('Tipo de arquivo'))
    return res.status(400).json({ error: err.message });
  next(err);
});
```

Este middleware de 4 parâmetros `(err, req, res, next)` é a forma do Express de capturar erros lançados por middlewares anteriores. Sem ele, o erro do `fileFilter` chegaria ao usuário como um 500 genérico — com ele, retornamos um 400 com mensagem legível.

---

### 4. Sistema de Sessões (Multi-usuário)

```javascript
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      id,
      client:        null,     // instância do WhatsApp
      status:        'disconnected',
      contacts:      loadCachedContacts(id),
      isSending:     false,
      stopRequested: false,
      watchdog:      null,
    };
  }
  return sessions[id];
}
```

`sessions` é um objeto que guarda o estado de cada usuário em memória. Cada usuário tem seu próprio "slot" identificado pelo nome da sessão (ex: "yuri", "suporte").

Quando você acessa `sessions["yuri"]`, você tem acesso ao cliente WhatsApp do Yuri, seus contatos, seu status, etc.

---

### 5. Watchdog (Vigilante de Conexão)

```javascript
function setWatchdog(sessionId, ms = 180000) {
  const sess = getSession(sessionId);
  clearTimeout(sess.watchdog);
  sess.watchdog = setTimeout(() => {
    if (sess.status === 'connecting') {
      connectSession(sessionId).catch(err =>
        console.error(`[${sessionId}] Watchdog erro ao reconectar:`, err)
      );
    }
  }, ms);
}
```

`setTimeout` agenda uma função para rodar depois de X milissegundos. O watchdog funciona assim:

1. Quando o WhatsApp começa a carregar, ativamos um timer de 2 minutos
2. Se em 2 minutos o status ainda for `connecting` (travado), o timer dispara
3. O timer chama `connectSession()` novamente, reiniciando tudo
4. Se o WhatsApp carregar normalmente (evento `ready`), cancelamos o timer com `clearTimeout`

> **Por que não usar `async/await` aqui?** O `setTimeout` não consegue capturar erros de uma função `async` passada como callback — uma rejeição viraria um `unhandledRejection` e poderia derrubar o processo. A solução é usar `.catch()` diretamente na Promise retornada por `connectSession()`.

---

### 6. Cache de Contatos

```javascript
function saveCachedContacts(sessionId, contacts) {
  fs.writeFileSync(path.join(cacheDir, `${sessionId}.json`), JSON.stringify(contacts));
}

function loadCachedContacts(sessionId) {
  const file = path.join(cacheDir, `${sessionId}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return [];
}
```

Após carregar os contatos do WhatsApp (o que pode demorar), salvamos em um arquivo JSON em disco. Na próxima conexão, carregamos do arquivo imediatamente (instantâneo) enquanto atualiza em background.

`JSON.stringify()` converte objeto JavaScript → texto JSON.
`JSON.parse()` converte texto JSON → objeto JavaScript.

---

### 7. Detecção do Chrome

```javascript
function getChromiumPath() {
  if (process.platform === 'linux') {
    // Verifica caminhos comuns no Linux
    const candidates = ['/usr/bin/google-chrome', ...];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }
  // Windows: verifica Chrome instalado
  const winCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ...
  ];
  for (const p of winCandidates) {
    if (fs.existsSync(p)) return p;
  }
}
```

`fs.existsSync()` verifica se um arquivo existe no caminho informado. Tentamos vários caminhos possíveis onde o Chrome pode estar instalado. O primeiro que existir é o que usamos.

---

### 8. Conectar Sessão WhatsApp

```javascript
async function connectSession(sessionId) {
  sess.client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: ... }),
    puppeteer: { headless: true, executablePath, args: [...] }
  });
```

`LocalAuth` salva a autenticação em disco. Assim, após escanear o QR uma vez, nas próximas vezes o WhatsApp reconhece automaticamente sem pedir QR de novo.

`headless: true` faz o Chrome rodar sem janela visível.

Os `args` são flags para otimizar o Chrome em servidores com pouca memória:
- `--no-sandbox` → desativa isolamento de processo (necessário em Linux sem root)
- `--disable-gpu` → não usa placa de vídeo
- `--disable-dev-shm-usage` → evita erro de memória compartilhada no Linux

```javascript
sess.client.on('qr', async (qr) => { ... });
sess.client.on('ready', async () => { ... });
sess.client.on('disconnected', (reason) => { ... });
```

`.on('evento', função)` é o padrão de "escuta de eventos" em Node.js. Quando o WhatsApp gera um QR, chama nossa função. Quando conecta (ready), chama outra função. É como registrar callbacks que serão executados quando algo acontecer.

---

### 9. Proteções de Segurança

Várias camadas de proteção foram adicionadas ao longo do desenvolvimento:

#### Path traversal — `path.basename()`

```javascript
// ERRADO (vulnerável):
const filePath = path.join(uploadsDir, filename); // filename pode ser "../../etc/passwd"

// CORRETO:
const filePath = path.join(uploadsDir, path.basename(filename)); // sempre fica dentro de uploadsDir
```

`path.basename()` extrai apenas o nome do arquivo, descartando qualquer componente de diretório. Isso impede que um usuário mal-intencionado acesse arquivos fora da pasta de uploads passando caminhos como `../../`.

#### Limite de linhas no XLSX — `sheetRows`

```javascript
const wb = XLSX.readFile(filePath, { sheetRows: 10001 });
```

Arquivos `.xlsx` são ZIPs internamente. Um arquivo malicioso pode ter 1 KB no disco mas expandir para centenas de MB de dados. O `sheetRows` faz a biblioteca parar de ler após 10.001 linhas, evitando que o servidor fique sem memória.

#### Limite de contatos por envio

```javascript
if (contactIds.length > 5000)
  return res.status(400).json({ error: 'Máximo de 5000 contatos por envio' });
```

Sem esse limite, um array com dezenas de milhares de IDs travaria o servidor por horas (1.500 ms mínimo por envio × volume = horas bloqueadas).

#### `try/finally` no loop de envio

```javascript
sess.isSending = true;
try {
  // ... todo o loop
} finally {
  sess.isSending = false; // executado SEMPRE, mesmo se houver exceção
}
```

O bloco `finally` garante que `isSending` sempre volta para `false`, mesmo que uma exceção inesperada interrompa o loop. Sem isso, um erro no meio do envio deixaria a sessão permanentemente travada, impedindo novos disparos até reiniciar o servidor.

#### Limpeza automática de arquivos e sessões

```javascript
// Uploads sem uso há mais de 2 horas são deletados a cada 1 hora
setInterval(cleanOrphanedUploads, 60 * 60 * 1000);

// Sessões desconectadas sem cliente ativo são removidas da memória a cada 1 hora
setInterval(cleanStaleSessions, 60 * 60 * 1000);
```

Sem essas rotinas, arquivos enviados mas não usados acumulariam no disco indefinidamente, e o objeto `sessions` cresceria na memória para sempre em um servidor com muitos usuários.

---

### 11. Loop de Envio

```javascript
for (let i = 0; i < contactIds.length; i++) {
  // Substituir variáveis: {{Nome}} → "João"
  const finalMsg = message.replace(/\{\{([^}]+)\}\}/g, (_, key) => rowData[key] ?? `{{${key}}}`);

  try {
    await sendTo(contactIds[i]);
    sent = true;
  } catch (err) {
    if (err.message.includes('LID')) {
      const altId = removeNinthDigit(contactIds[i]);
      await sendTo(altId); // tenta sem o nono dígito
    }
  }

  await sleep(delay); // pausa entre envios
}
```

- `await` = "espere essa operação terminar antes de continuar". Necessário porque enviar uma mensagem leva tempo (rede).
- A regex `/\{\{([^}]+)\}\}/g` encontra todos os `{{NomeDaColuna}}` no texto e substitui pelos valores reais.
- O `try/catch` captura erros. Se o número falhar por erro de LID (nono dígito), tenta o número alternativo.

---

### 12. Rotas da API

```javascript
app.post('/api/:sessionId/connect', sessionMiddleware, (req, res) => { ... });
app.post('/api/:sessionId/send',    sessionMiddleware, async (req, res) => { ... });
```

`app.post()` registra um "endereço" que responde a requisições POST (envio de dados).

`:sessionId` é um parâmetro dinâmico — `/api/yuri/connect` e `/api/suporte/connect` chamam a mesma função, mas com `sessionId` diferente.

`sessionMiddleware` é uma função intermediária que valida e prepara o `sessionId` antes de chegar na função principal.

---

### 13. Socket.IO (Comunicação em Tempo Real)

```javascript
io.on('connection', (socket) => {
  socket.on('join_session', (rawId) => {
    socket.join(`s:${sessionId}`);  // entra numa "sala"
    socket.emit('session_joined', { sessionId }); // responde ao cliente
  });
});
```

Socket.IO funciona com "salas" (rooms). Cada sessão tem sua própria sala `s:yuri`, `s:suporte`, etc. Quando emitimos um evento para a sala, apenas os usuários daquela sala recebem.

```javascript
function emit(sessionId, event, data) {
  io.to(`s:${sessionId}`).emit(event, data);
}
```

Esta função atalho envia um evento para todos os navegadores conectados na sala daquela sessão.

---

## Arquivo: `public/index.html`

Este arquivo é enviado ao navegador e contém toda a interface visual + o JavaScript que roda no lado do cliente.

### Estrutura da Página

```
┌─────────────────────────────────────────┐
│ HEADER: Logo ARX + Status + Botão       │
├──────────────────┬──────────────────────┤
│ PAINEL ESQUERDO  │ PAINEL DIREITO       │
│ Lista de contatos│ Aba Mensagem         │
│ Filtros          │ Aba Disparar         │
│ Seleção          │ Progresso            │
└──────────────────┴──────────────────────┘
│ MODAIS (sobrepostos):                   │
│ - Tela de Login                         │
│ - QR Code                               │
│ - Importar Planilha                     │
└─────────────────────────────────────────┘
```

### Como o JavaScript do Frontend Funciona

#### Conexão com o servidor

```javascript
const socket = io(); // conecta ao servidor via Socket.IO
```

Esta única linha estabelece a conexão em tempo real com o servidor. A partir daqui, podemos enviar e receber eventos.

#### Estado da Aplicação

```javascript
let contacts        = [];      // contatos do WhatsApp
let importedContacts = [];     // contatos importados da planilha
let sheetHeaders    = [];      // colunas da planilha importada
let selectedIds     = new Set(); // IDs dos contatos selecionados
let waStatus        = 'disconnected'; // status da conexão
```

Variáveis globais que guardam o estado atual da interface. `Set` é uma estrutura de dados que armazena valores únicos — perfeito para IDs selecionados (não permite duplicatas).

#### Recebendo eventos do servidor

```javascript
socket.on('status', ({ status, message }) => {
  waStatus = status;
  updateStatusUI(status, message); // atualiza a interface
});

socket.on('contacts', ({ contacts: c }) => {
  contacts = c;
  renderList(); // redesenha a lista
});
```

Quando o servidor emite um evento, o frontend reage atualizando a interface. Isso é o que faz a lista de contatos aparecer automaticamente sem recarregar a página.

#### Renderização da Lista

```javascript
function renderList() {
  const allContacts = [...importedContacts, ...contacts]; // junta os dois
  const filtered = allContacts.filter(c => {
    if (currentFilter === 'people' && c.isGroup) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
  list.innerHTML = filtered.map(c => `<div class="contact-item">...</div>`).join('');
}
```

`...array` é o "spread operator" — expande o array. `[...a, ...b]` junta dois arrays.

`.filter()` retorna um novo array com apenas os itens que passaram no teste.

`.map()` transforma cada item do array em outra coisa — aqui, transforma cada contato em HTML.

`.join('')` junta todos os HTMLs em uma única string.

`innerHTML` substitui o conteúdo HTML de um elemento.

#### Variáveis da Planilha

```javascript
function insertVar(colName) {
  const ta  = document.getElementById('msgText');
  const pos = ta.selectionStart; // posição do cursor no textarea
  const val = ta.value;
  ta.value = val.slice(0, pos) + `{{${colName}}}` + val.slice(ta.selectionEnd);
}
```

`selectionStart` é a posição atual do cursor dentro do textarea. Inserimos o `{{variável}}` exatamente onde o cursor está, como um editor de texto faria.

---

## Fluxo Completo de um Disparo

Para entender tudo junto, veja o que acontece quando você clica em "Disparar":

```
1. [FRONTEND] startSend() é chamado
   → Monta o objeto: { contactIds, message, filename, contactsData }
   → contactsData = { "5511999...@c.us": { "Nome": "João", "Valor": "R$100" } }
   → Faz POST para /api/yuri/send

2. [SERVIDOR] Recebe a requisição
   → Responde imediatamente: { ok: true } (não espera terminar)
   → Inicia o loop de envio em background

3. [SERVIDOR] Para cada contato:
   → Substitui {{Nome}} → "João" na mensagem
   → Chama sess.client.sendMessage(id, mensagem)
   → Emite evento send_progress via Socket.IO

4. [FRONTEND] Recebe send_progress
   → Atualiza a barra de progresso
   → Adiciona linha no log (✓ João / ✗ Maria)

5. [SERVIDOR] Loop termina
   → Emite evento send_done

6. [FRONTEND] Recebe send_done
   → Mostra "Disparo concluído!"
```

---

## Conceitos-Chave para Estudar

Se quiser aprofundar o conhecimento, esses são os temas mais importantes usados no projeto:

1. **JavaScript Assíncrono** — `async/await`, Promises, eventos
2. **Node.js** — módulos, `require()`, `fs` (sistema de arquivos)
3. **Express** — rotas, middlewares, req/res
4. **Socket.IO** — eventos, salas (rooms), emit
5. **REST API** — GET, POST, status codes HTTP
6. **DOM Manipulation** — `getElementById`, `innerHTML`, eventos de clique

Recursos gratuitos recomendados:
- **Node.js**: nodejs.org/en/docs (documentação oficial)
- **JavaScript moderno**: javascript.info (em inglês, muito completo)
- **Express**: expressjs.com/en/guide (guia oficial)
