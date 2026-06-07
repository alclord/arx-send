const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, removeNinthDigit, personalizeMessage, sanitizeSessionId } = require('../src/utils/helpers');

// ── normalizePhone ──────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  test('número brasileiro com 9 dígito (sem código do país)', () => {
    assert.equal(normalizePhone('11987654321'), '5511987654321@c.us');
  });

  test('número com código do país 55 já incluído', () => {
    assert.equal(normalizePhone('5511987654321'), '5511987654321@c.us');
  });

  test('número com formatação (parênteses, espaços, hífen)', () => {
    assert.equal(normalizePhone('(11) 9 8765-4321'), '5511987654321@c.us');
  });

  test('número sem 9 dígito — 8 dígitos após DDD', () => {
    assert.equal(normalizePhone('1187654321'), '551187654321@c.us');
  });

  test('número muito curto retorna null', () => {
    assert.equal(normalizePhone('12345'), null);
  });

  test('número muito longo retorna null', () => {
    assert.equal(normalizePhone('5511987654321099'), null);
  });

  test('string vazia retorna null', () => {
    assert.equal(normalizePhone(''), null);
  });

  test('remove zeros à esquerda antes de processar', () => {
    assert.equal(normalizePhone('011987654321'), '5511987654321@c.us');
  });

  test('aceita número como inteiro', () => {
    assert.equal(normalizePhone(11987654321), '5511987654321@c.us');
  });

  test('DDD de SP (11) com 8 dígitos', () => {
    assert.equal(normalizePhone('1132104321'), '551132104321@c.us');
  });
});

// ── removeNinthDigit ────────────────────────────────────────────────────────

describe('removeNinthDigit', () => {
  test('remove o nono dígito de número celular com DDD 11', () => {
    assert.equal(removeNinthDigit('5511987654321@c.us'), '551187654321@c.us');
  });

  test('funciona com DDD 21 (Rio de Janeiro)', () => {
    assert.equal(removeNinthDigit('5521987654321@c.us'), '552187654321@c.us');
  });

  test('retorna null para número sem nono dígito (já 8 dígitos após DDD)', () => {
    assert.equal(removeNinthDigit('551187654321@c.us'), null);
  });

  test('retorna null para ID de grupo (@g.us)', () => {
    assert.equal(removeNinthDigit('5511987654321-1234567@g.us'), null);
  });

  test('retorna null para string inválida', () => {
    assert.equal(removeNinthDigit('invalid'), null);
  });

  test('retorna null para número sem sufixo @c.us', () => {
    assert.equal(removeNinthDigit('5511987654321'), null);
  });
});

// ── personalizeMessage ──────────────────────────────────────────────────────

describe('personalizeMessage', () => {
  test('substitui variável existente no template', () => {
    assert.equal(personalizeMessage('Olá {{Nome}}', { Nome: 'João' }), 'Olá João');
  });

  test('mantém placeholder se variável não existe no rowData', () => {
    assert.equal(personalizeMessage('Olá {{Nome}}', {}), 'Olá {{Nome}}');
  });

  test('substitui múltiplas variáveis diferentes no mesmo template', () => {
    const result = personalizeMessage('{{Saudacao}} {{Nome}}, CPF: {{CPF}}', {
      Saudacao: 'Olá',
      Nome: 'João',
      CPF: '123.456.789-00',
    });
    assert.equal(result, 'Olá João, CPF: 123.456.789-00');
  });

  test('template vazio retorna string vazia', () => {
    assert.equal(personalizeMessage('', { Nome: 'João' }), '');
  });

  test('sem variáveis retorna template original sem alteração', () => {
    assert.equal(personalizeMessage('Mensagem sem variáveis', {}), 'Mensagem sem variáveis');
  });

  test('remove espaços ao redor do nome da variável', () => {
    assert.equal(personalizeMessage('{{  Nome  }}', { Nome: 'João' }), 'João');
  });

  test('substitui a mesma variável várias vezes no template', () => {
    assert.equal(personalizeMessage('{{Nome}} e {{Nome}}', { Nome: 'Ana' }), 'Ana e Ana');
  });

  test('variável mista com placeholder mantido e variável substituída', () => {
    const result = personalizeMessage('{{Nome}} tem código {{Codigo}}', { Nome: 'Maria' });
    assert.equal(result, 'Maria tem código {{Codigo}}');
  });

  test('valor da variável pode conter caracteres especiais', () => {
    assert.equal(
      personalizeMessage('Valor: {{V}}', { V: 'R$ 1.500,00' }),
      'Valor: R$ 1.500,00'
    );
  });
});

// ── sanitizeSessionId ───────────────────────────────────────────────────────

describe('sanitizeSessionId', () => {
  test('converte para lowercase', () => {
    assert.equal(sanitizeSessionId('MinhaSession'), 'minhasession');
  });

  test('remove caracteres especiais, mantém apenas [a-z0-9_-]', () => {
    assert.equal(sanitizeSessionId('minha session!@#'), 'minhasession');
  });

  test('mantém hífen e underscore', () => {
    assert.equal(sanitizeSessionId('minha-session_1'), 'minha-session_1');
  });

  test('limita a 30 caracteres', () => {
    const long = 'a'.repeat(50);
    assert.equal(sanitizeSessionId(long).length, 30);
  });

  test('retorna string vazia para null', () => {
    assert.equal(sanitizeSessionId(null), '');
  });

  test('retorna string vazia para undefined', () => {
    assert.equal(sanitizeSessionId(undefined), '');
  });

  test('retorna string vazia para string vazia', () => {
    assert.equal(sanitizeSessionId(''), '');
  });

  test('aceita combinação de letras, números, hífen e underscore', () => {
    assert.equal(sanitizeSessionId('yuri-2024_test'), 'yuri-2024_test');
  });
});
