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
| **Multer** | Gerencia uploads de arquivos (imagens, PDFs, planilhas) |
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
  console.error('Erro não tratado (ignorado):', err.message);
});
```

Captura erros inesperados do Node.js e os ignora em vez de fechar o servidor. Importante porque o Puppeteer às vezes dispara erros assíncronos fora do nosso controle.

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

### 3. Sistema de Sessões (Multi-usuário)

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

### 4. Watchdog (Vigilante de Conexão)

```javascript
function setWatchdog(sessionId, ms = 180000) {
  const sess = getSession(sessionId);
  clearTimeout(sess.watchdog);
  sess.watchdog = setTimeout(async () => {
    if (sess.status === 'connecting') {
      await connectSession(sessionId); // reconecta automaticamente
    }
  }, ms);
}
```

`setTimeout` agenda uma função para rodar depois de X milissegundos. O watchdog funciona assim:

1. Quando o WhatsApp começa a carregar, ativamos um timer de 2 minutos
2. Se em 2 minutos o status ainda for `connecting` (travado), o timer dispara
3. O timer chama `connectSession()` novamente, reiniciando tudo
4. Se o WhatsApp carregar normalmente (evento `ready`), cancelamos o timer com `clearTimeout`

---

### 5. Cache de Contatos

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

### 6. Detecção do Chrome

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

### 7. Conectar Sessão WhatsApp

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

### 8. Loop de Envio

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

### 9. Rotas da API

```javascript
app.post('/api/:sessionId/connect', sessionMiddleware, (req, res) => { ... });
app.post('/api/:sessionId/send',    sessionMiddleware, async (req, res) => { ... });
```

`app.post()` registra um "endereço" que responde a requisições POST (envio de dados).

`:sessionId` é um parâmetro dinâmico — `/api/yuri/connect` e `/api/suporte/connect` chamam a mesma função, mas com `sessionId` diferente.

`sessionMiddleware` é uma função intermediária que valida e prepara o `sessionId` antes de chegar na função principal.

---

### 10. Socket.IO (Comunicação em Tempo Real)

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
