import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { carregarModelo } from '@modules/propostas/contrato-documento.util';

import { ModeloContratoService } from './modelo-contrato.service';

/**
 * Storage em memória — o bucket `contratos-modelos` fingido. `vi.hoisted`
 * porque o `vi.mock` sobe pro topo do arquivo, antes de qualquer `const`.
 */
const { guardados, storage } = vi.hoisted(() => {
  const guardados = new Map<string, Buffer>();
  const storage = {
    upload: vi.fn(async (caminho: string, arquivo: Buffer) => {
      guardados.set(caminho, arquivo);
      return { error: null };
    }),
    download: vi.fn(async (caminho: string) => {
      const b = guardados.get(caminho);
      return b
        ? { data: { arrayBuffer: async () => b }, error: null }
        : { data: null, error: { message: 'Object not found' } };
    }),
  };
  return { guardados, storage };
});
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => storage,
      listBuckets: async () => ({ data: [] }),
      createBucket: vi.fn(),
    },
  }),
}));

const DIRETOR = { id: 'dir-1', role: 'DIRECTOR', empresaIdAtiva: 'emp-1' } as never;

function montar() {
  const prisma = {
    modeloContrato: {
      findFirst: vi.fn(async (_a: unknown): Promise<unknown> => null),
      findMany: vi.fn(async (_a: unknown): Promise<unknown[]> => []),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'mc-1', ...a.data })),
      update: vi.fn(async (_a: unknown) => ({})),
      updateMany: vi.fn(async (_a: unknown) => ({ count: 1 })),
    },
    usuario: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const svc = new ModeloContratoService(prisma as never, { get: () => 'x' } as never);
  return { svc, prisma };
}

const b64 = (b: Buffer) => b.toString('base64');

describe('ModeloContratoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardados.clear();
  });

  describe('enviar', () => {
    it('modelo inválido é RECUSADO com a lista — não sobe nada nem vira versão', async () => {
      const { svc, prisma } = montar();
      const err = await svc
        .enviar(DIRETOR, { nomeArquivo: 'x.pdf', conteudoBase64: b64(Buffer.from('%PDF')) })
        .catch((e: { details?: Array<{ message: string }> }) => e);
      expect((err as { details?: unknown[] }).details).toEqual([
        { message: 'não é um arquivo .docx (salve como "Documento do Word")' },
      ]);
      expect(storage.upload).not.toHaveBeenCalled();
      expect(prisma.modeloContrato.create).not.toHaveBeenCalled();
    });

    it('modelo válido vira a PRÓXIMA versão, INATIVA, com quem subiu e o hash', async () => {
      const { svc, prisma } = montar();
      prisma.modeloContrato.findFirst.mockResolvedValue({ versao: 2 });

      await svc.enviar(DIRETOR, {
        nomeArquivo: 'contrato-rev.docx',
        conteudoBase64: b64(carregarModelo()),
        observacao: '  cláusula 7  ',
      });

      const data = prisma.modeloContrato.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        empresaId: 'emp-1',
        versao: 3,
        enviadoPorId: 'dir-1',
        observacao: 'cláusula 7',
      });
      // Nasce INATIVA: subir não muda o contrato de ninguém — ativar muda.
      expect(data).not.toHaveProperty('ativo');
      expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(String(data.storagePath)).toMatch(/^emp-1\/v3-/);
      expect(guardados.has(String(data.storagePath))).toBe(true);
    });
  });

  describe('ativar', () => {
    it('desativa as outras e ativa ESTA, com quem ativou', async () => {
      const { svc, prisma } = montar();
      guardados.set('emp-1/v3.docx', carregarModelo());
      prisma.modeloContrato.findFirst.mockResolvedValue({
        id: 'mc-3',
        versao: 3,
        storagePath: 'emp-1/v3.docx',
      });

      expect(await svc.ativar(DIRETOR, 'mc-3')).toEqual({ emUso: 3 });
      expect(prisma.modeloContrato.updateMany).toHaveBeenCalledWith({
        where: { empresaId: 'emp-1', ativo: true },
        data: { ativo: false },
      });
      expect(prisma.modeloContrato.update).toHaveBeenCalledWith({
        where: { id: 'mc-3' },
        data: expect.objectContaining({ ativo: true, ativadoPorId: 'dir-1' }),
      });
    });

    it('🔒 versão de OUTRA empresa → 404 (a busca filtra pela empresa ativa)', async () => {
      const { svc, prisma } = montar();
      await expect(svc.ativar(DIRETOR, 'de-outra')).rejects.toThrow(/não encontrado/);
      expect(prisma.modeloContrato.findFirst).toHaveBeenCalledWith({
        where: { id: 'de-outra', empresaId: 'emp-1' },
      });
    });

    it('REVALIDA na ativação — versão que não passa mais não é ativada', async () => {
      const { svc, prisma } = montar();
      guardados.set('emp-1/v1.docx', Buffer.from('não é docx'));
      prisma.modeloContrato.findFirst.mockResolvedValue({
        id: 'mc-1',
        versao: 1,
        storagePath: 'emp-1/v1.docx',
      });
      await expect(svc.ativar(DIRETOR, 'mc-1')).rejects.toThrow(/não passa mais na validação/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('emUso — o que o próximo contrato usa', () => {
    it('sem versão ativa: o padrão do app (versão null)', async () => {
      const { svc } = montar();
      const r = await svc.emUso('emp-1');
      expect(r.versao).toBeNull();
      expect(r.arquivo.equals(carregarModelo())).toBe(true);
    });

    it('com versão ativa: o arquivo DELA', async () => {
      const { svc, prisma } = montar();
      const meu = Buffer.from('arquivo da versão 5');
      guardados.set('emp-1/v5.docx', meu);
      prisma.modeloContrato.findFirst.mockResolvedValue({
        versao: 5,
        storagePath: 'emp-1/v5.docx',
      });
      const r = await svc.emUso('emp-1');
      expect(r.versao).toBe(5);
      expect(r.arquivo.equals(meu)).toBe(true);
    });

    it('⛔ versão ativa ILEGÍVEL estoura — não cai pro padrão em silêncio', async () => {
      const { svc, prisma } = montar();
      prisma.modeloContrato.findFirst.mockResolvedValue({
        versao: 5,
        storagePath: 'emp-1/sumiu.docx',
      });
      await expect(svc.emUso('emp-1')).rejects.toThrow(/Não consegui ler o modelo/);
    });
  });

  it('voltar ao padrão desativa TUDO e não apaga nada', async () => {
    const { svc, prisma } = montar();
    expect(await svc.voltarAoPadrao(DIRETOR)).toEqual({ emUso: null });
    expect(prisma.modeloContrato.updateMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-1', ativo: true },
      data: { ativo: false },
    });
  });
});

/**
 * ⚠️ ESTRUTURAL — pedido do Léo (24/09): trocar o modelo muda o que o próximo
 * cliente assina, então toda ESCRITA desta tela deixa rastro.
 */
describe('controller — permissão e auditoria', () => {
  const FONTE = readFileSync(join(__dirname, 'modelo-contrato.controller.ts'), 'utf8');

  it('a tela inteira é DIRECTOR/ADMIN', () => {
    expect(FONTE).toMatch(/@Controller\('modelos-contrato'\)\s*\n@Roles\('ADMIN', 'DIRECTOR'\)/);
  });

  it('todo @Post tem @Audit logo abaixo', () => {
    const posts = FONTE.split('@Post(').slice(1);
    expect(posts.length).toBe(3);
    for (const trecho of posts) expect(trecho.slice(0, 200)).toMatch(/\n\s*@Audit\(\{ action: '/);
  });
});
