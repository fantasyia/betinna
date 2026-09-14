import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthSession } from '@/types/auth';

/**
 * Rascunhos (G-9) — o que a sessão caindo sozinha NÃO pode mais levar embora.
 *
 * O caro aqui não é guardar; é guardar pra pessoa errada ou devolver conteúdo
 * velho. Por isso os testes de dono e validade valem mais que o de ida-e-volta.
 */

const getSessionMock = vi.fn<[], AuthSession | null>();
vi.mock('./auth-store', () => ({ getSession: () => getSessionMock() }));

import { marcarSujo, limparMarcadores } from './dirty';
import {
  salvarRascunhosAbertos,
  lerRascunho,
  descartarRascunho,
  descartarRascunhos,
} from './rascunhos';

function sessao(userId: string): AuthSession {
  return {
    accessToken: 't',
    expiresAt: Date.now() + 600_000,
    user: {
      id: userId,
      email: 'a@b.com',
      nome: 'User',
      role: 'ADMIN',
      empresaIds: ['emp-1'],
      empresaIdAtiva: 'emp-1',
    },
  };
}

beforeEach(() => {
  limparMarcadores();
  window.localStorage.clear();
  getSessionMock.mockReturnValue(sessao('u1'));
  vi.restoreAllMocks();
});

describe('salvar e ler', () => {
  it('guarda o snapshot das telas sujas e devolve pro mesmo dono', () => {
    marcarSujo('fluxo-editor:f1', true, () => ({ nome: 'Régua fria', nos: 3 }));

    expect(salvarRascunhosAbertos()).toEqual(['fluxo-editor:f1']);

    const r = lerRascunho<{ nome: string; nos: number }>('fluxo-editor:f1');
    expect(r?.dados).toEqual({ nome: 'Régua fria', nos: 3 });
    expect(r?.dono).toBe('u1');
    expect(typeof r?.quando).toBe('number');
  });

  it('tela suja SEM snapshot não vira rascunho (só segura o reload do PWA)', () => {
    marcarSujo('form-qualquer', true);
    expect(salvarRascunhosAbertos()).toEqual([]);
  });

  it('snapshot que devolve null/undefined é ignorado', () => {
    marcarSujo('a', true, () => null);
    marcarSujo('b', true, () => undefined);
    expect(salvarRascunhosAbertos()).toEqual([]);
  });

  it('id sem rascunho → null', () => {
    expect(lerRascunho('nao-existe')).toBeNull();
  });
});

describe('quem pode ver o rascunho', () => {
  it('OUTRO usuário no mesmo navegador não vê — e o rascunho some', () => {
    marcarSujo('f', true, () => ({ segredo: 'proposta da Ana' }));
    salvarRascunhosAbertos();

    getSessionMock.mockReturnValue(sessao('u2'));
    expect(lerRascunho('f')).toBeNull();

    // e não fica guardado esperando o dono voltar
    getSessionMock.mockReturnValue(sessao('u1'));
    expect(lerRascunho('f')).toBeNull();
  });

  it('deslogado (sem sessão) não vê rascunho de usuário nenhum', () => {
    marcarSujo('f', true, () => ({ x: 1 }));
    salvarRascunhosAbertos();

    getSessionMock.mockReturnValue(null);
    expect(lerRascunho('f')).toBeNull();
  });
});

describe('validade', () => {
  it('passou de 24h → não oferece e apaga', () => {
    marcarSujo('f', true, () => ({ x: 1 }));
    salvarRascunhosAbertos();

    const bruto = JSON.parse(window.localStorage.getItem('betinna:rascunho:f') as string);
    bruto.quando = Date.now() - 25 * 60 * 60 * 1000;
    window.localStorage.setItem('betinna:rascunho:f', JSON.stringify(bruto));

    expect(lerRascunho('f')).toBeNull();
    expect(window.localStorage.getItem('betinna:rascunho:f')).toBeNull();
  });

  it('23h ainda vale', () => {
    marcarSujo('f', true, () => ({ x: 1 }));
    salvarRascunhosAbertos();
    const bruto = JSON.parse(window.localStorage.getItem('betinna:rascunho:f') as string);
    bruto.quando = Date.now() - 23 * 60 * 60 * 1000;
    window.localStorage.setItem('betinna:rascunho:f', JSON.stringify(bruto));

    expect(lerRascunho('f')?.dados).toEqual({ x: 1 });
  });
});

describe('descarte', () => {
  it('descartarRascunho tira só o id pedido', () => {
    marcarSujo('a', true, () => ({ v: 1 }));
    marcarSujo('b', true, () => ({ v: 2 }));
    salvarRascunhosAbertos();

    descartarRascunho('a');
    expect(lerRascunho('a')).toBeNull();
    expect(lerRascunho('b')?.dados).toEqual({ v: 2 });
  });

  it('descartarRascunhos limpa os nossos e NÃO mexe no resto do localStorage', () => {
    marcarSujo('a', true, () => ({ v: 1 }));
    marcarSujo('b', true, () => ({ v: 2 }));
    salvarRascunhosAbertos();
    window.localStorage.setItem('betinna:empresa', 'emp-1');

    descartarRascunhos();

    expect(lerRascunho('a')).toBeNull();
    expect(lerRascunho('b')).toBeNull();
    expect(window.localStorage.getItem('betinna:empresa')).toBe('emp-1');
  });
});

describe('não pode atrapalhar o logout', () => {
  it('snapshot que estoura é pulado, e os outros ainda são salvos', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    marcarSujo('quebrado', true, () => {
      throw new Error('boom');
    });
    marcarSujo('ok', true, () => ({ v: 1 }));

    expect(salvarRascunhosAbertos()).toEqual(['ok']);
  });

  it('rascunho grande demais não é guardado (localStorage não é só nosso)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    marcarSujo('gigante', true, () => ({ texto: 'x'.repeat(300 * 1024) }));

    expect(salvarRascunhosAbertos()).toEqual([]);
    expect(lerRascunho('gigante')).toBeNull();
  });

  it('localStorage indisponível (modo privado) não estoura', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    marcarSujo('f', true, () => ({ v: 1 }));

    expect(() => salvarRascunhosAbertos()).not.toThrow();
  });

  it('conteúdo corrompido no localStorage → null, e limpa', () => {
    window.localStorage.setItem('betinna:rascunho:f', '{ nao é json');
    expect(lerRascunho('f')).toBeNull();
    expect(window.localStorage.getItem('betinna:rascunho:f')).toBeNull();
  });
});
