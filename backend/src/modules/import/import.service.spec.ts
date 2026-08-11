import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { UserRole } from '@prisma/client';
import { ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ImportService } from './import.service';

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'u@x.com',
  nome: 'U',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const makePrisma = () => ({
  cliente: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'cli-novo' }),
    update: vi.fn().mockResolvedValue({ id: 'cli-existente' }),
  },
  produto: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'prod-novo' }),
    update: vi.fn().mockResolvedValue({ id: 'prod-existente' }),
  },
  lead: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: 'lead-novo',
      nome: 'Lead Novo',
      etapa: 'NOVO',
      valorEstimado: 0,
    }),
    update: vi.fn().mockResolvedValue({ id: 'lead-existente' }),
  },
  funil: {
    findFirst: vi.fn().mockResolvedValue({ id: 'funil-pad' }),
  },
  funilEtapa: {
    findFirst: vi.fn().mockResolvedValue({ id: 'etapa-1', funilId: 'funil-pad', tipo: 'ATIVA' }),
  },
  // Dedup por sufixo de telefone (D18) e por CNPJ só-dígitos usam SQL cru.
  // Default: nada encontrado.
  $queryRaw: vi.fn().mockResolvedValue([]),
});

// Bus de fluxos: o import só dispara LEAD_CRIADO quando o opt-in vem ligado.
const makeBus = () => ({ disparar: vi.fn().mockResolvedValue(undefined) });

// #72: o precoFabrica do create usa OMIE_PRECO_FABRICA_RATIO (era 0.7 cravado).
const makeEnv = () => ({ get: vi.fn().mockReturnValue(0.7) });

describe('ImportService.importarClientes', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new ImportService(prisma as never, bus as never, makeEnv() as never);
  });

  it('REP recebe ForbiddenException', async () => {
    await expect(
      svc.importarClientes(fakeUser({ role: 'REP' as UserRole }), {
        csv: 'nome\nCliente A',
        dryRun: false,
        onDuplicate: 'skip',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SAC recebe ForbiddenException', async () => {
    await expect(
      svc.importarClientes(fakeUser({ role: 'SAC' as UserRole }), {
        csv: 'nome\nCliente A',
        dryRun: false,
        onDuplicate: 'skip',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('importa CSV simples com header', async () => {
    const csv = 'nome,cnpj,email\nCliente A,12.345.678/0001-90,a@a.com\nCliente B,,b@b.com';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.total).toBe(2);
    expect(r.criados).toBe(2);
    expect(prisma.cliente.create).toHaveBeenCalledTimes(2);
  });

  it('aceita separador ponto-e-vírgula (pt-BR Excel)', async () => {
    const csv = 'nome;email\nCliente A;a@a.com';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
  });

  it('rejeita linha sem nome', async () => {
    const csv = 'nome,email\n,sem-nome@a.com';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(0);
    expect(r.erros).toBe(1);
    expect(r.detalhes[0]?.motivo).toContain('nome');
  });

  it('onDuplicate=skip pula registros existentes', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cli-velho' }]);
    const csv = 'nome,cnpj\nCliente A,12.345.678/0001-90';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.pulados).toBe(1);
    expect(r.criados).toBe(0);
    expect(prisma.cliente.create).not.toHaveBeenCalled();
  });

  it('onDuplicate=update atualiza existente', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cli-velho' }]);
    const csv = 'nome,cnpj\nCliente A,12.345.678/0001-90';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'update',
    });
    expect(r.atualizados).toBe(1);
    expect(prisma.cliente.update).toHaveBeenCalled();
  });

  it('onDuplicate=error reporta erro', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cli-velho' }]);
    const csv = 'nome,cnpj\nCliente A,12.345.678/0001-90';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'error',
    });
    expect(r.erros).toBe(1);
  });

  it('dryRun não chama create/update', async () => {
    const csv = 'nome\nCliente Novo';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: true,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    expect(r.dryRun).toBe(true);
    expect(prisma.cliente.create).not.toHaveBeenCalled();
  });

  it('CNPJ inválido vira null (mas continua importando)', async () => {
    const csv = 'nome,cnpj\nCliente A,123';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    const arg = prisma.cliente.create.mock.calls[0][0];
    expect(arg.data.cnpj).toBeNull();
  });

  it('aceita headers em PT-BR alternativos (razao_social, e-mail)', async () => {
    const csv = 'razao_social,e-mail\nMinha Empresa,contato@e.com';
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    const arg = prisma.cliente.create.mock.calls[0][0];
    expect(arg.data.nome).toBe('Minha Empresa');
    expect(arg.data.email).toBe('contato@e.com');
  });

  it('detalhes limitados a 100 linhas', async () => {
    const lines = ['nome'];
    for (let i = 0; i < 150; i++) lines.push(`Cliente ${i}`);
    const csv = lines.join('\n');
    const r = await svc.importarClientes(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.total).toBe(150);
    expect(r.detalhes).toHaveLength(100);
  });
});

