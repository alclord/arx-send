'use strict';

/**
 * Testes de integração do fluxo de disparo — F-006 (Mass Send).
 *
 * Cobre: trySendWithRetry, sendMessages (happy path, retry/erros, stop,
 * delay mínimo, arquivo de mídia).
 *
 * Estratégia de mock: require.cache manipulation antes de carregar sendService.
 * Cada teste começa com um slate limpo via clearSvcCache() no beforeEach.
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Constantes de teste ───────────────────────────────────────────────────────

const TEST_SESSION  = 'test-session';
const TEST_PHONE_ID = 'ph_test_001';
const TEST_UPLOADS  = path.join(os.tmpdir(), 'arx-send-test-uploads');
const MOCK_IO       = {};

// Contatos com 9º dígito → removeNinthDigit produz altId
const IDS = [
  '5511999990001@c.us',
  '5511999990002@c.us',
  '5511999990003@c.us',
];

// Para testes de LID: ID com 9º dígito e seu alt
const LID_ID  = '5511987654321@c.us'; // 55+11+9+87654321 → 13 dígitos
const LID_ALT = '551187654321@c.us';  // sem o 9

// ID sem 9º dígito: removeNinthDigit retorna null (5º dígito = 8)
const NO_ALT_ID = '5511887654321@c.us';

// ── Helpers de cache ──────────────────────────────────────────────────────────

function clearSvcCache() {
  [
    '../src/services/sendService',
    '../src/services/sessionService',
    '../src/services/auditService',
    '../src/utils/helpers',
    '../src/app/config',
  ].forEach(m => {
    try { delete require.cache[require.resolve(m)]; } catch (_) {}
  });
  try { delete require.cache[require.resolve('whatsapp-web.js')]; } catch (_) {}
}

/**
 * Monta contexto com todas as dependências do sendService mockadas.
 * @param {{ sendImpl?: (id: string, ...args: any[]) => Promise<void> }} opts
 */
function buildCtx({ sendImpl } = {}) {
  const events   = [];
  const audit    = { starts: [], sends: [], dones: [] };
  const sleepLog = [];

  // Telefone com cliente mock
  const phone = {
    id: TEST_PHONE_ID,
    name: 'Telefone Teste',
    status: 'ready',
    contacts: IDS.map((id, i) => ({ id, name: ['Alice', 'Bob', 'Carol'][i] })),
    client: { sendMessage: sendImpl ?? (async () => {}) },
  };

  // Sessão em memória
  const session = {
    id: TEST_SESSION,
    isSending: false,
    stopRequested: false,
    lastActivityAt: Date.now(),
    phones: { [TEST_PHONE_ID]: phone },
  };

  // sessionService mock
  require.cache[require.resolve('../src/services/sessionService')] = {
    exports: {
      getSession: () => session,
      touchSession: () => {},
      emit: (_sid, _io, event, data) => events.push({ event, data }),
    },
  };

  // auditService mock
  require.cache[require.resolve('../src/services/auditService')] = {
    exports: {
      logSendStart: (sid, pid, total)   => audit.starts.push({ sid, pid, total }),
      logSend:      (sid, to, status, err) => audit.sends.push({ sid, to, status, err }),
      logSendDone:  (sid, pid, summary) => audit.dones.push({ sid, pid, ...summary }),
    },
  };

  // helpers mock: preserva funções reais, substitui sleep
  const realHelpers = require('../src/utils/helpers');
  require.cache[require.resolve('../src/utils/helpers')] = {
    exports: { ...realHelpers, sleep: async (ms) => sleepLog.push(ms) },
  };

  // whatsapp-web.js mock
  try {
    require.cache[require.resolve('whatsapp-web.js')] = {
      exports: {
        MessageMedia: { fromFilePath: (fp) => ({ _fp: fp, isMediaMock: true }) },
      },
    };
  } catch (_) {}

  // config mock: valores reais + uploadsDir de teste
  const realConfig = require('../src/app/config');
  require.cache[require.resolve('../src/app/config')] = {
    exports: { ...realConfig, uploadsDir: TEST_UPLOADS },
  };

  const sendService = require('../src/services/sendService');
  return { sendService, session, phone, events, audit, sleepLog };
}

// ── Setup global ──────────────────────────────────────────────────────────────

