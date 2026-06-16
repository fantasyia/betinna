import { describe, it, expect } from 'vitest';
import {
  saidasDoNo,
  labelDaAresta,
  reconstruirSourceHandle,
  dedupConfigSaidas,
  RESERVADOS,
  norm,
  defaultConfig,
} from './saidas';
import type { NodePayload, PaletteItem } from './types';

/**
 * ⭐ Testes do CONTRATO de roteamento — o BACKEND roteia a execução pelo label da
 * aresta, então o round-trip handleId → label → handleId NÃO pode quebrar.
 *
 *   reconstruirSourceHandle(labelDaAresta(handleId), node) === handleId
 *
 * pra cada uma das 3 convenções.
 */

function no(partial: Partial<NodePayload>): NodePayload {
  return { titulo: 'x', tipo: 'ACAO', config: {}, ...partial };
}

describe('contrato: round-trip handleId ↔ label ↔ handleId', () => {
  it('CONDIÇÃO simples: true/false ↔ Sim/Não', () => {
    const condSimples = no({ tipo: 'CONDICAO', config: { modo: 'simples' } });

    expect(labelDaAresta('true')).toBe('Sim');
    expect(labelDaAresta('false')).toBe('Não');
    expect(reconstruirSourceHandle('Sim', condSimples)).toBe('true');
    expect(reconstruirSourceHandle('Não', condSimples)).toBe('false');

    // round-trip fechado
    for (const handleId of ['true', 'false']) {
      expect(reconstruirSourceHandle(labelDaAresta(handleId), condSimples)).toBe(handleId);
    }
  });

  it('CONDIÇÃO roteador: valor da saída ↔ ele mesmo (label = id)', () => {
    const roteador = no({
      tipo: 'CONDICAO',
      config: { modo: 'roteador', saidas: ['comprou', 'desistiu'] },
    });

    for (const handleId of ['comprou', 'desistiu', 'default']) {
      expect(labelDaAresta(handleId)).toBe(handleId);
      expect(reconstruirSourceHandle(handleId, roteador)).toBe(handleId);
      expect(reconstruirSourceHandle(labelDaAresta(handleId), roteador)).toBe(handleId);
    }
  });

  it('roteador com saída chamada "Sim"/"Não": NÃO mapeia pra true/false (modo manda)', () => {
    const roteador = no({
      tipo: 'CONDICAO',
      config: { modo: 'roteador', saidas: ['Sim', 'Não'] },
    });
    // No roteador o label É o id — Sim continua Sim (não vira 'true').
    expect(reconstruirSourceHandle('Sim', roteador)).toBe('Sim');
    expect(reconstruirSourceHandle('Não', roteador)).toBe('Não');
    for (const handleId of ['Sim', 'Não', 'default']) {
      expect(reconstruirSourceHandle(labelDaAresta(handleId), roteador)).toBe(handleId);
    }
  });

  it('CONVERSAR_IA: classificou/timeout/erro ↔ eles mesmos', () => {
    const ia = no({ acaoTipo: 'CONVERSAR_IA', config: { aguardarResposta: true, timeoutHoras: 24 } });
    for (const handleId of ['classificou', 'timeout', 'erro']) {
      expect(labelDaAresta(handleId)).toBe(handleId);
      expect(reconstruirSourceHandle(handleId, ia)).toBe(handleId);
      expect(reconstruirSourceHandle(labelDaAresta(handleId), ia)).toBe(handleId);
    }
  });

  it('saída única (ação comum): sem handle id → sem label → undefined', () => {
    const acao = no({ acaoTipo: 'ENVIAR_WHATSAPP' });
    expect(labelDaAresta(null)).toBeUndefined();
    expect(labelDaAresta(undefined)).toBeUndefined();
    expect(reconstruirSourceHandle(null, acao)).toBeUndefined();
    expect(reconstruirSourceHandle(undefined, acao)).toBeUndefined();
  });
});

