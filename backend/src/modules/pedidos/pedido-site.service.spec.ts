import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PedidoSiteService } from './pedido-site.service';

/**
 * O checkout do site entrando no app.
 *
 * O que estes testes protegem é o que custa dinheiro de verdade: pedido
 * duplicado (cobrança e nota em dobro), item que não existe no catálogo virando
 * nota errada, e cliente do site nascendo como cadastro novo quando já existe —
 * o que parte o histórico e tira o cliente da carteira do rep.
 */
function build(
  opts: {
    pedidoExistente?: Record<string, unknown> | null;
    produtos?: Array<{ id: string; sku: string; nome: string }>;
    clientePorDoc?: Array<{ id: string }>;
    /** Como o cadastro já está no banco, pra testar o que o pedido novo sobrescreve. */
    clienteAtual?: Record<string, unknown> | null;
    pushFalha?: boolean;
  } = {},
) {
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue(opts.pedidoExistente ?? null),
      create: vi.fn().mockResolvedValue({ id: 'ped-1', numero: 'PED-0009' }),
      // Guarda (ou limpa) o motivo da falha de envio ao ERP.
      update: vi.fn().mockResolvedValue({}),
    },
    produto: {
      findMany: vi
        .fn()
        .mockResolvedValue(opts.produtos ?? [{ id: 'prod-1', sku: 'MB-01', nome: 'Master Block' }]),
    },
    cliente: {
      create: vi.fn().mockResolvedValue({ id: 'cli-novo' }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.clienteAtual ?? { nome: null, cnpj: null, email: null, telefone: null },
        ),
    },
    $queryRaw: vi.fn().mockResolvedValue(opts.clientePorDoc ?? []),
  };
  const captura = { autenticarChave: vi.fn().mockResolvedValue('emp-1') };
  const sequence = { next: vi.fn().mockResolvedValue(9) };
  const erpPush = {
    enviarPedido: opts.pushFalha
      ? vi.fn().mockRejectedValue(new Error('Tiny 500'))
      : vi.fn().mockResolvedValue({ numeroErp: '77' }),
  };
  const notificacoes = { criarParaRole: vi.fn(async () => undefined) };
  const svc = new PedidoSiteService(
    prisma as never,
    captura as never,
    sequence as never,
    erpPush as never,
    // Comissão de canal: tem teste próprio no serviço dela.
    { recalcular: vi.fn(async () => undefined) } as never,
    notificacoes as never,
  );
  return { svc, prisma, captura, erpPush, notificacoes };
}

const PEDIDO = {
  numeroSite: 'SB1234',
  cliente: { nome: 'Indústria X', cpfCnpj: '16774052000155' },
  itens: [{ sku: 'MB-01', quantidade: 2, valorUnitario: 1500 }],
  valorFrete: 50,
};

