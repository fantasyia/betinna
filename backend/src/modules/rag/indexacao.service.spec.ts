import { describe, expect, it, vi } from 'vitest';
import { IndexacaoService } from './indexacao.service';

/**
 * Reindexar trecho editado (#08, 01/11): o BullMQ ignora o add quando o job de
 * mesmo id ainda está guardado como concluído — o trecho ficava com o vetor velho.
 */
function montar(anterior: { concluido?: boolean; falho?: boolean } | null) {
  const job = anterior && {
    isCompleted: vi.fn().mockResolvedValue(!!anterior.concluido),
    isFailed: vi.fn().mockResolvedValue(!!anterior.falho),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const queue = {
    getJob: vi.fn().mockResolvedValue(job),
    add: vi.fn().mockResolvedValue({}),
  };
  const svc = new IndexacaoService(queue as never, {} as never, {} as never);
  return { svc, queue, job };
}

describe('IndexacaoService.enfileirarChunk', () => {
  it('job anterior CONCLUÍDO: tira da fila e enfileira de novo', async () => {
    const { svc, queue, job } = montar({ concluido: true });
    await svc.enfileirarChunk('c1', 'e1');
    expect(job!.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'indexar',
      { tipo: 'chunk', id: 'c1', empresaId: 'e1' },
      expect.objectContaining({ jobId: 'chunk_c1' }),
    );
  });

  it('job anterior FALHO: idem', async () => {
    const { svc, job, queue } = montar({ falho: true });
    await svc.enfileirarChunk('c1', 'e1');
    expect(job!.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it('job ainda pendente: não remove (o add com o mesmo id não duplica)', async () => {
    const { svc, job, queue } = montar({});
    await svc.enfileirarChunk('c1', 'e1');
    expect(job!.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it('sem job anterior: só enfileira', async () => {
    const { svc, queue } = montar(null);
    await svc.enfileirarChunk('c1', 'e1');
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
