import { describe, expect, it } from 'vitest';
import { fmtDuracaoPasso } from './FluxosPage';

/**
 * A duração do passo é o que separa dois vermelhos idênticos no painel: um
 * turno de IA que estourou o teto de 2 minutos e um passo que falhou em 0,2s
 * apareciam iguais — mesmo status, mesma mensagem.
 */
describe('fmtDuracaoPasso', () => {
  it('abaixo de 1s vai em milissegundos — é onde a maioria dos passos vive', () => {
    expect(fmtDuracaoPasso('2026-09-09T21:27:08.502Z', '2026-09-09T21:27:08.504Z')).toBe('2ms');
    expect(fmtDuracaoPasso('2026-09-09T21:27:08.000Z', '2026-09-09T21:27:08.999Z')).toBe('999ms');
  });

  it('segundos com vírgula decimal (pt-BR)', () => {
    expect(fmtDuracaoPasso('2026-09-09T21:27:08.000Z', '2026-09-09T21:27:09.200Z')).toBe('1,2s');
  });

  // O caso que motivou tudo: o teto do Promise.race é de 2 minutos.
  it('mostra minutos — é assim que o estouro do teto fica visível', () => {
    expect(fmtDuracaoPasso('2026-09-09T21:00:00.000Z', '2026-09-09T21:02:00.000Z')).toBe('2min');
    expect(fmtDuracaoPasso('2026-09-09T21:00:00.000Z', '2026-09-09T21:02:07.000Z')).toBe('2min 7s');
  });

  it('passo ainda rodando não mostra duração', () => {
    expect(fmtDuracaoPasso('2026-09-09T21:27:08.502Z', null)).toBeNull();
    expect(fmtDuracaoPasso('2026-09-09T21:27:08.502Z', undefined)).toBeNull();
  });

  // Relógio de container pode andar pra trás entre dois writes.
  it('duração negativa é ruído, não informação', () => {
    expect(fmtDuracaoPasso('2026-09-09T21:27:09.000Z', '2026-09-09T21:27:08.000Z')).toBeNull();
  });
});