describe('pedido do site', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Dois compradores, um CNPJ.
   *
   * O casamento de cliente é por DOCUMENTO, então a segunda pessoa da mesma
   * empresa cai no cadastro da primeira. Até 09/09 o telefone e o e-mail novos
   * eram descartados em silêncio: confirmação, aviso de pagamento e código de
   * rastreio do pedido do SEGUNDO iam todos pro WhatsApp do PRIMEIRO — e o
   * segundo nunca recebia nada, achando que o pedido tinha sumido.
   *
   * Medido em 13 pedidos: o `(11) 99999-0000` entrou UMA vez, no primeiro, e
   * os 12 seguintes herdaram — inclusive os feitos de propósito com o número
   * certo. Duas sessões passaram o dia procurando quem tinha digitado.
   */
  describe('mesmo CNPJ, comprador diferente', () => {
    const doOutroComprador = {
      ...PEDIDO,
      cliente: {
        nome: 'Marina Torres',
        cpfCnpj: '16774052000155',
        email: 'marina@empresa.com.br',
        telefone: '5511997524483',
      },
    };
    const cadastroDoPrimeiro = {
      nome: 'Carlos Aguiar',
      cnpj: '16774052000155',
      email: 'carlos@empresa.com.br',
      telefone: '11999990000',
    };

    /**
     * A cura do problema que o conserto do CNPJ só reduziu: com dois
     * compradores na mesma empresa alternando pedidos, o cadastro fica com o
     * contato do ÚLTIMO — e a mensagem do pedido do primeiro saía pro telefone
     * do segundo. O contato de quem comprou passa a viver no PEDIDO.
     */
    it('o pedido guarda o contato de QUEM O FEZ, não o do cadastro', async () => {
      const { svc, prisma } = build({
        clientePorDoc: [{ id: 'cli-1' }],
        clienteAtual: cadastroDoPrimeiro,
      });

      await svc.receber('emp-1', doOutroComprador as never);

      expect(prisma.pedido.create.mock.calls[0][0].data).toMatchObject({
        contatoNome: 'Marina Torres',
        contatoEmail: 'marina@empresa.com.br',
        contatoTelefone: '5511997524483',
      });
    });

    it('o telefone do pedido de AGORA passa a valer', async () => {
      // É pra este número que a confirmação e o rastreio deste pedido vão.
      const { svc, prisma } = build({
        clientePorDoc: [{ id: 'cli-1' }],
        clienteAtual: cadastroDoPrimeiro,
      });

      await svc.receber('emp-1', doOutroComprador as never);

      expect(prisma.cliente.update.mock.calls[0][0].data).toMatchObject({
        nome: 'Marina Torres',
        email: 'marina@empresa.com.br',
        telefone: '5511997524483',
      });
    });

    it('o DOCUMENTO não é sobrescrito — identidade não vem de formulário', async () => {
      const { svc, prisma } = build({
        clientePorDoc: [{ id: 'cli-1' }],
        clienteAtual: { ...cadastroDoPrimeiro, cnpj: '99999999000199' },
      });

      await svc.receber('emp-1', doOutroComprador as never);

      expect(prisma.cliente.update.mock.calls[0][0].data.cnpj).toBeUndefined();
    });

    it('campo vazio no pedido NÃO apaga o que o cadastro já tem', async () => {
      // Checkout que não pede e-mail não pode zerar o e-mail bom que existe.
      const { svc, prisma } = build({
        clientePorDoc: [{ id: 'cli-1' }],
        clienteAtual: cadastroDoPrimeiro,
      });

      await svc.receber('emp-1', {
        ...PEDIDO,
        cliente: { nome: '  ', cpfCnpj: '16774052000155', telefone: '5511997524483' },
      } as never);

      const data = prisma.cliente.update.mock.calls[0][0].data;
      expect(data.email).toBeUndefined();
      expect(data.nome).toBeUndefined();
      expect(data.telefone).toBe('5511997524483');
    });

    it('mesmo comprador de novo: nada a atualizar no contato', async () => {
      // Sem isto, todo pedido repetido escreveria no banco e logaria "trocou"
      // sem ter trocado nada.
      const { svc, prisma } = build({
        clientePorDoc: [{ id: 'cli-1' }],
        clienteAtual: cadastroDoPrimeiro,
      });

      await svc.receber('emp-1', {
        ...PEDIDO,
        cliente: {
          nome: 'Carlos Aguiar',
          cpfCnpj: '16774052000155',
          email: 'carlos@empresa.com.br',
          telefone: '11999990000',
        },
      } as never);

      const data = (prisma.cliente.update.mock.calls[0]?.[0].data ?? {}) as Record<string, unknown>;
      expect(data.nome).toBeUndefined();
      expect(data.email).toBeUndefined();
      expect(data.telefone).toBeUndefined();
    });
  });

  it('pedido do site nasce Pix, vencimento 30 dias — é o que vira a conta a receber no ERP', async () => {
    const { svc, prisma } = build();
    await svc.receber('emp-1', PEDIDO as never);
    const data = prisma.pedido.create.mock.calls[0][0].data;
    expect(data.formaPagamento).toBe('PIX');
    // Provisório até o gateway (Asaas) carimbar a data real.
    expect(data.condicaoPagamento).toBe('30dias');
  });

  it('cria o pedido como venda de CANAL e sobe pro ERP', async () => {
    const { svc, prisma, erpPush } = build();

    const r = await svc.receber('blc_chave', PEDIDO);

    const dados = prisma.pedido.create.mock.calls[0][0].data;
    expect(dados.origem).toBe('SITE');
    // Sem representante de propósito: atribuir alguém criaria comissão de rep
    // sobre venda que ninguém atendeu.
    expect(dados.representanteId).toBeNull();
    expect(Number(dados.total)).toBe(3050); // 2 × 1500 + 50 de frete
    expect(erpPush.enviarPedido).toHaveBeenCalledWith('ped-1', 'emp-1');
    expect(r.numeroErp).toBe('77');
  });

  it('reenvio do MESMO número não cria segundo pedido', async () => {
    // Clique duplo no checkout, retry do gateway ou reenvio manual — qualquer
    // um deles viraria cobrança dupla e duas notas.
    const { svc, prisma } = build({
      pedidoExistente: { id: 'ped-ja', numero: 'PED-0005', numeroErp: '5' },
    });

    const r = await svc.receber('blc_chave', PEDIDO);

    expect(r.duplicado).toBe(true);
    expect(r.numero).toBe('PED-0005');
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('SKU fora do catálogo RECUSA o pedido inteiro', async () => {
    const { svc, prisma } = build({ produtos: [] });

    await expect(svc.receber('blc_chave', PEDIDO)).rejects.toThrow(/SKU não cadastrado/i);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('cliente que já existe pelo documento NÃO vira cadastro novo', async () => {
    const { svc, prisma } = build({ clientePorDoc: [{ id: 'cli-antigo' }] });

    await svc.receber('blc_chave', PEDIDO);

    expect(prisma.cliente.create).not.toHaveBeenCalled();
    expect(prisma.pedido.create.mock.calls[0][0].data.clienteId).toBe('cli-antigo');
  });

  it('ERP fora do ar não perde o pedido — ele existe e sobe depois', async () => {
    // O cliente já pagou: derrubar a resposta faria o checkout mostrar erro
    // pra uma compra que aconteceu.
    const { svc } = build({ pushFalha: true });

    const r = await svc.receber('blc_chave', PEDIDO);

    expect(r.numero).toBe('PED-0009');
    expect(r.numeroErp).toBeNull();
  });

  it('chave inválida não passa', async () => {
    const { svc, captura } = build();
    captura.autenticarChave.mockRejectedValue(new Error('Chave de API inválida'));

    await expect(svc.receber('errada', PEDIDO)).rejects.toThrow(/inválida/i);
  });

  /**
   * Dois pedidos REAIS morreram em `400 dados inválidos para o banco` porque o
   * item era criado com `produtoNome`, que NÃO é coluna do `PedidoItem`.
   *
   * O `tsc` não pega: em `create` aninhado montado por `.map()`, o TypeScript
   * não aplica checagem de propriedade em excesso. O CI passou, o mock do
   * Prisma aceitou qualquer objeto, e só um pedido de verdade denunciou.
   *
   * Este teste fecha o buraco no único lugar onde dá: afirmando que o payload
   * do item tem EXATAMENTE as colunas que existem.
   */
  it('o item do pedido só leva COLUNAS reais do PedidoItem', async () => {
    const { svc, prisma } = build();

    await svc.receber('blc_chave', PEDIDO);

    const item = prisma.pedido.create.mock.calls[0][0].data.itens.create[0];
    expect(Object.keys(item).sort()).toEqual(
      ['desconto', 'precoUnitario', 'produtoId', 'quantidade', 'total'].sort(),
    );
  });

  /**
   * O pedido de teste real (31/08) chegou no ERP sem CPF e sem endereço: o
   * contato ficou sem documento (não emite NF) e `enderecoEntrega` veio NULL
   * (não gera etiqueta). O endereço ia só como texto na observação — que
   * ninguém imprime.
   *
   * A regra é: tudo que a nota e a etiqueta precisam viaja NO PEDIDO, na hora
   * da compra. Depois disso o cliente não pode ser incomodado por nada.
   */
  describe('o que a NF e a etiqueta exigem', () => {
    const COM_ENTREGA = {
      ...PEDIDO,
      cliente: { nome: 'Fulano de Tal', cpfCnpj: '37258545808', telefone: '11999998888' },
      entrega: {
        cep: '01310-100',
        logradouro: 'Avenida Paulista',
        numero: '1578',
        complemento: 'sala 4',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        uf: 'sp',
      },
    };

    it('cliente NOVO nasce com documento e endereço', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([]);

      await svc.receber('blc_chave', COM_ENTREGA);

      expect(prisma.cliente.create.mock.calls[0][0].data).toMatchObject({
        cnpj: '37258545808',
        cep: '01310-100',
        endereco: 'Avenida Paulista',
        numero: '1578',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        uf: 'SP',
      });
    });

    it('UF vai maiúscula (o ERP recusa "sp")', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([]);

      await svc.receber('blc_chave', COM_ENTREGA);

      expect(prisma.cliente.create.mock.calls[0][0].data.uf).toBe('SP');
    });

    it('endereço pela METADE não vira endereço torto (o ERP recusa)', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([]);

      await svc.receber('blc_chave', { ...COM_ENTREGA, entrega: { cep: '', logradouro: '' } });

      expect(prisma.cliente.create.mock.calls[0][0].data.cep).toBeUndefined();
    });

    it('cliente que JÁ EXISTE recebe o endereço novo — é pra lá que a etiqueta vai', async () => {
      const { svc, prisma } = build({ clientePorDoc: [{ id: 'cli-antigo' }] });
      prisma.cliente.findUnique.mockResolvedValue({ cnpj: null, email: null, telefone: null });

      await svc.receber('blc_chave', COM_ENTREGA);

      expect(prisma.cliente.update.mock.calls[0][0].data).toMatchObject({
        endereco: 'Avenida Paulista',
        cnpj: '37258545808',
      });
    });

    it('mas NÃO sobrescreve documento que já existe no cadastro', async () => {
      const { svc, prisma } = build({ clientePorDoc: [{ id: 'cli-antigo' }] });
      prisma.cliente.findUnique.mockResolvedValue({
        cnpj: '11111111111',
        email: 'antigo@x.com',
        telefone: '1133334444',
      });

      await svc.receber('blc_chave', COM_ENTREGA);

      const patch = prisma.cliente.update.mock.calls[0][0].data;
      expect(patch.cnpj).toBeUndefined();
      expect(patch.email).toBeUndefined();
    });
  });

  /**
   * Pegado num teste REAL em produção (31/08): o pedido caiu no cliente errado
   * e a nota sairia no CPF de outra pessoa.
   *
   * O casamento por sufixo de 8 dígitos (D18) ignora o DDD — "11 99999-0000" e
   * "71 99999-0000" são a MESMA chave. Duas pessoas de estados diferentes
   * colidem, e o pedido de São Paulo foi parar num cadastro da Bahia.
   *
   * Documento é identidade forte; sufixo de telefone é pista. Quando discordam,
   * quem manda é o documento.
   */
  describe('documento veta o casamento por telefone', () => {
    const COMPRADOR = {
      ...PEDIDO,
      cliente: { nome: 'Comprador Novo', cpfCnpj: '37258545808', telefone: '11999990000' },
    };

    it('telefone bate mas o DOCUMENTO é outro → cria cadastro novo', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // busca por documento: não achou
        .mockResolvedValueOnce([{ id: 'cli-bahia', doc: '52998224725' }]); // telefone colidiu

      await svc.receber('blc_chave', COMPRADOR);

      expect(prisma.cliente.create).toHaveBeenCalled();
      expect(prisma.cliente.update).not.toHaveBeenCalled();
    });

    it('telefone bate e o documento é o MESMO → é a mesma pessoa, reusa', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'cli-1', doc: '37258545808' }]);

      await svc.receber('blc_chave', COMPRADOR);

      expect(prisma.cliente.create).not.toHaveBeenCalled();
    });

    it('cliente sem documento no cadastro NÃO é conflito — o telefone ainda vale', async () => {
      // Quem comprou pelo rep costuma não ter documento no cadastro. Recusar
      // aqui partiria o histórico e tiraria o cliente da carteira dele.
      const { svc, prisma } = build();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'cli-do-rep', doc: '' }]);

      await svc.receber('blc_chave', COMPRADOR);

      expect(prisma.cliente.create).not.toHaveBeenCalled();
      expect(prisma.cliente.update).toHaveBeenCalled();
    });

    it('comprador SEM documento segue casando pelo telefone (nada a vetar)', async () => {
      // Sem documento, a busca por documento nem acontece: a PRIMEIRA consulta
      // já é a do telefone.
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cli-1', doc: '52998224725' }]);

      await svc.receber('blc_chave', {
        ...PEDIDO,
        cliente: { nome: 'Sem Doc', telefone: '11999990000' },
      });

      expect(prisma.cliente.create).not.toHaveBeenCalled();
    });
  });
});

