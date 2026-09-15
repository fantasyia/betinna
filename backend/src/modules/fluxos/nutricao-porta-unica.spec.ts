import { describe, expect, it } from 'vitest';
import {
  NUTRICAO_DEFAULT,
  codigoDoFluxo,
  decidirEntrada,
  postoNaDisputa,
  resolveNutricao,
} from './nutricao-porta-unica.util';

/**
 * Porta única de nutrição (P6b). A ordem é decisão do Léo, 14/09:
 * E6 > E1 > E3 > E2, só o E6 interrompe, quem perde a vez é descartado.
 */
const E6 = { id: 'f-e6', nome: 'E6 · Abandono de checkout (não-industrial)' };
const E1 = { id: 'f-e1', nome: 'E1 · Quem chegou sozinho' };
const E3 = { id: 'f-e3', nome: 'E3 · Reaquecendo quem esfriou' };
const E2 = { id: 'f-e2', nome: 'E2 · Primeiro contato frio' };
const E5 = { id: 'f-e5', nome: 'E5 · Pediu pra sair' };
const P2 = { id: 'f-p2', nome: 'P2 · Rastreio disponível — avisar o cliente (WhatsApp)' };

const cfg = resolveNutricao(undefined);
const curso = (f: { id: string; nome: string }) => [
  { execucaoId: `exec-${f.id}`, fluxoId: f.id, fluxoNome: f.nome },
];

describe('quem está na disputa', () => {
  it('as quatro réguas de e-mail estão, na ordem decidida', () => {
    expect([E6, E1, E3, E2].map((f) => postoNaDisputa(f, cfg))).toEqual([0, 1, 2, 3]);
  });

  it('⛔ E5 (pediu pra sair) NUNCA é bloqueado — opt-out não é nutrição', () => {
    expect(postoNaDisputa(E5, cfg)).toBe(-1);
    expect(decidirEntrada(E5, curso(E6), cfg).admitir).toBe(true);
  });

  it('⛔ transacional (rastreio do pedido) também passa sempre', () => {
    expect(decidirEntrada(P2, curso(E1), cfg).admitir).toBe(true);
  });

  it('código sai do nome, e o nome pode vir sem o separador', () => {
    expect(codigoDoFluxo('E6 · Abandono')).toBe('E6');
    expect(codigoDoFluxo('e1')).toBe('E1');
  });
});

describe('o caso medido: E1 e E6 no mesmo lead, na mesma janela', () => {
  it('lead JÁ no E1 e o E6 dispara → E6 entra e INTERROMPE o E1', () => {
    const d = decidirEntrada(E6, curso(E1), cfg);
    expect(d.admitir).toBe(true);
    expect(d.cancelar).toEqual(['exec-f-e1']);
    expect(d.motivo).toMatch(/interrompe/);
  });

  it('lead JÁ no E6 e o E1 dispara → E1 é descartado, o E6 segue inteiro', () => {
    const d = decidirEntrada(E1, curso(E6), cfg);
    expect(d.admitir).toBe(false);
    expect(d.cancelar).toEqual([]);
  });
});

describe('a ordem, par a par', () => {
  it('quem está em curso vence todo mundo que não interrompe', () => {
    expect(decidirEntrada(E2, curso(E1), cfg).admitir).toBe(false);
    expect(decidirEntrada(E3, curso(E1), cfg).admitir).toBe(false);
    expect(decidirEntrada(E1, curso(E3), cfg).admitir).toBe(false);
    expect(decidirEntrada(E3, curso(E2), cfg).admitir).toBe(false);
  });

  it('E1 mais forte que o E3 em curso NÃO entra — só o E6 interrompe', () => {
    const d = decidirEntrada(E1, curso(E3), cfg);
    expect(d.admitir).toBe(false);
    expect(d.motivo).toMatch(/não interrompe/);
  });

  it('lead livre → qualquer régua entra', () => {
    for (const f of [E6, E1, E3, E2]) {
      expect(decidirEntrada(f, [], cfg).admitir).toBe(true);
    }
  });

  it('🔴 E2.3 · MESMA régua já rodando → recusa (a etiqueta reaplicada não duplica)', () => {
    const d = decidirEntrada(E2, curso(E2), cfg);
    expect(d.admitir).toBe(false);
    expect(d.motivo).toMatch(/JÁ está nesta régua/);
  });

  it('E2.3 vale pras outras que não interrompem', () => {
    for (const f of [E1, E3]) {
      expect(decidirEntrada(f, curso(f), cfg).admitir).toBe(false);
    }
  });

  it('E6 em curso e o E6 dispara de novo → REINICIA cancelando a anterior', () => {
    // Abandono de checkout novo merece sequência nova; o cancelamento é o que
    // impede as duas somadas.
    const d = decidirEntrada(E6, curso(E6), cfg);
    expect(d.admitir).toBe(true);
    expect(d.cancelar).toEqual(['exec-f-e6']);
  });

  it('mesma régua + outra mais fraca em curso: o E6 cancela as duas', () => {
    const d = decidirEntrada(E6, [...curso(E6), ...curso(E3)], cfg);
    expect(d.admitir).toBe(true);
    expect(d.cancelar.sort()).toEqual(['exec-f-e3', 'exec-f-e6']);
  });

  it('duas réguas em curso: o E6 cancela as DUAS ao entrar', () => {
    const d = decidirEntrada(E6, [...curso(E1), ...curso(E3)], cfg);
    expect(d.admitir).toBe(true);
    expect(d.cancelar.sort()).toEqual(['exec-f-e1', 'exec-f-e3']);
  });

  it('execução de fluxo fora da disputa não bloqueia ninguém', () => {
    expect(decidirEntrada(E2, curso(P2), cfg).admitir).toBe(true);
  });
});

describe('configuração do tenant', () => {
  it('sem config vale a decisão de 14/09', () => {
    expect(resolveNutricao(undefined)).toEqual(NUTRICAO_DEFAULT);
    expect(resolveNutricao({})).toEqual(NUTRICAO_DEFAULT);
  });

  it('`ativo: false` desliga a trava — volta ao comportamento anterior', () => {
    const off = resolveNutricao({ ativo: false });
    expect(decidirEntrada(E1, curso(E6), off).admitir).toBe(true);
  });

  it('dá pra trocar a ordem por config', () => {
    const invertido = resolveNutricao({ prioridade: ['E2', 'E1'], interrompem: ['E2'] });
    expect(decidirEntrada(E2, curso(E1), invertido).admitir).toBe(true);
    expect(decidirEntrada(E1, curso(E2), invertido).admitir).toBe(false);
  });

  it('dá pra apontar por ID quando o nome não segue a convenção', () => {
    const porId = resolveNutricao({ prioridade: ['f-e6', 'f-e1'], interrompem: ['f-e6'] });
    const semCodigo = { id: 'f-e1', nome: 'Régua de boas-vindas' };
    expect(decidirEntrada(semCodigo, curso(E6), porId).admitir).toBe(false);
  });

  it('`interrompem` com fluxo fora da disputa é ignorado (não cancela régua por engano)', () => {
    const torto = resolveNutricao({ prioridade: ['E1'], interrompem: ['E5'] });
    expect(torto.interrompem).toEqual([]);
  });

  it('config com lixo cai no default em vez de esvaziar a trava', () => {
    expect(resolveNutricao({ prioridade: 'E1' }).prioridade).toEqual(NUTRICAO_DEFAULT.prioridade);
  });
});
