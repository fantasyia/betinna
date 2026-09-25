import { beforeEach, describe, expect, it, vi } from 'vitest';
import { templatePropostaParaAprovar, textoSobre } from '@integrations/email/email-templates';
import { PropostaAceiteService } from './proposta-aceite.service';
import { PropostasService } from './propostas.service';
import { PropostaAnexosService } from './proposta-anexos.service';
import { resumoDaProposta } from './proposta-resumo.util';

/**
 * O que o CLIENTE recebe (Léo, 25/09): "não quero testar só o funcionamento.
 * Já precisa ficar tudo no formato de como o cliente vai receber".
 *
 * Antes: a página de aceite era uma tabela genérica produto/qtd/preço, SEM o
 * levantamento, sem prazos nem condições — e sem o PROJETO, que é o que o
 * cliente "aprova". O e-mail saudava a razão social e dizia "Valor total
 * R$ 1.528" sem dizer que era por mês.
 */

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

const TOKEN = 'tok-27';

/** A PROP-0027 do teste do contrato — a referência aprovada pelo Léo. */
const PARA_CONTRATO = {
  id: 'prop-27',
  numero: 'PROP-0027',
  valor: 1528,
  modalidade: 'LOCACAO',
  signatarioNome: 'Leonardo Beltran',
  signatarioEmail: 'pedido@somatecblocking.com.br',
  signatarioTelefone: '+5511999998888',
  validoAte: new Date('2026-10-24T00:00:00Z'),
  prazoEntregaDias: 45,
  prazoInstalacaoDias: 15,
  prazoVerificacaoDias: 5,
  prazoSoftwareDias: 7,
  servicosTotal: 12000,
  customizacaoUnitario: 1500,
  customizacaoQuantidade: 1,
  itens: [
    {
      produtoId: 'p-ds',
      produtoNome: 'Master Block MB-04 + Data Sense',
      quadroPainel: 'QGBT',
      tensaoV: 380,
      correnteA: 420,
      quantidade: 1,
      total: 874,
    },
    {
      produtoId: 'p-ep',
      produtoNome: 'Master Block MB-02 + End Point',
      quadroPainel: 'Painel Produção',
      tensaoV: 380,
      correnteA: 180,
      quantidade: 1,
      total: 533,
    },
    {
      produtoId: 'p-01',
      produtoNome: 'Master Block MB-01',
      quadroPainel: 'Painel Iluminação',
      tensaoV: 220,
      correnteA: 63,
      quantidade: 1,
      total: 121,
    },
  ],
  cliente: {
    nome: 'INDÚSTRIA TESTE CONTRATO LTDA',
    email: 'compras@industria.com.br',
    cnpj: '76851812000102',
    telefone: '1133334444',
    endereco: 'Avenida Paulista',
    numero: '1000',
    complemento: null,
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
    cep: '01310100',
  },
};
const SKUS = [
  { id: 'p-ds', sku: 'MB-04_D.S.' },
  { id: 'p-ep', sku: 'MB-02_E.P.' },
  { id: 'p-01', sku: 'MB-01' },
];

describe('resumoDaProposta — o conteúdo que o cliente lê', () => {
  const r = resumoDaProposta(
    { ...PARA_CONTRATO, itens: PARA_CONTRATO.itens.map((i, n) => ({ ...i, sku: SKUS[n].sku })) },
    new Date('2026-09-25T15:00:00Z'),
  );

  it('cliente com CNPJ formatado, endereço numa linha com CEP e quem assina', () => {
    expect(r.cliente).toEqual({
      razaoSocial: 'INDÚSTRIA TESTE CONTRATO LTDA',
      cnpj: '76.851.812/0001-02',
      endereco: 'Avenida Paulista, 1000 · Bela Vista · São Paulo/SP · CEP 01310-100',
    });
    expect(r.signatarioNome).toBe('Leonardo Beltran');
  });

  it('quadros com modelo, o PRINCIPAL marcado e o aluguel de cada um; total mensal somado', () => {
    expect(r.quadros.map((q) => [q.quadro, q.principal, q.modelo, q.aluguelMensal])).toEqual([
      ['QGBT', true, 'Master Block MB-04 + Data Sense', 874],
      ['Painel Produção', false, 'Master Block MB-02 + End Point', 533],
      ['Painel Iluminação', false, 'Master Block MB-01', 121],
    ]);
    expect(r.aluguelMensalTotal).toBe(1528);
  });

  it('condições = as do TEXTO do contrato (60 meses, dia 05, 2º mês, garantia 60)', () => {
    expect(r.condicoes).toEqual({
      vigenciaMeses: 60,
      diaVencimento: 5,
      primeiroAluguelNoMes: 2,
      garantiaMeses: 60,
    });
  });

  it('serviços em 2 parcelas e os 4 prazos', () => {
    expect(r.servicos).toEqual({
      customizacao: { quantidade: 1, unitario: 1500, total: 1500 },
      total: 12000,
      parcelas: 2,
      valorParcela: 6000,
    });
    expect(r.prazos).toEqual({
      entregaDias: 45,
      instalacaoDias: 15,
      verificacaoDias: 5,
      softwareDias: 7,
    });
  });
});

