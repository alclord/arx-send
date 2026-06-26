# ARX Send — Especificação do Produto (SPEC)

> **Autoridade máxima do produto.**
> Quando houver contradição entre este arquivo e o código, a SPEC vence — o código é que está errado.
> Toda nova feature começa com uma entrada aqui. Toda mudança de comportamento exige atualização aqui.

---

## Como usar esta SPEC

- **IA:** leia as seções relevantes **antes** de planejar qualquer implementação. Se uma feature não está aqui, pergunte ao usuário antes de inventar comportamento.
- **Desenvolvedor:** use como critério de "pronto". Uma feature está feita quando todos os seus critérios de aceitação são verificáveis.
- **Para adicionar feature:** abra um bloco `F-NNN` aqui com critérios de aceitação antes de escrever uma linha de código.

---

## 1. Identidade do produto

**Nome:** ARX Send  
**Tipo:** Aplicativo desktop Windows  
**Propósito:** Disparo em massa de mensagens WhatsApp para listas de contatos, com suporte a múltiplos aparelhos simultaneamente.  
**Usuário:** Operadores internos da ARX Administradora (uso corporativo, não público).  
**Problema que resolve:** Enviar mensagens personalizadas para centenas de contatos via WhatsApp sem intervenção manual por mensagem.

---

## 2. Premissas do ambiente

- Roda exclusivamente em Windows (x64).
- Requer Google Chrome instalado (usado pelo Puppeteer/whatsapp-web.js).
- Requer conexão com internet (para WhatsApp e verificação de updates).
- Um único operador por vez por sessão (não é multi-usuário concorrente).
- Usa a API não-oficial do WhatsApp (whatsapp-web.js). Comportamentos do WhatsApp Web valem.

---

## 3. Especificações de feature

### F-001 — Sessão de usuário

**Descrição:** O operador identifica-se com um nome de sessão para isolar seus telefones e dados dos de outras sessões.

**Critérios de aceitação:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | Não há sessão salva no navegador | O operador abre o app | A tela de login é exibida |
| 2 | O operador digita um nome de sessão | Clica em entrar | O ID é sanitizado: só `[a-z0-9_-]`, máximo 30 caracteres |
| 3 | O ID sanitizado tem menos de 2 caracteres | — | Exibe erro: "Nome deve ter ao menos 2 caracteres válidos" |
| 4 | O ID é válido | — | Sessão é salva em `localStorage`, evento `join_session` é emitido, badge `# {sessionId}` é exibido |
| 5 | Há sessão salva no `localStorage` | O operador abre o app | Login é executado automaticamente ao conectar ao Socket.io |
| 6 | O operador clica em "Trocar de sessão" | Confirma | `localStorage` é limpo, página é recarregada |

**Restrições:**
- Não há senha ou controle de acesso por sessão. Isso é **intencional**: o app é instalado localmente em cada computador do operador. O `sessionId` é organizacional — serve para separar empresas atendidas (ex: `empresa_a`, `empresa_b`), não para isolar usuários entre si.
- O `AUTH_TOKEN` protege a API HTTP contra acesso externo à rede local, mas não segrega sessões entre si.

---

### F-002 — Gerenciamento de telefones

**Descrição:** O operador cadastra aparelhos WhatsApp, conecta-os via QR code e pode desconectá-los ou removê-los.

**Critérios de aceitação:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | A sessão tem menos de 10 telefones | Operador adiciona telefone com nome | Telefone é criado com status `disconnected`, nome com até 50 caracteres |
| 2 | A sessão já tem 10 telefones | Operador tenta adicionar | Retorna erro: máximo atingido; botão de adicionar fica desabilitado |
| 3 | Telefone está `disconnected` | Operador clica "Conectar" | Puppeteer abre, status muda para `connecting`, QR modal é exibido com loading |
| 4 | WhatsApp gera o QR | — | QR code é exibido no modal como imagem base64 |
| 5 | Operador escaneia o QR | — | Status vai para `connecting` → `ready`; modal fecha |
| 6 | Telefone está `ready` | Operador clica "Desconectar" | `client.logout()` + `client.destroy()` é chamado; dados LocalAuth são apagados; status vai para `disconnected` |
| 7 | Operador clica "Remover" | Confirma | `logout()` + `destroy()` + dados LocalAuth apagados + cache de contatos apagado |
| 8 | Telefone reconecta (LocalAuth válido) | Operador abre o app | Reconexão automática sem QR, usando sessão salva em disco |
| 9 | Operador renomeia telefone | Salva | Nome é atualizado na lista e persistido em disco |

