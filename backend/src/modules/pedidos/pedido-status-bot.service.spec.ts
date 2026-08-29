import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PedidoStatusBotService } from './pedido-status-bot.service';

/**
 * O bot respondendo "cadê meu pedido?".
 *
 * Dois riscos moram aqui, e os dois são piores que não responder: contar o
 * pedido de OUTRA pessoa (o casamento é por telefone) e anexar histórico de
 * compra numa conversa que não pediu nada disso.
 */
function build(linhas: Array<Record<string, unknown>> = []) {
  const prisma = { $queryRaw: vi.fn().mockResolvedValue(linhas) };
  return { svc: new PedidoStatusBotService(prisma as never), prisma };
}

const PEDIDO = {
  numero: 'PED-0006',
  numeroSite: null,
  status: 'ENVIADO',
  total: 300,
  rastreioCodigo: 'BR123',
  rastreioUrl: 'https://rastreio/BR123',
  criadoEm: new Date('2026-08-20T12:00:00Z'),
};

describe('status do pedido pro bot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('só considera pergunta de pedido quando é sobre pedido', () => {
    const { svc } = build();

    expect(svc.ehPerguntaDePedido('meu pedido já saiu?')).toBe(true);
    expect(svc.ehPerguntaDePedido('tem código de rastreio?')).toBe(true);
    expect(svc.ehPerguntaDePedido('bom dia, tudo bem?')).toBe(false);
  });

  it('traduz o status pra linguagem de CLIENTE e mostra o rastreio', async () => {
    // "ENVIADO_ERP" não diz nada pra quem comprou.
    const { svc } = build([PEDIDO]);

    const texto = await svc.contextoPorTelefone('emp-1', '5519999990000');

    expect(texto).toContain('PED-0006');
    expect(texto).toContain('a caminho');
    expect(texto).toContain('BR123');
    expect(texto).toContain('não invente');
  });

  it('usa o número DO SITE quando a compra veio de lá', async () => {
    // É o número que o cliente conhece — falar "PED-0006" não ajuda ninguém.
    const { svc } = build([{ ...PEDIDO, numeroSite: 'SB1234' }]);

    const texto = await svc.contextoPorTelefone('emp-1', '5519999990000');

    expect(texto).toContain('SB1234');
    expect(texto).not.toContain('PED-0006');
  });

  it('sem pedido casado, devolve VAZIO (e não "não encontrei")', async () => {
    // Vazio deixa a IA seguir normal; um texto de "nenhum pedido" viraria
    // resposta esquisita numa conversa que só tocou no assunto de passagem.
    const { svc } = build([]);

    expect(await svc.contextoPorTelefone('emp-1', '5519999990000')).toBe('');
  });

  it('telefone curto demais nem consulta (não dá pra casar com segurança)', async () => {
    const { svc, prisma } = build([PEDIDO]);

    expect(await svc.contextoPorTelefone('emp-1', '1234')).toBe('');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('falha de banco não derruba a conversa (fail-open)', async () => {
    const { svc, prisma } = build();
    prisma.$queryRaw.mockRejectedValue(new Error('conexão caiu'));

    expect(await svc.contextoPorTelefone('emp-1', '5519999990000')).toBe('');
  });
});
