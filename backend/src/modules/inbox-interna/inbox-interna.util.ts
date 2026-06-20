/**
 * Inbox interna — config por tenant (Empresa.config.inboxInterna) + motor de horas úteis.
 */

export interface InboxTipo {
  key: string;
  nome: string;
  /** SLA de 1ª resposta em horas úteis. */
  slaHorasUteis: number;
  /** false = canal só-leitura (broadcast/avisos); rep não responde. */
  permiteResposta: boolean;
  prioridade: 'baixa' | 'media' | 'alta' | 'urgente';
  /** Papéis que recebem (informativo). */
  destinatariosPapeis?: string[];
}

export interface InboxConfig {
  tipos: InboxTipo[];
}

export const INBOX_CONFIG_DEFAULT: InboxConfig = {
  tipos: [
    {
      key: 'diretor_comercial',
      nome: 'Direto com Diretor Comercial',
      slaHorasUteis: 48,
      permiteResposta: true,
      prioridade: 'alta',
      destinatariosPapeis: ['DIRECTOR'],
    },
    {
      key: 'suporte_pedidos',
      nome: 'Suporte Pedidos',
      slaHorasUteis: 8,
      permiteResposta: true,
      prioridade: 'media',
      destinatariosPapeis: ['SAC', 'GERENTE'],
    },
    {
      key: 'avisos',
      nome: 'Avisos',
      slaHorasUteis: 0,
      permiteResposta: false,
      prioridade: 'baixa',
    },
  ],
};

export function resolveInboxConfig(raw: unknown): InboxConfig {
  const r = (raw ?? {}) as Partial<InboxConfig>;
  const tipos = Array.isArray(r.tipos)
    ? r.tipos
        .map((t) => t as Partial<InboxTipo>)
        .filter((t) => typeof t.key === 'string' && typeof t.nome === 'string')
        .map((t) => ({
          key: t.key as string,
          nome: t.nome as string,
          slaHorasUteis: typeof t.slaHorasUteis === 'number' ? t.slaHorasUteis : 24,
          permiteResposta: t.permiteResposta !== false,
          prioridade: (t.prioridade ?? 'media') as InboxTipo['prioridade'],
          destinatariosPapeis: Array.isArray(t.destinatariosPapeis)
            ? t.destinatariosPapeis
            : undefined,
        }))
    : INBOX_CONFIG_DEFAULT.tipos;
  return { tipos: tipos.length > 0 ? tipos : INBOX_CONFIG_DEFAULT.tipos };
}

const HORA_INICIO = 8; // 08:00
const HORA_FIM = 18; // 18:00 → 10h úteis/dia

/**
 * Soma `horas` úteis a partir de `base`, contando só seg–sex das 08:00 às 18:00.
 * Não considera feriados (refinamento futuro). Retorna a data/hora resultante.
 */
export function addHorasUteis(base: Date, horas: number): Date {
  const d = new Date(base.getTime());
  let restanteMs = horas * 60 * 60 * 1000;
  const PASSO_MS = 30 * 60 * 1000; // avança de 30 em 30 min
  while (restanteMs > 0) {
    d.setTime(d.getTime() + PASSO_MS);
    const dow = d.getDay();
    const h = d.getHours() + d.getMinutes() / 60;
    const ehUtil = dow !== 0 && dow !== 6 && h > HORA_INICIO && h <= HORA_FIM;
    if (ehUtil) restanteMs -= PASSO_MS;
  }
  return d;
}
