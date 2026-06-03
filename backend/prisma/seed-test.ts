/* eslint-disable no-console */
/**
 * Seed de TESTE — varredura pré-beta (E2E).
 * Roda contra o Supabase LOCAL (Docker). NUNCA contra produção.
 *
 *   npx dotenv -e .env.test -- npx tsx prisma/seed-test.ts
 *
 * Cria 2 empresas (tenants), usuários por papel (em login do Supabase local),
 * 30 produtos, 20 clientes, 10 pedidos, 5 propostas e 3 conversas WhatsApp.
 * Idempotente: limpa os dados transacionais das empresas de teste e recria.
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import {
  ACTIONS,
  DEFAULT_PERMISSIONS,
  MODULES,
} from '../src/modules/permissions/permissions.constants';

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PASS = process.env.SEED_TEST_PASSWORD ?? 'Teste@2026';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.\n' +
      '   Rode com: npx dotenv -e .env.test -- npx tsx prisma/seed-test.ts',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const round2 = (n: number): number => Math.round(n * 100) / 100;
const pad = (n: number): string => String(n).padStart(2, '0');

/** Cria (ou recupera) o usuário no Supabase Auth local com senha conhecida. */
async function ensureAuthUser(email: string, nome: string, role: string): Promise<string> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;
  const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) {
    await supabase.auth.admin.updateUserById(found.id, {
      password: PASS,
      email_confirm: true,
      user_metadata: { nome, role },
    });
    return found.id;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASS,
    email_confirm: true,
    user_metadata: { nome, role },
  });
  if (error || !data.user) throw error ?? new Error(`createUser falhou para ${email}`);
  return data.user.id;
}

async function seedPermissoes(): Promise<void> {
  for (const role of Object.keys(DEFAULT_PERMISSIONS) as Array<keyof typeof DEFAULT_PERMISSIONS>) {
    const moduleMap = DEFAULT_PERMISSIONS[role];
    for (const m of MODULES) {
      const actions = moduleMap[m] ?? [];
      const podeVer = actions.includes('view');
      const podeEditar = actions.some((a: (typeof ACTIONS)[number]) => a !== 'view');
      await prisma.permissao.upsert({
        where: { role_modulo: { role, modulo: m } },
        update: { podeVer, podeEditar },
        create: { role, modulo: m, podeVer, podeEditar },
      });
    }
  }
}

async function makeEmpresa(
  cnpj: string,
  nome: string,
  ramo: string,
  cidade: string,
  uf: string,
  subtitulo: string,
): Promise<string> {
  const e = await prisma.empresa.upsert({
    where: { cnpj },
    update: { nome, ramo, cidade, uf, subtitulo, ativo: true },
    create: { nome, cnpj, ramo, cidade, uf, subtitulo, ativo: true },
  });
  return e.id;
}

async function makeUser(
  email: string,
  nome: string,
  role: string,
  empresaIds: string[],
  gerenteId: string | null = null,
): Promise<string> {
  const id = await ensureAuthUser(email, nome, role);
  await prisma.usuario.upsert({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: { email, nome, role: role as any, status: 'ATIVO', gerenteId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: { id, email, nome, role: role as any, status: 'ATIVO', gerenteId },
  });
  for (const empresaId of empresaIds) {
    await prisma.usuarioEmpresa.upsert({
      where: { usuarioId_empresaId: { usuarioId: id, empresaId } },
      update: {},
      create: { usuarioId: id, empresaId },
    });
  }
  return id;
}

/** Apaga os dados transacionais das empresas de teste (idempotência). */
async function limparEmpresas(ids: string[]): Promise<void> {
  // Ordem importa por FK. Lead referencia funil/funilEtapa/cliente → apaga primeiro.
  await prisma.lead.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { empresaId: { in: ids } } }); // cascata: Message + ConversationNota
  await prisma.pedido.deleteMany({ where: { empresaId: { in: ids } } }); // cascata: PedidoItem
  await prisma.proposta.deleteMany({ where: { empresaId: { in: ids } } }); // cascata: PropostaItem
  await prisma.campanha.deleteMany({ where: { empresaId: { in: ids } } }); // cascata: CampanhaDestinatario
  await prisma.cliente.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.produto.deleteMany({ where: { empresaId: { in: ids } } });
  // Config/CRM acessória criada pelos testes (evita poluição entre runs).
  await prisma.funil.deleteMany({ where: { empresaId: { in: ids } } }); // cascata: FunilEtapa
  await prisma.tag.deleteMany({ where: { empresaId: { in: ids } } }); // cascata: ClienteTag
  await prisma.segmento.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.meta.deleteMany({ where: { empresaId: { in: ids } } });
}