describe('falha de envio ao ERP deixa RASTRO', () => {
  // Antes: o único registro era um `logger.error` no container. Passadas
  // algumas horas o log rotaciona e sobra um RASCUNHO mudo — cliente pagou,
  // expedição não vê, e não dá pra dizer por quê. Aconteceu em 09/09 com dois
  // pedidos de teste, e foi impossível recuperar a causa.
  it('grava o motivo NO pedido e avisa quem decide', async () => {
    const { svc, prisma, erpPush, notificacoes } = build();
    erpPush.enviarPedido.mockRejectedValue(new Error('contato recusado pelo ERP'));

    const r = await svc.receber('blc_chave', PEDIDO);

    // O pedido continua existindo: o cliente pagou.
    expect(r.numero).toBe('PED-0009');
    expect(prisma.pedido.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ erpErro: 'contato recusado pelo ERP' }),
      }),
    );
    expect(notificacoes.criarParaRole).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['DIRECTOR', 'ADMIN'], prioridade: 'ALTA' }),
    );
  });

  it('quando sobe, limpa a marca — senão o pedido fica marcado pra sempre', async () => {
    const { svc, prisma } = build();

    await svc.receber('blc_chave', PEDIDO);

    expect(prisma.pedido.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { erpErro: null, erpErroEm: null } }),
    );
  });

  it('falha ao gravar o rastro não derruba a resposta do checkout', async () => {
    // O pedido do cliente vale mais que o nosso registro dele.
    const { svc, prisma, erpPush } = build();
    erpPush.enviarPedido.mockRejectedValue(new Error('ERP fora'));
    prisma.pedido.update.mockRejectedValue(new Error('banco instável'));

    await expect(svc.receber('blc_chave', PEDIDO)).resolves.toMatchObject({ numero: 'PED-0009' });
  });
});
