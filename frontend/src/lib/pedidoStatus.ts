// Lifecycle de pedido — defaults + resolução da config por tenant (no-code).
// Fonte ÚNICA: a ConfiguracoesPage edita e a PedidosPage consome (sem drift).
// O backend guarda em Empresa.config.pedidoStatusLabels (ver empresas.dto).

export type PedidoStatus =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO'
  | 'ENVIADO_OMIE'
  | 'PAGO'
  | 'EM_SEPARACAO'
  | 'ENVIADO'
  | 'ENTREGUE'
  | 'CANCELADO';

export const PEDIDO_STATUSES: PedidoStatus[] = [
  'RASCUNHO',
  'AGUARDANDO_APROVACAO',
  'ENVIADO_OMIE',
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
  ENVIADO_OMIE: 'Enviado ao OMIE',
  PAGO: 'Pago',
  EM_SEPARACAO: 'Em separação',
  ENVIADO: 'Enviado',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

export const STATUS_VARIANT_DEFAULT: Record<PedidoStatus, StatusVariant> = {
  RASCUNHO: 'neutral',
  AGUARDANDO_APROVACAO: 'warning',
  ENVIADO_OMIE: 'info',
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
  return cfg?.[status]?.label?.trim() || STATUS_LABEL_DEFAULT[status];
}

/** Cor (variant) efetiva do status: a custom do tenant, senão a default. */
export function resolveStatusVariant(
  status: PedidoStatus,
  cfg?: PedidoStatusConfig | null,
): StatusVariant {
  return cfg?.[status]?.variant ?? STATUS_VARIANT_DEFAULT[status];
}
