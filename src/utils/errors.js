
/**
 * @fileoverview Tipos de erro estruturados do ARX Send.
 *
 * Use AppError para erros esperados (validação, estado inválido).
 * Erros inesperados (bugs) devem continuar como Error nativos e logar stack.
 */

class AppError extends Error {
  /**
   * @param {string} message      - Mensagem legível por humanos
   * @param {number} [statusCode] - HTTP status code (padrão 400)
   * @param {string} [code]       - Código de erro para o cliente (ex: 'PHONE_NOT_READY')
   */
  constructor(message, statusCode = 400, code) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** @type {Record<string, (detail?: string) => AppError>} */
const Errors = {
  SESSION_INVALID: () => new AppError('sessionId inválido', 400, 'SESSION_INVALID'),
  PHONE_NOT_FOUND: () => new AppError('Telefone não encontrado', 404, 'PHONE_NOT_FOUND'),
  PHONE_NOT_READY: () => new AppError('Telefone não conectado', 400, 'PHONE_NOT_READY'),
  PHONE_LIMIT: (max) => new AppError(`Máximo de ${max} telefones por sessão`, 400, 'PHONE_LIMIT'),
  SEND_IN_PROGRESS: () => new AppError('Envio já em andamento', 400, 'SEND_IN_PROGRESS'),
  NO_CONTACTS: () => new AppError('Nenhum contato selecionado', 400, 'NO_CONTACTS'),
  NO_CONTENT: () => new AppError('Mensagem ou arquivo obrigatório', 400, 'NO_CONTENT'),
  UPDATER_NOT_READY: () => new AppError('Updater não inicializado', 503, 'UPDATER_NOT_READY'),
  NO_PENDING_UPDATE: () =>
    new AppError('Nenhuma atualização verificada. Clique em Verificar novamente.', 400, 'NO_PENDING_UPDATE'),
};

/**
 * Middleware Express para tratar AppError de forma consistente.
 * @param {AppError|Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}

module.exports = { AppError, Errors, errorHandler };
