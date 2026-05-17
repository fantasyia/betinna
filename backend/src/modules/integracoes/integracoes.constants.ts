/**
 * Catálogo de serviços externos suportados.
 *
 * Cada entrada identifica a integração na tabela `IntegracaoConexao` (escopo empresa)
 * ou `UsuarioIntegracao` (escopo usuário).
 */

/** Integrações com escopo EMPRESA — uma conexão por empresa. */
export const SERVICOS_EMPRESA = [
  'omie',
  'whatsapp',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'instagram',
  'facebook',
] as const;
export type ServicoEmpresa = (typeof SERVICOS_EMPRESA)[number];

/** Integrações com escopo USUÁRIO — uma conexão por usuário (cada rep tem a sua). */
export const SERVICOS_USUARIO = [
  'google_calendar',
  'sendgrid',
  'openai',
  'anthropic',
  // WhatsApp pessoal — cada rep conecta o próprio celular/número via Baileys.
  // O WhatsApp empresa (central) continua em SERVICOS_EMPRESA.
  'whatsapp',
] as const;
export type ServicoUsuario = (typeof SERVICOS_USUARIO)[number];

export const SERVICOS_INTEGRACAO = [...SERVICOS_EMPRESA, ...SERVICOS_USUARIO] as const;
export type ServicoIntegracao = (typeof SERVICOS_INTEGRACAO)[number];

export type ServicoTipo =
  | 'erp'
  | 'mensageria'
  | 'marketplace'
  | 'social'
  | 'ia'
  | 'email'
  | 'agenda';
/** 'ambos' indica que o serviço aceita ambos os escopos (ex: WhatsApp empresa OU pessoal). */
export type ServicoEscopo = 'empresa' | 'usuario' | 'ambos';

/**
 * Metadados sobre cada serviço — usados em docs/UI.
 *
 * `requerDirector` (D45 — 2026-05-17): quando true, apenas usuários com role
 * DIRECTOR podem conectar/desconectar/forçar sync deste serviço. ADMIN é
 * bypass-all em todas as outras permissões, MAS NÃO neste flag — é um
 * privilégio reservado ao decisor da empresa (não ao operacional/TI).
 *
 * OMIE = true porque conectar o ERP altera dados fiscais/contábeis críticos
 * e a responsabilidade contratual é do diretor (não do admin de sistema).
 */
export const SERVICO_METADATA: Record<
  ServicoIntegracao,
  {
    nome: string;
    tipo: ServicoTipo;
    escopo: ServicoEscopo;
    obrigatorio: boolean;
    requerDirector?: boolean;
  }
> = {
  omie: {
    nome: 'OMIE ERP',
    tipo: 'erp',
    escopo: 'empresa',
    obrigatorio: true,
    requerDirector: true,
  },
  whatsapp: { nome: 'WhatsApp (Baileys)', tipo: 'mensageria', escopo: 'ambos', obrigatorio: false },
  mercadolivre: {
    nome: 'Mercado Livre',
    tipo: 'marketplace',
    escopo: 'empresa',
    obrigatorio: false,
  },
  shopee: { nome: 'Shopee', tipo: 'marketplace', escopo: 'empresa', obrigatorio: false },
  amazon: { nome: 'Amazon SP-API', tipo: 'marketplace', escopo: 'empresa', obrigatorio: false },
  tiktok: { nome: 'TikTok Shop', tipo: 'marketplace', escopo: 'empresa', obrigatorio: false },
  instagram: { nome: 'Instagram Direct', tipo: 'social', escopo: 'empresa', obrigatorio: false },
  facebook: { nome: 'Facebook Messenger', tipo: 'social', escopo: 'empresa', obrigatorio: false },
  google_calendar: {
    nome: 'Google Calendar',
    tipo: 'agenda',
    escopo: 'usuario',
    obrigatorio: false,
  },
  sendgrid: { nome: 'SendGrid', tipo: 'email', escopo: 'usuario', obrigatorio: false },
  openai: { nome: 'OpenAI', tipo: 'ia', escopo: 'usuario', obrigatorio: false },
  anthropic: { nome: 'Anthropic Claude', tipo: 'ia', escopo: 'usuario', obrigatorio: false },
};

/**
 * Retorna true se o serviço requer role DIRECTOR para conectar/desconectar.
 * Centralizado pra UI + backend usarem mesma fonte da verdade.
 */
export function servicoRequerDirector(servico: ServicoIntegracao): boolean {
  return SERVICO_METADATA[servico].requerDirector === true;
}

export function isServicoEmpresa(s: string): s is ServicoEmpresa {
  return (SERVICOS_EMPRESA as readonly string[]).includes(s);
}
export function isServicoUsuario(s: string): s is ServicoUsuario {
  return (SERVICOS_USUARIO as readonly string[]).includes(s);
}
