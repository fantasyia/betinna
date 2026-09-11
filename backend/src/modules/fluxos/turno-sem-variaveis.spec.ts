import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';

/**
 * O turno que declara variáveis e volta com NENHUMA precisa deixar rastro.
 *
 * Medido em 11/09, 1 vez em 5 rodadas: o modelo devolveu `variaveis: {}` — nem
 * os campos com enum, nem os livres. O portão seguinte leu vazio e mandou o
 * TEXTO FIXO perguntando a tensão que a pessoa tinha acabado de dizer. Do lado
 * do cliente, indistinguível do defeito original.
 *
 * ⚠️ O perigo não é a frequência, é a INVISIBILIDADE: passo VERDE, sem erro,
 * sem log. O único rastro era o `{}` — que também é o estado legítimo de um
 * turno sem novidade. Ninguém separava "não extraiu" de "não era pra extrair".
 *
 * Isto não conserta a extração. Torna o caso CONTÁVEL, que é o que permite
 * decidir entre conviver e consertar.
 */
const chamar = (
  svc: ConversarIaService,
  p: {
    gravaveis: string[];
    variaveisTurno: Record<string, unknown>;
    leadVariaveis?: Record<string, unknown>;
  },
) =>
  (
    svc as unknown as {
      gravarVariaveisDoTurno: (a: {
        leadId: string;
        leadVariaveis: unknown;
        gravaveis: string[];
        variaveisTurno: Record<string, unknown>;
        execucaoId: string;
      }) => Promise<Record<string, unknown>>;
    }
  ).gravarVariaveisDoTurno({
    leadId: 'lead-1',
    leadVariaveis: p.leadVariaveis ?? {},
    gravaveis: p.gravaveis,
    variaveisTurno: p.variaveisTurno,
    execucaoId: 'exec-1',
  });

const DECLARADAS = ['tensao_rede', 'corrente_quadro', 'perfil_cliente'];

describe('turno que declara variáveis e grava ZERO', () => {
  let svc: ConversarIaService;
  let avisos: string[];

  beforeEach(() => {
    svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
    avisos = [];
    Object.defineProperty(svc, 'logger', {
      value: { warn: (m: string) => avisos.push(m), log: vi.fn(), error: vi.fn() },
      writable: true,
    });
    Object.defineProperty(svc, 'prisma', {
      value: { lead: { update: vi.fn().mockResolvedValue({}) } },
      writable: true,
    });
  });

  it('avisa quando declarou e não gravou nada', async () => {
    await chamar(svc, { gravaveis: DECLARADAS, variaveisTurno: {} });
    expect(avisos.join(' ')).toContain('declarou 3 variáveis e gravou 0');
  });

  /**
   * O DISCRIMINADOR. Turno vazio com o lead já completo é o caso normal — não
   * havia novidade. O suspeito é vazio com o lead sem nada: primeira passagem,
   * que é exatamente onde a extração é a razão de o nó existir.
   */
  it('marca a PRIMEIRA passagem, que é o caso suspeito', async () => {
    await chamar(svc, { gravaveis: DECLARADAS, variaveisTurno: {} });
    expect(avisos.join(' ')).toContain('PRIMEIRA passagem');
    expect(avisos.join(' ')).toContain('já tinha 0/3');
  });

  it('NÃO marca como primeira passagem quando o lead já tem os campos', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: {},
      leadVariaveis: { tensao_rede: '220V', corrente_quadro: '63', perfil_cliente: 'comercio' },
    });
    expect(avisos.join(' ')).toContain('já tinha 3/3');
    expect(avisos.join(' ')).not.toContain('PRIMEIRA passagem');
  });

  it('não avisa quando gravou alguma coisa', async () => {
    await chamar(svc, { gravaveis: DECLARADAS, variaveisTurno: { tensao_rede: '220V' } });
    expect(avisos.join(' ')).not.toContain('gravou 0');
  });

  /**
   * Nó SEM `variaveisGravadas` não tem o que extrair — avisar ali seria ruído
   * em todo turno de todo fluxo que não usa a função.
   */
  it('nó que não declara variáveis nunca aparece no log', async () => {
    await chamar(svc, { gravaveis: [], variaveisTurno: {} });
    expect(avisos).toHaveLength(0);
  });

  /**
   * O schema costuma voltar com as chaves presentes e vazias. Isso conta como
   * "gravou 0" — é o mesmo efeito prático pro portão seguinte.
   */
  it('chaves presentes porém VAZIAS contam como zero', async () => {
    await chamar(svc, {
      gravaveis: DECLARADAS,
      variaveisTurno: { tensao_rede: '', corrente_quadro: null, perfil_cliente: '   ' },
    });
    expect(avisos.join(' ')).toContain('gravou 0');
  });
});