const PRODUTOS_A = [
  'Óleo de Soja 900ml',
  'Açúcar Refinado 1kg',
  'Farinha de Trigo 1kg',
  'Arroz Branco 5kg',
  'Feijão Carioca 1kg',
  'Macarrão Espaguete 500g',
  'Molho de Tomate 340g',
  'Café Torrado 500g',
  'Leite em Pó 400g',
  'Sal Refinado 1kg',
  'Óleo de Girassol 900ml',
  'Azeite Extra Virgem 500ml',
  'Maionese 500g',
  'Vinagre de Álcool 750ml',
  'Biscoito Recheado 130g',
  'Achocolatado em Pó 400g',
  'Aveia em Flocos 500g',
  'Fubá Mimoso 1kg',
  'Extrato de Tomate 340g',
  'Leite Condensado 395g',
];

const PRODUTOS_B = [
  'Refrigerante Cola 2L',
  'Refrigerante Guaraná 2L',
  'Suco de Laranja 1L',
  'Suco de Uva 1L',
  'Água Mineral 500ml',
  'Água com Gás 500ml',
  'Energético 250ml',
  'Chá Gelado Limão 1,5L',
  'Refrigerante Laranja 2L',
  'Água de Coco 1L',
];

const CLIENTES_A = [
  'Mercado Bom Preço',
  'Distribuidora Central',
  'Supermercado Família',
  'Atacadão do Bairro',
  'Mercearia da Esquina',
  'Empório São José',
  'Super Econômico',
  'Comercial Aliança',
  'Mercado Estrela',
  'Distribuidora Sul',
  'Hortifruti Verde',
  'Padaria Pão Quente',
  'Mercado Popular',
  'Atacado Mais',
];

const CLIENTES_B = [
  'Bar do Zé',
  'Lanchonete Sabor',
  'Conveniência 24h',
  'Restaurante Sabor Caseiro',
  'Distribuidora de Bebidas Norte',
  'Adega Premium',
];

const CLIENTE_STATUS = ['ATIVO', 'NOVO', 'PROSPECT', 'RISCO', 'ATIVO', 'ATIVO'] as const;

