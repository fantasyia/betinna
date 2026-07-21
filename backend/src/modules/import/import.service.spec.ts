import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    create: vi.fn().mockResolvedValue({ id: 'lead-novo' }),
    update: vi.fn().mockResolvedValue({ id: 'lead-existente' }),
  },
  funil: {
    findFirst: vi.fn().mockResolvedValue({ id: 'funil-pad' }),
  },
  funilEtapa: {
    findFirst: vi.fn().mockResolvedValue({ id: 'etapa-1', funilId: 'funil-pad', tipo: 'ATIVA' }),
  },
});

describe('ImportService.importarClientes', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ImportService(prisma as never);
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
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 'cli-velho' });
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
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 'cli-velho' });
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
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 'cli-velho' });
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
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ImportService(prisma as never);
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
  let svc: ImportService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ImportService(prisma as never);
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

  it('importa rows (Excel) caindo no funil/etapa padrão', async () => {
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
    expect(arg.data.funilEtapaId).toBe('etapa-1');
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
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-velho' });
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
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-velho' });
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
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-velho' });

    await svc.importarLeads(fakeUser(), {
      rows: [{ nome: 'Dup', telefone: '11999990000' }],
      dryRun: false,
      onDuplicate: 'update',
    });

    // Reimportar não transforma retroativamente um lead do site em lead de planilha.
    expect(prisma.lead.update.mock.calls[0][0].data.origemCadastro).toBeUndefined();
  });

  it('lead existente SEM variaveis não quebra o merge', async () => {
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-velho' });
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
