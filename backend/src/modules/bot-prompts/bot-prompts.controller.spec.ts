import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { BotPromptsController } from './bot-prompts.controller';

/**
 * Validação do MODELO ao criar/editar prompt.
 *
 * O card pedia expor `modelo`/`temperatura` no MCP; a parte que evita o
 * pé-na-jaca é esta: nome de modelo inválido tem que voltar com a LISTA dos
 * aceitos. Sem isso, quem edita por API/MCP descobre os nomes válidos chutando.
 *
 * E a regra do fail-open importa: se a chave da empresa não tem permissão de
 * listar modelos (project key restrita — é o caso hoje), recusar seria injusto.
 * O modelo pode ser válido e a gente só não conseguiu conferir.
 */
const makePrompts = () => ({
  create: vi.fn().mockResolvedValue({ id: 'p1' }),
  update: vi.fn().mockResolvedValue({ id: 'p1' }),
});

const user = { id: 'u1', empresaIdAtiva: 'emp-1' } as never;

describe('BotPromptsController — validação de modelo', () => {
  let prompts: ReturnType<typeof makePrompts>;

  const controller = (listar: unknown) =>
    new BotPromptsController(prompts as never, { listarModelos: listar } as never);

  beforeEach(() => {
    prompts = makePrompts();
  });

  it('modelo inexistente é recusado COM a lista dos aceitos', async () => {
    const listar = vi.fn().mockResolvedValue({
      modelos: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4o'],
      fonte: 'openai',
    });

    await expect(
      controller(listar).update(user, 'p1', { modelo: 'gpt-inventado' } as never),
    ).rejects.toThrow(/gpt-5\.4.*gpt-4o/s);
    expect(prompts.update).not.toHaveBeenCalled();
  });

  it('modelo válido passa', async () => {
    const listar = vi.fn().mockResolvedValue({ modelos: ['gpt-5.4'], fonte: 'openai' });

    await controller(listar).update(user, 'p1', { modelo: 'gpt-5.4' } as never);

    expect(prompts.update).toHaveBeenCalled();
  });

  it('chave sem permissão de listar modelos NÃO bloqueia (fail-open)', async () => {
    // É o estado real do tenant hoje: project key sem Models:Read.
    const listar = vi.fn().mockResolvedValue({
      modelos: ['gpt-4o'],
      fonte: 'fallback',
      motivo: 'sem_permissao_modelos',
    });

    await controller(listar).update(user, 'p1', { modelo: 'gpt-5.4-turbo' } as never);

    expect(prompts.update).toHaveBeenCalled();
  });

  it('sem mexer no modelo, nem consulta a OpenAI (não paga latência à toa)', async () => {
    const listar = vi.fn();

    await controller(listar).update(user, 'p1', { temperatura: 0.4 } as never);

    expect(listar).not.toHaveBeenCalled();
    expect(prompts.update).toHaveBeenCalled();
  });

  it('modelo vazio = "usa o da empresa" — não valida nem recusa', async () => {
    const listar = vi.fn();

    await controller(listar).update(user, 'p1', { modelo: '   ' } as never);

    expect(listar).not.toHaveBeenCalled();
    expect(prompts.update).toHaveBeenCalled();
  });

  it('a mesma validação vale no CREATE (senão nasce prompt com modelo morto)', async () => {
    const listar = vi.fn().mockResolvedValue({ modelos: ['gpt-5.4'], fonte: 'openai' });

    await expect(
      controller(listar).create(user, { nome: 'X', texto: 'Y', modelo: 'nao-existe' } as never),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    expect(prompts.create).not.toHaveBeenCalled();
  });
});
