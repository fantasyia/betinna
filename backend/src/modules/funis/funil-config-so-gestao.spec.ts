import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '@shared/decorators/roles.decorator';
import { FunisController } from './funis.controller';

/**
 * Mexer na ESTRUTURA do funil é config de empresa — o REP não entra.
 *
 * Por que precisou de `@Roles` e não bastou a matriz: essas rotas exigem
 * `kanban:edit`, que é a MESMA permissão de mover lead de etapa e etiquetar
 * lead — trabalho diário do representante. Ou seja, quem podia arrastar um
 * card no quadro também podia criar, renomear e EXCLUIR funil e etapa. E os
 * fluxos guardam a etapa por ID: excluir uma quebra automação em silêncio.
 *
 * Tirar `edit` da matriz do REP não resolveria — derrubaria o trabalho de lead
 * junto. Daí a trava por PAPEL, em cima da permissão.
 *
 * O teste lê a metadata do decorator em vez de subir o Nest inteiro: o que
 * interessa é que nenhuma rota de config fique sem a trava quando alguém
 * adicionar uma nova.
 */
const GESTAO = ['ADMIN', 'DIRECTOR', 'GERENTE'];

/** Métodos que MUDAM a estrutura do funil (o resto é leitura). */
const MUTACOES = [
  'create',
  'update',
  'remove',
  'adicionarEtapa',
  'atualizarEtapa',
  'removerEtapa',
] as const;

const rolesDe = (metodo: string): string[] | undefined =>
  Reflect.getMetadata(ROLES_KEY, FunisController.prototype[metodo as keyof object]);

describe('FunisController — config de funil é só pra gestão', () => {
  it('o controller expõe os métodos de mutação esperados', () => {
    // Guarda contra renomear/remover método e o teste passar vazio.
    for (const m of MUTACOES) {
      expect(
        typeof FunisController.prototype[m as keyof object],
        `método ${m} sumiu do controller — atualize esta lista`,
      ).toBe('function');
    }
  });

  it.each(MUTACOES)('%s exige papel de gestão', (metodo) => {
    expect(rolesDe(metodo), `${metodo} está SEM @Roles`).toEqual(GESTAO);
  });

  it.each(MUTACOES)('%s NÃO aceita REP', (metodo) => {
    expect(rolesDe(metodo) ?? []).not.toContain('REP');
  });

  it('LEITURA continua aberta ao REP — ele precisa ver o funil da carteira', () => {
    // A trava não pode levar junto a listagem: o service já filtra por
    // `visivelParaRep`, e é assim que o rep enxerga o funil de trabalho dele.
    expect(rolesDe('list')).toBeUndefined();
    expect(rolesDe('findOne')).toBeUndefined();
  });
});
