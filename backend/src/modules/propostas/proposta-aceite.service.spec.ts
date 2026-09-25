import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { BusinessRuleException } from '@shared/errors/app-exception';
import PizZip from 'pizzip';
import { carregarModelo } from './contrato-documento.util';
import { PropostaAceiteService } from './proposta-aceite.service';

// jose mockado — sem JWT real; validarToken devolve o payload fixo.
const { mockJwtVerify } = vi.hoisted(() => ({ mockJwtVerify: vi.fn() }));
vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() {
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    sign() {
      return Promise.resolve('jwt');
    }
  },
  jwtVerify: mockJwtVerify,
}));

const TOKEN = 'tok-123';
const PROPOSTA = {
  id: 'prop-1',
  numero: 'PROP-0001',
  status: 'AGUARDANDO_ASSINATURA',
  aceiteToken: TOKEN,
  clienteId: 'cli-1',
  representanteId: 'rep-1',
  formaPagamento: 'PIX',
  condicaoPagamento: 'avista',
  prazoEntrega: null,
  subtotal: 100,
  descontoGeral: 0,
  valor: 100,
  comissaoEstimada: 5,
  observacoes: null,
  itens: [],
};

const makeEnv = () => ({ get: vi.fn(() => 'k'.repeat(64)) });
const makeSequence = () => ({ next: vi.fn().mockResolvedValue(7) });
const makeNotificacoes = () => ({
  criarParaRole: vi.fn().mockResolvedValue(0),
  criarParaUsuario: vi.fn().mockResolvedValue(null),
});