describe('templatePropostaParaAprovar — o e-mail', () => {
  const base = {
    nome: 'Leonardo Beltran',
    empresaNome: 'Empresa X',
    numero: 'PROP-0027',
    aluguelMensal: 1528,
    vigenciaMeses: 60,
    servicosTotal: 12000,
    parcelas: 2,
    valorParcela: 6000,
    valorTotal: 1528,
    validade: '24/10/2026',
    url: 'https://app.x/proposta/aceite/tok',
  };

  it('saúda QUEM ASSINA e diz que o valor é POR MÊS', () => {
    const { assunto, html } = templatePropostaParaAprovar(base);
    expect(assunto).toBe('Proposta PROP-0027 — Empresa X');
    expect(html).toContain('Olá, Leonardo Beltran.');
    expect(html).toMatch(/R\$\s1\.528,00 \/ mês/);
    expect(html).toContain('60 meses');
    expect(html).toMatch(/R\$\s12\.000,00 \(2× de R\$\s6\.000,00\)/);
    expect(html).toContain('24/10/2026');
    expect(html).toContain('href="https://app.x/proposta/aceite/tok"');
  });

  it('escapa o nome (vem do cadastro/site)', () => {
    const { html } = templatePropostaParaAprovar({ ...base, nome: '<b>x</b>' });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('venda (sem aluguel) mostra o valor total, sem "/ mês"', () => {
    const { html } = templatePropostaParaAprovar({
      ...base,
      aluguelMensal: null,
      valorTotal: 9900,
    });
    expect(html).toMatch(/Valor total/);
    expect(html).not.toContain('/ mês');
  });
});

function montarAceite(over: Record<string, unknown> = {}) {
  const linhaPreview = {
    id: 'prop-27',
    numero: 'PROP-0027',
    status: 'AGUARDANDO_ASSINATURA',
    aceiteToken: TOKEN,
    contratoPreviaPath: 'emp-1/prop-27/1.docx' as string | null,
    levantamentoPdfPath: 'emp-1/prop-27/1.pdf' as string | null,
    contratoPdfPath: 'emp-1/prop-27/1-contrato.pdf' as string | null,
    modalidade: 'LOCACAO',
    criadoEm: new Date('2026-09-25T15:00:00Z'),
    validoAte: new Date('2026-10-24T00:00:00Z'),
    formaPagamento: 'PIX',
    condicaoPagamento: null,
    subtotal: 1528,
    descontoGeral: 0,
    valor: 1528,
    observacoes: null,
    itens: [],
    cliente: { nome: 'INDÚSTRIA TESTE CONTRATO LTDA' },
    empresa: {
      nome: 'Empresa X',
      config: { marca: { rodape: 'Empresa X · CNPJ 00 · contato@x' } },
    },
    ...over,
  };
  const prisma = {
    proposta: {
      findUnique: vi.fn(async (args: { include?: unknown; select?: Record<string, unknown> }) => {
        if (args.include) return linhaPreview;
        if (args.select?.aceiteToken)
          return { aceiteToken: linhaPreview.aceiteToken, status: linhaPreview.status };
        if (args.select?.contratoPdfPath)
          return {
            numero: linhaPreview.numero,
            levantamentoPdfPath: linhaPreview.levantamentoPdfPath,
            contratoPdfPath: linhaPreview.contratoPdfPath,
          };
        if (args.select?.contratoPreviaPath)
          return {
            numero: linhaPreview.numero,
            contratoPreviaPath: linhaPreview.contratoPreviaPath,
          };
        if (args.select?.levantamentoPdfPath)
          return {
            numero: linhaPreview.numero,
            levantamentoPdfPath: linhaPreview.levantamentoPdfPath,
          };
        return PARA_CONTRATO;
      }),
    },
    produto: { findMany: vi.fn().mockResolvedValue(SKUS) },
    propostaAnexo: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'an-1', nome: 'projeto-PROP-0027.pdf', mime: 'application/pdf', tamanho: 857 },
        ]),
    },
  };
  const previa = {
    linkAssinado: vi.fn(async (_path: string) => 'https://storage/contrato.docx'),
    baixar: vi.fn(async (_path: string) => Buffer.from('')),
  };
  const svc = new PropostaAceiteService(
    prisma as never,
    { get: vi.fn(() => 'k'.repeat(64)) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    previa as never,
    {} as never,
    {} as never,
  );
  mockJwtVerify.mockResolvedValue({ payload: { pid: 'prop-27', eid: 'emp-1' } });
  return { svc, prisma, previa };
}

