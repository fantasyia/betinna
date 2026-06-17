import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/react';
import {
  serializarFluxo,
  hidratarFluxo,
  inserirTriggerManual,
} from './serializacao';
import type { FluxoDetailApi, FlowNode, TriggerTipo } from './types';

/**
 * ⭐ Round-trip do GRAFO: hidratarFluxo(serializarFluxo(grafo)) preserva nós e
 * arestas. O backend faz full-replace e roteia pelo LABEL da aresta — então a
 * reconstrução do sourceHandle (não persistido) precisa fechar o ciclo.
 *
 * serializarFluxo / hidratarFluxo espelham handleSave e o efeito de hidratação
 * byte-a-byte; estes testes travam esse contrato.
 */

// ─── Helpers de fixture ──────────────────────────────────────────

function node(partial: Partial<FlowNode> & { id: string; data: FlowNode['data'] }): FlowNode {
  return {
    type: 'fluxo',
    position: { x: 100, y: 100 },
    ...partial,
  } as FlowNode;
}

/**
 * Constrói um FluxoDetailApi a partir do payload serializado (que é
 * Record<string, unknown>) — o backend devolveria nos/arestas com a mesma forma.
 * Mantém id/nome/status fixos pra fechar o round-trip.
 */
function comoApi(
  payload: Record<string, unknown>,
  extra: Partial<FluxoDetailApi> = {},
): FluxoDetailApi {
  return {
    id: 'fluxo-1',
    nome: payload.nome as string,
    status: 'RASCUNHO',
    triggerTipo: (payload.triggerTipo as TriggerTipo | undefined) ?? null,
    nos: payload.nos as FluxoDetailApi['nos'],
    arestas: payload.arestas as FluxoDetailApi['arestas'],
    ...extra,
  };
}

