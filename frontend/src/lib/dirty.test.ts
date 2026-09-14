import { describe, expect, it, beforeEach } from 'vitest';
import {
  marcarSujo,
  temAlteracaoNaoSalva,
  limparMarcadores,
  capturarRascunhos,
} from './dirty';

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

/**
 * G-9: o mesmo registro passou a carregar um snapshot opcional. O reload do PWA
 * segue olhando só o booleano — quem não sabe se serializar continua valendo.
 */
describe('dirty — snapshot opcional (G-9)', () => {
  beforeEach(() => limparMarcadores());

  it('sem snapshot, a tela conta pro reload mas não vira rascunho', () => {
    marcarSujo('form-simples', true);
    expect(temAlteracaoNaoSalva()).toBe(true);
    expect(capturarRascunhos()).toEqual([]);
  });

  it('com snapshot, entrega a função pra quem for guardar', () => {
    const snap = () => ({ nos: 3 });
    marcarSujo('fluxo-editor:f1', true, snap);

    const capturados = capturarRascunhos();
    expect(capturados).toHaveLength(1);
    expect(capturados[0][0]).toBe('fluxo-editor:f1');
    expect(capturados[0][1]()).toEqual({ nos: 3 });
  });

  it('remarcar troca o snapshot (o grafo de agora, não o de 10 minutos atrás)', () => {
    marcarSujo('f', true, () => ({ v: 1 }));
    marcarSujo('f', true, () => ({ v: 2 }));
    expect(capturarRascunhos()[0][1]()).toEqual({ v: 2 });
  });

  it('limpar a tela tira o snapshot junto', () => {
    marcarSujo('f', true, () => ({ v: 1 }));
    marcarSujo('f', false);
    expect(capturarRascunhos()).toEqual([]);
  });
});