describe('ImportService.importarProdutos', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new ImportService(prisma as never, bus as never, makeEnv() as never);
  });

  it('GERENTE recebe ForbiddenException (produtos é DIRECTOR/ADMIN)', async () => {
    await expect(
      svc.importarProdutos(fakeUser({ role: 'GERENTE' as UserRole }), {
        csv: 'nome,preco\nProd A,10',
        dryRun: false,
        onDuplicate: 'skip',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('parsea preço pt-BR "1.234,56" (em CSV com separador ;)', async () => {
    const csv = 'nome;preco\nProd Caro;1.234,56';
    const r = await svc.importarProdutos(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    const arg = prisma.produto.create.mock.calls[0][0];
    expect(arg.data.precoTabela).toBeCloseTo(1234.56);
  });

  it('parsea preço en-US "1234.56"', async () => {
    const csv = 'nome,preco\nProd,99.99';
    await svc.importarProdutos(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    const arg = prisma.produto.create.mock.calls[0][0];
    expect(arg.data.precoTabela).toBeCloseTo(99.99);
  });

  it('rejeita preço inválido', async () => {
    const csv = 'nome,preco\nProd X,nao-e-numero';
    const r = await svc.importarProdutos(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(0);
    expect(r.erros).toBe(1);
  });

  it('precoFabrica = precoTabela × 0.7 (heurística)', async () => {
    const csv = 'nome,preco\nProd,100';
    await svc.importarProdutos(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    const arg = prisma.produto.create.mock.calls[0][0];
    expect(arg.data.precoFabrica).toBeCloseTo(70);
  });

  it('unidade default UN quando não informada', async () => {
    const csv = 'nome,preco\nProd,10';
    await svc.importarProdutos(fakeUser(), {
      csv,
      dryRun: false,
      onDuplicate: 'skip',
    });
    const arg = prisma.produto.create.mock.calls[0][0];
    expect(arg.data.unidade).toBe('UN');
  });
});

describe('ImportService.importarLeads', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new ImportService(prisma as never, bus as never, makeEnv() as never);
  });

  it('REP recebe ForbiddenException', async () => {
    await expect(
      svc.importarLeads(fakeUser({ role: 'REP' as UserRole }), {
        csv: 'nome\nLead A',
        dryRun: false,
        onDuplicate: 'skip',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('importa rows (Excel) — sem etapa escolhida, entra como CONTATO (sem funil)', async () => {
    const r = await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Rep João', telefone: '11999990000', cidade: 'São Paulo' }],
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    const arg = prisma.lead.create.mock.calls[0][0];
    expect(arg.data.nome).toBe('Rep João');
    // Import normaliza pra E.164 (assume BR quando vem sem DDI).
    expect(arg.data.contatoTelefone).toBe('+5511999990000');
    // Regra de produto: só entra no funil quando o import diz a ETAPA.
    expect(arg.data.funilEtapaId).toBeNull();
    expect(arg.data.variaveis).toMatchObject({ origem: 'importacao_excel' });
  });

  it('CSV com header "whatsapp" vira contatoTelefone', async () => {
    const r = await svc.importarLeads(fakeUser(), {
      csv: 'nome,whatsapp\nMaria,11988887777',
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    expect(prisma.lead.create.mock.calls[0][0].data.contatoTelefone).toBe('+5511988887777');
  });

  it('dedup por telefone: onDuplicate=skip pula o existente', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);
    const r = await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.pulados).toBe(1);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('rejeita linha sem nome', async () => {
    const r = await svc.importarLeads(fakeUser(), {
      rows: [{ telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.erros).toBe(1);
    expect(r.criados).toBe(0);
  });

  it('respeita funilEtapaId explícito', async () => {
    prisma.funilEtapa.findFirst.mockResolvedValueOnce({
      id: 'etapa-prospec',
      funilId: 'funil-reps',
      tipo: 'ATIVA',
    });
    const r = await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead X' }],
      funilEtapaId: 'etapa-prospec',
      dryRun: false,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    const arg = prisma.lead.create.mock.calls[0][0];
    expect(arg.data.funilEtapaId).toBe('etapa-prospec');
    expect(arg.data.funilId).toBe('funil-reps');
  });

  it('dryRun não persiste', async () => {
    const r = await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead Y' }],
      dryRun: true,
      onDuplicate: 'skip',
    });
    expect(r.criados).toBe(1);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
  it('lead NOVO nasce com origemCadastro=importacao (nunca nulo)', async () => {
    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead Z', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'skip',
    });
    // Sem isto, "sem UTM porque veio de planilha" ficava indistinguível de
    // "rastreio quebrado" — que é o motivo do campo existir.
    expect(prisma.lead.create.mock.calls[0][0].data.origemCadastro).toBe('importacao');
  });

  it('onDuplicate=update PRESERVA a atribuição do lead existente (não substitui variaveis)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);
    prisma.lead.findUnique.mockResolvedValueOnce({
      variaveis: {
        atribuicao: { primeiro: { utmCampaign: 'vtcd-alimenticia' } },
        classificacao_betinna: 'forte',
      },
    });

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000', empresa: 'ACME' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    const vars = prisma.lead.update.mock.calls[0][0].data.variaveis;
    // Campo JSON no Prisma SUBSTITUI o valor inteiro — por isso o merge.
    // A campanha que trouxe o lead não pode morrer numa reimportação.
    expect(vars.atribuicao).toEqual({ primeiro: { utmCampaign: 'vtcd-alimenticia' } });
    expect(vars.classificacao_betinna).toBe('forte');
    // E o que o import traz entra junto.
    expect(vars.origem).toBe('importacao_excel');
    expect(vars.empresa).toBe('ACME');
  });

  it('onDuplicate=update NÃO reescreve a porta de entrada do lead existente', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    // Reimportar não transforma retroativamente um lead do site em lead de planilha.
    expect(prisma.lead.update.mock.calls[0][0].data.origemCadastro).toBeUndefined();
  });

  it('lead existente SEM variaveis não quebra o merge', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);
    prisma.lead.findUnique.mockResolvedValueOnce({ variaveis: null });

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    expect(prisma.lead.update.mock.calls[0][0].data.variaveis).toMatchObject({
      origem: 'importacao_excel',
    });
  });
});

// ─── Auditoria 2026-08: o import não pode destruir dado acumulado ─────

describe('ImportService — proteções do onDuplicate=update (auditoria)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new ImportService(prisma as never, bus as never, makeEnv() as never);
  });

  it('lead: update NÃO move o lead de volta pra etapa alvo do import', async () => {
    // O bug: re-importar a planilha de prospecção arrastava de volta um lead que
    // já estava em Negociação — sem disparar LEAD_ETAPA_MUDOU e sem histórico.
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    const data = prisma.lead.update.mock.calls[0][0].data;
    expect(data.etapa).toBeUndefined();
    expect(data.funilId).toBeUndefined();
    expect(data.funilEtapaId).toBeUndefined();
    expect(data.canalOrigem).toBeUndefined();
  });

  it('lead: update NÃO zera valorEstimado quando a planilha não traz a coluna', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    expect(prisma.lead.update.mock.calls[0][0].data.valorEstimado).toBeUndefined();
  });

  it('lead: update GRAVA valorEstimado quando a coluna existe', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000', valor: '5000' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    expect(prisma.lead.update.mock.calls[0][0].data.valorEstimado).toBe(5000);
  });

  it('lead: update NÃO apaga e-mail/cidade que a planilha não trouxe', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-velho' }]);

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    const data = prisma.lead.update.mock.calls[0][0].data;
    expect(data.contatoEmail).toBeUndefined();
    expect(data.cidade).toBeUndefined();
    expect(data.uf).toBeUndefined();
  });

  it('lead: dedup casa por SUFIXO de 8 dígitos (D18), não igualdade crua', async () => {
    // Lead criado por conversa de WhatsApp guarda o número do JID (sem '+').
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-do-whatsapp' }]);

    const r = await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Mesma pessoa', telefone: '(11) 99999-0000' }],
      dryRun: false,
      onDuplicate: 'skip',
    });

    expect(r.pulados).toBe(1);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('lead SEM telefone deduplica por e-mail (antes duplicava a cada reenvio)', async () => {
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-por-email' });

    const r = await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Sem fone', email: 'Contato@Empresa.com' }],
      dryRun: false,
      onDuplicate: 'skip',
    });

    expect(r.pulados).toBe(1);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('cliente: update NÃO reativa quem está BLOQUEADO no OMIE', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cli-bloqueado' }]);

    await svc.importarClientes(fakeUser(), {
      csv: 'nome,cnpj\nCliente A,12.345.678/0001-90',
      dryRun: false,
      onDuplicate: 'update',
    });

    const data = prisma.cliente.update.mock.calls[0][0].data;
    expect(data.omieStatus).toBeUndefined();
    expect(data.status).toBeUndefined();
  });

  it('cliente: update não apaga campos ausentes na planilha', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cli-velho' }]);

    await svc.importarClientes(fakeUser(), {
      csv: 'nome,cnpj\nCliente A,12.345.678/0001-90',
      dryRun: false,
      onDuplicate: 'update',
    });

    const data = prisma.cliente.update.mock.calls[0][0].data;
    expect(data.email).toBeUndefined();
    expect(data.telefone).toBeUndefined();
    expect(data.cidade).toBeUndefined();
  });

  it('produto: update NÃO sobrescreve precoFabrica real com a heurística 70%', async () => {
    prisma.produto.findFirst.mockResolvedValueOnce({ id: 'prod-velho' });

    await svc.importarProdutos(fakeUser(), {
      csv: 'nome,sku,preco\nProd A,SKU1,100',
      dryRun: false,
      onDuplicate: 'update',
    });

    const data = prisma.produto.update.mock.calls[0][0].data;
    expect(data.precoFabrica).toBeUndefined();
    expect(data.precoTabela).toBe(100);
  });

  it('CSV acima do limite é REJEITADO (antes truncava e o total mentia)', async () => {
    const lines = ['nome'];
    for (let i = 0; i < 5001; i++) lines.push(`Cliente ${i}`);

    await expect(
      svc.importarClientes(fakeUser(), {
        csv: lines.join('\n'),
        dryRun: false,
        onDuplicate: 'skip',
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });
});

// ─── Regra de produto: lead só entra no funil com etapa EXPLÍCITA ─────

describe('ImportService.importarLeads — destino no funil', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new ImportService(prisma as never, bus as never, makeEnv() as never);
  });

  it('SEM funil/etapa: lead entra como CONTATO (sem funil), não no kanban', async () => {
    // Antes caía no "funil padrão da empresa": qualquer importação (base de
    // e-mail marketing, lista de reps, prospecção fria) despejava tudo no
    // pipeline principal e depois era trabalho manual tirar.
    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Contato Frio', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'skip',
    });

    const data = prisma.lead.create.mock.calls[0][0].data;
    expect(data.funilId).toBeNull();
    expect(data.funilEtapaId).toBeNull();
    // Não consultou funil padrão nenhum.
    expect(prisma.funil.findFirst).not.toHaveBeenCalled();
  });

  it('COM etapa escolhida: entra no funil daquela etapa', async () => {
    prisma.funilEtapa.findFirst.mockResolvedValue({
      id: 'et-abordagem',
      funilId: 'funil-reps',
      tipo: 'ATIVA',
    });

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead Quente', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'skip',
      funilEtapaId: 'et-abordagem',
    });

    const data = prisma.lead.create.mock.calls[0][0].data;
    expect(data.funilId).toBe('funil-reps');
    expect(data.funilEtapaId).toBe('et-abordagem');
  });

  it('funil SEM etapa é recusado (a etapa é decisão de quem importa)', async () => {
    await expect(
      svc.importarLeads(fakeUser(), {
        rows: [{ nome: 'X', telefone: '11999990000' }],
        dryRun: false,
        onDuplicate: 'skip',
        funilId: 'funil-reps',
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });

  it('etapa de OUTRA empresa é recusada', async () => {
    prisma.funilEtapa.findFirst.mockResolvedValue(null);

    await expect(
      svc.importarLeads(fakeUser(), {
        rows: [{ nome: 'X', telefone: '11999990000' }],
        dryRun: false,
        onDuplicate: 'skip',
        funilEtapaId: 'et-de-outro-tenant',
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });
});

describe('ImportService.importarLeads — opt-in de automações (dispararReguas)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new ImportService(prisma as never, bus as never, makeEnv() as never);
  });

  it('default (flag ausente) NÃO dispara nada — planilha não é motivo pra régua', async () => {
    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead A', telefone: '11999990000' }],
      funilId: 'funil-pad',
      funilEtapaId: 'etapa-1',
      dryRun: false,
      onDuplicate: 'skip',
      dispararReguas: false,
    });
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('flag ligada + destino de funil → dispara LEAD_CRIADO por lead NOVO', async () => {
    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead A', telefone: '11999990000' }],
      funilId: 'funil-pad',
      funilEtapaId: 'etapa-1',
      dryRun: false,
      onDuplicate: 'skip',
      dispararReguas: true,
    });
    expect(bus.disparar).toHaveBeenCalledTimes(1);
    const [empresaId, evento, payload] = bus.disparar.mock.calls[0];
    expect(empresaId).toBe('emp-1');
    expect(evento).toBe('LEAD_CRIADO');
    expect(payload.leadId).toBe('lead-novo');
  });

  it('flag ligada SEM funil/etapa não dispara — contato puro não entra em régua', async () => {
    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead A', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'skip',
      dispararReguas: true,
    });
    expect(prisma.lead.create).toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('dryRun não dispara (nada foi criado de verdade)', async () => {
    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead A', telefone: '11999990000' }],
      funilId: 'funil-pad',
      funilEtapaId: 'etapa-1',
      dryRun: true,
      onDuplicate: 'skip',
      dispararReguas: true,
    });
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('lead que JÁ EXISTE não dispara — re-importar não re-dispara a régua', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-existente' }]);
    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Lead A', telefone: '11999990000' }],
      funilId: 'funil-pad',
      funilEtapaId: 'etapa-1',
      dryRun: false,
      onDuplicate: 'update',
      dispararReguas: true,
    });
    expect(prisma.lead.update).toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });
});

