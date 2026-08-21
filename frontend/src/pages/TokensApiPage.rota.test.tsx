import { describe, it, expect } from 'vitest';
import { ROUTE_MODULO, moduloDaRota } from '@/hooks/usePermission';

/**
 * Tokens de API do MCP saíram de `/kanban/tokens` pra `/configuracoes/tokens`
 * (pedido do Léo, 21/08: "retire as configs de token de api do mcp e coloque
 * junto com as outras configs").
 *
 * O escopo desses tokens nunca foi só o quadro — eles alcançam fluxos, funis,
 * CRM, inbox, prompts. Configuração de acesso pertence a Sistema.
 *
 * Duas coisas quebram calado numa mudança dessas, e são elas que ficam presas
 * aqui: o gate de permissão e o endereço antigo.
 */
describe('Tokens de API — gate de módulo', () => {
  it('a rota nova continua gateada por `quadros`, como o backend', () => {
    // O backend gateia POST/GET/DELETE /kanban/api-tokens por `quadros`
    // (view/edit) — herança de quando a tela morava no Kanban. Se a tela
    // saísse desse gate, ela abriria pra quem toma 403 na primeira chamada.
    expect(moduloDaRota('/configuracoes/tokens')).toBe('quadros');
  });

  it('o resto de /configuracoes segue FORA do painel granular', () => {
    // Rotas de sistema são gated por role/permission fixa, não pela matriz
    // viva. O prefixo novo é a rota inteira justamente pra não arrastar
    // /configuracoes pra dentro do painel.
    expect(moduloDaRota('/configuracoes')).toBeNull();
    expect(moduloDaRota('/configuracoes/empresa')).toBeNull();
  });

  it('o mapa não ganhou um prefixo curto demais por engano', () => {
    const prefixos = ROUTE_MODULO.map(([p]) => p);
    expect(prefixos).toContain('/configuracoes/tokens');
    expect(prefixos).not.toContain('/configuracoes');
  });
});