describe('página de aceite — o que a prévia pública entrega', () => {
  beforeEach(() => vi.clearAllMocks());

  it('proposta aberta: traz o resumo do levantamento, o PROJETO e o rodapé do tenant', async () => {
    const { svc } = montarAceite();
    const p = await svc.resolverPreview(TOKEN);
    expect(p.resumo?.quadros).toHaveLength(3);
    expect(p.resumo?.aluguelMensalTotal).toBe(1528);
    expect(p.anexos).toEqual([
      { id: 'an-1', nome: 'projeto-PROP-0027.pdf', mime: 'application/pdf', tamanho: 857 },
    ]);
    expect(p.rodape).toBe('Empresa X · CNPJ 00 · contato@x');
  });

  it('já respondida: nada do conteúdo — nem resumo nem projeto (F-6)', async () => {
    const { svc } = montarAceite({ status: 'ACEITA', aceiteToken: null });
    const p = await svc.resolverPreview(TOKEN);
    expect(p.jaRespondida).toBe(true);
    expect(p.resumo).toBeNull();
    expect(p.anexos).toEqual([]);
  });

  it('venda: sem resumo de locação, mas o projeto aparece', async () => {
    const { svc } = montarAceite({ modalidade: 'VENDA' });
    const p = await svc.resolverPreview(TOKEN);
    expect(p.resumo).toBeNull();
    expect(p.anexos).toHaveLength(1);
  });

  it('o projeto só abre com o token VIGENTE de proposta aberta', async () => {
    expect(await montarAceite().svc.propostaDoTokenAberto(TOKEN)).toBe('prop-27');
    await expect(
      montarAceite({ aceiteToken: 'outro' }).svc.propostaDoTokenAberto(TOKEN),
    ).rejects.toThrow();
    await expect(
      montarAceite({ status: 'RECUSADA' }).svc.propostaDoTokenAberto(TOKEN),
    ).rejects.toThrow();
  });

  /** "O contrato é o mesmo" (Léo, 25/09): o cliente lê o arquivo congelado no link. */
  it('contrato congelado: a prévia avisa que há contrato e o link abre O ARQUIVO guardado', async () => {
    const { svc, previa } = montarAceite();
    expect((await svc.resolverPreview(TOKEN)).temContrato).toBe(true);
    expect(await svc.linkDoContrato(TOKEN)).toEqual({
      url: 'https://storage/contrato.docx',
      nome: 'PROP-0027.docx',
    });
    expect(previa.linkAssinado).toHaveBeenCalledWith('emp-1/prop-27/1.docx');
  });

  it('LEVANTAMENTO TÉCNICO: a prévia avisa e o link abre O PDF congelado', async () => {
    const { svc, previa } = montarAceite();
    expect((await svc.resolverPreview(TOKEN)).temLevantamento).toBe(true);
    expect(await svc.linkDoLevantamento(TOKEN)).toEqual({
      url: 'https://storage/contrato.docx',
      nome: 'PROP-0027-levantamento-tecnico.pdf',
    });
    expect(previa.linkAssinado).toHaveBeenCalledWith('emp-1/prop-27/1.pdf');
    const aceita = montarAceite({ status: 'ACEITA', aceiteToken: null });
    expect((await aceita.svc.resolverPreview(TOKEN)).temLevantamento).toBe(false);
    await expect(aceita.svc.linkDoLevantamento(TOKEN)).rejects.toThrow();
  });

  /** Léo, 25/09: os dois documentos no mesmo lugar, no mesmo formato, e imprime junto. */
  it('DOCUMENTOS: a prévia avisa, e os links abrem os DOIS PDFs congelados', async () => {
    const { svc, previa } = montarAceite();
    expect((await svc.resolverPreview(TOKEN)).temDocumentos).toBe(true);
    previa.linkAssinado.mockImplementation(async (p: string) => `https://storage/${p}`);
    const d = await svc.documentosDoAceite(TOKEN);
    expect(d.levantamento).toEqual({
      url: 'https://storage/emp-1/prop-27/1.pdf',
      nome: 'PROP-0027-levantamento-tecnico.pdf',
    });
    expect(d.contrato).toEqual({
      url: 'https://storage/emp-1/prop-27/1-contrato.pdf',
      nome: 'PROP-0027-contrato.pdf',
    });
  });

  it('DOCUMENTO COMPLETO: um PDF só, levantamento + contrato, nessa ordem', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const umPdf = async (paginas: number) => {
      const d = await PDFDocument.create();
      for (let i = 0; i < paginas; i++) d.addPage();
      return Buffer.from(await d.save());
    };
    const { svc, previa } = montarAceite();
    const lev = await umPdf(1);
    const con = await umPdf(3);
    previa.baixar.mockImplementation(async (p: string) => (p.includes('contrato') ? con : lev));
    const r = await svc.documentoCompleto(TOKEN);
    expect(r.filename).toBe('PROP-0027-proposta-e-contrato.pdf');
    const junto = await PDFDocument.load(Buffer.from(r.base64, 'base64'));
    expect(junto.getPageCount()).toBe(4);
    expect(previa.baixar.mock.calls.map((c) => c[0])).toEqual([
      'emp-1/prop-27/1.pdf',
      'emp-1/prop-27/1-contrato.pdf',
    ]);
  });

  it('documentos: respondida ou sem o contrato em PDF não abre', async () => {
    const aceita = montarAceite({ status: 'ACEITA', aceiteToken: null });
    expect((await aceita.svc.resolverPreview(TOKEN)).temDocumentos).toBe(false);
    await expect(aceita.svc.documentosDoAceite(TOKEN)).rejects.toThrow();
    const semPdf = montarAceite({ contratoPdfPath: null });
    expect((await semPdf.svc.resolverPreview(TOKEN)).temDocumentos).toBe(false);
    await expect(semPdf.svc.documentoCompleto(TOKEN)).rejects.toThrow();
  });

  it('contrato: sem arquivo congelado não há o que ler; respondida não abre', async () => {
    const sem = montarAceite({ contratoPreviaPath: null });
    expect((await sem.svc.resolverPreview(TOKEN)).temContrato).toBe(false);
    await expect(sem.svc.linkDoContrato(TOKEN)).rejects.toThrow();
    const aceita = montarAceite({ status: 'ACEITA', aceiteToken: null });
    expect((await aceita.svc.resolverPreview(TOKEN)).temContrato).toBe(false);
    await expect(aceita.svc.linkDoContrato(TOKEN)).rejects.toThrow();
    expect(aceita.previa.linkAssinado).not.toHaveBeenCalled();
  });
});

