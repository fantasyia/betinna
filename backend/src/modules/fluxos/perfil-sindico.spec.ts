import { describe, expect, it } from 'vitest';
import { perfilNaFrase } from './extracao-deterministica';

/**
 * 🔴 "Síndico" sozinho cravava condomínio — e o síndico que quer proteger a
 * PRÓPRIA casa recebia o link errado (medido em campo, 17/09):
 *
 * ```
 * ELE  "sou sindico aqui, é 220V e o disjuntor é 63A, queimou a geladeira da minha cozinha"
 * BOT  "…para proteger a geladeira da sua cozinha."
 * BOT  .../protecao-comercial?contexto=condominio&…
 * ```
 *
 * A frase do bot contradiz o link que ele acabou de mandar.
 *
 * 📌 É a TERCEIRA instância de uma classe que este arquivo já documenta duas
 * vezes: "casa de máquinas" (o `casa` que é do prédio) e "morador de rua" (o
 * `morador` que não é de condomínio). Nas duas, a solução foi a palavra só
 * contar ACOMPANHADA. `síndico` tinha ficado de fora da mesma lição.
 *
 * ⚠️ Abster é o comportamento CERTO, não desistência: perfil vazio faz o portão
 * responder "Não" e o nó consultivo PERGUNTAR — que é a regra do Léo ("síndico
 * também tem apartamento; na dúvida, perguntar antes de mandar calculadora
 * errada"). A régua não precisa acertar o ambíguo, precisa não CRAVAR nele.
 *
 * As frases são as do card da Testadora, com o esperado dela.
 */
describe('perfil — o cargo de síndico não decide sozinho', () => {
  it.each([
    // o defeito do card: cargo + cômodo da casa dele
    ['sou sindico aqui, queimou a geladeira da minha cozinha', null],
    // o SUBSTANTIVO continua cravando — quem diz "é pro condomínio" diz o lugar
    ['e pro condominio, queimou o elevador', 'condominio'],
    // controles que já passavam
    ['moro num predio, queimou o portao eletronico', null],
    ['queimou a geladeira da loja', 'comercio'],
  ])('%j → %s', (frase, esperado) => {
    expect(perfilNaFrase(frase)).toBe(esperado);
  });

  /**
   * ⚠️ DIVERGE do card, de propósito: a Testadora esperava `condominio`.
   *
   * Bomba de piscina e bomba de poço existem em casa. Com o cargo abstendo, o
   * que sobraria pra decidir seria a palavra "bomba" — e cravar por ela é
   * repetir a classe que este conserto fecha, só trocando a palavra. O custo de
   * abster é UMA pergunta do nó consultivo; o de cravar errado é a pessoa levar
   * um produto que não protege o que ela quer proteger.
   *
   * O que entrou na lista foi só o inequívoco (elevador, portaria, interfone) —
   * esses ninguém tem em casa, e decidem sem depender de cargo nenhum.
   */
  it('cargo + "bomba" ABSTÉM — bomba de piscina existe em casa', () => {
    expect(perfilNaFrase('sou sindico aqui, queimou a bomba')).toBeNull();
  });

  /**
   * ⚠️ DIVERGE do card — e aqui a premissa dele estava errada: a tabela dizia
   * que esta frase JÁ dava `residencia` hoje ("casa casou primeiro"). Não dava.
   * Medi antes de mexer: `perfilNaFrase` acumula TODAS as categorias que casam
   * e a linha "Duas categorias = ambiguidade real. A rede não desempata"
   * devolve `null`. Já era `null` antes deste conserto, e continua sendo.
   *
   * Fazer moradia GANHAR de condomínio resolveria esta frase e criaria a
   * pergunta oposta em outras ("moro no prédio e queimou o elevador"). Fica
   * abstendo: o nó consultivo pergunta, que é o que o desempate exige.
   */
  it('cargo + lugar + moradia: duas categorias seguem abstendo', () => {
    expect(
      perfilNaFrase('sou sindico do predio, queimou a televisao da sala aqui de casa'),
    ).toBeNull();
  });

  /** O cargo acompanhado do lugar, sem nada de moradia, resolve. */
  it('"síndico do prédio" sozinho crava condomínio', () => {
    expect(perfilNaFrase('sou sindico do predio, queimou a entrada')).toBe('condominio');
  });

  /** Registro falado: "síndico AQUI do prédio" — uma palavra no meio, como o `morador`. */
  it('admite uma palavra no meio ("síndico aqui do prédio")', () => {
    expect(perfilNaFrase('sou sindico aqui do predio, queimou a entrada')).toBe('condominio');
  });
});