before(()  => fs.mkdirSync(TEST_UPLOADS, { recursive: true }));
after(()   => { try { fs.rmSync(TEST_UPLOADS, { recursive: true, force: true }); } catch (_) {} });

// ═════════════════════════════════════════════════════════════════════════════
// trySendWithRetry
// ═════════════════════════════════════════════════════════════════════════════

describe('trySendWithRetry', () => {
  beforeEach(clearSvcCache);

  test('ok:true em sucesso imediato — sendFn chamado uma vez', async () => {
    const { sendService } = buildCtx();
    let n = 0;
    const r = await sendService.trySendWithRetry(async () => { n++; }, 3, 100);
    assert.equal(r.ok, true);
    assert.equal(n, 1);
  });

  test('retenta em erro transiente; ok:true quando 2ª tentativa sucede', async () => {
    const { sendService, sleepLog } = buildCtx();
    let n = 0;
    const r = await sendService.trySendWithRetry(async () => {
      if (++n === 1) throw new Error('timeout');
    }, 3, 100);
    assert.equal(r.ok, true);
    assert.equal(n, 2);
    assert.equal(sleepLog.length, 1);
    assert.equal(sleepLog[0], 100); // baseDelay * 2^0
  });

  test('backoff exponencial: 100ms na 1ª falha, 200ms na 2ª', async () => {
    const { sendService, sleepLog } = buildCtx();
    let n = 0;
    await sendService.trySendWithRetry(async () => {
      if (++n <= 2) throw new Error('ECONNRESET');
    }, 3, 100);
    assert.equal(sleepLog[0], 100); // 100 * 2^0
    assert.equal(sleepLog[1], 200); // 100 * 2^1
  });

  test('NÃO retenta em erro não-transiente — sendFn chamado uma vez', async () => {
    const { sendService } = buildCtx();
    let n = 0;
    const r = await sendService.trySendWithRetry(async () => {
      n++;
      throw new Error('invalid number');
    }, 3, 100);
    assert.equal(r.ok, false);
    assert.equal(n, 1);
    assert.match(r.err.message, /invalid number/);
  });

  test('ok:false com último erro após esgotar todas as tentativas', async () => {
    const { sendService } = buildCtx();
    let n = 0;
    const r = await sendService.trySendWithRetry(async () => {
      throw new Error(`timeout ${++n}`);
    }, 3, 100);
    assert.equal(r.ok, false);
    assert.equal(n, 3);
    assert.match(r.err.message, /timeout 3/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendMessages — happy path
// ═════════════════════════════════════════════════════════════════════════════

describe('sendMessages — happy path', () => {
  beforeEach(clearSvcCache);

  const JOB = { contactIds: IDS, message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500 };

  test('emite send_start com total correto', async () => {
    const { sendService, events } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, JOB);
    const ev = events.find(e => e.event === 'send_start');
    assert.ok(ev, 'send_start não emitido');
    assert.equal(ev.data.total, 3);
  });

  test('emite send_progress:done para cada contato enviado com sucesso', async () => {
    const { sendService, events } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, JOB);
    const dones = events.filter(e => e.event === 'send_progress' && e.data.status === 'done');
    assert.equal(dones.length, 3);
  });

  test('emite send_done ao final do disparo', async () => {
    const { sendService, events } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, JOB);
    assert.ok(events.find(e => e.event === 'send_done'), 'send_done não emitido');
  });

  test('logSendDone com sentCount=3 e failedCount=0', async () => {
    const { sendService, audit } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, JOB);
    assert.equal(audit.dones[0].sent, 3);
    assert.equal(audit.dones[0].failed, 0);
  });

  test('personaliza mensagem com rowData de planilha', async () => {
    const msgs = [];
    const { sendService } = buildCtx({ sendImpl: async (_id, msg) => msgs.push(msg) });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]],
      message: 'Olá {{Nome}}',
      phoneId: TEST_PHONE_ID,
      delayMs: 1500,
      contactsData: { [IDS[0]]: { Nome: 'Alice' } },
    });
    assert.equal(msgs[0], 'Olá Alice');
  });

  test('delay não aplicado após o último contato — 3 contatos produzem 2 sleeps', async () => {
    const { sendService, sleepLog } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, JOB);
    assert.equal(sleepLog.length, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendMessages — retry e erros
// ═════════════════════════════════════════════════════════════════════════════

describe('sendMessages — retry e erros', () => {
  beforeEach(clearSvcCache);

  test('erro transiente: retenta e succeeds na 2ª tentativa → status:done', async () => {
    let n = 0;
    const { sendService, events } = buildCtx({
      sendImpl: async () => { if (++n === 1) throw new Error('timeout'); },
    });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]], message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.ok(events.find(e => e.event === 'send_progress' && e.data.status === 'done'));
  });

  test('erro transiente x3: emite status:error e continua para o próximo contato', async () => {
    const { sendService, events } = buildCtx({
      sendImpl: async (id) => {
        if (id === IDS[0]) throw new Error('Target closed');
      },
    });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0], IDS[1]], message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    const errs  = events.filter(e => e.event === 'send_progress' && e.data.status === 'error');
    const dones = events.filter(e => e.event === 'send_progress' && e.data.status === 'done');
    assert.equal(errs.length, 1);
    assert.equal(dones.length, 1);
  });

  test('mix sucesso/falha: sentCount e failedCount corretos no logSendDone', async () => {
    const { sendService, audit } = buildCtx({
      sendImpl: async (id) => {
        if (id === IDS[1]) throw new Error('Session closed');
      },
    });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: IDS, message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.equal(audit.dones[0].sent,   2);
    assert.equal(audit.dones[0].failed, 1);
  });

  test('erro LID: tenta sendMessage com removeNinthDigit(id) após falha', async () => {
    const sentTo = [];
    const { sendService } = buildCtx({
      sendImpl: async (id) => {
        sentTo.push(id);
        if (id === LID_ID) throw new Error('LID not found');
        // LID_ALT tem sucesso implícito
      },
    });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [LID_ID], message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.ok(sentTo.includes(LID_ID),  'ID original não tentado');
    assert.ok(sentTo.includes(LID_ALT), 'ID alternativo não tentado');
  });

  test('erro LID + alt-id falha → status:error + logSend:failed', async () => {
    const { sendService, events, audit } = buildCtx({
      sendImpl: async () => { throw new Error('LID error'); },
    });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [LID_ID], message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.ok(events.find(e => e.event === 'send_progress' && e.data.status === 'error'));
    assert.equal(audit.sends.filter(a => a.status === 'failed').length, 1);
  });

  test('erro LID em ID sem 9º dígito (altId=null) → status:error sem tentar alt', async () => {
    const sentTo = [];
    const { sendService, events } = buildCtx({
      sendImpl: async (id) => {
        sentTo.push(id);
        throw new Error('LID not found');
      },
    });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [NO_ALT_ID], message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    // Somente o ID original deve ter sido tentado (sem nenhum altId)
    assert.equal(sentTo.filter(id => id !== NO_ALT_ID).length, 0);
    assert.ok(events.find(e => e.event === 'send_progress' && e.data.status === 'error'));
  });

  test('erro não-transiente: não retenta (sendFn chamado 1x), emite status:error', async () => {
    let n = 0;
    const { sendService, events } = buildCtx({
      sendImpl: async () => { n++; throw new Error('invalid number'); },
    });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]], message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.equal(n, 1);
    assert.ok(events.find(e => e.event === 'send_progress' && e.data.status === 'error'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendMessages — parada pelo operador
// ═════════════════════════════════════════════════════════════════════════════

describe('sendMessages — parada pelo operador', () => {
  beforeEach(clearSvcCache);

  test('stop após 1º envio: emite send_stopped e não envia o 2º', async () => {
    let n = 0;
    const ctx = buildCtx();
    ctx.phone.client.sendMessage = async () => {
      if (++n === 1) ctx.session.stopRequested = true;
    };
    await ctx.sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: IDS, message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.ok(ctx.events.find(e => e.event === 'send_stopped'), 'send_stopped não emitido');
    assert.equal(n, 1, 'mais contatos enviados do que esperado após stop');
  });

  test('send_done emitido mesmo após stop', async () => {
    const ctx = buildCtx();
    ctx.session.stopRequested = true;
    await ctx.sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: IDS, message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.ok(ctx.events.find(e => e.event === 'send_done'), 'send_done não emitido');
  });

  test('logSendDone.stopped=true quando parado pelo operador', async () => {
    const ctx = buildCtx();
    // stopRequested deve ser ativado DURANTE o envio (sendMessages reseta para false no início)
    ctx.phone.client.sendMessage = async () => { ctx.session.stopRequested = true; };
    await ctx.sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: IDS, message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.equal(ctx.audit.dones[0].stopped, true);
  });

  test('isSending=false no finally mesmo após stop', async () => {
    const ctx = buildCtx();
    ctx.session.stopRequested = true;
    await ctx.sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: IDS, message: 'Olá', phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.equal(ctx.session.isSending, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendMessages — delay mínimo
// ═════════════════════════════════════════════════════════════════════════════

describe('sendMessages — delay mínimo', () => {
  beforeEach(clearSvcCache);

  const TWO = { contactIds: IDS.slice(0, 2), message: 'Olá', phoneId: TEST_PHONE_ID };

  test('delayMs=0 (falsy) → sleep com DEFAULT_SEND_DELAY_MS (3000)', async () => {
    // 0 é tratado como "não informado" pelo operador || — usa o padrão, não o mínimo
    const { sendService, sleepLog } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, { ...TWO, delayMs: 0 });
    assert.equal(sleepLog[0], 3000);
  });

  test('delayMs=500 → sleep com MIN_SEND_DELAY_MS (1500)', async () => {
    const { sendService, sleepLog } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, { ...TWO, delayMs: 500 });
    assert.equal(sleepLog[0], 1500);
  });

  test('delayMs=3000 → sleep com 3000', async () => {
    const { sendService, sleepLog } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, { ...TWO, delayMs: 3000 });
    assert.equal(sleepLog[0], 3000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendMessages — arquivo de mídia
// ═════════════════════════════════════════════════════════════════════════════

describe('sendMessages — arquivo de mídia', () => {
  const FIXTURE = 'fixture_test.jpg';
  let fixturePath;

  beforeEach(() => {
    clearSvcCache();
    fixturePath = path.join(TEST_UPLOADS, FIXTURE);
    fs.writeFileSync(fixturePath, 'fake image bytes');
  });

  test('arquivo existente + texto: sendMessage(id, media, {caption})', async () => {
    const calls = [];
    const { sendService } = buildCtx({ sendImpl: async (_id, ...a) => calls.push(a) });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]], message: 'Legenda', filename: FIXTURE,
      phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.ok(calls[0][0]?.isMediaMock, 'media não passou como 1º argumento');
    assert.deepEqual(calls[0][1], { caption: 'Legenda' });
  });

  test('arquivo existente sem texto: sendMessage(id, media) sem caption', async () => {
    const calls = [];
    const { sendService } = buildCtx({ sendImpl: async (_id, ...a) => calls.push(a) });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]], message: '', filename: FIXTURE,
      phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.ok(calls[0][0]?.isMediaMock);
    assert.equal(calls[0].length, 1, 'caption não deveria estar presente');
  });

  test('arquivo inexistente: sendMessage chamado apenas com texto', async () => {
    const calls = [];
    const { sendService } = buildCtx({ sendImpl: async (_id, ...a) => calls.push(a) });
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]], message: 'Só texto', filename: 'nao-existe.jpg',
      phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    assert.equal(typeof calls[0][0], 'string', 'esperava texto, recebeu objeto');
  });

  test('arquivo deletado no finally após envio completo', async () => {
    const { sendService } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]], message: 'Olá', filename: FIXTURE,
      phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    await new Promise(r => setTimeout(r, 100)); // unlink é assíncrono (callback)
    assert.equal(fs.existsSync(fixturePath), false, 'arquivo deveria ter sido deletado');
  });

  test('arquivo deletado no finally mesmo após stop', async () => {
    const ctx = buildCtx();
    ctx.session.stopRequested = true;
    await ctx.sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: IDS, message: 'Olá', filename: FIXTURE,
      phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(fs.existsSync(fixturePath), false, 'arquivo deveria ter sido deletado mesmo após stop');
  });

  test('sem filename: outros arquivos no uploads não são tocados', async () => {
    const extra = path.join(TEST_UPLOADS, 'should-survive.jpg');
    fs.writeFileSync(extra, 'content');
    const { sendService } = buildCtx();
    await sendService.sendMessages(TEST_SESSION, MOCK_IO, {
      contactIds: [IDS[0]], message: 'Olá',
      phoneId: TEST_PHONE_ID, delayMs: 1500,
    });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(fs.existsSync(extra), true, 'arquivo não relacionado foi deletado incorretamente');
    fs.unlinkSync(extra);
  });
});