describe('enviarPorEmail — vai pra QUEM ASSINA, com o aluguel por mês', () => {
  function montarEnvio(
    overContrato: Record<string, unknown> = {},
    vigente: { token: string; url: string; expiraEm: Date } | null = null,
  ) {
    const linha = {
      id: 'prop-27',
      numero: 'PROP-0027',
      empresaId: 'emp-1',
      clienteId: 'cli-1',
      status: 'RASCUNHO',
      modalidade: 'LOCACAO',
      criadoEm: new Date('2026-09-25T15:00:00Z'),
      validoAte: new Date('2026-10-24T00:00:00Z'),
      formaPagamento: 'PIX',
      condicaoPagamento: null,
      subtotal: 1528,
      descontoGeral: 0,
      valor: 1528,
      observacoes: null,
      itens: [],
      cliente: { nome: 'INDÚSTRIA TESTE CONTRATO LTDA', cnpj: '76851812000102' },
    };
    const prisma = {
      proposta: {
        findFirst: vi.fn().mockResolvedValue(linha),
        findUnique: vi.fn().mockResolvedValue({ ...PARA_CONTRATO, ...overContrato }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      cliente: {
        findUnique: vi.fn().mockResolvedValue({
          nome: 'INDÚSTRIA TESTE CONTRATO LTDA',
          cnpj: '76851812000102',
          email: 'compras@industria.com.br',
        }),
      },
      empresa: { findUnique: vi.fn().mockResolvedValue({ nome: 'Empresa X', cnpj: null }) },
      produto: { findMany: vi.fn().mockResolvedValue(SKUS) },
    };
    const email = { enviarPropostaParaAprovar: vi.fn().mockResolvedValue({ ok: true }) };
    const aceite = {
      gerarLink: vi.fn().mockResolvedValue({
        token: 't',
        url: 'https://app.x/proposta/aceite/t',
        expiraEm: new Date('2026-10-24T00:00:00Z'),
      }),
      linkVigente: vi.fn().mockResolvedValue(vigente),
    };

    const svc = new PropostasService(
      prisma as never,
      {} as never,
      {} as never,
      { getRepIds: vi.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      email as never,
      aceite as never,
      {} as never,
      { resolver: vi.fn().mockResolvedValue({}) } as never,
      {} as never,
    );
    return { svc, email, aceite, prisma };
  }
  const user = { id: 'u-1', role: 'ADMIN', empresaIdAtiva: 'emp-1' } as never;
  const VIGENTE = {
    token: 'v',
    url: 'https://app.x/proposta/aceite/v',
    expiraEm: new Date('2026-10-02T00:00:00Z'),
  };
  const ENVIADO_EM = new Date('2026-09-25T22:04:00Z');

  it('destinatário = e-mail de quem assina; saudação = a pessoa; aluguel mensal e validade sem fuso', async () => {
    const { svc, email, aceite } = montarEnvio();
    const r = await svc.enviarPorEmail(user, 'prop-27');
    expect(aceite.gerarLink).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      enviadoPara: 'pedido@somatecblocking.com.br',
      url: 'https://app.x/proposta/aceite/t',
    });
    expect(email.enviarPropostaParaAprovar).toHaveBeenCalledWith(
      expect.objectContaining({
        para: 'pedido@somatecblocking.com.br',
        nome: 'Leonardo Beltran',
        aluguelMensal: 1528,
        vigenciaMeses: 60,
        servicosTotal: 12000,
        valorParcela: 6000,
        validade: '24/10/2026',
      }),
    );
  });

  it('sem e-mail de quem assina, cai no do cadastro do cliente', async () => {
    const { svc, email } = montarEnvio({ signatarioEmail: null });
    await svc.enviarPorEmail(user, 'prop-27');
    expect(email.enviarPropostaParaAprovar.mock.calls[0][0].para).toBe('compras@industria.com.br');
  });

  /** Léo, 25/09: o e-mail sai UMA vez por link; clicar de novo mostra o link valendo. */
  it('link valendo e e-mail já enviado: NÃO reenvia, NÃO troca o token — devolve o que está com o cliente', async () => {
    const { svc, email, aceite, prisma } = montarEnvio(
      { aceiteEmailEnviadoEm: ENVIADO_EM, aceiteEmailEnviadoPara: 'pedido@somatecblocking.com.br' },
      VIGENTE,
    );
    const r = await svc.enviarPorEmail(user, 'prop-27');
    expect(r).toMatchObject({
      jaEnviado: true,
      enviadoPara: 'pedido@somatecblocking.com.br',
      enviadoEm: ENVIADO_EM,
      url: VIGENTE.url,
    });
    expect(email.enviarPropostaParaAprovar).not.toHaveBeenCalled();
    expect(aceite.gerarLink).not.toHaveBeenCalled();
    expect(prisma.proposta.updateMany).not.toHaveBeenCalled();
  });

  it('clique duplo: quem não pega a trava NÃO manda o 2º e-mail', async () => {
    const { svc, email, aceite, prisma } = montarEnvio();
    prisma.proposta.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.enviarPorEmail(user, 'prop-27')).rejects.toThrow(/já está sendo enviada/);
    expect(email.enviarPropostaParaAprovar).not.toHaveBeenCalled();
    expect(aceite.gerarLink).not.toHaveBeenCalled();
    expect(prisma.proposta.updateMany.mock.calls[0][0].where).toEqual({
      id: 'prop-27',
      aceiteEmailEnviadoEm: null,
    });
  });

  it('link VENCIDO (ou de volta a rascunho): libera UM envio novo, travando a partir da marca antiga', async () => {
    const { svc, email, prisma } = montarEnvio(
      { aceiteEmailEnviadoEm: ENVIADO_EM, aceiteEmailEnviadoPara: 'pedido@somatecblocking.com.br' },
      null,
    );
    const r = await svc.enviarPorEmail(user, 'prop-27');
    expect(r.jaEnviado).toBe(false);
    expect(email.enviarPropostaParaAprovar).toHaveBeenCalledTimes(1);
    expect(prisma.proposta.updateMany.mock.calls[0][0].where).toEqual({
      id: 'prop-27',
      aceiteEmailEnviadoEm: ENVIADO_EM,
    });
  });

  it('e-mail falhou: devolve a marca — a proposta não fica "enviada" sem e-mail', async () => {
    const { svc, email, prisma } = montarEnvio();
    email.enviarPropostaParaAprovar.mockResolvedValueOnce({ ok: false, motivo: 'resend fora' });
    await expect(svc.enviarPorEmail(user, 'prop-27')).rejects.toThrow(/resend fora/);
    const [, desfaz] = prisma.proposta.updateMany.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(desfaz[0].data).toEqual({ aceiteEmailEnviadoEm: null, aceiteEmailEnviadoPara: null });
  });
});

