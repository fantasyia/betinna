import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyWebhookProcessorService } from './tiny-webhook-processor.service';

/**
 * Processamento dos webhooks do Tiny.
 *
 * Os payloads destes testes são REAIS — copiados da fila de produção depois dos
 * pedidos de teste. Mock inventado aqui seria o mesmo erro do preview e das
 * comissões: teste que valida a expectativa do código, não o contrato de fora.
 */
const EVENTO_PEDIDO = JSON.stringify({
  versao: '1.0.1',
  cnpj: '16774052000155',
  tipo: 'atualizacao_pedido',
  dados: {
    id: '335860454',
    numero: '4',
    codigoSituacao: 'cancelado',
    descricaoSituacao: 'Cancelado',
    idContato: '894891895',
  },
});

const EVENTO_ESTOQUE = JSON.stringify({
  versao: '1.0.1',
  cnpj: '16774052000155',
  tipo: 'estoque',
  dados: { idProduto: 335240597, sku: 'MB-01', nome: 'Master Block MB-01', saldo: 0 },
});

function build(eventos: string[], opts: { empresaCnpj?: string | null; novo?: boolean } = {}) {
  const naFila = eventos.map((payload, i) =>
    JSON.stringify({ tipo: 'pedido', hash: `h${i}`, recebidoEm: '2026-08-29T06:00:00Z', payload }),
  );
  const redis = {
    rpop: vi.fn().mockResolvedValue(naFila),
    setNxEx: vi.fn().mockResolvedValue(opts.novo ?? true),
  };
  const prisma = {
    empresa: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          opts.empresaCnpj === null
            ? []
            : [{ id: 'emp-1', cnpj: opts.empresaCnpj ?? '16.774.052/0001-55' }],
        ),
    },
    integracaoConexao: { findMany: vi.fn().mockResolvedValue([{ empresaId: 'emp-1' }]) },
  };
  const produtos = { sincronizarUm: vi.fn().mockResolvedValue(true) };
  const aplicador = { sincronizarUm: vi.fn().mockResolvedValue('atualizado') };
  const svc = new TinyWebhookProcessorService(redis as never, prisma as never, produtos as never);
  return { svc, redis, prisma, produtos, aplicador };
}

describe('webhooks do Tiny — processamento', () => {
  beforeEach(() => vi.clearAllMocks());

  it('evento de pedido RECONSULTA o pedido em vez de acreditar no payload', async () => {
    // O corpo diz "cancelado". Ele NÃO é assinado — quem decide é a API.
    const { svc, aplicador } = build([EVENTO_PEDIDO]);

    const r = await svc.processarPendentes(aplicador as never);

    expect(aplicador.sincronizarUm).toHaveBeenCalledWith('emp-1', 335860454);
    expect(r.aplicados).toBe(1);
  });

  it('evento de estoque reconsulta o produto (o saldo do payload não é o que a tela usa)', async () => {
    const { svc, produtos, aplicador } = build([EVENTO_ESTOQUE]);

    await svc.processarPendentes(aplicador as never);

    expect(produtos.sincronizarUm).toHaveBeenCalledWith('emp-1', 335240597);
  });

  it('CNPJ que não bate com empresa nenhuma NÃO é aplicado', async () => {
    // Sem isso, um evento da empresa A mexeria nos dados da B — a URL do
    // webhook é a mesma pra todo mundo.
    const { svc, aplicador, produtos } = build([EVENTO_PEDIDO], { empresaCnpj: null });

    const r = await svc.processarPendentes(aplicador as never);

    expect(aplicador.sincronizarUm).not.toHaveBeenCalled();
    expect(produtos.sincronizarUm).not.toHaveBeenCalled();
    expect(r.ignorados).toBe(1);
  });

  it('retentativa do mesmo evento não aplica de novo', async () => {
    // O Tiny reenvia até 10 vezes quando não recebe 200.
    const { svc, aplicador } = build([EVENTO_PEDIDO], { novo: false });

    const r = await svc.processarPendentes(aplicador as never);

    expect(aplicador.sincronizarUm).not.toHaveBeenCalled();
    expect(r.repetidos).toBe(1);
  });

  it('um evento quebrado não derruba o lote', async () => {
    const { svc, aplicador } = build(['{isso não é json}', EVENTO_PEDIDO]);

    const r = await svc.processarPendentes(aplicador as never);

    expect(r.erros).toBe(1);
    expect(r.aplicados).toBe(1);
  });

  it('fila vazia não faz nada (nem log, nem chamada)', async () => {
    const { svc, aplicador, redis } = build([]);
    redis.rpop.mockResolvedValue([]);

    const r = await svc.processarPendentes(aplicador as never);

    expect(r.lidos).toBe(0);
    expect(aplicador.sincronizarUm).not.toHaveBeenCalled();
  });
});
