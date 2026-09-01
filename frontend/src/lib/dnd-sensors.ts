import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Sensores de arrastar-e-soltar do app — um lugar só.
 *
 * ⚠️ NUNCA use `PointerSensor` aqui. Ele escuta *pointer events*, que incluem
 * TOQUE — então no celular ele dispara antes de qualquer espera, e bastam
 * poucos pixels de movimento pra iniciar um arrasto. Na prática: rolar a tela
 * carregava um card junto ("só de encostar já se mexe", relatado em 01/09).
 *
 * Separar por dispositivo é o que deixa cada um com a regra certa:
 *  - MOUSE: começa a arrastar com alguns pixels de movimento — preciso, e é o
 *    que evita que um clique curto vire arrasto.
 *  - TOQUE: exige SEGURAR. É a faixa em que o Trello opera, e é o que permite
 *    o swipe rolar a lista em vez de arrastar. O `tolerance` é o quanto o dedo
 *    pode andar DURANTE a espera sem cancelar o arrasto.
 *
 * Estava copiado em 8 telas, com valores diferentes e sem sensor de toque em 7
 * delas. Cópia de regra é duas verdades, e a que erra é a que ninguém olha.
 */
export function useSensoresDnd(distanciaMouse = 6, comTeclado = false) {
  // Os três são criados SEMPRE — hook não pode ser chamado condicionalmente.
  // A escolha acontece na montagem da lista, logo abaixo.
  const mouse = useSensor(MouseSensor, { activationConstraint: { distance: distanciaMouse } });
  const toque = useSensor(TouchSensor, {
    activationConstraint: {
      // SEGURAR pra arrastar. É o que separa "quis mover o card" de "quis rolar
      // a tela" — sem isso qualquer swipe carrega um card junto.
      delay: 250,
      // Quanto o dedo pode andar DURANTE a espera sem cancelar. Baixo demais e
      // o tremor da mão cancela; alto demais e a rolagem vira arrasto.
      tolerance: 8,
    },
  });
  // Só onde o punho de arrastar é focável (hoje: reordenar seções do
  // PageLayout). Ligar em todo lugar prometeria arrastar por teclado em lista
  // que não tem foco em item nenhum.
  const teclado = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  return useSensors(...(comTeclado ? [mouse, toque, teclado] : [mouse, toque]));
}
