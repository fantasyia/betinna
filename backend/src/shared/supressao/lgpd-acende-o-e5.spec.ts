import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupressaoService } from './supressao.service';

/**
 * Aplicar a LGPD tem que ACENDER O E5 (A25, medido em produção em 15/09).
 *
 * O opt-out pelo WhatsApp funcionava pela metade: a etiqueta era aplicada, o bot
 * silenciava e o cliente recebia "não vamos mais te procurar" — mas o **E5 nunca
 * rodava**, porque `leadTag.createMany` é escrita direta e NÃO emite
 * `LEAD_RECEBEU_TAG`. Só a rota do app emitia.
 *
 * E o E5 é quem faz o resto do opt-out: aplica `nutricao-parar`, tira de
 * `em-nutricao` e abre a tarefa de confirmar a saída. Sem ele, **a régua de
 * e-mail continuava saindo** pra quem pediu pra sair — com a confirmação na mão
 * dizendo o contrário. Metade de um direito legal funcionando.
 */
const TAG_LGPD = 'Não Reabordar - LGPD ⛔';

const makePrisma = (jaTem: string[] = []) => ({
  tag: { upsert: vi.fn().mockResolvedValue({ id: 'tag-lgpd' }) },
  leadTag: {
    findMany: vi.fn().mockResolvedValue(jaTem.map((leadId) => ({ leadId }))),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  clienteTag: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  $queryRaw: vi.fn().mockResolvedValue([]),
});

const makeBus = () => ({ disparar: vi.fn().mockResolvedValue(undefined) });
/** ModuleRef: o serviço resolve o barramento na hora da chamada (ver o porquê no service). */
const refPara = (bus: ReturnType<typeof makeBus>) => ({ get: () => bus });

describe('aplicarLgpd → LEAD_RECEBEU_TAG', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
  });

  const svc = () => new SupressaoService(prisma as never, refPara(bus) as never);

  it('🔴 lead que NÃO tinha a etiqueta → evento sai (é o que acende o E5)', async () => {
    await svc().aplicarLgpd('emp-1', { leadId: 'lead-1' });

    expect(bus.disparar).toHaveBeenCalledTimes(1);
    expect(bus.disparar).toHaveBeenCalledWith('emp-1', 'LEAD_RECEBEU_TAG', {
      leadId: 'lead-1',
      tagId: 'tag-lgpd',
      tagNome: TAG_LGPD,
    });
  });

  it('a etiqueta continua sendo gravada (o ato legal em si)', async () => {
    await svc().aplicarLgpd('emp-1', { leadId: 'lead-1' });

    expect(prisma.leadTag.createMany).toHaveBeenCalled();
  });

  it('quem JÁ tinha a etiqueta não dispara de novo — senão pedir 2× abre 2 tarefas', async () => {
    prisma = makePrisma(['lead-1']);
    bus = makeBus();

    await svc().aplicarLgpd('emp-1', { leadId: 'lead-1' });

    expect(bus.disparar).not.toHaveBeenCalled();
    expect(prisma.leadTag.createMany).toHaveBeenCalled(); // idempotente, segue gravando
  });

  it('vários leads pelo mesmo telefone → um evento por lead NOVO', async () => {
    prisma = makePrisma(['lead-velho']);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'lead-velho' }, { id: 'lead-novo' }]) // leads por telefone
      .mockResolvedValueOnce([]); // clientes
    bus = makeBus();

    await svc().aplicarLgpd('emp-1', { telefone: '+55 11 99752-4483' });

    expect(bus.disparar).toHaveBeenCalledTimes(1);
    expect((bus.disparar.mock.calls[0] as unknown[])[2]).toMatchObject({ leadId: 'lead-novo' });
  });

  it('⛔ fila fora do ar NÃO derruba a aplicação da LGPD — o direito vale mesmo assim', async () => {
    bus.disparar.mockRejectedValue(new Error('redis fora'));

    await expect(svc().aplicarLgpd('emp-1', { leadId: 'lead-1' })).resolves.toBeGreaterThan(0);
    expect(prisma.leadTag.createMany).toHaveBeenCalled();
  });

  it('sem lead nenhum (só cliente) não inventa evento', async () => {
    prisma = makePrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // nenhum lead
      .mockResolvedValueOnce([{ id: 'cli-1' }]);
    bus = makeBus();

    await svc().aplicarLgpd('emp-1', { telefone: '11997524483' });

    expect(bus.disparar).not.toHaveBeenCalled();
    expect(prisma.clienteTag.createMany).toHaveBeenCalled();
  });
});