describe('ImportService — duplicata DENTRO do arquivo (#71) e linha ilegível (#69)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ImportService(prisma as never, makeBus() as never, makeEnv() as never);
  });

  it('mesmo SKU repetido no arquivo cria UMA vez e pula a 2ª (era criar duas)', async () => {
    // O `existente` é calculado antes de qualquer escrita: as duas linhas viam
    // null e criavam dois produtos.
    const r = await svc.importarProdutos(fakeUser(), {
      csv: `nome,sku,preco
Master Block,MB-01,100
Master Block (repetido),MB-01,100`,
      dryRun: false,
      onDuplicate: 'skip',
    });

    expect(r.criados).toBe(1);
    expect(r.pulados).toBe(1);
    expect(prisma.produto.create).toHaveBeenCalledTimes(1);
    const pulada = r.detalhes.find((d) => d.status === 'pulado');
    expect(pulada?.motivo).toContain('duplicada no próprio arquivo');
    expect(pulada?.motivo).toContain('linha 2');
  });

  it('no dryRun o preview também não conta a repetida como "a criar"', async () => {
    const r = await svc.importarProdutos(fakeUser(), {
      csv: `nome,sku,preco
A,X1,10
A de novo,X1,10
B,X2,20`,
      dryRun: true,
      onDuplicate: 'skip',
    });

    expect(r.criados).toBe(2);
    expect(r.pulados).toBe(1);
  });

  it('lead repetido casa pelo SUFIXO do telefone, não pela string crua', async () => {
    const r = await svc.importarLeads(fakeUser(), {
      rows: [
        { nome: 'João', telefone: '11999990000' },
        { nome: 'Joao (outro formato)', telefone: '+55 11 99999-0000' },
      ],
      dryRun: false,
      onDuplicate: 'skip',
    });

    expect(r.criados).toBe(1);
    expect(r.pulados).toBe(1);
  });

  it('onDuplicate=error trata a repetida do arquivo como erro', async () => {
    const r = await svc.importarProdutos(fakeUser(), {
      csv: `nome,sku,preco
A,Z9,10
A,Z9,10`,
      dryRun: false,
      onDuplicate: 'error',
    });

    expect(r.criados).toBe(1);
    expect(r.erros).toBe(1);
  });

  it('#69: linha ilegível do CSV vira ERRO no relatório, não só log', async () => {
    // Aspas não fechadas: o papaparse reporta em `errors` e a linha some do data.
    const r = await svc.importarProdutos(fakeUser(), {
      csv: ['nome,sku,preco', '"Produto sem fechar,SKU1,10', 'Outro,SKU2,20'].join('\n'),
      dryRun: true,
      onDuplicate: 'skip',
    });

    expect(r.erros).toBeGreaterThan(0);
    expect(r.detalhes.some((d) => d.motivo?.includes('linha ilegível'))).toBe(true);
  });
});

