import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContratoComodatoErpService } from './contrato-comodato-erp.service';

/**
 * NF de comodato: sai SEMPRE do pedido de venda, nunca avulsa, e o disparo é
 * manual — as duas coisas são decisão do Léo (12/09).
 *
 * 🔴 O que este arquivo guarda é sobretudo as RECUSAS. Nota fiscal não tem
 * desfazer pela API do Tiny: não há segunda nota pro mesmo pedido, não há
 * endpoint de alterar, e rejeitada guarda um snapshot do item. Cada guarda que
 * cai aqui é uma nota errada que não existiu.
 */
const CFG = {
  comodato: {
    emiteNota: true,
    naturezaMesmaUf: 'Remessa em comodato',
    naturezaOutraUf: 'Remessa em comodato interestadual',
  },
};

const CONTRATO = {
  id: 'ctr-1',
  status: 'ASSINADO',
  comodatoNotaId: null as string | null,
  comodatoNotaNumero: null as string | null,
  cliente: { nome: 'INDÚSTRIA X', uf: 'SP' },
  proposta: { id: 'prop-1', numero: 'PROP-0025', pedidoErpId: '340265143', modalidade: 'LOCACAO' },
};

const build = (over: { contrato?: unknown; erp?: unknown; ufEmpresa?: string | null } = {}) => {
  const prisma = {
    contrato: {
      findFirst: vi.fn().mockResolvedValue(over.contrato === undefined ? CONTRATO : over.contrato),
      update: vi.fn().mockResolvedValue({}),
    },
    empresa: {
      findUnique: vi.fn(async ({ select }: { select: Record<string, boolean> }) =>
        select.config
          ? { config: { erp: over.erp ?? CFG } }
          : { uf: over.ufEmpresa === undefined ? 'SP' : over.ufEmpresa },
      ),
    },
  };
  const notas = {
    gerarDoPedido: vi.fn().mockResolvedValue({ id: '999', numero: '12' }),
    emitirEEsperar: vi.fn().mockResolvedValue({
      id: '999',
      numero: '12',
      chaveAcesso: 'CH123',
      dataEmissao: '2026-09-20',
    }),
  };
  const comodato = { iniciarCobrancaPorContrato: vi.fn().mockResolvedValue(undefined) };
  const svc = new ContratoComodatoErpService(prisma as never, notas as never, comodato as never);
  return { svc, prisma, notas, comodato };
};

