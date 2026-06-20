/**
 * Pedido mínimo configurável por tenant (ConfiguracaoTenant → Empresa.config.pedidoMinimo).
 * Função pura: recebe a regra + os totais do pedido e diz se atende, com o que falta.
 * Usada no preview (info em tempo real) e no envio (gate). Backward-compat: sem
 * regra ou `sem_minimo` → sempre ok.
 */

export type PedidoMinimoTipo =
  | 'sem_minimo'
  | 'por_valor'
  | 'por_peso'
  | 'por_quantidade'
  | 'combinada';

export interface PedidoMinimoRegra {
  tipo?: PedidoMinimoTipo;
  /** Valor mínimo em R$ (soma dos itens). */
  valorMin?: number;
  /** Peso mínimo em kg (Σ quantidade × pesoPorUnidade). */
  pesoMin?: number;
  /** Quantidade mínima de unidades. */
  quantidadeMin?: number;
  /** Combinador pra `combinada`: E (todos) | OU (qualquer um). Default E. */
  modo?: 'E' | 'OU';
}

export interface PedidoMinimoTotais {
  valor: number;
  peso: number;
  quantidade: number;
}

export type PedidoMinimoCriterio = 'valor' | 'peso' | 'quantidade';

export interface PedidoMinimoFalta {
  criterio: PedidoMinimoCriterio;
  minimo: number;
  atual: number;
  /** Quanto falta pra atingir o mínimo (sempre > 0 numa falta). */
  falta: number;
}

export interface PedidoMinimoResultado {
  ok: boolean;
  tipo: PedidoMinimoTipo;
  /** Combinador efetivo quando `combinada`. */
  modo?: 'E' | 'OU';
  /** Critérios não atendidos (vazio quando ok). */
  faltas: PedidoMinimoFalta[];
  /** Mensagem pt-BR pronta pra exibir/erro (undefined quando ok). */
  mensagem?: string;
}

const fmtMoeda = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtNum = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v);

function rotuloCriterio(c: PedidoMinimoCriterio, v: number): string {
  if (c === 'valor') return fmtMoeda(v);
  if (c === 'peso') return `${fmtNum(v)} kg`;
  return `${fmtNum(v)} un`;
}

/**
 * Avalia a regra contra os totais. `regra` pode vir do JSON da config (untyped),
 * então tratamos campos ausentes/zerados como "critério não configurado".
 */
export function avaliarPedidoMinimo(
  regra: PedidoMinimoRegra | null | undefined,
  totais: PedidoMinimoTotais,
): PedidoMinimoResultado {
  const tipo: PedidoMinimoTipo = regra?.tipo ?? 'sem_minimo';

  if (!regra || tipo === 'sem_minimo') {
    return { ok: true, tipo: 'sem_minimo', faltas: [] };
  }

  // Monta os critérios ativos conforme o tipo (só os que têm mínimo > 0).
  const candidatos: Array<{ criterio: PedidoMinimoCriterio; minimo?: number; atual: number }> = [];
  const usaValor = tipo === 'por_valor' || tipo === 'combinada';
  const usaPeso = tipo === 'por_peso' || tipo === 'combinada';
  const usaQtd = tipo === 'por_quantidade' || tipo === 'combinada';
  if (usaValor) candidatos.push({ criterio: 'valor', minimo: regra.valorMin, atual: totais.valor });
  if (usaPeso) candidatos.push({ criterio: 'peso', minimo: regra.pesoMin, atual: totais.peso });
  if (usaQtd)
    candidatos.push({
      criterio: 'quantidade',
      minimo: regra.quantidadeMin,
      atual: totais.quantidade,
    });

  const ativos = candidatos.filter(
    (c): c is { criterio: PedidoMinimoCriterio; minimo: number; atual: number } =>
      typeof c.minimo === 'number' && c.minimo > 0,
  );

  // Tipo setado mas sem nenhum limite configurado → nada a exigir.
  if (ativos.length === 0) {
    return { ok: true, tipo, faltas: [] };
  }

  const modo: 'E' | 'OU' = tipo === 'combinada' ? (regra.modo ?? 'E') : 'E';
  const atendidos = ativos.filter((c) => c.atual >= c.minimo);
  const naoAtendidos = ativos.filter((c) => c.atual < c.minimo);

  const ok = modo === 'OU' ? atendidos.length >= 1 : naoAtendidos.length === 0;

  if (ok) {
    return { ok: true, tipo, modo: tipo === 'combinada' ? modo : undefined, faltas: [] };
  }

  // No modo OU nenhum foi atendido → mostra todos os caminhos possíveis.
  const faltas: PedidoMinimoFalta[] = naoAtendidos.map((c) => ({
    criterio: c.criterio,
    minimo: c.minimo,
    atual: c.atual,
    falta: Math.max(0, c.minimo - c.atual),
  }));

  const partes = faltas.map(
    (f) =>
      `${rotuloCriterio(f.criterio, f.falta)} (mínimo ${rotuloCriterio(f.criterio, f.minimo)})`,
  );
  const mensagem =
    modo === 'OU'
      ? `Pedido abaixo do mínimo. Atinja um destes: faltam ${partes.join(' OU ')}.`
      : `Pedido abaixo do mínimo. Faltam ${partes.join(' e ')}.`;

  return { ok: false, tipo, modo: tipo === 'combinada' ? modo : undefined, faltas, mensagem };
}
