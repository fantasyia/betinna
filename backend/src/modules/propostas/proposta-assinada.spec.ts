import { describe, expect, it, vi } from 'vitest';
import { PropostasService } from './propostas.service';
import { PropostaErpService } from './proposta-erp.service';

/**
 * "Aceita" e "assinada" são fatos diferentes.
 *
 * Aceite é o cliente dizendo que quer — e o pedido nasce rascunho. Assinatura é
 * o DOCUMENTO existindo: aí o pedido trava, a comissão entra no cronograma e o
 * contrato sobe pro ERP. Com um status só, olhar a lista de propostas não dizia
 * se o contrato tinha voltado; era preciso abrir o contrato pra saber.
 *
 * Vale só pra LOCAÇÃO, que gera contrato. Venda termina em ACEITA.
 */
const transicao = (de: string, para: string) => {
  const svc = new PropostasService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return () =>
    (
      svc as unknown as { assertTransicaoValida: (a: string, b: string) => void }
    ).assertTransicaoValida(de, para);
};

describe('máquina de estados da proposta', () => {
  it('ACEITA deixou de ser final — a locação ainda vai ser assinada', () => {
    expect(transicao('ACEITA', 'ASSINADA')).not.toThrow();
  });

  it('ASSINADA é o fim da linha: documento assinado não se desfaz por tela', () => {
    for (const destino of ['ACEITA', 'RECUSADA', 'EXPIRADA', 'ENVIADA']) {
      expect(transicao('ASSINADA', destino), destino).toThrow(/Transição inválida/);
    }
  });

  it('não dá pra pular o aceite e ir direto pra assinada', () => {
    // Quem move pra ASSINADA é o webhook da assinatura eletrônica, sobre um
    // contrato que só existe depois do aceite.
    for (const origem of ['RASCUNHO', 'ENVIADA', 'NEGOCIACAO', 'AGUARDANDO_ASSINATURA']) {
      expect(transicao(origem, 'ASSINADA'), origem).toThrow(/Transição inválida/);
    }
  });
});

describe('gerar pedido no ERP', () => {
  const build = (status: string) => {
    const prisma = {
      proposta: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'p1',
          numero: 'PROP-1',
          status,
          orcamentoErpId: '900',
          pedidoErpId: null,
          cliente: { nome: 'Indústria X' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const orcamentos = { gerarVenda: vi.fn().mockResolvedValue({ id: 5, numeroPedido: '10' }) };
    const svc = new PropostaErpService(
      prisma as never,
      orcamentos as never,
      {} as never,
      { criarParaRole: vi.fn().mockResolvedValue(undefined) } as never,
    );
    return { svc, orcamentos };
  };

  it('proposta ASSINADA gera pedido — é o caminho da locação', async () => {
    const { svc, orcamentos } = build('ASSINADA');

    await expect(svc.gerarPedido('p1', 'emp-1')).resolves.toMatchObject({ pedidoErpId: '5' });
    expect(orcamentos.gerarVenda).toHaveBeenCalled();
  });

  it('proposta ACEITA continua gerando — é o caminho da venda', async () => {
    const { svc } = build('ACEITA');

    await expect(svc.gerarPedido('p1', 'emp-1')).resolves.toMatchObject({ pedidoErpId: '5' });
  });

  it('em negociação, segue recusada', async () => {
    const { svc, orcamentos } = build('NEGOCIACAO');

    await expect(svc.gerarPedido('p1', 'emp-1')).rejects.toThrow(/ACEITA/);
    expect(orcamentos.gerarVenda).not.toHaveBeenCalled();
  });
});
