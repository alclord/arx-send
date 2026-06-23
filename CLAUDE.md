# ARX Send — Guia para IA (CLAUDE.md)

## O que é este projeto

App desktop Windows para disparo em massa de mensagens WhatsApp.
Stack: Electron 42 + Express 4 + Socket.io 4 + whatsapp-web.js + HTML/JS vanilla.

## Mapa de módulos

```
src/
  main.js              — processo principal Electron (window, tray, IPC, updater)
  app/
    index.js           — fábrica do Express + registro de rotas e middlewares
    config.js          — ÚNICA fonte de constantes e paths. Não duplicar aqui.
    security.js        — AUTH_TOKEN, rate limiter, middleware de autenticação
    http.js            — cria http.Server e io (Socket.io)
  services/
    sessionService.js  — FACHADA: re-exporta phoneStore + connectionManager + contactManager
    phoneStore.js      — CRUD de telefones em disco (sem lógica de conexão)
    connectionManager.js — ciclo de vida da conexão WhatsApp (connect/disconnect/watchdog)
    contactManager.js  — carregamento e cache de contatos via getChats()
    sendService.js     — fila de disparo, retry, delay
    auditService.js    — audit trail em JSONL
    cleanupService.js  — limpeza de uploads órfãos
    mediaService.js    — validação e upload de arquivos
    updateService.js   — estado do auto-updater no processo Express
  routes/
    sessionRoutes.js   — CRUD de telefones via HTTP
    sendRoutes.js      — POST /send e /stop
    healthRoutes.js    — GET /api/health
    logRoutes.js       — GET /api/logs
    updateRoutes.js    — POST /api/update/install
    sheetRoutes.js     — parse e extração de planilhas
    uploadRoutes.js    — upload de arquivos de mídia
  socket/
    handlers.js        — join_session e auto-reconexão
    events.js          — CATÁLOGO de todos os eventos Socket.io
  utils/
    logger.js          — Logger singleton (intercepta console.*)
    helpers.js         — sanitizeSessionId, normalizePhone, personalizeMessage, sleep
    errors.js          — AppError, Errors, errorHandler middleware
    chromium.js        — localiza o executável do Chrome
  updater/
    autoUpdater.js     — download e aplicação de updates (asar ou installer)
  types/
    index.js           — JSDoc @typedef para Phone, Session, Contact, SendJob, etc.
  electron/
    preload.js         — expõe window.electronAPI via contextBridge
public/
  index.html           — UI principal
  js/
    state.js           — ÚNICO source of truth do frontend (window.state)
    send-flow.js       — progress, timer countdown, start/stop
    updater-ui.js      — banner de update, IPC Electron
    socket-client.js   — Socket.io connect, join_session, todos os event handlers
    app.js             — bootstrap e funções de UI residual
```

## Invariantes críticas — NUNCA violar

### 1. logout() vs destroy()

| Situação | Ação correta |
|---|---|
| App fechando (`destroyAllSessions`) | **APENAS `client.destroy()`** |
| Usuário clica "Desconectar" | `logout()` + `destroy()` |
| Usuário remove telefone (`removePhone`) | `logout()` + `destroy()` + `deletePhoneData()` |

**Por que:** `logout()` apaga os dados LocalAuth em disco. Se chamado no fechamento,
força novo QR code na próxima abertura. Bug original: v2.1.6 e anteriores.

### 2. Estado de frontend via `window.state`

Todo estado mutável do frontend vive em `state.js`.
NUNCA declarar variáveis de estado (`let contacts = []`) em nenhum outro arquivo JS.
Leia e escreva via `state.X`.

### 3. Segurança de dados no IPC Electron

O main.js NUNCA usa dados passados pelo renderer para operações sensíveis.
O `download-update` usa `updater._pendingUpdate` (cacheado no main process).
O renderer não controla o que é baixado.

### 4. Sem innerHTML com dados externos

Use `setText(el, value)` para dados vindos do WhatsApp ou do usuário.
`setHTML()` só para HTML estático controlado pelo código.
`esc()` ao interpolar dados em strings HTML.

### 5. room Socket.io = `s:{sessionId}`

Nunca emitir eventos globalmente — sempre para o room correto.
Use `io.to(\`s:${sessionId}\`).emit(EVENTS.X, data)`.
Os nomes dos eventos estão todos em `src/socket/events.js`.

## Onde cada coisa deve ir

- Nova constante de configuração → `src/app/config.js`
- Novo evento Socket.io → declarar em `src/socket/events.js` primeiro
- Novo tipo de dado → `src/types/index.js`
- Novo erro de validação → `src/utils/errors.js`
- Nova rota REST → `src/routes/` + registrar em `src/app/index.js`
- Novo estado de UI → `public/js/state.js`

## Anti-patterns a evitar

- `console.log` direto no backend — use `logger.info/warn/error`
- Variáveis globais no frontend fora de `state.js`
- Chamar `logout()` no fechamento do app
- Usar `innerHTML` com dados do usuário ou do WhatsApp
- Emitir eventos Socket.io com strings hardcoded — use `EVENTS.X`
- Passar objetos sensíveis pelo IPC do renderer para o main
- `fs.mkdirSync` fora do `ensureDirectories()` em `app/index.js`

## Commits e releases

- Commits em português ou inglês, imperativos curtos
- Bump de versão apenas em `package.json`
- Release via GitHub Actions (`.github/workflows/release.yml`) ou script PowerShell em `scripts/`
- 3 artefatos obrigatórios: `.exe`, `app.asar`, `release.json`

## Testes

```bash
node --test tests/utils.test.js
```

Antes de refatorar qualquer serviço, escrever testes para o fluxo que será alterado.