describe('serializarFluxo / hidratarFluxo — round-trip do grafo', () => {
  it('preserva nós (id/tipo/acaoTipo/config/posX/posY) e arestas (source/target/label)', () => {
    const nodes: FlowNode[] = [
      node({
        id: 'trg',
        position: { x: 120, y: 40 },
        data: { titulo: 'Lead criado', tipo: 'TRIGGER', triggerTipo: 'LEAD_CRIADO', config: {} },
      }),
      node({
        id: 'wa',
        position: { x: 200, y: 300 },
        data: {
          titulo: 'Enviar WhatsApp',
          tipo: 'ACAO',
          acaoTipo: 'ENVIAR_WHATSAPP',
          config: { mensagem: 'Oi {{nome}}', destinatarioModo: 'lead' },
        },
      }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'trg', target: 'wa', type: 'removivel' },
    ];

    const payload = serializarFluxo(nodes, edges, 'Fluxo X', 'LEAD_CRIADO');
    const hid = hidratarFluxo(comoApi(payload));

    expect(hid.name).toBe('Fluxo X');
    expect(hid.triggerTipo).toBe('LEAD_CRIADO');
    // nós
    expect(hid.nodes.map((n) => n.id)).toEqual(['trg', 'wa']);
    const wa = hid.nodes.find((n) => n.id === 'wa')!;
    expect(wa.data.tipo).toBe('ACAO');
    expect(wa.data.acaoTipo).toBe('ENVIAR_WHATSAPP');
    expect(wa.data.config).toEqual({ mensagem: 'Oi {{nome}}', destinatarioModo: 'lead' });
    expect(wa.position).toEqual({ x: 200, y: 300 });
    const trg = hid.nodes.find((n) => n.id === 'trg')!;
    // triggerTipo do fluxo é espelhado no nó TRIGGER na hidratação
    expect(trg.data.triggerTipo).toBe('LEAD_CRIADO');
    // arestas
    expect(hid.edges).toHaveLength(1);
    expect(hid.edges[0]).toMatchObject({ source: 'trg', target: 'wa', id: 'e1' });
    // ação comum sem handle id → aresta sem label
    expect(hid.edges[0].label).toBeUndefined();
    expect(hid.edges[0].sourceHandle).toBeUndefined();
  });

  it('CONDIÇÃO roteador: saídas + arestas por label, sourceHandle reconstruído = label', () => {
    const nodes: FlowNode[] = [
      node({
        id: 'cond',
        data: {
          titulo: 'Roteia',
          tipo: 'CONDICAO',
          config: { modo: 'roteador', variavel: 'classificacao_final', saidas: ['comprou', 'desistiu'] },
        },
      }),
      node({ id: 'a1', data: { titulo: 'A1', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', config: {} } }),
      node({ id: 'a2', data: { titulo: 'A2', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', config: {} } }),
      node({ id: 'a3', data: { titulo: 'A3', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', config: {} } }),
    ];
    // No roteador o label da aresta É o id do handle (valor da saída / 'default').
    const edges: Edge[] = [
      { id: 'e1', source: 'cond', target: 'a1', sourceHandle: 'comprou', label: 'comprou', type: 'removivel' },
      { id: 'e2', source: 'cond', target: 'a2', sourceHandle: 'desistiu', label: 'desistiu', type: 'removivel' },
      { id: 'e3', source: 'cond', target: 'a3', sourceHandle: 'default', label: 'default', type: 'removivel' },
    ];

    const payload = serializarFluxo(nodes, edges, 'Roteador', '');
    const hid = hidratarFluxo(comoApi(payload));

    const cond = hid.nodes.find((n) => n.id === 'cond')!;
    expect(cond.data.config.saidas).toEqual(['comprou', 'desistiu']);
    expect(cond.data.config.modo).toBe('roteador');

    // cada aresta mantém label E reconstrói sourceHandle = label (id do handle)
    const byId = new Map(hid.edges.map((e) => [e.id, e]));
    expect(byId.get('e1')).toMatchObject({ label: 'comprou', sourceHandle: 'comprou' });
    expect(byId.get('e2')).toMatchObject({ label: 'desistiu', sourceHandle: 'desistiu' });
    expect(byId.get('e3')).toMatchObject({ label: 'default', sourceHandle: 'default' });
  });

  it('CONDIÇÃO simples: true/false ↔ Sim/Não, sourceHandle reconstruído', () => {
    const nodes: FlowNode[] = [
      node({ id: 'cond', data: { titulo: 'Cond', tipo: 'CONDICAO', config: { modo: 'simples', campo: 'etapa', operador: 'eq', valor: 'x' } } }),
      node({ id: 'sim', data: { titulo: 'Sim', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', config: {} } }),
      node({ id: 'nao', data: { titulo: 'Não', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', config: {} } }),
    ];
    // Na criação, o handle 'true' vira label 'Sim'; 'false' vira 'Não'.
    const edges: Edge[] = [
      { id: 'e1', source: 'cond', target: 'sim', sourceHandle: 'true', label: 'Sim', type: 'removivel' },
      { id: 'e2', source: 'cond', target: 'nao', sourceHandle: 'false', label: 'Não', type: 'removivel' },
    ];

    const payload = serializarFluxo(nodes, edges, 'Simples', '');
    // só o label é persistido — o sourceHandle some no payload
    const arestas = payload.arestas as Array<{ label: string | null }>;
    expect(arestas.map((a) => a.label)).toEqual(['Sim', 'Não']);

    const hid = hidratarFluxo(comoApi(payload));
    const byId = new Map(hid.edges.map((e) => [e.id, e]));
    // label preservado, sourceHandle reconstruído (Sim→true / Não→false no simples)
    expect(byId.get('e1')).toMatchObject({ label: 'Sim', sourceHandle: 'true' });
    expect(byId.get('e2')).toMatchObject({ label: 'Não', sourceHandle: 'false' });
  });

  it('CRON: serializa triggerConfig à parte + triggerTipo vem do nó TRIGGER', () => {
    const nodes: FlowNode[] = [
      node({
        id: 'trg',
        data: {
          titulo: 'Cron',
          tipo: 'TRIGGER',
          triggerTipo: 'CRON_AGENDADO',
          config: { expressao: '0 9 * * 1-5', timezone: 'America/Sao_Paulo' },
        },
      }),
    ];

    // triggerTipo top-level vazio: a FONTE DA VERDADE é o nó TRIGGER.
    const payload = serializarFluxo(nodes, [], 'Cron diário', '');
    expect(payload.triggerTipo).toBe('CRON_AGENDADO');
    expect(payload.triggerConfig).toEqual({
      expressao: '0 9 * * 1-5',
      timezone: 'America/Sao_Paulo',
    });

    // hidratando de volta (triggerTipo agora no topo, como o backend devolveria)
    const hid = hidratarFluxo(comoApi(payload));
    expect(hid.triggerTipo).toBe('CRON_AGENDADO');
    const trg = hid.nodes.find((n) => n.id === 'trg')!;
    expect(trg.data.triggerTipo).toBe('CRON_AGENDADO');
    expect(trg.data.config.expressao).toBe('0 9 * * 1-5');
  });

  it('triggerConfig CRON com config faltando → defaults (expressao vazia, SP)', () => {
    const nodes: FlowNode[] = [
      node({ id: 'trg', data: { titulo: 'Cron', tipo: 'TRIGGER', triggerTipo: 'CRON_AGENDADO', config: {} } }),
    ];
    const payload = serializarFluxo(nodes, [], 'Cron', '');
    expect(payload.triggerConfig).toEqual({ expressao: '', timezone: 'America/Sao_Paulo' });
  });

  it('triggerTipo top-level só é fallback quando não há nó TRIGGER', () => {
    // sem nó TRIGGER → usa o top-level
    const payload = serializarFluxo([], [], 'Sem nó', 'LEAD_CRIADO');
    expect(payload.triggerTipo).toBe('LEAD_CRIADO');

    // com nó TRIGGER de outro tipo → o nó vence o top-level
    const nodes: FlowNode[] = [
      node({ id: 'trg', data: { titulo: 'T', tipo: 'TRIGGER', triggerTipo: 'PEDIDO_APROVADO', config: {} } }),
    ];
    const p2 = serializarFluxo(nodes, [], 'Com nó', 'LEAD_CRIADO');
    expect(p2.triggerTipo).toBe('PEDIDO_APROVADO');
  });

  it('label persiste como null pra aresta sem label (não-string)', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b', type: 'removivel' }];
    const payload = serializarFluxo([], edges, 'x', '');
    const arestas = payload.arestas as Array<{ label: string | null }>;
    expect(arestas[0].label).toBeNull();
  });
});

describe('hidratarFluxo — Trigger Manual sintético', () => {
  it('fluxo sem triggerTipo e sem nó TRIGGER → insere Manual no topo e conecta nós-raiz', () => {
    const data: FluxoDetailApi = {
      id: 'f9',
      nome: 'Manual',
      status: 'RASCUNHO',
      triggerTipo: null,
      nos: [
        { id: 'a1', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', titulo: 'A1', config: {}, posX: 100, posY: 200 },
        { id: 'a2', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', titulo: 'A2', config: {}, posX: 100, posY: 300 },
      ],
      arestas: [{ id: 'e1', sourceNoId: 'a1', targetNoId: 'a2', label: null }],
    };
    const hid = hidratarFluxo(data);

    expect(hid.inseriuManual).toBe(true);
    // nó manual no topo
    expect(hid.nodes[0].id).toBe('manual-f9');
    expect(hid.nodes[0].data.tipo).toBe('TRIGGER');
    expect(hid.nodes[0].position).toEqual({ x: 120, y: 40 });
    // a1 é nó-raiz (sem entrada) → ganha aresta do manual; a2 já tinha entrada (e1) → não.
    const novas = hid.edges.filter((e) => e.source === 'manual-f9');
    expect(novas.map((e) => e.target)).toEqual(['a1']);
    expect(novas[0].id).toBe('edge-manual-f9-a1');
  });

  it('fluxo com triggerTipo → NÃO insere Manual', () => {
    const data: FluxoDetailApi = {
      id: 'f1',
      nome: 'Com gatilho',
      status: 'ATIVO',
      triggerTipo: 'LEAD_CRIADO',
      nos: [{ id: 'a1', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', titulo: 'A1', config: {} }],
      arestas: [],
    };
    const hid = hidratarFluxo(data);
    expect(hid.inseriuManual).toBe(false);
    expect(hid.nodes.some((n) => n.id.startsWith('manual-'))).toBe(false);
  });

  it('fluxo já com nó TRIGGER (manual) → NÃO duplica', () => {
    const data: FluxoDetailApi = {
      id: 'f2',
      nome: 'Já manual',
      status: 'RASCUNHO',
      triggerTipo: null,
      nos: [
        { id: 'm1', tipo: 'TRIGGER', titulo: 'Disparado manualmente', config: { manual: true } },
        { id: 'a1', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', titulo: 'A1', config: {} },
      ],
      arestas: [],
    };
    const hid = hidratarFluxo(data);
    expect(hid.inseriuManual).toBe(false);
    expect(hid.nodes.filter((n) => n.data.tipo === 'TRIGGER')).toHaveLength(1);
  });
});

describe('inserirTriggerManual', () => {
  it('não muta os arrays de entrada e conecta só nós-raiz não-TRIGGER', () => {
    const nodes: FlowNode[] = [
      node({ id: 'a1', data: { titulo: 'A1', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', config: {} } }),
      node({ id: 'a2', data: { titulo: 'A2', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP', config: {} } }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'a1', target: 'a2', type: 'removivel' }];

    const res = inserirTriggerManual(nodes, edges, { manualId: 'm', posY: 99 });

    // entrada intacta
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    // saída: manual no topo, na posição pedida
    expect(res.nodes[0].id).toBe('m');
    expect(res.nodes[0].position).toEqual({ x: 120, y: 99 });
    // só a1 é raiz → 1 aresta nova
    const novas = res.edges.filter((e) => e.source === 'm');
    expect(novas.map((e) => e.target)).toEqual(['a1']);
  });

  it('posY default = 40', () => {
    const res = inserirTriggerManual([], [], { manualId: 'm' });
    expect(res.nodes[0].position).toEqual({ x: 120, y: 40 });
  });
});
