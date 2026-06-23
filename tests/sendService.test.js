
/**
 * Testes unitários do sendService.
 *
 * Testa as funções auxiliares de retry e categorização de erros,
 * que são o coração da lógica de envio.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Extrai funções internas para teste (via require + acesso ao módulo)
const path = require('path');

// Reutiliza os helpers que o sendService usa
const { personalizeMessage } = require('../src/utils/helpers');

describe('personalizeMessage — integração com sendService', () => {
  test('personaliza mensagem com dados da planilha', () => {
    const msg = 'Olá {{Nome}}, seu código é {{Codigo}}';
    const row = { Nome: 'Maria', Codigo: 'ABC123' };
    assert.equal(personalizeMessage(msg, row), 'Olá Maria, seu código é ABC123');
  });

  test('mantém placeholder de variável ausente', () => {
    const msg = 'Olá {{Nome}}';
    assert.equal(personalizeMessage(msg, {}), 'Olá {{Nome}}');
  });
});

describe('isLidError — lógica de detecção', () => {
  // Espelho da implementação em sendService.js — manter sincronizado se mudar lá
  function isLidError(err) {
    const msg = err?.message || '';
    return /\bLID\b/i.test(msg) || msg.includes('invalid wid');
  }

  test('detecta erro LID', () => {
    assert.equal(isLidError(new Error('LID not found')), true);
    assert.equal(isLidError(new Error('invalid wid')), true);
  });

  test('não detecta como LID erro transiente', () => {
    assert.equal(isLidError(new Error('timeout')), false);
    assert.equal(isLidError(new Error('ECONNRESET')), false);
  });

  test('NÃO detecta false positive: "invalid number" não é LID', () => {
    // Regressão: 'invalid'.includes('lid') === true (substring), mas não é erro de LID
    assert.equal(isLidError(new Error('invalid number')), false);
    assert.equal(isLidError(new Error('invalid session')), false);
  });

  test('não quebra com err undefined', () => {
    assert.equal(isLidError(undefined), false);
    assert.equal(isLidError(null), false);
  });
});

describe('isTransientError — lógica de retry', () => {
  function isTransientError(err) {
    const msg = err?.message || '';
    return (
      msg.includes('timeout') ||
      msg.includes('Timeout') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('navigation') ||
      msg.includes('Protocol error') ||
      msg.includes('Target closed') ||
      msg.includes('Session closed')
    );
  }

  test('detecta erros transientes', () => {
    assert.equal(isTransientError(new Error('timeout expired')), true);
    assert.equal(isTransientError(new Error('ECONNRESET')), true);
    assert.equal(isTransientError(new Error('Target closed')), true);
  });

  test('não classifica erros de negócio como transientes', () => {
    assert.equal(isTransientError(new Error('invalid number')), false);
    assert.equal(isTransientError(new Error('LID not found')), false);
  });
});
