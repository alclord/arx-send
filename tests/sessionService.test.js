
/**
 * Testes de integração do sessionService.
 *
 * Verifica as operações de CRUD de telefones e as invariantes críticas
 * da distinção logout vs destroy.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Isola o módulo para cada teste (evita estado global entre testes)
let sessionService;
beforeEach(() => {
  Object.keys(require.cache).forEach(k => {
    if (k.includes('sessionService') || k.includes('phoneStore') || k.includes('connectionManager') || k.includes('contactManager')) {
      delete require.cache[k];
    }
  });
  sessionService = require('../src/services/sessionService');
});

describe('getSession', () => {
  test('cria sessão nova se não existir', () => {
    const sess = sessionService.getSession('test1');
    assert.equal(sess.id, 'test1');
    assert.deepEqual(sess.phones, {});
    assert.equal(sess.isSending, false);
  });

  test('retorna mesma sessão em chamadas subsequentes', () => {
    const a = sessionService.getSession('test2');
    const b = sessionService.getSession('test2');
    assert.equal(a, b);
  });
});

describe('addPhone / renamePhone / removePhone', () => {
  test('addPhone adiciona telefone com ID único', () => {
    const sess = sessionService.getSession('test3');
    const id = sessionService.addPhone('test3', 'Celular A');
    assert.ok(id);
    assert.ok(sess.phones[id]);
    assert.equal(sess.phones[id].name, 'Celular A');
    assert.equal(sess.phones[id].status, 'disconnected');
  });

  test('addPhone respeita limite de MAX_PHONES_PER_SESSION', () => {
    const sessionId = 'test-limit';
    sessionService.getSession(sessionId);
    for (let i = 0; i < sessionService.MAX_PHONES_PER_SESSION; i++) {
      sessionService.addPhone(sessionId, `Phone ${i}`);
    }
    const extra = sessionService.addPhone(sessionId, 'Extra');
    assert.equal(extra, null);
  });

  test('renamePhone altera o nome do telefone', () => {
    const sid = 'test-rename';
    const sess = sessionService.getSession(sid);
    const id = sessionService.addPhone(sid, 'Antigo');
    sessionService.renamePhone(sid, id, 'Novo');
    assert.equal(sess.phones[id].name, 'Novo');
  });

  test('removePhone remove o telefone da sessão', () => {
    const sid = 'test-remove';
    const sess = sessionService.getSession(sid);
    const id = sessionService.addPhone(sid, 'Temp');
    sessionService.removePhone(sid, id);
    assert.equal(sess.phones[id], undefined);
  });
});

describe('phonesListPayload', () => {
  test('retorna array com campos corretos', () => {
    const sid = 'test-payload';
    const sess = sessionService.getSession(sid);
    const id = sessionService.addPhone(sid, 'Test Phone');
    const payload = sessionService.phonesListPayload(sess);
    const item = payload.find(p => p.id === id);
    assert.ok(item);
    assert.equal(item.name, 'Test Phone');
    assert.equal(item.status, 'disconnected');
    assert.equal(item.contactCount, 0);
  });
});

describe('destroyAllSessions — invariante logout vs destroy', () => {
  test('destroyAllSessions não chama logout em nenhum client', async () => {
    const sid = 'test-destroy';
    const sess = sessionService.getSession(sid);
    const id = sessionService.addPhone(sid, 'Phone');

    let logoutCalled = false;
    let destroyCalled = false;

    // Injeta um client mock que rastreia as chamadas
    sess.phones[id].client = {
      logout: async () => { logoutCalled = true; },
      destroy: async () => { destroyCalled = true; },
    };
    sess.phones[id].status = 'ready';

    await sessionService.destroyAllSessions();

    assert.equal(logoutCalled, false, 'destroyAllSessions NÃO deve chamar logout()');
    assert.equal(destroyCalled, true, 'destroyAllSessions deve chamar destroy()');
    assert.equal(sess.phones[id].status, 'disconnected');
    assert.equal(sess.phones[id].client, null);
  });
});
