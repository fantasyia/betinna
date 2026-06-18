/**
 * usePermission.test.ts — Teste-prova de conversão allowedRoles → requirePermission.
 *
 * Para CADA permissão de rota, assere hasPermission(role, perm) para os 5 papéis,
 * provando que o conjunto EXATO de roles com acesso é idêntico ao allowedRoles original.
 *
 * Receita: vitest puro, sem @testing-library/jest-dom.
 */
import { describe, it, expect } from 'vitest';
import { hasPermission } from '@/hooks/usePermission';

// ---------------------------------------------------------------------------
// mullerbot.config — allowedRoles original: ['ADMIN', 'DIRECTOR']
// ---------------------------------------------------------------------------
describe('mullerbot.config', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'mullerbot.config')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'mullerbot.config')).toBe(true);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'mullerbot.config')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'mullerbot.config')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'mullerbot.config')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mullerbot.auditoria — allowedRoles original: ['ADMIN', 'DIRECTOR', 'GERENTE']
// ---------------------------------------------------------------------------
describe('mullerbot.auditoria', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'mullerbot.auditoria')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'mullerbot.auditoria')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'mullerbot.auditoria')).toBe(true);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'mullerbot.auditoria')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'mullerbot.auditoria')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// incidentes.view — allowedRoles original: ['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC']
// ---------------------------------------------------------------------------
describe('incidentes.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'incidentes.view')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'incidentes.view')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'incidentes.view')).toBe(true);
  });
  it('SAC tem acesso', () => {
    expect(hasPermission('SAC', 'incidentes.view')).toBe(true);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'incidentes.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// configuracoes.view — allowedRoles original: ['ADMIN']
// ---------------------------------------------------------------------------
describe('configuracoes.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'configuracoes.view')).toBe(true);
  });
  it('DIRECTOR NÃO tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'configuracoes.view')).toBe(false);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'configuracoes.view')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'configuracoes.view')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'configuracoes.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// permissoes.view — allowedRoles original: ['ADMIN']
// ---------------------------------------------------------------------------
describe('permissoes.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'permissoes.view')).toBe(true);
  });
  it('DIRECTOR NÃO tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'permissoes.view')).toBe(false);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'permissoes.view')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'permissoes.view')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'permissoes.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// usuarios.view — allowedRoles original: ['ADMIN', 'DIRECTOR', 'GERENTE']
// ---------------------------------------------------------------------------
describe('usuarios.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'usuarios.view')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'usuarios.view')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'usuarios.view')).toBe(true);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'usuarios.view')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'usuarios.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fluxos.view — allowedRoles original: ['ADMIN', 'DIRECTOR', 'GERENTE']
// ---------------------------------------------------------------------------
describe('fluxos.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'fluxos.view')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'fluxos.view')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'fluxos.view')).toBe(true);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'fluxos.view')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'fluxos.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// segmentos.view — allowedRoles original: ['ADMIN', 'DIRECTOR', 'GERENTE']
// ---------------------------------------------------------------------------
describe('segmentos.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'segmentos.view')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'segmentos.view')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'segmentos.view')).toBe(true);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'segmentos.view')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'segmentos.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// integracoes.view — allowedRoles original: ['ADMIN', 'DIRECTOR', 'GERENTE']
// ---------------------------------------------------------------------------
describe('integracoes.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'integracoes.view')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'integracoes.view')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'integracoes.view')).toBe(true);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'integracoes.view')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'integracoes.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// aprovacoes.decide — inline check original: role === 'DIRECTOR' || role === 'ADMIN'
// ---------------------------------------------------------------------------
describe('aprovacoes.decide', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'aprovacoes.decide')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'aprovacoes.decide')).toBe(true);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'aprovacoes.decide')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'aprovacoes.decide')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'aprovacoes.decide')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// campanhas.manage — inline check original: ['ADMIN','DIRECTOR','GERENTE'].includes(role)
// ---------------------------------------------------------------------------
describe('campanhas.manage', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'campanhas.manage')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'campanhas.manage')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'campanhas.manage')).toBe(true);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'campanhas.manage')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'campanhas.manage')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// comissoes.manage — inline check original: role === 'DIRECTOR' || role === 'ADMIN'
// ---------------------------------------------------------------------------
describe('comissoes.manage', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'comissoes.manage')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'comissoes.manage')).toBe(true);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'comissoes.manage')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'comissoes.manage')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'comissoes.manage')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// inbox.zerar — inline check original: role === 'ADMIN' || role === 'DIRECTOR'
// ---------------------------------------------------------------------------
describe('inbox.zerar', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'inbox.zerar')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'inbox.zerar')).toBe(true);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'inbox.zerar')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'inbox.zerar')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'inbox.zerar')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fluxos.edit — inline check original: ['ADMIN','DIRECTOR'].includes(role)
// ---------------------------------------------------------------------------
describe('fluxos.edit', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'fluxos.edit')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'fluxos.edit')).toBe(true);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'fluxos.edit')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'fluxos.edit')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'fluxos.edit')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// configuracoes.empresa — inline check original: role === 'ADMIN' || role === 'DIRECTOR'
// FIX: rota /configuracoes era ADMIN-only mas a página esperava ADMIN+DIRECTOR
// ---------------------------------------------------------------------------
describe('configuracoes.empresa', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'configuracoes.empresa')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'configuracoes.empresa')).toBe(true);
  });
  it('GERENTE NÃO tem acesso', () => {
    expect(hasPermission('GERENTE', 'configuracoes.empresa')).toBe(false);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'configuracoes.empresa')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'configuracoes.empresa')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// funis.view — inline check original: role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE'
// ---------------------------------------------------------------------------
describe('funis.view', () => {
  it('ADMIN tem acesso', () => {
    expect(hasPermission('ADMIN', 'funis.view')).toBe(true);
  });
  it('DIRECTOR tem acesso', () => {
    expect(hasPermission('DIRECTOR', 'funis.view')).toBe(true);
  });
  it('GERENTE tem acesso', () => {
    expect(hasPermission('GERENTE', 'funis.view')).toBe(true);
  });
  it('SAC NÃO tem acesso', () => {
    expect(hasPermission('SAC', 'funis.view')).toBe(false);
  });
  it('REP NÃO tem acesso', () => {
    expect(hasPermission('REP', 'funis.view')).toBe(false);
  });
});
