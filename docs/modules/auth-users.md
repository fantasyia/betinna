# Auth, Users, Empresas, Permissions, Audit

## Auth (Supabase + Cookie httpOnly D47)

**Fluxo de login:**

1. Usuário envia email/senha em `POST /api/v1/auth/login`
2. Backend chama Supabase Auth, recebe `access_token` (JWT) + `refresh_token`
3. Backend seta `refresh_token` em cookie httpOnly (path `/api/v1/auth`, SameSite=None em prod), retorna access ao frontend
4. Frontend guarda access em memória (não em localStorage) e usa em `Authorization: Bearer`
5. Próximo do exp (60s antes), `auth-store` chama `POST /auth/refresh` — cookie é trocado por novo par

**Por que isso?** XSS no frontend não consegue ler refresh token. Pre-D47 usava localStorage do Supabase SDK (vulnerável).

**Algoritmo JWT:** auto-detectado via `jose.decodeProtectedHeader` (HS256 / RS256 / ES256). Supabase moderno usa RS256.

## Papéis (UserRole)

| Role | Escopo | Casos de uso |
|---|---|---|
| **ADMIN** | Cross-tenant (plataforma) | Operador Betinna.ai. Cria empresas, suporta clientes, debug em prod, dead-letter queue. **Bypassa PermissionsGuard** mas NÃO bypassa D45/D46 (config + financeiro continuam DIRECTOR/ADMIN). |
| **DIRECTOR** | 1 tenant | Decisor da empresa-cliente. Total dentro do tenant: integrações, teto desconto, % comissão, fechar/pagar mês, dados fiscais. |
| **GERENTE** | Carteira dos REPs sob gerência | Gestão operacional sem config. Vê só REPs com `Usuario.gerenteId = self.id`. Pode aprovar descontos dos seus reps. |
| **SAC** | Atendimento | Inbox todos canais (marketplaces, IG, FB, WhatsApp empresa) + ocorrências. Sem acesso a pedidos/vendas. |
| **REP** | Própria carteira | Cria pedidos/propostas pros próprios clientes. **Inbox limitada ao WhatsApp pessoal**. |

### Hierarquia REP → GERENTE

`Usuario.gerenteId` (self-FK, nullable) aponta o REP pro GERENTE responsável. Se `null`, fica no catch-all do DIRECTOR.

Filtragem centralizada em `RepScopeService.getRepIds(user)`:
- `null` → sem restrição (ADMIN/DIRECTOR/SAC)
- `[user.id]` → REP (só ele)
- lista de subordinados → GERENTE

Aplicado em **todas** as listas de Clientes/Pedidos/Propostas/Aprovações/Leads/Comissões/Amostras/Ocorrências/Agenda.

### Anti-órfão ao desativar GERENTE

Quando `setStatus(INATIVO)` em um GERENTE, `users.service` faz `updateMany({ gerenteId }) → null` antes. Reps caem no catch-all do DIRECTOR — não ficam invisíveis.

## Users (CRUD)

### Endpoints chave

| Endpoint | Quem | O quê |
|---|---|---|
| `GET /users` | ADMIN/DIRECTOR/GERENTE | Listar (com filtro por role/status/gerenteId) |
| `POST /users/invite` | ADMIN/DIRECTOR | Cria user no Supabase Auth + manda magic link |
| `PATCH /users/:id` | ADMIN/DIRECTOR | Edita nome/role/empresaIds/gerenteId |
| `PUT /users/:id/teto-desconto` | **DIRECTOR only** | Define % máximo de desconto sem aprovação (D46) |
| `PUT /users/:id/comissao` | **DIRECTOR only** | Define % comissão padrão (D46) |
| `PATCH /users/:id/status` | ADMIN/DIRECTOR | ATIVO/INATIVO (gerente inativo libera REPs) |

### Convite via Supabase Auth

1. `POST /users/invite` cria registro local (status `INVITED`) + chama `supabase.auth.admin.inviteUserByEmail()`
2. Email com magic link enviado pelo Supabase
3. User clica, define senha, status vira `ATIVO`

## Empresas (multi-tenant)

Cada empresa tem `id`, `cnpj`, `razaoSocial`, `nomeFantasia`, `tabelaPreco`, `omieCodigoEmpresa`, etc.

- `Usuario.empresaIds[]` define a quais tenants o user tem acesso
- Header `X-Empresa-Id` define a empresa ATIVA da requisição (default: primeira de `empresaIds`)
- Tentativa de acessar empresa não vinculada → `403 TENANT_ACCESS_DENIED`

### Endpoints

| Endpoint | Quem | O quê |
|---|---|---|
| `POST /empresas` | **ADMIN only** | Criar nova empresa (setup multi-tenant) |
| `PATCH /empresas/:id` | **DIRECTOR/ADMIN (D46)** | Editar CNPJ/razão social/dados fiscais |
| `POST /empresas/:id/activate` | DIRECTOR/ADMIN | Reativar empresa pausada |
| `POST /empresas/:id/deactivate` | DIRECTOR/ADMIN | Suspender empresa (não apaga dados) |

## Permissions (matriz dinâmica)

Tabela `Permissao` (Role × Módulo × Ação) populada pelo seed com defaults. Pode ser customizada via UI `/permissoes` (ADMIN/DIRECTOR).

`PermissionsGuard` lê o decorator `@RequirePermissions({ module, action })` e checa contra a tabela. ADMIN bypassa.

**Layered:** quando endpoint tem `@Roles('DIRECTOR')` E `@RequirePermissions(...)`, AMBOS precisam passar (AND).

Frontend usa `usePermission('modulo.acao')` e `useRole()` pra esconder botões — espelha a regra mas o gate real é no backend.

## Audit

Interceptor automático via `@Audit({ action, resource, resourceIdFrom })`. Grava em `AuditLog`:
- `userId`, `userEmail`, `userRole`
- `action`, `resource`, `resourceId`
- `payload` (request body, com PII redacted), `result` (success/error)
- `ip`, `userAgent`, `timestamp`

Usado para rastrear: criação/edição de usuários, mudanças de teto/comissão, fechamento de comissões, edição de empresa, desativações, aprovações de desconto, ajustes manuais de pontos.

## Fluxos típicos

### A. Onboarding de tenant novo (1ª vez)

1. ADMIN: `POST /empresas` cria empresa
2. ADMIN: `POST /users/invite` cria DIRECTOR (`role=DIRECTOR`, `empresaIds=[novaEmpresa]`)
3. DIRECTOR recebe magic link, define senha, loga
4. DIRECTOR: conecta OMIE em `/integracoes` (cifrado AES-256-GCM)
5. DIRECTOR: roda sync OMIE → importa clientes + produtos
6. DIRECTOR: cria GERENTEs e REPs via `POST /users/invite`
7. DIRECTOR: define `tetoDesconto` + `comissaoPadrao` por user
8. REPs começam a operar

### B. REP esqueceu senha

1. REP em `/login` clica "Esqueci minha senha"
2. Frontend chama Supabase `resetPasswordForEmail()` → email com link
3. REP define nova senha → loga
