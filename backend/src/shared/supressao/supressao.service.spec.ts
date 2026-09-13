import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupressaoService } from './supressao.service';

const makePrisma = () => ({
  tag: { findMany: vi.fn().mockResolvedValue([]) },
  leadTag: { count: vi.fn().mockResolvedValue(0) },
  clienteTag: { count: vi.fn().mockResolvedValue(0) },
  $queryRaw: vi.fn().mockResolvedValue([{ n: 0n }]),
});

describe('SupressaoService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: SupressaoService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new SupressaoService(prisma as never);
  });

  it('suprime pelo leadId quando o lead tem a tag canônica', async () => {
    prisma.tag.findMany.mockResolvedValue([{ id: 't1', nome: 'Não Reabordar - LGPD ⛔' }]);
    prisma.leadTag.count.mockResolvedValue(1);
    await expect(svc.suprimido('emp-1', { leadId: 'l1' })).resolves.toBe(true);
  });

  it('acha a tag por nome NORMALIZADO — renomeada sem acento/emoji segue casando', async () => {
    prisma.tag.findMany.mockResolvedValue([{ id: 't1', nome: 'nao   reabordar LGPD' }]);
    prisma.leadTag.count.mockResolvedValue(1);
    await expect(svc.suprimido('emp-1', { leadId: 'l1' })).resolves.toBe(true);
  });

  it('tag ausente → supressão inerte (false), sem lançar (estado de config, não erro)', async () => {
    prisma.tag.findMany.mockResolvedValue([]);
    await expect(svc.suprimido('emp-1', { leadId: 'l1' })).resolves.toBe(false);
  });

  it('FAIL-CLOSED: erro de banco PROPAGA — nunca decide "pode enviar" sem checar', async () => {
    prisma.tag.findMany.mockRejectedValue(new Error('db down'));
    await expect(svc.suprimido('emp-1', { leadId: 'l1' })).rejects.toThrow('db down');
  });

  it('casa por SUFIXO de telefone (D18) quando os ids não têm a tag', async () => {
    prisma.tag.findMany.mockResolvedValue([{ id: 't1', nome: 'Não Reabordar - LGPD ⛔' }]);
    prisma.leadTag.count.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValue([{ n: 1n }]);
    await expect(
      svc.suprimido('emp-1', { leadId: 'l1', telefone: '+55 (11) 98888-7777' }),
    ).resolves.toBe(true);
  });

  it('sem match em nada → false (envio liberado)', async () => {
    prisma.tag.findMany.mockResolvedValue([{ id: 't1', nome: 'Não Reabordar - LGPD ⛔' }]);
    await expect(
      svc.suprimido('emp-1', { leadId: 'l1', clienteId: 'c1', telefone: '11988887777' }),
    ).resolves.toBe(false);
  });
});

/**
 * Regressão da auditoria 13/09/2026: `emailSuprimido` buscava a tag com o
 * fragmento ASCII "invalido" via `contains` (= ILIKE). O Postgres NÃO dobra
 * acento no ILIKE, então "E-mail inválido ⛔" nunca casava e o bounce não
 * suprimia nada — e o spec antigo passava porque mockava `findMany` já com a
 * tag "encontrada". Este mock reproduz o ILIKE de verdade: filtra por
 * substring case-insensitive, SEM normalizar acento.
 */
describe('SupressaoService.emailSuprimido — o ILIKE do Postgres não dobra acento', () => {
  const tagsDoTenant = [
    { id: 'lgpd', nome: 'Não Reabordar - LGPD ⛔' },
    { id: 'mail', nome: 'E-mail inválido ⛔' },
  ];
  const ilike = (haystack: string, needle: string) =>
    haystack.toLowerCase().includes(needle.toLowerCase());

  let prisma: ReturnType<typeof makePrisma>;
  let svc: SupressaoService;

  beforeEach(() => {
    prisma = makePrisma();
    prisma.tag.findMany.mockImplementation(
      async (args: { where: { nome: { contains: string } } }) =>
        tagsDoTenant.filter((t) => ilike(t.nome, args.where.nome.contains)),
    );
    svc = new SupressaoService(prisma as never);
  });

  it('acha a tag "E-mail inválido ⛔" mesmo com o ILIKE sem dobrar acento', async () => {
    prisma.leadTag.count.mockResolvedValue(1);

    expect(await svc.emailSuprimido('emp-1', 'morta@exemplo.com')).toBe(true);

    const fragmento = prisma.tag.findMany.mock.calls[0][0].where.nome.contains as string;
    expect(ilike('E-mail inválido ⛔', fragmento)).toBe(true);
    expect(prisma.leadTag.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tagId: 'mail' }) }),
    );
  });

  it('o fragmento antigo ("invalido", sem acento) NÃO casa a tag — é a regressão que este spec guarda', () => {
    expect(ilike('E-mail inválido ⛔', 'invalido')).toBe(false);
  });

  it('endereço sem a tag segue liberado', async () => {
    prisma.leadTag.count.mockResolvedValue(0);
    expect(await svc.emailSuprimido('emp-1', 'viva@exemplo.com')).toBe(false);
  });
});