function makeService(txProverbCount: number, recusaCount = 1) {
  const tx = {
    proposta: {
      updateMany: vi.fn().mockResolvedValue({ count: txProverbCount }),
      update: vi.fn().mockResolvedValue({}),
    },
    pedido: { create: vi.fn().mockResolvedValue({ id: 'ped-1' }) },
    aprovacaoDesconto: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    proposta: {
      findUnique: vi.fn().mockResolvedValue(PROPOSTA),
      updateMany: vi.fn().mockResolvedValue({ count: recusaCount }),
    },
    usuario: { findUnique: vi.fn().mockResolvedValue({ role: 'REP', tetoDesconto: 100 }) },
    empresa: {
      findUnique: vi.fn().mockResolvedValue({ descontoPixPct: 0, descontoBoletoAvistaPct: 0 }),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const notificacoes = makeNotificacoes();
  // Gate de aprovação: default dentro do teto → RASCUNHO (sem aprovação).
  const pedidoPricing = {
    avaliarAprovacaoProposta: vi.fn().mockReturnValue({
      requerAprovacao: false,
      statusPedido: 'RASCUNHO',
      maxDescontoPercentual: 0,
    }),
  };
  // ClickSign desligado nos testes de aceite: o envio do contrato é best-effort
  // e tem teste próprio. `configurado: false` mantém o caminho antigo intacto.
  // `configurado` agora é por empresa (credencial cifrada do tenant), então é
  // função assíncrona — não mais um getter booleano.
  const clicksign = {
    configurado: vi.fn().mockResolvedValue(false),
    enviarParaAssinatura: vi.fn(),
  };
  // Marco do funil: o aceite move a etapa do lead, e o move é best-effort.
  const etapa = { mover: vi.fn(async () => 'movido' as const) };
  // Modelo do contrato EM USO: default = o padrão do app (nenhuma versão ativa).
  const modelos = {
    emUso: vi.fn(
      async (): Promise<{ arquivo: Buffer; versao: number | null }> => ({
        arquivo: carregarModelo(),
        versao: null,
      }),
    ),
  };
  // Contrato congelado no link: por padrão NÃO há (proposta de antes do 25/09).
  const previa = {
    salvar: vi.fn(async () => ({ path: 'emp-1/prop-1/1.docx', sha256: 'h' })),
    baixar: vi.fn(async () => Buffer.from('docx-guardado')),
    linkAssinado: vi.fn(async () => 'https://storage/contrato.docx'),
  };
  const svc = new PropostaAceiteService(
    prisma as never,
    makeEnv() as never,
    makeSequence() as never,
    notificacoes as never,
    pedidoPricing as never,
    clicksign as never,
    etapa as never,
    // Comissão do pedido nascido do aceite: tem teste próprio no serviço dela.
    { recalcular: vi.fn(async () => undefined) } as never,
    modelos as never,
    previa as never,
  );
  mockJwtVerify.mockResolvedValue({ payload: { pid: 'prop-1', eid: 'emp-1' } });
  return { svc, prisma, tx, notificacoes, pedidoPricing, clicksign, etapa, modelos, previa };
}

describe('PropostaAceiteService.registrarDecisao — CAS anti duplo-pedido', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ACEITA vencedora (CAS count=1) cria 1 pedido e retorna número', async () => {
    const { svc, tx } = makeService(1);
    const r = await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(r.status).toBe('ACEITA');
    expect(r.pedidoNumero).toBe('PED-0007');
    expect(tx.pedido.create).toHaveBeenCalledTimes(1);
  });

  it('ACEITA dentro do teto → pedido RASCUNHO, sem AprovacaoDesconto', async () => {
    const { svc, tx } = makeService(1);
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(tx.pedido.create.mock.calls[0][0].data.status).toBe('RASCUNHO');
    expect(tx.aprovacaoDesconto.create).not.toHaveBeenCalled();
  });

  it('ACEITA com desconto acima do teto → pedido AGUARDANDO_APROVACAO + AprovacaoDesconto (não burla)', async () => {
    const { svc, tx, pedidoPricing } = makeService(1);
    pedidoPricing.avaliarAprovacaoProposta.mockReturnValue({
      requerAprovacao: true,
      statusPedido: 'AGUARDANDO_APROVACAO',
      maxDescontoPercentual: 40,
    });
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(tx.pedido.create.mock.calls[0][0].data.status).toBe('AGUARDANDO_APROVACAO');
    expect(tx.aprovacaoDesconto.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ representanteId: 'rep-1', status: 'PENDENTE' }),
      }),
    );
  });

  it('ACEITA notifica o REP dono da proposta (não só GERENTE/DIRECTOR)', async () => {
    const { svc, notificacoes } = makeService(1);
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(notificacoes.criarParaUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: 'rep-1', empresaId: 'emp-1' }),
    );
    expect(notificacoes.criarParaRole).toHaveBeenCalled();
  });

  it('ACEITA perdedora da corrida (CAS count=0) NÃO cria pedido', async () => {
    const { svc, tx } = makeService(0); // outro request já reivindicou o token
    await expect(svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it('RECUSADA perdedora (CAS count=0) é rejeitada', async () => {
    const { svc } = makeService(1, 0); // updateMany de recusa não casou nenhuma linha
    await expect(svc.registrarDecisao(TOKEN, 'RECUSADA', undefined)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });
});

describe('PropostaAceiteService — cliente BLOQUEADO no ERP não aceita (auditoria média)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ACEITE de cliente bloqueado é barrado ANTES de criar pedido', async () => {
    // Cenário do achado: cliente vira BLOQUEADO no ERP depois do envio da
    // proposta. O link público já revalidava validade e produto inativo, mas não
    // o erpStatus — o pedido era criado, o rep notificado "aceita!", e a falha
    // só aparecia no envio ao ERP.
    const { svc, prisma, tx } = makeService(1);
    prisma.proposta.findUnique.mockResolvedValue({
      ...PROPOSTA,
      cliente: { erpStatus: 'BLOQUEADO' },
    });

    await expect(svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9')).rejects.toThrow(
      /não é possível aceitar/i,
    );
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it('RECUSAR proposta de cliente bloqueado continua permitido', async () => {
    const { svc, prisma } = makeService(1);
    prisma.proposta.findUnique.mockResolvedValue({
      ...PROPOSTA,
      cliente: { erpStatus: 'BLOQUEADO' },
    });

    const r = await svc.registrarDecisao(TOKEN, 'RECUSADA', '203.0.113.9');
    expect(r.status).toBe('RECUSADA');
  });

  it('cliente ATIVO segue aceitando normalmente', async () => {
    const { svc, prisma, tx } = makeService(1);
    prisma.proposta.findUnique.mockResolvedValue({
      ...PROPOSTA,
      cliente: { erpStatus: 'ATIVO' },
    });

    const r = await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(r.status).toBe('ACEITA');
    expect(tx.pedido.create).toHaveBeenCalled();
  });

  describe('base do link de aceite', () => {
    // O link sai da empresa: link errado aqui não quebra nada do nosso lado —
    // o rep envia, o cliente clica, não abre, e a gente descobre pelo cliente.
    const montar = (envs: Record<string, string>, producao = true) =>
      new PropostaAceiteService(
        {} as never,
        { get: (k: string) => envs[k] ?? '', isProduction: producao } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined as never, // etapa
        undefined as never, // comissoes
        undefined as never, // modelos
        undefined as never, // previa
      ) as unknown as { frontendUrl: () => string };

    it('usa FRONTEND_URL quando existe', () => {
      const svc = montar({ FRONTEND_URL: 'https://app.somatecblocking.com.br/' });

      expect(svc.frontendUrl()).toBe('https://app.somatecblocking.com.br');
    });

    it('limpa o nome da variável colado no valor (o paste que aconteceu em produção)', () => {
      const svc = montar({
        CORS_ORIGINS: 'CORS_ORIGINS=https://app.exemplo.com,https://outro.com',
      });

      expect(svc.frontendUrl()).toBe('https://app.exemplo.com');
    });

    it('em produção, ESTOURA em vez de gerar link pra localhost', () => {
      const svc = montar({ CORS_ORIGINS: 'http://localhost:5173' });

      expect(() => svc.frontendUrl()).toThrow(/FRONTEND_URL/);
    });

    it('em produção, ESTOURA quando não há base nenhuma', () => {
      const svc = montar({});

      expect(() => svc.frontendUrl()).toThrow(/FRONTEND_URL/);
    });

    it('fora de produção, localhost segue valendo', () => {
      const svc = montar({ CORS_ORIGINS: 'http://localhost:5173' }, false);

      expect(svc.frontendUrl()).toBe('http://localhost:5173');
    });
  });
});

/**
 * O contrato que sai do ACEITE é o DOCUMENTO ÚNICO do Anexo I (24/09).
 *
 * Todos os outros testes deste arquivo rodam com a ClickSign desligada — e por
 * isso nenhum exercitava o envio. Como o envio é best-effort (engole erro pra
 * não perder o aceite), um defeito aqui não quebraria teste nenhum: o contrato
 * só não sairia, calado.
 */
describe('PropostaAceiteService — contrato do aceite é o documento pronto', () => {
  beforeEach(() => vi.clearAllMocks());

  const LOCACAO = {
    id: 'prop-1',
    numero: 'PROP-0001',
    clienteId: 'cli-1',
    representanteId: 'rep-1',
    valor: 4350,
    modalidade: 'LOCACAO',
    prazoMeses: 60,
    diaVencimento: 5,
    signatarioNome: 'Marina Torres Aguiar',
    signatarioEmail: 'marina@exemplo.com.br',
    signatarioTelefone: '11999998888',
    validoAte: new Date('2026-10-24T12:00:00Z'),
    prazoEntregaDias: 10,
    prazoInstalacaoDias: 15,
    prazoVerificacaoDias: 5,
    prazoSoftwareDias: 20,
    servicosTotal: 9000,
    customizacaoUnitario: 1500,
    customizacaoQuantidade: 1,
    itens: [
      {
        produtoId: 'prod-mb04',
        quadroPainel: 'QGBT',
        tensaoV: 220,
        correnteA: 105,
        quantidade: 1,
        total: 4350,
      },
    ],
    cliente: {
      nome: 'Indústria Exemplo Ltda',
      email: 'contato@exemplo.com.br',
      cnpj: '12345678000190',
      telefone: '1133334444',
      endereco: 'Rua das Turbinas',
      numero: '100',
      complemento: null,
      bairro: 'Distrito',
      cidade: 'São Paulo',
      uf: 'SP',
    },
  };

  const comClickSign = (proposta: Record<string, unknown>) => {
    const m = makeService(1);
    m.clicksign.configurado.mockResolvedValue(true);
    m.clicksign.enviarParaAssinatura.mockResolvedValue({
      envelopeId: 'env-1',
      documentoId: 'doc-1',
      signatarios: [],
    });
    Object.assign(m.prisma.proposta, { findFirst: vi.fn().mockResolvedValue(proposta) });
    const contrato = { create: vi.fn().mockResolvedValue({}) };
    Object.assign(m.prisma, {
      produto: { findMany: vi.fn().mockResolvedValue([{ id: 'prod-mb04', sku: 'MB-04_D.S.' }]) },
      contrato,
    });
    return { ...m, contrato };
  };

  it('aceite de locação completa manda o .docx montado, com o quadro do levantamento', async () => {
    const { svc, clicksign, contrato } = comClickSign(LOCACAO);

    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');

    expect(clicksign.enviarParaAssinatura).toHaveBeenCalledTimes(1);
    const dados = clicksign.enviarParaAssinatura.mock.calls[0][1] as {
      documento?: { arquivo: Buffer; nome: string };
      variaveis?: unknown;
    };
    expect(dados.variaveis).toBeUndefined();
    expect(dados.documento?.nome).toBe('PROP-0001.docx');
    const xml = new PizZip(dados.documento!.arquivo).file('word/document.xml')!.asText();
    expect(xml).toContain('QGBT');
    expect(xml).toContain('MB-04');
    expect(contrato.create).toHaveBeenCalledTimes(1);
  });

  /**
   * Os termos do contrato são os do TEXTO (60 meses, dia 05), não os da
   * proposta: o ERP cobra pelo que o contrato do app guarda, e o PDF assinado
   * diz 60/05. Proposta antiga com 36/10 gravados não pode furar isso.
   */
  it('o contrato nasce com 60 meses e dia 05, qualquer que seja a proposta', async () => {
    for (const termos of [
      { prazoMeses: 36, diaVencimento: 10 },
      { prazoMeses: null, diaVencimento: null },
    ]) {
      const { svc, contrato } = comClickSign({ ...LOCACAO, ...termos });
      await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
      expect(contrato.create).toHaveBeenCalledTimes(1);
      expect(contrato.create.mock.calls[0][0].data).toMatchObject({
        prazoMeses: 60,
        diaVencimento: 5,
      });
    }
  });

  /**
   * "O contrato é o mesmo" (Léo, 25/09): o que vai pra ClickSign ao aprovar é o
   * ARQUIVO que o cliente leu no link, não uma montagem nova.
   */
  it('com contrato congelado no link: manda O ARQUIVO GUARDADO, conferido pelo hash', async () => {
    const guardado = Buffer.from('docx-guardado');
    const hash = createHash('sha256').update(guardado).digest('hex');
    const { svc, clicksign, contrato, previa } = comClickSign({
      ...LOCACAO,
      contratoPreviaPath: 'emp-1/prop-1/1.docx',
      contratoPreviaSha256: hash,
      contratoPreviaModeloVersao: 3,
    });

    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');

    expect(previa.baixar).toHaveBeenCalledWith('emp-1/prop-1/1.docx');
    const dados = clicksign.enviarParaAssinatura.mock.calls[0][1] as {
      documento?: { arquivo: Buffer };
    };
    expect(dados.documento?.arquivo.equals(guardado)).toBe(true);
    const envio = contrato.create.mock.calls[0][0].data.enviosAssinatura[0];
    expect(envio).toMatchObject({ modeloVersao: 3, sha256: hash });
  });

  it('hash do guardado NÃO confere → não manda outro texto, e avisa', async () => {
    const { svc, clicksign, contrato, notificacoes } = comClickSign({
      ...LOCACAO,
      contratoPreviaPath: 'emp-1/prop-1/1.docx',
      contratoPreviaSha256: 'outro-hash',
      contratoPreviaModeloVersao: 3,
    });

    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');

    expect(clicksign.enviarParaAssinatura).not.toHaveBeenCalled();
    expect(contrato.create).not.toHaveBeenCalled();
    expect(JSON.stringify(notificacoes.criarParaUsuario.mock.calls)).toContain('não confere');
  });

  it('proposta sem os dados do documento NÃO manda nada e AVISA o responsável', async () => {
    const { svc, clicksign, contrato, notificacoes } = comClickSign({
      ...LOCACAO,
      servicosTotal: null,
    });

    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');

    expect(clicksign.enviarParaAssinatura).not.toHaveBeenCalled();
    expect(contrato.create).not.toHaveBeenCalled();
    const avisos = JSON.stringify([
      ...notificacoes.criarParaUsuario.mock.calls,
      ...notificacoes.criarParaRole.mock.calls,
    ]);
    expect(avisos).toMatch(/instalação, materiais e customização/);
  });
});

describe('PropostaAceiteService — modelo do contrato subido pela tela', () => {
  beforeEach(() => vi.clearAllMocks());

  const comModelo = (versao: number | null, falha = false) => {
    const m = makeService(1);
    m.clicksign.configurado.mockResolvedValue(true);
    m.clicksign.enviarParaAssinatura.mockResolvedValue({
      envelopeId: 'env-1',
      documentoId: 'doc-1',
      signatarios: [],
    });
    if (falha) m.modelos.emUso.mockRejectedValue(new Error('Storage fora'));
    else m.modelos.emUso.mockResolvedValue({ arquivo: carregarModelo(), versao });
    const contrato = { create: vi.fn().mockResolvedValue({}) };
    Object.assign(m.prisma.proposta, {
      findFirst: vi.fn().mockResolvedValue({
        id: 'prop-1',
        numero: 'PROP-0001',
        clienteId: 'cli-1',
        representanteId: 'rep-1',
        valor: 4350,
        modalidade: 'LOCACAO',
        prazoMeses: 60,
        diaVencimento: 5,
        signatarioNome: 'Marina Torres Aguiar',
        signatarioEmail: 'marina@exemplo.com.br',
        signatarioTelefone: '11999998888',
        validoAte: new Date('2026-10-24T12:00:00Z'),
        prazoEntregaDias: 10,
        prazoInstalacaoDias: 15,
        prazoVerificacaoDias: 5,
        prazoSoftwareDias: 20,
        servicosTotal: 9000,
        customizacaoUnitario: 1500,
        customizacaoQuantidade: 1,
        itens: [
          {
            produtoId: 'p1',
            quadroPainel: 'QGBT',
            tensaoV: 220,
            correnteA: 105,
            quantidade: 1,
            total: 4350,
          },
        ],
        cliente: {
          nome: 'Indústria Exemplo Ltda',
          email: null,
          cnpj: '12345678000190',
          telefone: null,
          endereco: 'Rua A',
          numero: '1',
          complemento: null,
          bairro: 'B',
          cidade: 'São Paulo',
          uf: 'SP',
        },
      }),
    });
    Object.assign(m.prisma, {
      produto: { findMany: vi.fn().mockResolvedValue([{ id: 'p1', sku: 'MB-04' }]) },
      contrato,
    });
    return { ...m, contrato };
  };

  it('o contrato criado registra QUAL versão do modelo saiu', async () => {
    const { svc, contrato } = comModelo(3);
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    const envios = contrato.create.mock.calls[0][0].data.enviosAssinatura;
    expect(envios[0]).toMatchObject({ desfecho: 'enviado', modeloVersao: 3 });
  });

  it('modelo ativo ilegível: NÃO manda nada e avisa o responsável', async () => {
    const { svc, clicksign, contrato, notificacoes } = comModelo(3, true);
    await svc.registrarDecisao(TOKEN, 'ACEITA', '203.0.113.9');
    expect(clicksign.enviarParaAssinatura).not.toHaveBeenCalled();
    expect(contrato.create).not.toHaveBeenCalled();
    expect(JSON.stringify(notificacoes.criarParaUsuario.mock.calls)).toMatch(
      /modelo de contrato ativo não pôde ser lido/,
    );
  });
});
