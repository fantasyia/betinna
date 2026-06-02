import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BotCustoService } from './bot-custo.service';

const makePrisma = () => ({
  mullerBotPersona: { findUnique: vi.fn(), update: vi.fn() },
  botUsoTokens: { findUnique: vi.fn(), aggregate: vi.fn(), upsert: vi.fn() },
  empresa: { findUnique: vi.fn() },
  usuario: { findFirst: vi.fn() },
});

const makeEmail = () => ({ enviarAlertaSistema: vi.fn().mockResolvedValue({ ok: true }) });

describe('BotCustoService — orçamento ÚNICO por período (não soma in+out)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let email: ReturnType<typeof makeEmail>;
  let svc: BotCustoService;

  beforeEach(() => {
    prisma = makePrisma();
    email = makeEmail();
    svc = new BotCustoService(prisma as never, email as never);
  });

  describe('statusCusto', () => {
    it('limite = valor único (não dobrado); usado = in+out', async () => {
      prisma.mullerBotPersona.findUnique.mockResolvedValue({
        limiteTokensDiaIn: 100000,
        limiteTokensMesIn: 2000000,
        pausadoPorCustoAte: null,
      });
      prisma.botUsoTokens.findUnique.mockResolvedValue({ tokensIn: 30000, tokensOut: 20000 });
      prisma.botUsoTokens.aggregate.mockResolvedValue({
        _sum: { tokensIn: 100000, tokensOut: 50000 },
      });

      const r = await svc.statusCusto('emp-1');

      // O bug era mostrar 200000 (limiteIn+limiteOut). Agora é 100000.
      expect(r.dia.limite).toBe(100000);
      expect(r.dia.usado).toBe(50000);
      expect(r.dia.pct).toBe(50);
      expect(r.mes.limite).toBe(2000000);
      expect(r.mes.usado).toBe(150000);
    });

    it('sem persona → defaults 100000 / 2000000 (single)', async () => {
      prisma.mullerBotPersona.findUnique.mockResolvedValue(null);
      prisma.botUsoTokens.findUnique.mockResolvedValue(null);
      prisma.botUsoTokens.aggregate.mockResolvedValue({ _sum: { tokensIn: 0, tokensOut: 0 } });

      const r = await svc.statusCusto('emp-1');
      expect(r.dia.limite).toBe(100000);
      expect(r.mes.limite).toBe(2000000);
    });
  });

  describe('verificarTeto', () => {
    const persona = {
      limiteTokensDiaIn: 100000,
      limiteTokensMesIn: 2000000,
      pausadoPorCustoAte: null,
    };

    it('bloqueia quando total do dia (in+out) >= limite', async () => {
      prisma.mullerBotPersona.findUnique.mockResolvedValue(persona);
      prisma.botUsoTokens.findUnique.mockResolvedValue({ tokensIn: 60000, tokensOut: 40000 }); // 100k
      prisma.botUsoTokens.aggregate.mockResolvedValue({ _sum: { tokensIn: 100000, tokensOut: 0 } });

      expect((await svc.verificarTeto('emp-1')).bloqueado).toBe(true);
    });

    it('NÃO bloqueia quando o total está abaixo do limite (antes dobrava a capacidade)', async () => {
      prisma.mullerBotPersona.findUnique.mockResolvedValue(persona);
      prisma.botUsoTokens.findUnique.mockResolvedValue({ tokensIn: 30000, tokensOut: 30000 }); // 60k
      prisma.botUsoTokens.aggregate.mockResolvedValue({ _sum: { tokensIn: 60000, tokensOut: 0 } });

      expect((await svc.verificarTeto('emp-1')).bloqueado).toBe(false);
    });
  });
});