/**
 * #71 — a corrida entre DUAS requisições (o dedup interno só enxerga a própria).
 */
describe('ImportService — corrida entre importações simultâneas (#71)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ImportService(prisma as never, makeBus() as never, makeEnv() as never);
  });

  it('P2002 do índice único conta como DUPLICATA, não como erro do arquivo', async () => {
    // A outra importação criou o produto entre a nossa leitura e a nossa escrita.
    prisma.produto.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
      }),
    );

    const r = await svc.importarProdutos(fakeUser(), {
      csv: `nome,sku,preco
Master Block,MB-01,100`,
      dryRun: false,
      onDuplicate: 'skip',
    });

    expect(r.erros).toBe(0); // ← o ponto do achado: não é erro do arquivo
    expect(r.pulados).toBe(1);
    expect(r.detalhes[0].motivo).toMatch(/outra importação/i);
  });

  it('erro de verdade continua sendo erro (não vira duplicata silenciosa)', async () => {
    prisma.produto.create.mockRejectedValueOnce(new Error('conexão caiu'));

    const r = await svc.importarProdutos(fakeUser(), {
      csv: `nome,sku,preco
Master Block,MB-01,100`,
      dryRun: false,
      onDuplicate: 'skip',
    });

    expect(r.erros).toBe(1);
    expect(r.pulados).toBe(0);
  });
});
