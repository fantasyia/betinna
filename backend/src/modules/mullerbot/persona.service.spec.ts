import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MullerBotPersonaService } from './persona.service';

const makePrisma = () => ({
  mullerBotPersona: { findUnique: vi.fn().mockResolvedValue(null) },
});
const makeBotPrompts = () => ({
  obterTextoPadrao: vi.fn().mockResolvedValue(null),
  obterTextoPorId: vi.fn().mockResolvedValue(null),
});

describe('MullerBotPersonaService — resolução do prompt de conversa (orquestração)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let botPrompts: ReturnType<typeof makeBotPrompts>;
  let service: MullerBotPersonaService;

  beforeEach(() => {
    prisma = makePrisma();
    botPrompts = makeBotPrompts();
    service = new MullerBotPersonaService(prisma as never, botPrompts as never);
  });

  it('usa o prompt do fluxo quando promptId é dado e existe', async () => {
    botPrompts.obterTextoPorId.mockResolvedValue('Prompt do fluxo');
    const r = await service.compilarSystemPromptConversa('emp-1', 'p9');
    expect(r).toBe('Prompt do fluxo');
    expect(botPrompts.obterTextoPorId).toHaveBeenCalledWith('emp-1', 'p9');
    // Não precisou nem olhar a persona.
    expect(prisma.mullerBotPersona.findUnique).not.toHaveBeenCalled();
  });

  it('usa o prompt PADRÃO da biblioteca quando existe (sem promptId)', async () => {
    botPrompts.obterTextoPadrao.mockResolvedValue('Prompt padrão da empresa');
    const r = await service.compilarSystemPromptConversa('emp-1');
    expect(r).toBe('Prompt padrão da empresa');
  });

  it('cai na persona (retrocompat) quando não há BotPrompt na biblioteca', async () => {
    prisma.mullerBotPersona.findUnique.mockResolvedValue({
      promptCustom: 'Sou a persona configurada hoje.',
      nome: 'Bê',
      ativo: true,
    });
    const r = await service.compilarSystemPromptConversa('emp-1');
    expect(r).toBe('Sou a persona configurada hoje.');
  });
});