describe('ContratoComodatoErpService.emitir', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emite a partir do PEDIDO DE VENDA e devolve a chave de acesso', async () => {
    const { svc, notas } = build();

    await expect(svc.emitir('ctr-1', 'emp-1')).resolves.toMatchObject({
      notaId: '999',
      numero: '12',
      chaveAcesso: 'CH123',
      jaExistia: false,
    });

    // O id do pedido é o que vai — nota avulsa foi descartada de propósito.
    expect(notas.gerarDoPedido).toHaveBeenCalledWith('340265143', {
      naturezaOperacao: 'Remessa em comodato',
    });
  });

  /**
   * A nota já existe no ERP entre gerar e autorizar. Gravar o id só no fim
   * deixaria uma janela em que uma segunda tentativa geraria OUTRA nota pro
   * mesmo pedido — e não existe desfazer.
   */
  it('grava o id ANTES de mandar autorizar', async () => {
    const { svc, prisma, notas } = build();
    const ordem: string[] = [];
    prisma.contrato.update.mockImplementation(async () => {
      ordem.push('gravou');
      return {};
    });
    notas.emitirEEsperar.mockImplementation(async () => {
      ordem.push('autorizou');
      return { id: '999', chaveAcesso: 'CH', numero: '12' };
    });

    await svc.emitir('ctr-1', 'emp-1');

    expect(ordem[0]).toBe('gravou');
    expect(ordem).toContain('autorizou');
  });

  it('contrato que já tem nota NÃO emite de novo', async () => {
    const { svc, notas } = build({
      contrato: { ...CONTRATO, comodatoNotaId: '777', comodatoNotaNumero: '5' },
    });

    await expect(svc.emitir('ctr-1', 'emp-1')).resolves.toEqual({
      notaId: '777',
      numero: '5',
      jaExistia: true,
    });
    expect(notas.gerarDoPedido).not.toHaveBeenCalled();
  });

  it('marca o início da cobrança pela data da NOTA — antes disso o equipamento não saiu', async () => {
    const { svc, comodato } = build();

    await svc.emitir('ctr-1', 'emp-1');

    expect(comodato.iniciarCobrancaPorContrato).toHaveBeenCalledWith('ctr-1', '2026-09-20');
  });

  it('cobrança que falha NÃO derruba a emissão — a nota já existe no mundo', async () => {
    const { svc, comodato } = build();
    comodato.iniciarCobrancaPorContrato.mockRejectedValue(new Error('banco fora'));

    await expect(svc.emitir('ctr-1', 'emp-1')).resolves.toMatchObject({ chaveAcesso: 'CH123' });
  });

  describe('recusas — cada uma é uma nota errada que não existiu', () => {
    it('sem pedido de venda no ERP: não há de onde emitir (e avulsa foi descartada)', async () => {
      const { svc, notas } = build({
        contrato: { ...CONTRATO, proposta: { ...CONTRATO.proposta, pedidoErpId: null } },
      });

      await expect(svc.emitir('ctr-1', 'emp-1')).rejects.toThrow(/pedido de venda/i);
      expect(notas.gerarDoPedido).not.toHaveBeenCalled();
    });

    it('contrato não assinado: o equipamento sairia por um contrato que ninguém assinou', async () => {
      const { svc } = build({ contrato: { ...CONTRATO, status: 'AGUARDANDO_ASSINATURA' } });

      await expect(svc.emitir('ctr-1', 'emp-1')).rejects.toThrow(/assinatura/i);
    });

    it('proposta de VENDA não tem comodato', async () => {
      const { svc } = build({
        contrato: { ...CONTRATO, proposta: { ...CONTRATO.proposta, modalidade: 'VENDA' } },
      });

      await expect(svc.emitir('ctr-1', 'emp-1')).rejects.toThrow(/LOCAÇÃO/i);
    });

    it('emissão desligada na config: não emite por conta própria', async () => {
      const { svc } = build({ erp: { comodato: { emiteNota: false } } });

      await expect(svc.emitir('ctr-1', 'emp-1')).rejects.toThrow(/DESLIGADA/i);
    });

    it('sem natureza configurada: é ela que carrega o CFOP', async () => {
      const { svc } = build({ erp: { comodato: { emiteNota: true } } });

      await expect(svc.emitir('ctr-1', 'emp-1')).rejects.toThrow(/natureza de operação/i);
    });

    /**
     * 🔴 Sem UF o app RECUSA em vez de assumir operação interna: "mesma UF" é o
     * palpite mais provável e o mais caro — uma remessa interestadual com CFOP
     * interno passa despercebida até a fiscalização.
     */
    it('sem UF dos dois lados: recusa em vez de chutar operação interna', async () => {
      const { svc } = build({ ufEmpresa: null });

      await expect(svc.emitir('ctr-1', 'emp-1')).rejects.toThrow(/UF/);
    });
  });

  it('cliente em OUTRA UF usa a natureza interestadual — o CFOP é outro', async () => {
    const { svc, notas } = build({
      contrato: { ...CONTRATO, cliente: { nome: 'INDÚSTRIA Y', uf: 'MG' } },
    });

    await svc.emitir('ctr-1', 'emp-1');

    expect(notas.gerarDoPedido).toHaveBeenCalledWith('340265143', {
      naturezaOperacao: 'Remessa em comodato interestadual',
    });
  });
});