describe('saidasDoNo', () => {
  it('CONDIÇÃO simples → [true, false]', () => {
    const s = saidasDoNo(no({ tipo: 'CONDICAO', config: { modo: 'simples' } }));
    expect(s.map((x) => x.id)).toEqual(['true', 'false']);
    expect(s[0].pos).toBe('30%');
    expect(s[1].pos).toBe('70%');
  });

  it('CONDIÇÃO sem modo definido → simples (true/false)', () => {
    const s = saidasDoNo(no({ tipo: 'CONDICAO', config: {} }));
    expect(s.map((x) => x.id)).toEqual(['true', 'false']);
  });

  it('CONDIÇÃO roteador com saidas=[a,b] → [a, b, default]', () => {
    const s = saidasDoNo(no({ tipo: 'CONDICAO', config: { modo: 'roteador', saidas: ['a', 'b'] } }));
    expect(s.map((x) => x.id)).toEqual(['a', 'b', 'default']);
    // default cinza; demais primary
    expect(s[2].cor).toBe('!bg-muted');
    expect(s[0].cor).toBe('!bg-primary');
  });

  it('CONDIÇÃO roteador sem saidas → só [default]', () => {
    const s = saidasDoNo(no({ tipo: 'CONDICAO', config: { modo: 'roteador' } }));
    expect(s.map((x) => x.id)).toEqual(['default']);
  });

  it('CONVERSAR_IA com timeout → classificou/timeout/erro (inclui erro)', () => {
    const s = saidasDoNo(
      no({ acaoTipo: 'CONVERSAR_IA', config: { aguardarResposta: true, timeoutHoras: 24 } }),
    );
    expect(s.map((x) => x.id)).toEqual(['classificou', 'timeout', 'erro']);
    expect(s.find((x) => x.id === 'erro')).toBeTruthy();
  });

  it('CONVERSAR_IA sem timeout (aguardarResposta=false) → [main(sem id), erro]', () => {
    const s = saidasDoNo(
      no({ acaoTipo: 'CONVERSAR_IA', config: { aguardarResposta: false, timeoutHoras: 24 } }),
    );
    expect(s.map((x) => x.id)).toEqual([undefined, 'erro']);
    // 'erro' aparece SEMPRE
    expect(s.find((x) => x.id === 'erro')).toBeTruthy();
  });

  it('CONVERSAR_IA com timeoutHoras=0 → [main(sem id), erro]', () => {
    const s = saidasDoNo(
      no({ acaoTipo: 'CONVERSAR_IA', config: { aguardarResposta: true, timeoutHoras: 0 } }),
    );
    expect(s.map((x) => x.id)).toEqual([undefined, 'erro']);
  });

  it('ação comum → 1 saída sem id', () => {
    const s = saidasDoNo(no({ acaoTipo: 'ENVIAR_WHATSAPP' }));
    expect(s).toHaveLength(1);
    expect(s[0].id).toBeUndefined();
    expect(s[0].pos).toBeUndefined();
  });

  it('os ids de saidasDoNo fecham o round-trip via labelDaAresta', () => {
    const nodes: NodePayload[] = [
      no({ tipo: 'CONDICAO', config: { modo: 'simples' } }),
      no({ tipo: 'CONDICAO', config: { modo: 'roteador', saidas: ['x', 'y'] } }),
      no({ acaoTipo: 'CONVERSAR_IA', config: { aguardarResposta: true, timeoutHoras: 3 } }),
    ];
    for (const n of nodes) {
      for (const s of saidasDoNo(n)) {
        if (s.id == null) continue; // saída única não roteia por label
        expect(reconstruirSourceHandle(labelDaAresta(s.id), n)).toBe(s.id);
      }
    }
  });
});

describe('RESERVADOS / norm', () => {
  it('norm faz trim + lowercase + colapsa espaços', () => {
    expect(norm('  Comprou  Tudo ')).toBe('comprou tudo');
    expect(norm('SIM')).toBe('sim');
  });

  it('RESERVADOS rejeita os nomes que colidem com handles implícitos', () => {
    for (const v of ['default', 'true', 'false', 'sim', 'não', 'nao']) {
      expect(RESERVADOS.includes(norm(v))).toBe(true);
    }
    // variações com caixa/espaço normalizam pra reservado
    expect(RESERVADOS.includes(norm(' Default '))).toBe(true);
    expect(RESERVADOS.includes(norm('TRUE'))).toBe(true);
    // valor legítimo não é reservado
    expect(RESERVADOS.includes(norm('comprou'))).toBe(false);
  });
});

describe('dedupConfigSaidas', () => {
  it('remove saídas duplicadas EXATAS preservando ordem', () => {
    const out = dedupConfigSaidas({ saidas: ['a', 'b', 'a', 'c', 'b'] });
    expect(out.saidas).toEqual(['a', 'b', 'c']);
  });

  it('retorna o MESMO objeto quando não há duplicata (sem realocar)', () => {
    const cfg = { saidas: ['a', 'b'] };
    expect(dedupConfigSaidas(cfg)).toBe(cfg);
  });

  it('ignora config sem saidas (ou não-array)', () => {
    const cfg = { modo: 'simples' };
    expect(dedupConfigSaidas(cfg)).toBe(cfg);
  });
});

describe('defaultConfig', () => {
  const item = (p: Partial<PaletteItem>): PaletteItem => ({ id: 'x', label: 'x', tipo: 'ACAO', ...p });

  it('manual → { manual, descricao }', () => {
    expect(defaultConfig(item({ tipo: 'TRIGGER', manual: true }))).toEqual({
      manual: true,
      descricao: '',
    });
  });

  it('CRON_AGENDADO → freq/horario/timezone', () => {
    expect(defaultConfig(item({ tipo: 'TRIGGER', triggerTipo: 'CRON_AGENDADO' }))).toEqual({
      cronFreq: 'dias_uteis',
      cronHorario: '09:00',
      timezone: 'America/Sao_Paulo',
    });
  });

  it('DELAY → quantidade/unidade', () => {
    expect(defaultConfig(item({ tipo: 'DELAY' }))).toEqual({ quantidade: 1, unidade: 'horas' });
  });

  it('CONDICAO → modo simples', () => {
    expect(defaultConfig(item({ tipo: 'CONDICAO' }))).toEqual({ modo: 'simples', operador: 'eq' });
  });

  it('CONVERSAR_IA → aguarda resposta com timeout', () => {
    expect(defaultConfig(item({ acaoTipo: 'CONVERSAR_IA' }))).toEqual({
      aguardarResposta: true,
      timeoutHoras: 24,
    });
  });

  it('PAUSAR_IA → { acao: pausar_ia }', () => {
    expect(defaultConfig(item({ acaoTipo: 'PAUSAR_IA' }))).toEqual({ acao: 'pausar_ia' });
  });

  it('ação sem default conhecido → {}', () => {
    expect(defaultConfig(item({ acaoTipo: 'ATRIBUIR_REP' }))).toEqual({});
  });
});
