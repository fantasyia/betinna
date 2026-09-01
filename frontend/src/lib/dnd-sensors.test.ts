import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MouseSensor, PointerSensor, TouchSensor } from '@dnd-kit/core';
import { useSensoresDnd } from './dnd-sensors';

/**
 * O defeito que originou este hook: com `PointerSensor`, tocar e mover 6px ja
 * arrastava um card no celular — porque pointer events INCLUEM toque, e ele
 * vencia o TouchSensor antes de a espera correr. Rolar a tela carregava card.
 */
describe('useSensoresDnd', () => {
  const sensores = (...args: [number?, boolean?]) =>
    renderHook(() => useSensoresDnd(...args)).result.current;

  it('NUNCA usa PointerSensor — e ele que dispara no toque sem esperar', () => {
    expect(sensores().map((s) => s.sensor)).not.toContain(PointerSensor);
  });

  it('mouse e toque sao sensores SEPARADOS', () => {
    const usados = sensores().map((s) => s.sensor);

    expect(usados).toContain(MouseSensor);
    expect(usados).toContain(TouchSensor);
  });

  it('o toque exige SEGURAR — sem delay o swipe vira arrasto', () => {
    const toque = sensores().find((s) => s.sensor === TouchSensor);

    expect(toque?.options).toMatchObject({
      activationConstraint: { delay: 250, tolerance: 8 },
    });
  });

  it('a espera vai em activationConstraint, nao solta nas opcoes', () => {
    // Solta, a opcao e IGNORADA pelo dnd-kit e o sensor volta a disparar na
    // hora — o defeito reapareceria sem nenhum erro de tipo.
    const toque = sensores().find((s) => s.sensor === TouchSensor);

    expect((toque?.options as { delay?: number }).delay).toBeUndefined();
  });

  it('o mouse respeita a distancia pedida por cada tela', () => {
    const mouse = sensores(5).find((s) => s.sensor === MouseSensor);

    expect(mouse?.options).toMatchObject({ activationConstraint: { distance: 5 } });
  });

  it('teclado so entra quando pedido', () => {
    expect(sensores()).toHaveLength(2);
    expect(sensores(6, true)).toHaveLength(3);
  });
});
