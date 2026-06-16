import type { NodePayload, PaletteItem } from './types';

/**
 * ⭐ CONTRATO DE ROTEAMENTO centralizado.
 *
 * O `id` do handle de saída de um nó VIRA o `label` da aresta; SÓ o label é
 * persistido. Na carga, o `sourceHandle` é RECONSTRUÍDO a partir de
 * (label + modo do nó de origem). São 3 convenções:
 *
 *  - CONDIÇÃO simples: handles id='true'/'false'; no connect viram label
 *    'Sim'/'Não'; na carga 'Sim'→'true', 'Não'→'false'.
 *  - CONDIÇÃO roteador: id do handle = valor da saída literal; label = o próprio
 *    id; reservados bloqueados via norm()/RESERVADOS.
 *  - CONVERSAR_IA: handles 'classificou'/'timeout'/'erro' (condicionados a
 *    aguardarResposta!==false && timeoutHoras>0).
 *
 * labelDaAresta() e reconstruirSourceHandle() são inversas no round-trip pra
 * cada convenção — o backend roteia a execução por isso, não pode quebrar.
 */

// ─── Saídas (handles) de um nó ───────────────────────────────────

/**
 * Descritor de um handle de saída. O `id` (quando definido) vira o label da
 * aresta. `cor` é a classe Tailwind do bg do handle; `rotulo`/`txt` são o
 * rótulo flutuante das saídas do CONVERSAR_IA; `pos` é o `left` (style) do
 * handle quando posicionado por índice (undefined = sem override).
 */
export interface SaidaHandle {
  id?: string;
  cor: string;
  rotulo?: string;
  txt?: string;
  pos?: string;
}

/**
 * Lista de handles de saída de um nó — as 3 convenções do contrato. O NodeCard
 * usa isto pra renderizar os <Handle> de saída (substitui a lógica inline,
 * mantendo render idêntico).
 *
 * - CONDIÇÃO simples → ['true' (verde, 30%), 'false' (vermelho, 70%)]
 * - CONDIÇÃO roteador → cada saída de config.saidas + 'default' (cinza),
 *   posicionados por índice
 * - CONVERSAR_IA com timeout → ['classificou','timeout','erro'] (com rótulos);
 *   sem timeout → [main (sem id), 'erro']
 * - demais → 1 saída sem id (sem override de posição)
 */
export function saidasDoNo(data: NodePayload): SaidaHandle[] {
  const tipo = data.tipo;

  if (tipo === 'CONDICAO') {
    if ((data.config?.modo as string) === 'roteador') {
      const arr = [...(((data.config?.saidas as string[]) ?? [])), 'default'];
      return arr.map((s, i) => ({
        id: s,
        cor: s === 'default' ? '!bg-muted' : '!bg-primary',
        pos: `${((i + 1) / (arr.length + 1)) * 100}%`,
      }));
    }
    return [
      { id: 'true', cor: '!bg-success', pos: '30%' },
      { id: 'false', cor: '!bg-danger', pos: '70%' },
    ];
  }

  if (data.acaoTipo === 'CONVERSAR_IA') {
    // "classificou"/"timeout" só quando aguarda resposta com timeout; "erro"
    // aparece SEMPRE (falha de IA/WhatsApp pode ocorrer em qualquer modo).
    const comTimeout =
      (data.config?.aguardarResposta as boolean | undefined) !== false &&
      Number(data.config?.timeoutHoras ?? 0) > 0;
    const saidas: SaidaHandle[] = comTimeout
      ? [
          { id: 'classificou', cor: '!bg-success', rotulo: '🟢 classificou', txt: 'text-success' },
          { id: 'timeout', cor: '!bg-warning', rotulo: '🟠 timeout', txt: 'text-warning' },
          { id: 'erro', cor: '!bg-danger', rotulo: '🔴 erro', txt: 'text-danger' },
        ]
      : [
          { cor: '!bg-primary' },
          { id: 'erro', cor: '!bg-danger', rotulo: '🔴 erro', txt: 'text-danger' },
        ];
    return saidas.map((s, i) => ({
      ...s,
      pos: `${((i + 1) / (saidas.length + 1)) * 100}%`,
    }));
  }

  // Demais nós: uma saída única, sem id (vira aresta sem label).
  return [{ cor: '!bg-primary' }];
}

// ─── Round-trip do label da aresta ↔ sourceHandle ────────────────

