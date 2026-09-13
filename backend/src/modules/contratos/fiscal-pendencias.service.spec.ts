import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FiscalPendenciasService } from './fiscal-pendencias.service';

/**
 * O diagnóstico existe porque a pendência fiscal era SILENCIOSA: o contrato
 * 340265142 entrou no ERP Ativo, cobrando, com `emite_nota = N`, e o único
 * rastro foi um `warn` no log do worker. O que se testa aqui é a honestidade
 * da resposta — principalmente a diferença entre "conferi e está certo" e
 * "não consegui conferir".
 */
const CFG_COMPLETA = {
  contratoLocacao: {
    emiteNota: true,
    codigoListaServico: '14.01',
    naturezaOperacao: 'Locação de bens móveis',
    percentualIss: 2,
    servicoCodigo: 'LOC-MB',
    servicoNome: 'Locação Master Block IoT',
  },
  comodato: {
    emiteNota: true,
    cfopMesmaUf: '5908',
    cfopOutraUf: '6908',
    naturezaOperacao: 'Remessa em comodato',
  },
};

const build = (
  over: {
    erp?: unknown;
    produtos?: Array<{ sku: string | null; nome: string; valorBem: unknown }>;
    tinyGet?: () => Promise<unknown>;
  } = {},
) => {
  const prisma = {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ config: { erp: over.erp ?? CFG_COMPLETA } }),
    },
    produto: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          over.produtos ?? [{ sku: 'MB-05', nome: 'Master Block MB-05', valorBem: 4800 }],
        ),
    },
  };
  const tiny = {
    get: vi.fn(over.tinyGet ?? (async () => ({ itens: [{ sku: 'MB-05', ncm: '8536.30.90' }] }))),
  };
  const svc = new FiscalPendenciasService(prisma as never, tiny as never);
  return { svc, prisma, tiny };
};

describe('FiscalPendenciasService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('config completa + produto com valor e NCM → pronto pra emitir', async () => {
    const { svc } = build();

    const r = await svc.verificar('emp-1');

    expect(r.pronto).toBe(true);
    expect(r.nfseMensal).toMatchObject({ pronto: true, ligado: true, faltando: [] });
    expect(r.comodato).toMatchObject({ pronto: true, ligado: true, faltando: [] });
    expect(r.comodato.semValorBem).toEqual([]);
    expect(r.comodato.semNcm).toEqual([]);
  });

  it('config vazia: diz O QUE falta e ONDE preencher — não só "faltam dados"', async () => {
    const { svc } = build({ erp: {} });

    const r = await svc.verificar('emp-1');

    expect(r.pronto).toBe(false);
    expect(r.nfseMensal.faltando.map((p) => p.campo)).toEqual([
      'codigoListaServico',
      'naturezaOperacao',
      'percentualIss',
      'servicoCodigo',
      'servicoNome',
    ]);
    expect(r.nfseMensal.faltando[0].onde).toBe('erp.contratoLocacao');
    expect(r.comodato.faltando.map((p) => p.campo)).toEqual([
      'cfopMesmaUf',
      'cfopOutraUf',
      'naturezaOperacao',
    ]);
    // Cada pendência explica a consequência — quem preenche é o contador, e ele
    // não lê nome de campo de banco.
    expect(r.nfseMensal.faltando[0].porque).toContain('ISS');
  });

  /**
   * "Não ligou a emissão" é uma ESCOLHA do tenant, não uma pendência. Misturar
   * os dois faria o diagnóstico gritar por quem decidiu não emitir nota.
   */
  it('emissão desligada NÃO vira pendência — ligado e pronto são coisas diferentes', async () => {
    const { svc } = build({
      erp: {
        contratoLocacao: { ...CFG_COMPLETA.contratoLocacao, emiteNota: false },
        comodato: { ...CFG_COMPLETA.comodato, emiteNota: false },
      },
    });

    const r = await svc.verificar('emp-1');

    expect(r.nfseMensal).toMatchObject({ ligado: false, pronto: true });
    expect(r.comodato).toMatchObject({ ligado: false, pronto: true });
    expect(r.pronto).toBe(true);
  });

  it('produto de locação sem valor do BEM aparece na lista (≠ mensalidade)', async () => {
    const { svc } = build({
      produtos: [
        { sku: 'MB-05', nome: 'Master Block MB-05', valorBem: null },
        { sku: 'MB-10', nome: 'Master Block MB-10', valorBem: 9000 },
      ],
    });

    const r = await svc.verificar('emp-1');

    expect(r.comodato.semValorBem).toEqual([{ sku: 'MB-05', nome: 'Master Block MB-05' }]);
    expect(r.comodato.pronto).toBe(false);
  });

  it('produto sem NCM no ERP bloqueia — é o que a SEFAZ rejeita', async () => {
    const { svc } = build({ tinyGet: async () => ({ itens: [{ sku: 'MB-05', ncm: '' }] }) });

    const r = await svc.verificar('emp-1');

    expect(r.comodato.semNcm).toEqual([{ sku: 'MB-05', nome: 'Master Block MB-05' }]);
    expect(r.comodato.pronto).toBe(false);
  });

  /**
   * 🔴 O ponto do arquivo: ERP fora do ar devolve `null` (= "não sei"), nunca
   * lista vazia. Lista vazia lida como "conferi e está tudo certo" mandaria
   * alguém emitir confiando num diagnóstico que não chegou a rodar.
   */
  it('ERP fora do ar → semNcm = null ("não sei"), e NÃO lista vazia', async () => {
    const { svc } = build({
      tinyGet: async () => {
        throw new Error('timeout');
      },
    });

    const r = await svc.verificar('emp-1');

    expect(r.comodato.semNcm).toBeNull();
    expect(r.comodato.pronto).toBe(true); // não sei ≠ está errado: não inventa bloqueio
  });

  it('só confere produtos de LOCAÇÃO — produto de venda não entra no comodato', async () => {
    const { svc, prisma } = build();

    await svc.verificar('emp-1');

    expect(prisma.produto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp-1', precoLocacaoMensal: { not: null } },
      }),
    );
  });
});