async function main(): Promise<void> {
  console.log('🌱 Seed de TESTE (E2E) iniciando...\n');

  console.log('→ Permissões');
  await seedPermissoes();

  console.log('→ Empresas');
  const empA = await makeEmpresa(
    '11.111.111/0001-11',
    'Alfa Alimentos',
    'Alimentos B2B',
    'São Paulo',
    'SP',
    'Tenant de teste A',
  );
  const empB = await makeEmpresa(
    '22.222.222/0001-22',
    'Beta Bebidas',
    'Bebidas B2B',
    'Campinas',
    'SP',
    'Tenant de teste B',
  );

  console.log('→ Usuários (Supabase Auth local + Postgres)');
  await makeUser('admin@betinna.test', 'Admin Plataforma', 'ADMIN', [empA, empB]);
  await makeUser('diretor.a@betinna.test', 'Diretor Alfa', 'DIRECTOR', [empA]);
  const gerA = await makeUser('gerente.a@betinna.test', 'Gerente Alfa', 'GERENTE', [empA]);
  const repA1 = await makeUser('rep.a1@betinna.test', 'Rep Alfa 1', 'REP', [empA], gerA);
  const repA2 = await makeUser('rep.a2@betinna.test', 'Rep Alfa 2', 'REP', [empA], gerA);
  await makeUser('diretor.b@betinna.test', 'Diretor Beta', 'DIRECTOR', [empB]);
  const gerB = await makeUser('gerente.b@betinna.test', 'Gerente Beta', 'GERENTE', [empB]);
  const repB1 = await makeUser('rep.b1@betinna.test', 'Rep Beta 1', 'REP', [empB], gerB);
  const repB2 = await makeUser('rep.b2@betinna.test', 'Rep Beta 2', 'REP', [empB], gerB);

  console.log('→ Limpando dados transacionais anteriores (idempotência)');
  await limparEmpresas([empA, empB]);

  console.log('→ Produtos');
  const prodA = await Promise.all(
    PRODUTOS_A.map((nome, i) => {
      const preco = round2(8 + i * 3.5 + 0.9);
      return prisma.produto.create({
        data: {
          empresaId: empA,
          nome,
          sku: `ALF-${pad(i + 1)}`,
          codigoOmie: `${9100 + i}`,
          linha: 'Alimentos',
          categoria: 'Mercearia',
          unidade: 'UN',
          precoTabela: preco,
          precoFabrica: round2(preco * 0.7),
          popularidade: (i * 7) % 100,
          estoque: 50 + i * 5,
          ativo: true,
          isDemo: true,
        },
      });
    }),
  );
  const prodB = await Promise.all(
    PRODUTOS_B.map((nome, i) => {
      const preco = round2(4 + i * 2.2 + 0.5);
      return prisma.produto.create({
        data: {
          empresaId: empB,
          nome,
          sku: `BET-${pad(i + 1)}`,
          codigoOmie: `${9200 + i}`,
          linha: 'Bebidas',
          categoria: 'Bebidas',
          unidade: 'UN',
          precoTabela: preco,
          precoFabrica: round2(preco * 0.7),
          popularidade: (i * 11) % 100,
          estoque: 80 + i * 4,
          ativo: true,
          isDemo: true,
        },
      });
    }),
  );

  console.log('→ Clientes');
  const repsA = [repA1, repA2, null, repA1, repA2, null, repA1, repA2, repA1, repA2, null, repA1, repA2, repA1];
  const cliA = await Promise.all(
    CLIENTES_A.map((nome, i) =>
      prisma.cliente.create({
        data: {
          empresaId: empA,
          nome,
          codigoOmie: `${5100 + i}`,
          cnpj: `33.${pad(i + 1)}3.333/0001-33`,
          email: `contato${i + 1}@alfacli.test`,
          telefone: `1199${pad(i + 1)}00${pad(i + 1)}`,
          cidade: 'São Paulo',
          uf: 'SP',
          status: CLIENTE_STATUS[i % CLIENTE_STATUS.length],
          representanteId: repsA[i] ?? null,
          isDemo: true,
        },
      }),
    ),
  );
  const repsB = [repB1, repB2, null, repB1, repB2, repB1];
  const cliB = await Promise.all(
    CLIENTES_B.map((nome, i) =>
      prisma.cliente.create({
        data: {
          empresaId: empB,
          nome,
          codigoOmie: `${5300 + i}`,
          cnpj: `44.${pad(i + 1)}4.444/0001-44`,
          email: `contato${i + 1}@betacli.test`,
          telefone: `1988${pad(i + 1)}00${pad(i + 1)}`,
          cidade: 'Campinas',
          uf: 'SP',
          status: CLIENTE_STATUS[i % CLIENTE_STATUS.length],
          representanteId: repsB[i] ?? null,
          isDemo: true,
        },
      }),
    ),
  );

  console.log('→ Pedidos');
  // [empresa, prefixo, produtos, clientes, status, descontoGeral?]
  const pedStatusA = [
    'RASCUNHO',
    'AGUARDANDO_APROVACAO',
    'ENVIADO_OMIE',
    'PAGO',
    'ENVIADO',
    'ENTREGUE',
    'CANCELADO',
  ] as const;
  const pedStatusB = ['RASCUNHO', 'ENVIADO_OMIE', 'ENTREGUE'] as const;

  async function criarPedido(
    empresaId: string,
    numero: string,
    clienteId: string,
    representanteId: string | null,
    status: string,
    produtos: { id: string; precoTabela: unknown }[],
    descontoGeral = 0,
  ): Promise<void> {
    const itens = produtos.slice(0, 2).map((p, idx) => {
      const preco = Number(p.precoTabela);
      const qtd = (idx + 1) * 10;
      const desc = idx === 0 ? 0 : 5;
      const total = round2(qtd * preco * (1 - desc / 100));
      return { produtoId: p.id, quantidade: qtd, precoUnitario: preco, desconto: desc, total };
    });
    const subtotal = round2(itens.reduce((s, i) => s + i.quantidade * i.precoUnitario, 0));
    const totalItens = round2(itens.reduce((s, i) => s + i.total, 0));
    const total = round2(totalItens * (1 - descontoGeral / 100));
    await prisma.pedido.create({
      data: {
        numero,
        empresaId,
        clienteId,
        representanteId,
        status: status as never,
        origem: 'REP_APP',
        formaPagamento: 'BOLETO',
        subtotal,
        descontoGeral,
        total,
        comissao: round2(total * 0.05),
        motivoDesconto: status === 'AGUARDANDO_APROVACAO' ? 'Desconto acima do teto do rep' : null,
        isDemo: true,
        itens: { create: itens },
      },
    });
  }

  for (let i = 0; i < pedStatusA.length; i++) {
    const cli = cliA[i % cliA.length];
    await criarPedido(
      empA,
      `PED-A-${pad(i + 1)}`,
      cli.id,
      cli.representanteId,
      pedStatusA[i],
      [prodA[i % prodA.length], prodA[(i + 1) % prodA.length]],
      pedStatusA[i] === 'AGUARDANDO_APROVACAO' ? 18 : 0,
    );
  }
  for (let i = 0; i < pedStatusB.length; i++) {
    const cli = cliB[i % cliB.length];
    await criarPedido(
      empB,
      `PED-B-${pad(i + 1)}`,
      cli.id,
      cli.representanteId,
      pedStatusB[i],
      [prodB[i % prodB.length], prodB[(i + 1) % prodB.length]],
      0,
    );
  }

  console.log('→ Propostas');
  const propStatusA = ['RASCUNHO', 'ENVIADA', 'ACEITA'] as const;
  const propStatusB = ['ENVIADA', 'NEGOCIACAO'] as const;

  async function criarProposta(
    empresaId: string,
    numero: string,
    clienteId: string,
    representanteId: string | null,
    status: string,
    produtos: { id: string; nome: string; precoTabela: unknown }[],
  ): Promise<void> {
    const itens = produtos.slice(0, 2).map((p, idx) => {
      const preco = Number(p.precoTabela);
      const qtd = (idx + 1) * 8;
      const total = round2(qtd * preco);
      return {
        produtoId: p.id,
        produtoNome: p.nome,
        quantidade: qtd,
        precoUnitario: preco,
        desconto: 0,
        total,
      };
    });
    const subtotal = round2(itens.reduce((s, i) => s + i.total, 0));
    await prisma.proposta.create({
      data: {
        numero,
        empresaId,
        clienteId,
        representanteId,
        status: status as never,
        probabilidade: 60,
        validoAte: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        formaPagamento: 'BOLETO',
        subtotal,
        descontoGeral: 0,
        valor: subtotal,
        comissaoEstimada: round2(subtotal * 0.05),
        isDemo: true,
        itens: { create: itens },
      },
    });
  }

  for (let i = 0; i < propStatusA.length; i++) {
    const cli = cliA[(i + 2) % cliA.length];
    await criarProposta(empA, `PROP-A-${pad(i + 1)}`, cli.id, cli.representanteId, propStatusA[i], [
      prodA[(i + 3) % prodA.length],
      prodA[(i + 4) % prodA.length],
    ]);
  }
  for (let i = 0; i < propStatusB.length; i++) {
    const cli = cliB[(i + 1) % cliB.length];
    await criarProposta(empB, `PROP-B-${pad(i + 1)}`, cli.id, cli.representanteId, propStatusB[i], [
      prodB[(i + 2) % prodB.length],
      prodB[(i + 3) % prodB.length],
    ]);
  }

  console.log('→ Conversas WhatsApp (Inbox)');
  async function criarConversa(
    empresaId: string,
    peerId: string,
    peerNome: string,
    clienteId: string,
    atribuidoId: string | null,
    msgs: { dir: 'INBOUND' | 'OUTBOUND'; conteudo: string; bot?: boolean }[],
  ): Promise<void> {
    const last = msgs[msgs.length - 1];
    await prisma.conversation.create({
      data: {
        empresaId,
        canal: 'WHATSAPP',
        peerId,
        peerNome,
        clienteId,
        atribuidoId,
        status: 'ABERTA',
        categoria: 'GERAL',
        naoLidas: msgs.filter((m) => m.dir === 'INBOUND').length,
        ultimaMsgEm: new Date(),
        ultimaMsgPreview: last.conteudo.slice(0, 120),
        isDemo: true,
        mensagens: {
          create: msgs.map((m) => ({
            direction: m.dir,
            tipo: 'TEXT',
            conteudo: m.conteudo,
            status: m.dir === 'INBOUND' ? 'RECEIVED' : 'SENT',
            enviadaPorBot: m.bot ?? false,
            autorUsuarioId: m.dir === 'OUTBOUND' && !m.bot ? atribuidoId : null,
          })),
        },
      },
    });
  }

  await criarConversa(empA, '5511990001111', 'João Mercado', cliA[0].id, repA1, [
    { dir: 'INBOUND', conteudo: 'Oi, vocês têm óleo de soja em caixa?' },
    { dir: 'OUTBOUND', conteudo: 'Recebi sua mensagem! Já te respondo com os detalhes.', bot: true },
    { dir: 'OUTBOUND', conteudo: 'Olá João! Temos sim, caixa com 20 unidades. Quer que eu faça um pedido?' },
  ]);
  await criarConversa(empA, '5511990002222', 'Maria Distribuidora', cliA[1].id, repA2, [
    { dir: 'INBOUND', conteudo: 'Bom dia, qual o prazo de entrega pra Campinas?' },
    { dir: 'OUTBOUND', conteudo: 'Bom dia! Em média 3 dias úteis.' },
  ]);
  await criarConversa(empB, '5519990003333', 'Bar do Zé', cliB[0].id, repB1, [
    { dir: 'INBOUND', conteudo: 'Tem refrigerante cola 2L em promoção?' },
    { dir: 'OUTBOUND', conteudo: 'Boa pergunta — deixa eu consultar aqui e já te retorno.', bot: true },
  ]);

  // ── Resumo ──────────────────────────────────────────────────────────────
  const counts = {
    empresas: await prisma.empresa.count({ where: { id: { in: [empA, empB] } } }),
    usuarios: await prisma.usuario.count(),
    produtos: await prisma.produto.count({ where: { empresaId: { in: [empA, empB] } } }),
    clientes: await prisma.cliente.count({ where: { empresaId: { in: [empA, empB] } } }),
    pedidos: await prisma.pedido.count({ where: { empresaId: { in: [empA, empB] } } }),
    propostas: await prisma.proposta.count({ where: { empresaId: { in: [empA, empB] } } }),
    conversas: await prisma.conversation.count({ where: { empresaId: { in: [empA, empB] } } }),
  };
  console.log('\n✅ Seed de teste concluído:');
  console.table(counts);
  console.log(`\n🔑 Senha de todos os usuários de teste: ${PASS}\n`);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed de teste:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
