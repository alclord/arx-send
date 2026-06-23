
/**
 * @fileoverview state.js — único source of truth do frontend.
 *
 * Todo estado mutável vive aqui. Nenhum outro módulo declara variáveis
 * de estado globais — leem e escrevem via este objeto.
 *
 * Convenção: state.X para ler, state.X = Y para escrever.
 * Não há getters/setters — o objetivo é simplicidade, não encapsulamento.
 */

const state = {
  // ── Sessão ────────────────────────────────────────────────────────
  sessionId: null,

  // ── Telefones ─────────────────────────────────────────────────────
  /** @type {Array<{id:string,name:string,status:string,contactCount:number}>} */
  phones: [],
  /** @type {Object.<string, Array>} phoneId → contacts[] */
  phoneContacts: {},
  /** @type {Object.<string, {status:string,message:string}>} */
  phoneStatuses: {},
  /** Telefone selecionado no painel de contatos */
  selectedPhoneId: null,
  /** Telefone cujo QR está sendo exibido no modal */
  currentQrPhoneId: null,

  // ── Contatos / seleção ────────────────────────────────────────────
  /** Contatos do telefone selecionado */
  contacts: [],
  /** Contatos importados de planilha */
  importedContacts: [],
  /** IDs selecionados para envio */
  selectedIds: new Set(),
  currentFilter: 'all',
  /** Limite de itens visíveis na lista (paginação leve) */
  vsLimit: 200,

  // ── Planilha / variáveis ──────────────────────────────────────────
  sheetHeaders: [],
  /** Nome do arquivo de planilha importado (para confirmar import) */
  importFilename: null,

  // ── Modo de envio ─────────────────────────────────────────────────
  sendMode: 'text',
  selectedDelay: 3000,
  uploadedFile: null,

  // ── Estado de envio ───────────────────────────────────────────────
  isSending: false,
  /** Delay real usado no disparo em andamento (para o timer) */
  sendDelayMs: 0,

  // ── Auth ──────────────────────────────────────────────────────────
  authToken: null,

  // ── Update ────────────────────────────────────────────────────────
  pendingUpdateInfo: null,
};

// Expõe globalmente — os módulos que não usam import precisam de window.state
window.state = state;
