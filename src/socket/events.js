
/**
 * @fileoverview Catálogo canônico de todos os eventos Socket.io do ARX Send.
 *
 * Regra: NUNCA emitir um evento com nome hardcoded fora deste arquivo.
 * Use EVENTS.xxx para garantir consistência entre backend e frontend.
 *
 * Padrão de room: `s:{sessionId}` — uma room por sessão de usuário.
 */

const EVENTS = {
  // ── Cliente → Servidor ─────────────────────────────────────────────
  /** Frontend entra na sessão e recebe estado inicial */
  JOIN_SESSION: 'join_session',

  // ── Servidor → Cliente ─────────────────────────────────────────────

  /** Confirmação de entrada na sessão */
  SESSION_JOINED: 'session_joined',

  /** Lista completa de telefones da sessão */
  PHONES_LIST: 'phones_list',

  /** Atualização de status de um telefone específico */
  PHONE_STATUS: 'phone_status',

  /** QR code de um telefone (base64 data URL) */
  PHONE_QR: 'phone_qr',

  /** Contatos de um telefone (carregados ou atualizados) */
  PHONE_CONTACTS: 'phone_contacts',

  /** Disparo iniciado — fornece total de contatos */
  SEND_START: 'send_start',

  /**
   * Progresso do disparo.
   * @payload { index, total, name, status: 'sending'|'done'|'error', error? }
   */
  SEND_PROGRESS: 'send_progress',

  /** Disparo concluído normalmente */
  SEND_DONE: 'send_done',

  /** Disparo parado pelo usuário via /stop */
  SEND_STOPPED: 'send_stopped',

  /** Status de atualização de software */
  UPDATE_STATUS: 'update_status',
};

module.exports = { EVENTS };
