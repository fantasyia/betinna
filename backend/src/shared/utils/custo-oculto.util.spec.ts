import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  ocultaCusto,
  precosParaRep,
  precosParaRepLista,
  semCustoParaRep,
  semCustoParaRepLista,
} from './custo-oculto.util';

/**
 * REPRESENTANTE NÃO VÊ CUSTO — regra explícita do Léo (26/08).
 *
 * O custo é a margem da empresa. Rep que enxerga o custo sabe até onde a
 * empresa aguenta descer, e a negociação deixa de ser sobre o valor da solução.
 *
 * O modo de falha aqui é traiçoeiro: vazar custo não gera erro, não quebra
 * tela, não aparece em log. Só aparece numa negociação, meses depois. Por isso
 * a regra é testada em vez de confiada à revisão.
 */
const como = (role: string) => ({ role }) as Pick<AuthenticatedUser, 'role'>;

describe('custo oculto para representante', () => {
  it('REP não vê: o custo vira null', () => {
    const r = semCustoParaRep(como('REP'), { nome: 'MB-01', precoFabrica: 1800 });
    expect(r.precoFabrica).toBeNull();
    // O resto do produto continua inteiro — esconder custo não é esconder produto.
    expect(r.nome).toBe('MB-01');
  });

  it('GERENTE, SAC, DIRECTOR e ADMIN veem — cada um precisa do número', () => {
    // Gerente avalia desconto; diretor decide preço. Cegá-los quebraria o
    // trabalho deles sem proteger nada.
    for (const role of ['GERENTE', 'SAC', 'DIRECTOR', 'ADMIN']) {
      expect(semCustoParaRep(como(role), { precoFabrica: 1800 }).precoFabrica).toBe(1800);
      expect(ocultaCusto(como(role))).toBe(false);
    }
    expect(ocultaCusto(como('REP'))).toBe(true);
  });

  it('a chave CONTINUA existindo (null), não some do objeto', () => {
    // O front tipa `precoFabrica: number | null` e mostra "—" no null. Remover
    // a chave renderizaria `undefined` na tela.
    const r = semCustoParaRep(como('REP'), { precoFabrica: 1800 });
    expect('precoFabrica' in r).toBe(true);
  });

  it('listagem inteira é limpa — é por onde mais custo escapa', () => {
    const lista = semCustoParaRepLista(como('REP'), [
      { sku: 'MB-01', precoFabrica: 1800 },
      { sku: 'MB-02', precoFabrica: 2400 },
    ]);
    expect(lista.every((p) => p.precoFabrica === null)).toBe(true);
  });

  it('não muta o objeto original (o cache do Prisma segue intacto)', () => {
    const original = { precoFabrica: 1800 };
    semCustoParaRep(como('REP'), original);
    expect(original.precoFabrica).toBe(1800);
  });

  it('custo já nulo continua nulo, sem inventar zero', () => {
    // Zero significaria "custa nada"; null significa "não informado".
    expect(semCustoParaRep(como('REP'), { precoFabrica: null }).precoFabrica).toBeNull();
    expect(semCustoParaRep(como('DIRECTOR'), { precoFabrica: null }).precoFabrica).toBeNull();
  });
});

/**
 * O REP LOCA, NÃO VENDE (regra do Léo, 26/08). No catálogo dele o preço que
 * aparece é a MENSALIDADE DE LOCAÇÃO — nunca o preço de venda, nunca o custo.
 */
describe('preços que o representante vê', () => {
  it('REP vê locação; venda e custo somem', () => {
    const r = precosParaRep(como('REP'), {
      precoTabela: 3150,
      precoFabrica: 1800,
      precoLocacaoMensal: 300,
    });
    expect(r.precoLocacaoMensal).toBe(300);
    expect(r.precoTabela).toBeNull();
    expect(r.precoFabrica).toBeNull();
  });

  it('sem preço de locação, fica NULL — NÃO cai pro preço de venda', () => {
    // O fallback silencioso seria o jeito exato de a regra falhar sem ninguém
    // notar: o rep veria 3150 achando que é mensalidade.
    const r = precosParaRep(como('REP'), {
      precoTabela: 3150,
      precoFabrica: 1800,
      precoLocacaoMensal: null,
    });
    expect(r.precoLocacaoMensal).toBeNull();
    expect(r.precoTabela).toBeNull();
  });

  it('DIRECTOR e GERENTE veem tudo — precisam dos três números', () => {
    for (const role of ['DIRECTOR', 'GERENTE', 'ADMIN', 'SAC']) {
      const r = precosParaRep(como(role), {
        precoTabela: 3150,
        precoFabrica: 1800,
        precoLocacaoMensal: 300,
      });
      expect(r.precoTabela).toBe(3150);
      expect(r.precoFabrica).toBe(1800);
    }
  });

  it('lista inteira do catálogo é filtrada', () => {
    const lista = precosParaRepLista(como('REP'), [
      { precoTabela: 3150, precoFabrica: 1800, precoLocacaoMensal: 300 },
      { precoTabela: 4120, precoFabrica: 2200, precoLocacaoMensal: null },
    ]);
    expect(lista.map((p) => p.precoTabela)).toEqual([null, null]);
    expect(lista.map((p) => p.precoLocacaoMensal)).toEqual([300, null]);
  });
});