**Estado persistido:**
- Lista de telefones: `%APPDATA%\arx-send\cache\{sessionId}_phones.json`
- Auth WhatsApp: `%LOCALAPPDATA%\arx-send\sessions\{sessionId}\{phoneId}\`

**Invariante crítica — logout vs destroy:**

| Situação | Comportamento obrigatório |
|---|---|
| App fechando | **Apenas `destroy()`** — LocalAuth preservado |
| Operador clica "Desconectar" | `logout()` + `destroy()` — LocalAuth apagado |
| Operador remove o telefone | `logout()` + `destroy()` + apagar pasta LocalAuth |

Violar esta regra causa QR code obrigatório na próxima abertura (bug histórico v2.1.6).

---

### F-003 — Carregamento de contatos

**Descrição:** Após conectar, o app carrega automaticamente as conversas do WhatsApp do aparelho e as exibe como lista de contatos selecionáveis.

**Critérios de aceitação:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | Telefone atinge status `ready` | — | Se há cache em disco, é emitido imediatamente para o frontend |
| 2 | — | — | Após 3s, `getChats()` é chamado para carregar a lista atualizada |
| 3 | `getChats()` retorna lista vazia | — | Sistema aguarda e tenta novamente, até 8 tentativas (4s entre as primeiras, 6s entre as demais) |
| 4 | `getChats()` retorna lista não-vazia | — | Contatos são ordenados alfabeticamente por nome |
| 5 | Lista é carregada | — | Cache é gravado em `%APPDATA%\arx-send\cache\phone_{phoneId}.json` |
| 6 | Telefone desconecta | — | Lista de contatos do frontend é zerada |
| 7 | Operador clica "Recarregar contatos" | Telefone está `ready` | `getChats()` é chamado novamente do início |

**Formato de cada contato:**
```
id:      string  — WhatsApp ID serializado (ex: "5511999999999@c.us")
name:    string  — nome do chat
isGroup: boolean — true = grupo
unread:  number  — mensagens não lidas
```

**Restrições:**
- Contatos individuais e grupos são carregados juntos. O frontend exibe filtros para separar.
- Não é possível editar ou deletar contatos do WhatsApp pelo ARX Send.

---

### F-004 — Importação de planilha

**Descrição:** O operador pode importar uma planilha (.xlsx, .xls, .csv) para adicionar contatos que não estão no WhatsApp do aparelho, com suporte a variáveis por linha.

**Critérios de aceitação:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | Arquivo com extensão não permitida | Upload | Erro: "Formato inválido. Use .xlsx, .xls ou .csv" |
| 2 | Planilha válida | Upload | Headers e preview das 3 primeiras linhas são exibidos |
| 3 | Planilha tem mais de 10.000 linhas de dados | — | Apenas as primeiras 10.000 são processadas (limite silencioso) |
| 4 | Operador seleciona coluna de telefone e confirma | — | Números são normalizados para formato WhatsApp brasileiro |
| 5 | Número inválido em uma linha | — | Linha é ignorada silenciosamente |
| 6 | Importação concluída | — | Contatos da planilha aparecem na lista com badge "Planilha" e ficam pré-selecionados |
| 7 | Operador seleciona coluna de nome (opcional) | — | Nome da coluna é usado; se ausente, o número normalizado é o nome |
| 8 | — | — | Todos os headers da planilha ficam disponíveis como variáveis `{{NomeColuna}}` |

**Normalização de telefone (Brasil):**
- Remove formatação (parênteses, hífens, espaços, zeros à esquerda)
- Adiciona `55` se não começar com `55`
- Aceita 12 ou 13 dígitos totais (com `55` e DDD)
- Formato final: `55XXXXXXXXXXX@c.us`
- Números fora desse range: ignorados

---

### F-005 — Composição de mensagem

**Descrição:** O operador compõe a mensagem a ser enviada. Três modos disponíveis: texto, arquivo, ou texto + arquivo.

**Modos:**

| Modo | Comportamento |
|---|---|
| `text` | Só texto. Envio bloqueado se texto vazio. |
| `file` | Só arquivo. Envio bloqueado se nenhum arquivo selecionado. |
| `text+file` | Texto + arquivo. Ambos obrigatórios. |

**Critérios de aceitação:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | Operador digita texto | — | Contador de caracteres atualizado em tempo real |
| 2 | — | — | Rascunho salvo em `localStorage` a cada 500ms |
| 3 | Operador reabre o app | — | Rascunho é restaurado automaticamente |
| 4 | Operador usa `{{NomeColuna}}` no texto | Há planilha importada | Preview da mensagem renderiza o valor da coluna para o contato selecionado no preview |
| 5 | Variável não tem valor para aquele contato | Preview | Placeholder `{{NomeColuna}}` é mantido, marcado visualmente como ausente |
| 6 | Operador faz upload de arquivo | — | Arquivo é enviado para o servidor; imagens exibem preview; outros tipos exibem ícone por tipo |
| 7 | Arquivo excede limite do WhatsApp | Upload | Erro com limite específico por tipo (imagem: 16 MB, vídeo: 64 MB, áudio: 16 MB, documento: 100 MB) |
| 8 | Tipo de arquivo não permitido | Upload | Erro: "Tipo de arquivo não permitido" |

**Extensões permitidas:**
- Imagem: `.jpg .jpeg .png .gif .webp .bmp`
- Vídeo: `.mp4 .mov .avi .mkv .3gp`
- Áudio: `.mp3 .ogg .wav .aac .m4a`
- Documento: `.pdf .doc .docx .xls .xlsx .ppt .pptx .zip .txt`

---

### F-006 — Disparo em massa

**Descrição:** O operador dispara as mensagens para todos os contatos selecionados, com delay configurável entre envios e acompanhamento em tempo real.

**Critérios de aceitação — pré-envio:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | Nenhum contato selecionado | Operador tenta enviar | Botão desabilitado |
| 2 | Nenhum conteúdo (texto vazio ou sem arquivo, conforme modo) | — | Botão desabilitado |
| 3 | Nenhum telefone `ready` selecionado | — | Botão desabilitado |
| 4 | Mais de 5.000 contatos selecionados | Clica enviar | Erro: limite excedido |
| 5 | Já há um disparo em andamento nesta sessão | Clica enviar | Erro: "Envio já em andamento" |

**Critérios de aceitação — durante o envio:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 6 | Disparo iniciado | — | Barra de progresso, contador `N / total`, log de envios aparecem |
| 7 | Delay configurado > 30s | Entre envios | Timer de countdown é exibido |
| 8 | Delay configurado ≤ 30s | — | Timer não é exibido |
| 9 | Erro transiente (timeout, ECONNRESET, Target closed) | Envio de uma mensagem | Sistema retenta até 3x com backoff exponencial (2s, 4s, 8s) |
| 10 | Erro de LID (número com 9º dígito problemático) | Envio falha | Tenta reenviar sem o 9º dígito (ex: `5511987654321` → `551187654321`) |
| 11 | Todos os retries falham | — | Contato marcado como erro no log; disparo continua para o próximo |
| 12 | Operador clica "Parar" | — | Disparo para após o envio atual terminar (não interrompe a mensagem em curso) |
| 13 | Disparo conclui normalmente | — | Notificação Windows: "Disparo concluído!" |
| 14 | Arquivo de mídia foi usado | Após conclusão (ou parada) | Arquivo é apagado do servidor automaticamente |

**Delay:**
- Mínimo obrigatório: **1.500 ms** (hardcoded, não configurável abaixo disso)
- Padrão se não configurado: **3.000 ms**
- Unidade: segundos ou minutos (selecionável na UI)

**Personalização por contato:**
- Para contatos de planilha: template `{{Coluna}}` é substituído pelos dados da linha correspondente
- Para contatos do WhatsApp: variáveis sem match são enviadas como texto literal `{{Coluna}}`

---

### F-007 — Atualização automática

**Descrição:** O app verifica e aplica atualizações automaticamente a partir de releases publicadas no GitHub.

**Critérios de aceitação:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | App inicializado | Após 30s | Verifica automaticamente se há nova versão |
| 2 | — | A cada 6h | Verifica novamente |
| 3 | Nova versão disponível | — | Banner de update é exibido com versão e botão de ação |
| 4 | Versão nova tem mesmo Electron | Operador clica "Baixar e reiniciar" | Baixa `app.asar`, verifica SHA-256, substitui, reinicia o app |
| 5 | Versão nova mudou o Electron | Operador clica "Baixar instalador" | Baixa `.exe`, verifica SHA-256, abre instalador, fecha o app |
| 6 | SHA-256 não confere | — | Arquivo é apagado; erro exibido: "Falha na verificação de integridade" |
| 7 | Operador clica "Verificar atualizações" | — | Verificação manual disparada; resultado exibido no banner |
| 8 | App está na versão mais recente | — | Banner some após 3s |

**Artefatos obrigatórios em cada release do GitHub:**
- `ARX-Send-Setup-{versão}.exe` — instalador completo
- `app.asar` — código da aplicação
- `release.json` — metadados com versão, versão do Electron e SHA-256 de cada artefato

---

## 4. Máquina de estados — Telefone

```
                  ┌─────────────────────────────────────┐
                  │                                     │
         connectPhone()                        desconexão inesperada
                  │                             (evento 'disconnected')
                  ▼                                     │
         ┌─────────────────┐                            │
         │   connecting    │ ◄──────────────────────────┘
         └────────┬────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
   QR gerado           'authenticated'
       │                     │
       ▼                     │
  ┌─────────┐                │
  │   qr    │                │
  └────┬────┘                │
       │                     │
  QR escaneado               │
       │                     │
       └──────────┬──────────┘
                  │
                  ▼
         ┌─────────────────┐
         │     ready       │ ──► loadContactsForPhone()
         └─────────────────┘

   Em qualquer estado ──► auth_failure ──► disconnected
   
   Watchdog: se ficar em 'connecting' por > 180s → connectPhone() automático
