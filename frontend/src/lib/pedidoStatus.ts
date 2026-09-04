// Lifecycle de pedido — defaults + resolução da config por tenant (no-code).
// Fonte ÚNICA: a ConfiguracoesPage edita e a PedidosPage consome (sem drift).
// O backend guarda em Empresa.config.pedidoStatusLabels (ver empresas.dto).

export type PedidoStatus =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO'
  /** Contrato assinado — travado esperando a liberação no ERP. */
  | 'AGUARDANDO_LIBERACAO'
  | 'ENVIADO_ERP'
  | 'PAGO'
  | 'EM_SEPARACAO'
  | 'ENVIADO'
  | 'ENTREGUE'
  | 'CANCELADO';

export const PEDIDO_STATUSES: PedidoStatus[] = [
  'RASCUNHO',
  'AGUARDANDO_APROVACAO',
  'AGUARDANDO_LIBERACAO',
  'ENVIADO_ERP',
  'PAGO',
  'EM_SEPARACAO',
  'ENVIADO',
  'ENTREGUE',
  'CANCELADO',
];

export type StatusVariant = 'neutral' | 'warning' | 'info' | 'success' | 'primary' | 'danger';

export const STATUS_VARIANTS: StatusVariant[] = [
  'neutral',
  'warning',
  'info',
  'success',
  'primary',
  'danger',
];

/** Rótulo amigável de cada variant (pro select de cor no Admin). */
export const VARIANT_LABEL: Record<StatusVariant, string> = {
  neutral: 'Cinza',
  warning: 'Amarelo',
  info: 'Azul',
  success: 'Verde',
  primary: 'Roxo',
  danger: 'Vermelho',
};

export const STATUS_LABEL_DEFAULT: Record<PedidoStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  AGUARDANDO_LIBERACAO: 'Aguardando liberação no ERP',
  ENVIADO_ERP: 'Enviado ao ERP',
  PAGO: 'Pago',
  EM_SEPARACAO: 'Em separação',
  ENVIADO: 'Enviado',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

export const STATUS_VARIANT_DEFAULT: Record<PedidoStatus, StatusVariant> = {
  RASCUNHO: 'neutral',
  AGUARDANDO_APROVACAO: 'warning',
  AGUARDANDO_LIBERACAO: 'warning',
  ENVIADO_ERP: 'info',
  PAGO: 'success',
  EM_SEPARACAO: 'primary',
  ENVIADO: 'info',
  ENTREGUE: 'success',
  CANCELADO: 'danger',
};

export interface PedidoStatusMeta {
  label?: string;
  variant?: StatusVariant;
}
/** Config do tenant: override por status (Empresa.config.pedidoStatusLabels). */
export type PedidoStatusConfig = Partial<Record<PedidoStatus, PedidoStatusMeta>>;

/** Nome efetivo do status: o custom do tenant, senão o default. */
export function resolveStatusLabel(status: PedidoStatus, cfg?: PedidoStatusConfig | null): string {
  // Fallback pro PRÓPRIO nome do status: em 04/09 o backend ganhou
  // AGUARDANDO_LIBERACAO, o front não conhecia a chave, e a página de pedidos
  // inteira caiu no "Algo deu errado" — por causa de um rótulo. Status novo
  // pode ficar feio na tela; não pode derrubar a tela.
  return cfg?.[status]?.label?.trim() || STATUS_LABEL_DEFAULT[status] || String(status);
}

/** Cor (variant) efetiva do status: a custom do tenant, senão a default. */
export function resolveStatusVariant(
  status: PedidoStatus,
  cfg?: PedidoStatusConfig | null,
): StatusVariant {
  return cfg?.[status]?.variant ?? STATUS_VARIANT_DEFAULT[status] ?? 'neutral';
}
