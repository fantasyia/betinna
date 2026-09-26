import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { NotFoundException } from '@shared/errors/app-exception';
import type { ResultadoSync } from './tiny-produtos-sync.service';
import { TINY_SYNC_PRODUTOS_QUEUE, type TinySyncProdutosJobData } from './tiny.types';

export type EstadoSyncProdutos =
  | { estado: 'enfileirado' }
  | { estado: 'rodando' }
  | { estado: 'concluido'; resultado: ResultadoSync }
  | { estado: 'falhou'; erro: string };

/** Estados em que o job ainda vai rodar ou está rodando. */
const ESTADOS_VIVOS = ['waiting', 'delayed', 'active', 'prioritized', 'paused'] as const;

/**
 * Lado da API do sync de produtos disparado pela tela: enfileira e responde
 * na hora; quem roda é o worker (`TinyProdutosSyncProcessor`).
 *
 * O job concluído fica guardado por um dia — é de lá que a tela lê o resultado
 * ("N novos, M atualizados") depois que o worker termina.
 */
@Injectable()
export class TinyProdutosSyncFilaService {
  constructor(
    @InjectQueue(TINY_SYNC_PRODUTOS_QUEUE)
    private readonly fila: Queue<TinySyncProdutosJobData, ResultadoSync>,
  ) {}

  /**
   * Enfileira o sync da empresa — ou devolve o que já está na fila.
   *
   * O segundo clique (outra aba, página recarregada no meio) acompanha o sync
   * que já existe em vez de disparar outro catálogo inteiro contra o Tiny. Era
   * exatamente essa a duplicação que o timeout provocava.
   */
  async enfileirar(
    empresaId: string,
    modo: TinySyncProdutosJobData['modo'],
  ): Promise<{ jobId: string; jaEmAndamento: boolean }> {
    const vivo = await this.jobVivoDaEmpresa(empresaId);
    if (vivo?.id) return { jobId: vivo.id, jaEmAndamento: true };

    // `_` e não `:` — o BullMQ v5 rejeita `:` em jobId customizado (já parou o
    // worker de fluxos inteiro uma vez).
    const jobId = `sync-produtos_${empresaId}_${Date.now()}`;
    await this.fila.add(
      'sync-produtos',
      { empresaId, modo },
      {
        jobId,
        // Sem retentativa automática: o sync é pesado e bate na API do Tiny,
        // que tem rate limit. Falhou → a tela diz que falhou e a pessoa decide.
        attempts: 1,
        removeOnComplete: { age: 24 * 3600, count: 200 },
        removeOnFail: { age: 7 * 24 * 3600, count: 200 },
      },
    );
    return { jobId, jaEmAndamento: false };
  }

  async status(empresaId: string, jobId: string): Promise<EstadoSyncProdutos> {
    const job = await this.fila.getJob(jobId);
    // Job de OUTRA empresa responde igual a job inexistente: o id não confirma
    // nem nega que exista algo fora do tenant de quem pergunta.
    if (!job || job.data?.empresaId !== empresaId) {
      throw new NotFoundException('Sincronização', jobId);
    }

    const estado = await job.getState();
    if (estado === 'completed') return { estado: 'concluido', resultado: job.returnvalue };
    if (estado === 'failed') {
      return { estado: 'falhou', erro: job.failedReason || 'falha desconhecida' };
    }
    if (estado === 'active') return { estado: 'rodando' };
    return { estado: 'enfileirado' };
  }

  private async jobVivoDaEmpresa(
    empresaId: string,
  ): Promise<Job<TinySyncProdutosJobData, ResultadoSync> | undefined> {
    const jobs = await this.fila.getJobs([...ESTADOS_VIVOS]);
    return jobs.find((j) => j?.data?.empresaId === empresaId);
  }
}
