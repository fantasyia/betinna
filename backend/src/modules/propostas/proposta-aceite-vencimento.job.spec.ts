import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PropostaAceiteVencimentoJob } from './proposta-aceite-vencimento.job';

/**
 * O link de aceite é um JWT com `exp`: quando vence, o cliente vê "link
 * expirado" e o rep não fica sabendo de nada — a proposta continua
 * `AGUARDANDO_ASSINATURA` no funil dele, como se ainda estivesse em análise.
 *
 * Estes testes travam as duas coisas que o job faz (avisar antes, expirar
 * depois) e — tão importante quanto — a que ele **não** faz: falar com o
 * cliente.
 */
const DIA = 86_400_000;

const proposta = (over: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  numero: 'PROP-0042',
  representanteId: 'rep-1',
  aceiteExpiraEm: new Date(Date.now() + DIA), // vence amanhã
  valor: 3150,
  cliente: { nome: 'Padaria Central' },
  ...over,
});

describe('PropostaAceiteVencimentoJob', () => {
  let prisma: {
    proposta: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    empresa: { findMany: ReturnType<typeof vi.fn> };
  };
  let tarefas: { criarCardsDeTarefa: ReturnType<typeof vi.fn> };
  let job: PropostaAceiteVencimentoJob;

  beforeEach(() => {
    prisma = {
      proposta: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      empresa: { findMany: vi.fn().mockResolvedValue([{ id: 'emp-1' }]) },
    };
    tarefas = { criarCardsDeTarefa: vi.fn().mockResolvedValue({}) };
    job = new PropostaAceiteVencimentoJob(
      prisma as never,
      { get: vi.fn().mockReturnValue('') } as never,
      { acquire: vi.fn().mockResolvedValue(true) } as never,
      tarefas as never,
    );
  });

  describe('antes de vencer', () => {
    it('avisa o rep e NÃO expira a proposta', async () => {
      prisma.proposta.findMany.mockResolvedValue([proposta()]);

      const res = await job.varrer('emp-1');

      expect(res).toMatchObject({ lembretes: 1, expiradas: 0, erros: [] });
      expect(prisma.proposta.updateMany).not.toHaveBeenCalled();
      expect(tarefas.criarCardsDeTarefa).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: 'rep-1', empresaId: 'emp-1' }),
      );
    });

    /**
     * O job roda de hora em hora — sem chave de idempotência ele produziria
     * 24 cards por dia da mesma proposta. `criarCardsDeTarefa` dedupa por
     * `origemJobId`, então a chave tem que carregar o id da proposta E qual dos
     * dois avisos é.
     */
    it('a chave de idempotência separa o LEMBRETE do EXPIRADO', async () => {
      prisma.proposta.findMany.mockResolvedValue([proposta()]);
      await job.varrer('emp-1');
      expect(tarefas.criarCardsDeTarefa.mock.calls[0][0].origemJobId).toBe(
        'proposta-aceite-vencendo:prop-1',
      );

      tarefas.criarCardsDeTarefa.mockClear();
      prisma.proposta.findMany.mockResolvedValue([
        proposta({ aceiteExpiraEm: new Date(Date.now() - DIA) }),
      ]);
      await job.varrer('emp-1');
      expect(tarefas.criarCardsDeTarefa.mock.calls[0][0].origemJobId).toBe(
        'proposta-aceite-expirada:prop-1',
      );
    });

    it('o card do lembrete diz o número, o cliente e o valor', async () => {
      prisma.proposta.findMany.mockResolvedValue([proposta()]);

      await job.varrer('emp-1');

      const card = tarefas.criarCardsDeTarefa.mock.calls[0][0];
      expect(card.titulo).toContain('PROP-0042');
      expect(card.titulo).toContain('Padaria Central');
      expect(card.descricao).toContain('3.150');
    });
  });

  describe('depois de vencer', () => {
    it('marca EXPIRADA e abre tarefa pro rep', async () => {
      prisma.proposta.findMany.mockResolvedValue([
        proposta({ aceiteExpiraEm: new Date(Date.now() - DIA) }),
      ]);

      const res = await job.varrer('emp-1');

      expect(res).toMatchObject({ lembretes: 0, expiradas: 1 });
      expect(prisma.proposta.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRADA' } }),
      );
      expect(tarefas.criarCardsDeTarefa).toHaveBeenCalled();
    });

    /**
     * A corrida real: o cliente clica em "aceitar" no mesmo segundo em que a
     * varredura passa. Quem aceitou tem que GANHAR — expirar por cima de um
     * aceite seria perder uma venda fechada.
     */
    it('aceite que chega no mesmo instante GANHA — o CAS não acha a linha', async () => {
      prisma.proposta.findMany.mockResolvedValue([
        proposta({ aceiteExpiraEm: new Date(Date.now() - DIA) }),
      ]);
      prisma.proposta.updateMany.mockResolvedValue({ count: 0 });

      await job.varrer('emp-1');

      expect(tarefas.criarCardsDeTarefa).not.toHaveBeenCalled();
    });

    it('o CAS exige que o status ainda seja AGUARDANDO_ASSINATURA', async () => {
      prisma.proposta.findMany.mockResolvedValue([
        proposta({ aceiteExpiraEm: new Date(Date.now() - DIA) }),
      ]);

      await job.varrer('emp-1');

      expect(prisma.proposta.updateMany.mock.calls[0][0].where).toMatchObject({
        id: 'prop-1',
        empresaId: 'emp-1',
        status: 'AGUARDANDO_ASSINATURA',
      });
    });
  });

  describe('o que o job NÃO faz', () => {
    /**
     * Mensagem pra fora é decisão do Léo. O job só tem o serviço de tarefa
     * injetado — não há como ele mandar e-mail ou WhatsApp nem por engano.
     */
    it('nenhuma dependência de envio ao cliente está injetada', () => {
      const deps = Object.values(job as unknown as Record<string, unknown>);
      for (const d of deps) {
        const metodos = d && typeof d === 'object' ? Object.keys(d) : [];
        expect(metodos.join(' ')).not.toMatch(/enviarTexto|enviarHtml|enviar\b/);
      }
    });

    it('proposta sem representante não vira card órfão (mas ainda expira)', async () => {
      prisma.proposta.findMany.mockResolvedValue([
        proposta({ representanteId: null, aceiteExpiraEm: new Date(Date.now() - DIA) }),
      ]);

      const res = await job.varrer('emp-1');

      expect(res.expiradas).toBe(1);
      expect(prisma.proposta.updateMany).toHaveBeenCalled();
      expect(tarefas.criarCardsDeTarefa).not.toHaveBeenCalled();
    });
  });

  describe('a varredura', () => {
    it('só olha AGUARDANDO_ASSINATURA com data de vencimento', async () => {
      await job.varrer('emp-1');

      expect(prisma.proposta.findMany.mock.calls[0][0].where).toMatchObject({
        empresaId: 'emp-1',
        status: 'AGUARDANDO_ASSINATURA',
      });
      expect(prisma.proposta.findMany.mock.calls[0][0].where.aceiteExpiraEm.not).toBeNull();
    });

    it('uma proposta que falha não derruba as outras', async () => {
      prisma.proposta.findMany.mockResolvedValue([
        proposta({ id: 'prop-1' }),
        proposta({ id: 'prop-2', numero: 'PROP-0043' }),
      ]);
      tarefas.criarCardsDeTarefa.mockRejectedValueOnce(new Error('quadro fora'));

      const res = await job.varrer('emp-1');

      expect(res.lembretes).toBe(1);
      expect(res.erros).toEqual(['PROP-0042: quadro fora']);
    });

    it('em NODE_ENV=test o cron não roda sozinho', async () => {
      const jobTeste = new PropostaAceiteVencimentoJob(
        prisma as never,
        { get: vi.fn().mockReturnValue('test') } as never,
        { acquire: vi.fn().mockResolvedValue(true) } as never,
        tarefas as never,
      );

      await jobTeste.rodar();

      expect(prisma.empresa.findMany).not.toHaveBeenCalled();
    });

    it('sem o lock, não varre (outro container já está varrendo)', async () => {
      const jobSemLock = new PropostaAceiteVencimentoJob(
        prisma as never,
        { get: vi.fn().mockReturnValue('') } as never,
        { acquire: vi.fn().mockResolvedValue(false) } as never,
        tarefas as never,
      );

      await jobSemLock.rodar();

      expect(prisma.empresa.findMany).not.toHaveBeenCalled();
    });
  });
});