```

**Estados:**

| Estado | Descrição |
|---|---|
| `disconnected` | Sem cliente ativo. Dados LocalAuth podem ou não existir em disco. |
| `connecting` | Puppeteer iniciando ou autenticando. Watchdog ativo. |
| `qr` | QR gerado, aguardando scan do operador. |
| `ready` | Conectado e operacional. Pode enviar mensagens. |
| `error` | Falha não-recuperável (auth expirada, browser crash). Requer reconexão manual. |

---

## 5. Contratos de dados

### Phone (em memória)
```
id:             string        — "ph_{timestamp}_{counter}"
name:           string        — nome dado pelo operador (max 50 chars)
client:         Client|null   — instância whatsapp-web.js (null = desconectado)
status:         PhoneStatus   — ver seção 4
contacts:       Contact[]     — lista em memória (cacheada em disco)
watchdog:       Timeout|null  — timer do watchdog
lastActivityAt: number        — ms timestamp
```

### Contact
```
id:       string   — WhatsApp ID serializado ("5511999999999@c.us" ou "groupid@g.us")
name:     string   — nome do chat
isGroup:  boolean
unread:   number
imported: boolean  — true = veio de planilha (não existe no campo original do WA)
rowData:  Object   — dados da linha da planilha (para personalização, só em imported=true)
```

### SendJob (parâmetros de um disparo)
```
sessionId:    string
phoneId:      string
contactIds:   string[]          — lista de WhatsApp IDs
message:      string            — texto (pode ser vazio se só arquivo)
filename:     string|null       — nome do arquivo em uploads/ (somente basename)
delayMs:      number            — delay entre envios (mínimo: 1500)
contactsData: {[id]: Object}    — dados de planilha por contactId (para personalização)
```

### AuditEntry (linha do audit.jsonl)
```
t:       string   — ISO timestamp
event:   string   — "send:sent" | "send:failed" | "send:start" | "send:done" | "phone:connect" | "phone:disconnect"
session: string
phone:   string   — phoneId (em eventos de phone e send)
to:      string   — WhatsApp ID do destinatário (em eventos de send)
error:   string   — mensagem de erro (só em send:failed)
total:   number   — total de contatos (só em send:start)
sent:    number   — enviados com sucesso (só em send:done)
failed:  number   — falhas (só em send:done)
stopped: boolean  — parado pelo operador (só em send:done)
```

### PhoneListItem (payload dos eventos phones_list)
```
id:           string
name:         string
status:       PhoneStatus
contactCount: number
```

---

## 6. Catálogo de erros esperados

| Erro | Causa | Comportamento esperado |
|---|---|---|
| `auth_failure` | Sessão WhatsApp expirada ou corrompida | LocalAuth apagado; status `error`; operador deve escanear novo QR |
| `Target closed` / `context` | Browser crash (Puppeteer) | LocalAuth apagado; status `error`; mensagem específica orientando reconexão |
| `LID` / `invalid wid` | Número tem 9º dígito incompatível | Tenta reenviar sem o 9º dígito antes de falhar |
| Erro transiente (timeout, ECONNRESET) | Conexão instável durante envio | Retry com backoff exponencial, até 3 tentativas |
| Arquivo não encontrado no upload | Upload corrompido ou expirado | Erro 400: "Arquivo não encontrado" |
| Planilha vazia | Arquivo sem dados | Erro 400: "Planilha vazia" |
| `LIMIT_FILE_SIZE` (multer) | Arquivo > 100 MB | Erro 400 com limite em MB |
| Tipo de arquivo não permitido | Extensão fora da lista | Erro 400: "Tipo de arquivo não permitido" |
| Watchdog timeout | Puppeteer travado em connecting | `connectPhone()` é chamado novamente automaticamente |
| SHA-256 inválido no update | Download corrompido | Arquivo apagado; erro exibido; nenhuma alteração aplicada |

---

## 7. Limites e constantes

Estes valores não devem ser alterados sem atualizar esta SPEC primeiro.

| Constante | Valor | Significado |
|---|---|---|
| `MAX_PHONES_PER_SESSION` | 10 | Telefones por sessão |
| `MAX_CONTACTS_PER_SEND` | 5.000 | Contatos por disparo |
| `MAX_FILE_SIZE_BYTES` | 100 MB | Tamanho máximo de upload |
| `MAX_SHEET_ROWS` | 10.001 | Linhas lidas da planilha (1 header + 10.000 dados) |
| `MIN_SEND_DELAY_MS` | 1.500 ms | Delay mínimo entre envios |
| `DEFAULT_SEND_DELAY_MS` | 3.000 ms | Delay padrão |
| `WATCHDOG_TIMEOUT_MS` | 180.000 ms | Tempo em connecting antes do reconnect automático |
| `CONTACT_LOAD_RETRIES` | 8 | Tentativas de `getChats()` se retornar vazio |
| `SEND_MAX_RETRIES` | 3 | Tentativas por mensagem em erro transiente |
| `SEND_RETRY_BASE_MS` | 2.000 ms | Base do backoff exponencial (2s, 4s, 8s) |
| `SESSION_TTL_MS` | 4 horas | Tempo para sessão inativa ser removida da memória |
| `ORPHAN_FILE_AGE_MS` | 2 horas | Tempo para uploads sem dono serem apagados |
| `CLEANUP_INTERVAL_MS` | 1 hora | Intervalo de limpeza de arquivos e sessões |
| `AUDIT_RETENTION_DAYS` | 7 dias | Retenção do audit.jsonl; entradas mais antigas são purgadas automaticamente (**a implementar**) |
| `UPDATE_CHECK_INITIAL_MS` | 30.000 ms | Delay inicial da verificação de update |
| `UPDATE_CHECK_INTERVAL_MS` | 6 horas | Intervalo da verificação periódica de update |

**Limites de arquivo por tipo (WhatsApp):**

| Tipo | Limite |
|---|---|
| Imagem | 16 MB |
| Vídeo | 64 MB |
| Áudio | 16 MB |
| Documento | 100 MB |

---

## 8. Restrições de segurança

| Restrição | Implementação |
|---|---|
| Renderer não controla downloads | `download-update` usa `updater._pendingUpdate` cacheado no main process; ignora dados do renderer |
| Auth da API HTTP | Token de 32 bytes gerado em `%LOCALAPPDATA%\arx-send\.auth_token`, passado via header `x-auth-token` |
| Rate limiting | 60 requisições por minuto por IP na rota `/api/` |
| Context isolation | `nodeIntegration: false`, `contextIsolation: true`; somente APIs explícitas via `contextBridge` |
| Sem innerHTML com dados externos | Dados do WhatsApp e do usuário sempre via `textContent`; `esc()` ao interpolar em HTML |
| Upload path traversal | `path.basename(filename)` sempre antes de acessar arquivo de upload |
| CSP | `default-src 'self'`; fontes externas apenas para Google Fonts |

---

### F-008 — Formulário de contato (feedback e suporte)

**Descrição:** O operador pode abrir um formulário de contato para enviar feedback, sugestões ou pedidos de suporte. O formulário é um Google Form externo, aberto no navegador padrão do Windows. As respostas chegam diretamente à equipe ARX Send.

**Critérios de aceitação:**

| # | Dado | Quando | Então |
|---|------|--------|-------|
| 1 | Qualquer estado do app | Operador clica no botão "Contato / Suporte" | O Google Form abre no navegador padrão do Windows via `shell.openExternal()` |
| 2 | Navegador abriu | — | Toast exibido no app: "Formulário aberto no seu navegador." |
| 3 | `shell.openExternal()` falha | — | Toast de erro: "Não foi possível abrir o navegador. Acesse: [URL do form]" com a URL visível para cópia manual |

**Restrições:**
- A URL do Google Form é hardcoded: `https://forms.gle/BsiCqjt68pGTjsrG7` — registrada como `SUPPORT_FORM_URL` em `src/app/config.js`.
- Nenhum dado é enviado pelo backend — zero credenciais no código.
- O Google Form contém os campos: **Tipo** (múltipla escolha: Suporte técnico / Feedback / Sugestão de melhoria), **Seu email** e **Mensagem**.
- Se a URL do form mudar, atualizar `SUPPORT_FORM_URL` em `config.js` e publicar nova versão.

