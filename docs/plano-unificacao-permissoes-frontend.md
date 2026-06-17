# Plano — Unificação de permissões no frontend

> Refator GRANDE, tratado à parte (decisão 2026-06-17). Não é gap de segurança: o
> gate real é sempre o `PermissionsGuard` no backend; o front só esconde botões
> (UI hint). Ver CLAUDE.md backend **D49** (drift documentado como tolerável).

## Estado atual — 3 espelhos + 2 mecanismos de gate

**3 lugares que espelham permissão (divergem):**
1. `frontend/src/hooks/usePermission.ts` — `type Permission` + `PERMISSION_MATRIX`
   (Record `UserRole → Set<Permission>`), tentativa de fonte da verdade.
2. `frontend/src/App.tsx` — `allowedRoles={[...]}` hardcoded em ~13 rotas (não
   derivam da matrix).
3. Checks inline `role === 'X'` em 9+ páginas (`PersonaBotPage`, `AprovacoesPage`,
   `CampanhasPage`, `ComissoesPage`, `ConfiguracoesPage`, `FluxosPage`,
   `DashboardPage`, `AdminPage`, `inbox/ThreadHeader`).

**2 mecanismos de gate de rota:**
- `ProtectedRoute` com `requirePermission` (consulta a matrix) **OU** `allowedRoles`
  (lista hardcoded) **OU** sem prop (só auth).
- Checks inline nas páginas (escondem botões/ações após entrar na rota).

**Divergências conhecidas:** `mullerbot.config` está na matrix mas as rotas usam
`allowedRoles`; `campanhas.delete` na matrix duplica a lista hardcoded da página;
a matrix não tem `funis`, `aprovacoes.decide`, `inbox.zerar`, `fluxos.edit`.

## Plano (incremental, do mais seguro ao mais arriscado)

1. **Expandir a `PERMISSION_MATRIX`** com o que hoje só existe nos checks inline:
   `mullerbot.prompts`, `fluxos.edit`, `aprovacoes.decide`, `inbox.zerar`,
   `configuracoes.empresa`, `campanhas.manage`, `comissoes.manage`. Alinhar as
   chaves com `backend/.../permissions.constants.ts` onde houver correspondência.
2. **Unificar o gate de rota** (mecânico, isolado no router): trocar todo
   `allowedRoles` por `requirePermission` no `App.tsx`. Pra cada rota, conferir
   que o mapeamento role→permissão preserva o acesso atual EXATAMENTE (risco de
   regressão é aqui — fazer rota a rota, comparando antes/depois).
3. **Trocar os checks inline** `role === 'X'` por `usePermission('modulo.acao')`
   nas 9+ páginas. Um PR por página (ou em lotes pequenos), pra revisar regressão.
4. **Testes**: render-tests por papel (mesmo padrão de `pages/inbox` e `pages/fluxo`)
   assertando que cada UI gated aparece/some pro papel certo.

## Riscos / notas
- **Regressão de acesso** é o risco central — cada conversão precisa preservar o
  acesso exato. Mitigar com os render-tests por papel (passo 4) ANTES de mexer.
- D45/D46/D48 (backend): algumas decisões são `@Roles('ADMIN','DIRECTOR')` mais
  estritas que a matrix dinâmica. O front precisa refletir esse AND — não dá pra
  mapear tudo 1:1 pra `usePermission`; alguns gates seguem `useRole()` por design.
- Fazer os passos 1–2 primeiro fecha a duplicação mais perigosa (rotas) com baixo
  risco; o passo 3 (páginas) é maior e pode ir em ondas.
