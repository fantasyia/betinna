import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PausarIaForm } from './PausarIaForm';
import { rotuloDaAcao } from '@/pages/fluxo/lib/metadata';
import { resumoNo } from '@/pages/fluxo/lib/resumo';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * O bug que isto fecha: `PAUSAR_IA` com `religar: true` faz o OPOSTO do nome do
 * tipo — religa o bot. O editor mostrava "Pausar IA" e "pausa a IA na conversa"
 * num nó que religa, e não existia controle nenhum pro campo (só JSON cru ou
 * MCP). Nó que diz o contrário do que faz não quebra, não loga, não alerta: só
 * faz quem revisa remover o nó certo achando que removeu o errado.
 */
afterEach(cleanup);

const payload = (config: Record<string, unknown> = {}, titulo = 'Pausar IA na conversa') =>
  ({ tipo: 'ACAO', acaoTipo: 'PAUSAR_IA', titulo, config }) as NodePayload;

function montar(config: Record<string, unknown> = {}, titulo?: string) {
  const onUpdate = vi.fn();
  const inicial = payload(config, titulo);
  render(<PausarIaForm data={inicial} onUpdate={onUpdate} />);
  const select = screen.getByTestId('pausar-ia-modo') as HTMLSelectElement;
  const gravado = () => {
    const fn = onUpdate.mock.calls.at(-1)?.[0] as (d: NodePayload) => NodePayload;
    return fn(inicial);
  };
  return { select, gravado };
}

describe('PausarIaForm', () => {
  it('nó sem config aparece como PAUSAR (o default do backend)', () => {
    expect(montar().select.value).toBe('pausar');
  });

  it('nó com religar:true aparece como RELIGAR — era o que a tela escondia', () => {
    expect(montar({ religar: true }).select.value).toBe('religar');
  });

  it('trocar pra religar grava religar:true', () => {
    const { select, gravado } = montar();
    fireEvent.change(select, { target: { value: 'religar' } });
    expect(gravado().config.religar).toBe(true);
  });

  it('trocar pra pausar grava religar:false EXPLÍCITO (não some a chave)', () => {
    // Explícito porque o campo INVERTE o efeito do nó: quem ler o JSON não
    // deveria precisar saber que "ausente" significa pausar.
    const { select, gravado } = montar({ religar: true });
    fireEvent.change(select, { target: { value: 'pausar' } });
    expect(gravado().config.religar).toBe(false);
  });

  it('o TÍTULO acompanha (senão o nó segue se chamando o contrário do que faz)', () => {
    const { select, gravado } = montar({}, 'Pausar IA na conversa');
    fireEvent.change(select, { target: { value: 'religar' } });
    expect(gravado().titulo).toBe('Religar IA na conversa');
  });

  it('título customizado pelo usuário é PRESERVADO', () => {
    const { select, gravado } = montar({}, 'Religar IA (limpa precisaHumano)');
    fireEvent.change(select, { target: { value: 'religar' } });
    expect(gravado().titulo).toBe('Religar IA (limpa precisaHumano)');
  });

  it('preserva o resto da config', () => {
    const { select, gravado } = montar({ outraCoisa: 1 });
    fireEvent.change(select, { target: { value: 'religar' } });
    expect(gravado().config).toEqual({ outraCoisa: 1, religar: true });
  });
});

describe('rótulo e resumo seguem a config (o cerne do bug)', () => {
  it('rótulo do nó: religar:true → "Religar IA na conversa"', () => {
    expect(rotuloDaAcao('PAUSAR_IA', { religar: true })).toBe('Religar IA na conversa');
    expect(rotuloDaAcao('PAUSAR_IA', {})).toBe('Pausar IA na conversa');
  });

  it('resumo do nó: diz RELIGA, não "pausa"', () => {
    expect(resumoNo(payload({ religar: true }))).toMatch(/RELIGA/);
    expect(resumoNo(payload({}))).toMatch(/pausa/);
  });
});

describe('chave morta `acao`', () => {
  it('editar o nó LIMPA o `acao: "pausar_ia"` (o backend só lê `religar`)', () => {
    // Vinha do default antigo e só confundia quem abria o JSON procurando o que
    // o nó faz. Some sem migração, quando alguém encosta no nó.
    const { select, gravado } = montar({ acao: 'pausar_ia' });
    fireEvent.change(select, { target: { value: 'religar' } });
    expect(gravado().config).toEqual({ religar: true });
  });
});
