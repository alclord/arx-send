
/**
 * @fileoverview Contratos de dados do ARX Send — JSDoc types para todo o sistema.
 *
 * Estes tipos documentam os dados que circulam entre backend e frontend.
 * Nunca instancie estes "tipos" — eles existem só como documentação.
 */

/**
 * @typedef {Object} Phone
 * @property {string} id          - Identificador único (ex: "ph_1234567890")
 * @property {string} name        - Nome amigável dado pelo usuário
 * @property {import('whatsapp-web.js').Client|null} client - Instância do cliente WA (null = desconectado)
 * @property {PhoneStatus} status - Estado atual da conexão
 * @property {Contact[]} contacts - Contatos em memória (também cacheados em disco)
 * @property {ReturnType<typeof setTimeout>|null} watchdog - Timer de watchdog (null = inativo)
 * @property {number} lastActivityAt - Timestamp da última atividade (ms)
 */

/**
 * @typedef {'disconnected'|'connecting'|'qr'|'ready'|'error'} PhoneStatus
 *
 * Diagrama de estados:
 *   disconnected → connecting → qr → connecting → ready
 *                           ↓
 *                      auth_failure → disconnected
 *   ready → disconnected (desconexão inesperada)
 */

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {Object.<string, Phone>} phones - Mapa phoneId → Phone
 * @property {boolean} isSending             - Envio em andamento
 * @property {boolean} stopRequested         - Parada solicitada pelo usuário
 * @property {number} lastActivityAt
 */

/**
 * @typedef {Object} Contact
 * @property {string} id       - Serialized WhatsApp ID (ex: "5511999999999@c.us")
 * @property {string} name     - Nome do chat
 * @property {boolean} isGroup - true = grupo, false = contato individual
 * @property {number} unread   - Mensagens não lidas
 */

/**
 * @typedef {Object} SendJob
 * @property {string} sessionId
 * @property {string} phoneId
 * @property {string[]} contactIds
 * @property {string} [message]   - Texto (pode estar vazio se só tiver arquivo)
 * @property {string} [filename]  - Nome do arquivo em uploads/ (path.basename seguro)
 * @property {number} delayMs     - Delay entre envios (mínimo: config.MIN_SEND_DELAY_MS)
 * @property {Object.<string, Object>} [contactsData] - Dados da planilha por contactId
 */

/**
 * @typedef {Object} PhoneListItem - Payload enviado ao frontend via phones_list
 * @property {string} id
 * @property {string} name
 * @property {PhoneStatus} status
 * @property {number} contactCount
 */

/**
 * @typedef {Object} AuditEntry
 * @property {string} t        - ISO timestamp
 * @property {string} session
 * @property {string} to       - Destinatário (WhatsApp ID)
 * @property {'sent'|'failed'} status
 * @property {string} [error]
 * @property {string} [phoneId]
 */

/**
 * @typedef {Object} UpdateCheckResult
 * @property {boolean} updateAvailable
 * @property {string} [version]          - Nova versão disponível
 * @property {boolean} [electronChanged] - Se o Electron mudou (requer instalador completo)
 */

module.exports = {};