/**
 * Regra do onConnect: o `sourceHandle` do handle de origem vira o `label` da
 * aresta. Condição simples: 'true'→'Sim', 'false'→'Não'. Roteador: o label É o
 * id do handle (o valor da saída, ou 'default'). Demais nós: sem label.
 */
export function labelDaAresta(sourceHandle: string | null | undefined): string | undefined {
  return sourceHandle === 'true'
    ? 'Sim'
    : sourceHandle === 'false'
      ? 'Não'
      : (sourceHandle ?? undefined);
}

/**
 * Regra da hidratação: reconstrói o `sourceHandle` a partir do `label` + modo do
 * nó de origem (o sourceHandle não é persistido, só o label). No ROTEADOR o
 * label JÁ é o id do handle (valor da saída / 'default') — usa direto. No
 * SIMPLES, 'Sim'→'true' / 'Não'→'false'. (Antes mapeava Sim/Não cego e quebrava
 * roteador com saída chamada "Sim"/"Não".)
 *
 * Inversa de labelDaAresta() no round-trip pra cada convenção.
 */
export function reconstruirSourceHandle(
  label: string | null | undefined,
  sourceNodeData: NodePayload | undefined,
): string | undefined {
  const isRoteador =
    sourceNodeData?.tipo === 'CONDICAO' && sourceNodeData.config?.['modo'] === 'roteador';
  return isRoteador
    ? (label ?? undefined)
    : label === 'Sim'
      ? 'true'
      : label === 'Não'
        ? 'false'
        : (label ?? undefined);
}

// ─── Saídas do roteador: dedup / reservados / normalização ───────

/**
 * Remove saídas duplicadas EXATAS do config de um nó na hidratação. Saída
 * repetida gera handle id/React key duplicado no NodeCard (React Flow exige id
 * único por nó) e faz remover/renomear (por valor) afetar as duas de uma vez.
 * Dedup no load evita esse estado inconsistente (a validação já impede criar
 * novas duplicatas).
 */
export function dedupConfigSaidas(config: Record<string, unknown>): Record<string, unknown> {
  const saidas = config['saidas'];
  if (!Array.isArray(saidas)) return config;
  const unicas = Array.from(new Set(saidas as string[]));
  return unicas.length === saidas.length ? config : { ...config, saidas: unicas };
}

/**
 * Reservados: colidiriam com os handles implícitos (true/false do simples e o
 * 'default' do roteador) e quebrariam o roteamento da aresta.
 */
export const RESERVADOS = ['default', 'true', 'false', 'sim', 'não', 'nao'];

/**
 * Normaliza igual ao matching do backend (avaliarCondicao: trim + toLowerCase),
 * colapsando espaços internos. Duas saídas que normalizam igual roteariam ambas
 * pro PRIMEIRO match no motor → a segunda viraria ramo morto. Por isso
 * bloqueamos.
 */
export function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Config default por item de paleta ───────────────────────────

export function defaultConfig(item: PaletteItem): Record<string, unknown> {
  if (item.manual) return { manual: true, descricao: '' };
  if (item.triggerTipo === 'CRON_AGENDADO')
    return { cronFreq: 'dias_uteis', cronHorario: '09:00', timezone: 'America/Sao_Paulo' };
  if (item.tipo === 'DELAY') return { quantidade: 1, unidade: 'horas' };
  if (item.tipo === 'CONDICAO') return { modo: 'simples', operador: 'eq' };
  if (item.acaoTipo === 'ENVIAR_WHATSAPP') return { mensagem: '', destinatarioModo: 'lead' };
  if (item.acaoTipo === 'ENVIAR_EMAIL') return { assunto: '', corpo: '' };
  if (item.acaoTipo === 'WEBHOOK_EXTERNO') return { url: '', method: 'POST' };
  if (item.acaoTipo === 'MUDAR_TAG') return { operacao: 'adicionar', tagNome: '' };
  if (item.acaoTipo === 'CONVERSAR_IA') return { aguardarResposta: true, timeoutHoras: 24 };
  if (item.acaoTipo === 'LIBERAR_LOTE') return { quantidade: 50 };
  // Trava simples — sem config visível. Desliga o bot na conversa (botLigado=false).
  // O backend (acaoPausarIa) trata religar:true como religar; ausente = pausar.
  if (item.acaoTipo === 'PAUSAR_IA') return { acao: 'pausar_ia' };
  return {};
}
