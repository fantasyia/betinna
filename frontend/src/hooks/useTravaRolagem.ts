import { useEffect } from 'react';

/**
 * Trava a rolagem do body enquanto um overlay está aberto — com CONTAGEM.
 *
 * ⚠️ Por que contagem, e não `const prev = body.style.overflow` em cada
 * componente (que era o padrão em 4 lugares):
 *
 * Isolado, salvar-e-restaurar funciona. SOBREPOSTO, não. Se A abre
 * (`prev=''`), B abre por cima (`prev='hidden'`) e **A fecha antes de B**, A
 * restaura `''` — rolagem liberada com overlay ainda aberto — e depois B
 * restaura `'hidden'`. A trava fica PARA SEMPRE, sem nada na tela.
 *
 * E o estrago não é só não rolar: `body { overflow: hidden }` faz o body virar
 * caixa sem rolagem, e isso DESLIGA o `position: sticky` de tudo que está
 * dentro. Medido em 01/09 no celular: com a trava vazada o header ia pra
 * `top: -143` ao rolar; sem ela, ficava em `top: 0`.
 *
 * O sintoma aparece longe da causa ("o topo desce"), e é por isso que a regra
 * mora aqui, num lugar só: o body é global, então a contagem também precisa
 * ser. Só o ÚLTIMO a soltar destrava.
 */
let pedidos = 0;
let overflowOriginal = '';

export function useTravaRolagem(ativo: boolean): void {
  useEffect(() => {
    if (!ativo) return;

    // Só o PRIMEIRO guarda o valor original — os de cima já veriam 'hidden'.
    if (pedidos === 0) {
      overflowOriginal = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    pedidos += 1;

    return () => {
      pedidos -= 1;
      // Guarda contra desmontagem fora de ordem: nunca deixa negativo, senão
      // a próxima abertura acharia que já há alguém segurando e não travaria.
      if (pedidos <= 0) {
        pedidos = 0;
        document.body.style.overflow = overflowOriginal;
      }
    };
  }, [ativo]);
}

/** Só pra teste: zera o contador entre casos. */
export function __resetTravaRolagem(): void {
  pedidos = 0;
  overflowOriginal = '';
}
