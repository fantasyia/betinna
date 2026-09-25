import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropostaAceiteService } from './proposta-aceite.service';

/**
 * O link de aceite é o ponto ÚNICO por onde a proposta vai ao cliente (e-mail
 * e WhatsApp do rep usam o mesmo link). Regra do Léo (25/09): a locação não
 * sai sem TUDO o que o contrato exige, inclusive o celular de quem assina.
 * Antes o link só conferia o projeto anexado e o resto era descoberto no
 * aceite — o cliente aceitava e o contrato não saía.
 */

const COMPLETA = {
  id: 'prop-27',
  numero: 'PROP-0027',
  valor: 1528,
  modalidade: 'LOCACAO',
  signatarioNome: 'Marina Torres Aguiar',
  signatarioEmail: 'pedido@somatecblocking.com.br',
  signatarioTelefone: '+5511999998888',
  validoAte: new Date('2026-10-24T12:00:00Z'),
  prazoEntregaDias: 45,
  prazoInstalacaoDias: 15,
  prazoVerificacaoDias: 5,
  prazoSoftwareDias: 7,
  servicosTotal: 12000,
  customizacaoUnitario: 1500,
  customizacaoQuantidade: 1,
  itens: [
    {
      produtoId: 'prod-mb04',
      quadroPainel: 'QGBT',
      tensaoV: 380,
      correnteA: 420,
      quantidade: 1,
      total: 1528,
    },
  ],
  cliente: {
    nome: 'Indústria Teste Contrato Ltda',
    email: 'compras@exemplo.com.br',
    cnpj: '76851812000102',
    telefone: '1133334444',
    endereco: 'Avenida Paulista',
    numero: '1000',
    complemento: null,
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
  },
};

function montar(proposta: Record<string, unknown>, anexos = 1) {
  const prisma = {
    propostaAnexo: { count: vi.fn().mockResolvedValue(anexos) },
    proposta: {
      findUnique: vi.fn().mockResolvedValue(proposta),
      update: vi.fn().mockResolvedValue({ clienteId: 'cli-1' }),
    },
    produto: { findMany: vi.fn().mockResolvedValue([{ id: 'prod-mb04', sku: 'MB-04_D.S.' }]) },
  };
  const etapa = { mover: vi.fn(async () => 'movido' as const) };
  const svc = new PropostaAceiteService(
    prisma as never,
    { get: vi.fn(() => 'k'.repeat(64)) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    etapa as never,
    {} as never,
    {} as never,
  );
  return { svc, prisma };
}

describe('gerarLink — a proposta só vai ao cliente pronta pra virar contrato', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completa: gera o link e muda o status', async () => {
    const { svc, prisma } = montar(COMPLETA);
    const r = await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    expect(r.url).toContain('/proposta/aceite/');
    expect(prisma.proposta.update).toHaveBeenCalledTimes(1);
  });

  it('🔴 completa MENOS o celular: recusa, diz o que falta e NÃO muda o status', async () => {
    const { svc, prisma } = montar({ ...COMPLETA, signatarioTelefone: null });
    await expect(svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO')).rejects.toThrow(
      /celular de quem assina/,
    );
    expect(prisma.proposta.update).not.toHaveBeenCalled();
  });

  it('lista TUDO que falta de uma vez, na mesma mensagem', async () => {
    const { svc } = montar({
      ...COMPLETA,
      signatarioTelefone: null,
      validoAte: null,
      servicosTotal: null,
    });
    const erro = await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO').catch((e: Error) => e);
    expect(String((erro as Error).message)).toMatch(
      /celular de quem assina.*validade da proposta.*valor total de instalação/s,
    );
  });

  it('venda não passa pela checagem do contrato — não gera contrato', async () => {
    const { svc, prisma } = montar({ ...COMPLETA, modalidade: 'VENDA', signatarioTelefone: null });
    await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    expect(prisma.proposta.update).toHaveBeenCalledTimes(1);
  });

  it('sem projeto anexado continua recusando antes de tudo', async () => {
    const { svc, prisma } = montar(COMPLETA, 0);
    await expect(svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO')).rejects.toThrow(/projeto/);
    expect(prisma.proposta.update).not.toHaveBeenCalled();
  });
});
