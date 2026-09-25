import { beforeEach, describe, expect, it, vi } from 'vitest';
import { templatePropostaParaAprovar } from '@integrations/email/email-templates';
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
  );
  mockJwtVerify.mockResolvedValue({ payload: { pid: 'prop-27', eid: 'emp-1' } });
  return { svc, prisma };
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
});

describe('enviarPorEmail — vai pra QUEM ASSINA, com o aluguel por mês', () => {
  function montarEnvio(overContrato: Record<string, unknown> = {}) {
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
    return { svc, email, aceite };
  }
  const user = { id: 'u-1', role: 'ADMIN', empresaIdAtiva: 'emp-1' } as never;

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