**Localização na UI:**
- Botão discreto no rodapé ou no menu/header principal, sempre visível independentemente da sessão ativa.

---

## 9. Fora de escopo

Estes comportamentos **não são** responsabilidade do ARX Send. Se surgir demanda, requer entrada nesta SPEC primeiro.

| Item | Motivo de exclusão |
|---|---|
| Agendamento de disparos | Não implementado; envio é sempre imediato |
| Confirmação de entrega / leitura | API não-oficial não expõe isso de forma confiável |
| Leitura de mensagens recebidas | App é somente emissor |
| Múltiplos usuários simultâneos na mesma sessão | Concorrência não tratada; design é single-operator |
| WhatsApp Business API oficial | Usa whatsapp-web.js (API não-oficial) |
| Analytics de campanhas | Somente audit log bruto; sem dashboards |
| Contatos internacionais (fora do Brasil) | Normalização de telefone só implementada para números brasileiros |
| Edição/exclusão de contatos no WhatsApp | App não modifica a agenda do telefone |
| Rastreamento de tickets de suporte | F-008 usa Google Form externo; não há sistema de tickets integrado |
| Resposta automática ao operador | Nenhuma confirmação de recebimento é enviada pelo app |

---

## 10. Backlog de implementação pendente

Comportamentos especificados nesta SPEC que ainda não existem no código.

_Nenhum item pendente no momento._
