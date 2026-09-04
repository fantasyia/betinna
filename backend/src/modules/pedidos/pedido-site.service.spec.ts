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
    pushFalha?: boolean;
  } = {},
) {
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue(opts.pedidoExistente ?? null),
      create: vi.fn().mockResolvedValue({ id: 'ped-1', numero: 'PED-0009' }),
    },
    produto: {
      findMany: vi
        .fn()
        .mockResolvedValue(opts.produtos ?? [{ id: 'prod-1', sku: 'MB-01', nome: 'Master Block' }]),
    },
    cliente: {
      create: vi.fn().mockResolvedValue({ id: 'cli-novo' }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ cnpj: null, email: null, telefone: null }),
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
  const svc = new PedidoSiteService(
    prisma as never,
    captura as never,
    sequence as never,
    erpPush as never,
    // Comissão de canal: tem teste próprio no serviço dela.
    { recalcular: vi.fn(async () => undefined) } as never,
  );
  return { svc, prisma, captura, erpPush };
}

const PEDIDO = {
  numeroSite: 'SB1234',
  cliente: { nome: 'Indústria X', cpfCnpj: '16774052000155' },
  itens: [{ sku: 'MB-01', quantidade: 2, valorUnitario: 1500 }],
  valorFrete: 50,
};

describe('pedido do site', () => {
  beforeEach(() => vi.clearAllMocks());

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
