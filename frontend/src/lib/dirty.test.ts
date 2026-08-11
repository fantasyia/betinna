import { describe, expect, it, beforeEach } from 'vitest';
import { marcarSujo, temAlteracaoNaoSalva, limparMarcadores } from './dirty';

/**
 * Registro de "não salvo" (#43). O reload automático do PWA consulta isto antes
 * de recarregar: sem ele, um deploy no meio da edição de um fluxo levava o
 * trabalho embora sem aviso.
 */
describe('dirty — registro global de alteração não salva', () => {
  beforeEach(() => limparMarcadores());

  it('começa limpo', () => {
    expect(temAlteracaoNaoSalva()).toBe(false);
  });

  it('uma tela suja basta pra segurar o reload', () => {
    marcarSujo('fluxo-editor', true);
    expect(temAlteracaoNaoSalva()).toBe(true);
  });

  it('só libera quando TODAS as telas limpam', () => {
    marcarSujo('fluxo-editor', true);
    marcarSujo('novo-pedido', true);

    marcarSujo('fluxo-editor', false);
    expect(temAlteracaoNaoSalva()).toBe(true);

    marcarSujo('novo-pedido', false);
    expect(temAlteracaoNaoSalva()).toBe(false);
  });

  it('marcar a mesma tela duas vezes não cria pendência dupla', () => {
    marcarSujo('fluxo-editor', true);
    marcarSujo('fluxo-editor', true);
    marcarSujo('fluxo-editor', false);
    expect(temAlteracaoNaoSalva()).toBe(false);
  });

  it('desmarcar tela que nunca marcou não quebra', () => {
    marcarSujo('inexistente', false);
    expect(temAlteracaoNaoSalva()).toBe(false);
  });
});
