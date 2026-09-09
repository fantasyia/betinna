import { describe, expect, it } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';

/**
 * Derrubar a IA de propósito, sem sabotar produção.
 *
 * A sessão de testes travou no PV.16 por um motivo que não é falta de teste, é
 * falta de gancho: pra ver a IA cair era preciso estourar o teto de tokens do
 * prompt ou apontar o nó pra um prompt inexistente — as duas coisas mexem em
 * config que está NO AR. O caminho de falha, que é o que mais precisa de teste,
 * era o único que não dava pra exercitar.
 *
 * O risco do gancho é óbvio: ninguém pode derrubar a IA de um cliente. Por isso
 * são DUAS travas, e a primeira não vem do pedido — `_teste` é posto pelo
 * serviço na execução de teste e nunca existe numa execução real.
 */
const chamar = (ctx: Record<string, unknown>) => () =>
  (
    ConversarIaService.prototype as unknown as {
      falharSePedidoPorTeste: (c: unknown) => void;
    }
  ).falharSePedidoPorTeste.call({}, ctx);

describe('falha de IA forçada por teste', () => {
  it('execução de TESTE que pede a falha, falha', () => {
    expect(chamar({ _teste: true, _testeFalharIa: true })).toThrow(/indisponivel/i);
  });

  it('a mensagem cai em ia_indisponivel, não em ia_sem_chave', () => {
    // É a diferença entre "volta sozinha" e "alguém tem que configurar": só a
    // primeira é coberta pelo botPausadoAte, e é essa que se quer exercitar.
    const classificar = (
      ConversarIaService.prototype as unknown as {
        tipoErroIa: (e: unknown) => string;
      }
    ).tipoErroIa;
    let capturado: unknown;
    try {
      chamar({ _teste: true, _testeFalharIa: true })();
    } catch (e) {
      capturado = e;
    }
    expect(classificar.call({}, capturado)).toBe('ia_indisponivel');
  });

  it('execução REAL não derruba, nem pedindo', () => {
    // Este é o teste que importa: `_testeFalharIa` pode vir do contexto que o
    // chamador manda, mas sem `_teste` — que só o caminho de teste grava — ele
    // não vale nada.
    expect(chamar({ _testeFalharIa: true })).not.toThrow();
    expect(chamar({ _teste: false, _testeFalharIa: true })).not.toThrow();
  });

  it('execução de teste comum roda a IA normalmente', () => {
    expect(chamar({ _teste: true })).not.toThrow();
    expect(chamar({})).not.toThrow();
  });

  it('não aceita valor "quase verdadeiro" — só o booleano', () => {
    // Contexto vem de JSON; "true" e 1 chegam fácil e não podem ligar isto.
    expect(chamar({ _teste: true, _testeFalharIa: 'true' })).not.toThrow();
    expect(chamar({ _teste: 'true', _testeFalharIa: true })).not.toThrow();
    expect(chamar({ _teste: 1, _testeFalharIa: 1 })).not.toThrow();
  });
});