describe('o projeto congela quando o link de aceite existe', () => {
  function montarAnexos(status: string) {
    const prisma = {
      propostaAnexo: {
        findFirst: vi.fn().mockResolvedValue({ id: 'an-1', url: 'x' }),
        delete: vi.fn(),
      },
    };
    const propostas = {
      findById: vi.fn().mockResolvedValue({ id: 'prop-27', status, empresaId: 'emp-1' }),
    };
    const svc = new PropostaAnexosService(
      prisma as never,
      { get: vi.fn(() => 'http://supabase.test') } as never,
      propostas as never,
    );
    return { svc, prisma };
  }
  const arquivo = {
    filename: 'p.pdf',
    mimetype: 'application/pdf',
    size: 10,
    buffer: Buffer.from('x'),
  };

  it.each(['AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA'])(
    '%s: não troca nem apaga o projeto',
    async (status) => {
      const { svc, prisma } = montarAnexos(status);
      await expect(svc.upload({} as never, 'prop-27', arquivo as never)).rejects.toThrow();
      await expect(svc.remove({} as never, 'prop-27', 'an-1')).rejects.toThrow();
      expect(prisma.propostaAnexo.delete).not.toHaveBeenCalled();
    },
  );

  it('link gerado: a mensagem diz o que fazer', async () => {
    const { svc } = montarAnexos('AGUARDANDO_ASSINATURA');
    await expect(svc.upload({} as never, 'prop-27', arquivo as never)).rejects.toThrow(
      /link de aceite já foi gerado/,
    );
  });
});

describe('contraste do botão na cor de ação (regra da marca: escuro no laranja)', () => {
  it('laranja leva texto ESCURO; navy leva branco', () => {
    expect(textoSobre('#F39200')).toBe('#0B1620');
    expect(textoSobre('#00416E')).toBe('#ffffff');
    expect(textoSobre('lixo')).toBe('#ffffff');
  });

  it('o e-mail com a marca do tenant usa o texto certo no botão', () => {
    const { html } = templatePropostaParaAprovar({
      nome: 'Leonardo',
      empresaNome: 'Empresa X',
      numero: 'PROP-0027',
      aluguelMensal: 1528,
      vigenciaMeses: 60,
      servicosTotal: null,
      parcelas: null,
      valorParcela: null,
      valorTotal: 1528,
      validade: null,
      url: 'https://app.x/a',
      marca: {
        empresaNome: 'Empresa X',
        logoUrl: 'https://x/l.png',
        corPrimaria: '#00416E',
        corAcao: '#F39200',
      },
    });
    expect(html).toMatch(/color:#0B1620;text-decoration:none[^>]*>Ver a proposta e aprovar/);
  });
});
