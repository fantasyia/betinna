import { api, ApiError } from '@/lib/api';

/** O que o sync de produtos do Tiny devolve quando termina. */
export interface ResultadoSyncErp {
  lidos?: number;
  criados?: number;
  atualizados?: number;
  erros?: number;
  imagensFalharam?: number;
}

export type EstadoSyncErp =
  | { estado: 'enfileirado' }
  | { estado: 'rodando' }
  | { estado: 'concluido'; resultado: ResultadoSyncErp }
  | { estado: 'falhou'; erro: string };

/** Como a espera terminou. `demorou` e `cancelado` NÃO significam falha do sync. */
export type FimDaEspera =
  | { estado: 'concluido'; resultado: ResultadoSyncErp }
  | { estado: 'falhou'; erro: string }
  | { estado: 'demorou' }
  | { estado: 'cancelado' };

interface Opcoes {
  intervaloMs?: number;
  /** Depois disso a tela para de esperar — o sync continua no servidor. */
  limiteMs?: number;
  /** A tela saiu: para de consultar, sem aviso. */
  cancelado?: () => boolean;
  /** Injetáveis pra teste. */
  buscar?: (jobId: string) => Promise<EstadoSyncErp>;
  esperar?: (ms: number) => Promise<void>;
  agora?: () => number;
}

const buscarPadrao = (jobId: string) =>
  api.get<EstadoSyncErp>(`/integracoes/tiny/sync/produtos/${encodeURIComponent(jobId)}`);

const esperarPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Acompanha um sync do ERP que o servidor já aceitou (202).
 *
 * O sync roda no worker desde BETINNA-FRONT-9: antes ele rodava DENTRO do POST,
 * o catálogo passava dos 30s que o front espera, e a tela dizia "falha" com o
 * servidor terminando certinho. Aqui a tela só pergunta o estado de tempos em
 * tempos — nenhuma consulta segura conexão por muito tempo.
 *
 * Erro de rede numa consulta NÃO é falha do sync: a próxima volta tenta de
 * novo. Só o 404 encerra (o job sumiu ou não é desta empresa).
 */
export async function aguardarSyncErp(jobId: string, opcoes: Opcoes = {}): Promise<FimDaEspera> {
  const {
    intervaloMs = 2000,
    limiteMs = 10 * 60_000,
    cancelado = () => false,
    buscar = buscarPadrao,
    esperar = esperarPadrao,
    agora = Date.now,
  } = opcoes;

  const inicio = agora();
  for (;;) {
    await esperar(intervaloMs);
    if (cancelado()) return { estado: 'cancelado' };

    try {
      const r = await buscar(jobId);
      if (r.estado === 'concluido' || r.estado === 'falhou') return r;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { estado: 'falhou', erro: 'A sincronização não foi encontrada no servidor.' };
      }
      // Rede instável numa consulta: tenta de novo na próxima volta.
    }

    if (agora() - inicio >= limiteMs) return { estado: 'demorou' };
  }
}
