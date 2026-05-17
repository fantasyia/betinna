# Admin — Operação cross-tenant

ADMIN é o **operador da plataforma Betinna.ai**, não da empresa-cliente. Suas funções são meta-administrativas e atravessam tenants.

## Quando usar ADMIN vs DIRECTOR

| Cenário | Quem |
|---|---|
| Criar nova empresa-cliente | **ADMIN** (setup multi-tenant) |
| Convidar primeiro DIRECTOR | ADMIN |
| Configurar OMIE de um tenant | **DIRECTOR** (operação normal); ADMIN só em suporte (D48) |
| Definir teto desconto de um rep | **DIRECTOR** |
| Fechar mês de comissões | **DIRECTOR** |
| Reativar tenant suspenso por inadimplência | **ADMIN** |
| Debugar erro de integração em prod | ADMIN (override D48 + audit log) |
| Gerenciar dead-letter queue | **ADMIN only** |
| Ver métricas globais (todos tenants somados) | **ADMIN only** (não implementado MVP) |

Regra mental: DIRECTOR = decisor do tenant; ADMIN = operador da plataforma SaaS.

## Funções exclusivas

### Criar empresa nova

`POST /empresas` — só ADMIN. Fluxo:

1. ADMIN em `/admin/empresas` clica "+ Nova empresa"
2. Preenche CNPJ, razão social, nome fantasia
3. Backend valida CNPJ (formato) + unicidade
4. Empresa criada com `ativa=true`
5. ADMIN convida DIRECTOR inicial via `POST /users/invite` (role=DIRECTOR, empresaIds=[novaEmpresa])

### Dead-letter queue (`/admin/dead-letter`)

Mensagens que falharam permanentemente em filas (BullMQ retry esgotou) ou processamento crítico.

- Lista por origem (queue name)
- Detalhes: payload, último erro, tentativas
- Ações: retry manual, descartar, exportar JSON

### Audit log global

`/admin/audit` mostra ações sensíveis de **todos os tenants** com filtros:
- Por user, por action, por resource, por período
- Útil pra investigar incidente de segurança ou compliance

### Permissões da matriz dinâmica

`/permissoes` (ADMIN + DIRECTOR) — customizar `DEFAULT_PERMISSIONS` por tenant.

Ex: empresa X quer que GERENTE também aprove comissão (não só DIRECTOR). ADMIN/DIRECTOR ajusta na matriz.

> Frontend `PERMISSION_MATRIX` hardcoded espelha defaults — drift entre os dois é tolerável (alguns reloads pra atualizar UI), gate real é backend.

## Permissões granulares (`PERMISSION_MATRIX`)

Módulos no enum atual (`permissions.constants.ts`):

```
clientes, produtos, pedidos, propostas, aprovacoes, catalogo,
comissoes, leads, ocorrencias, agenda, amostras, fluxos,
campanhas, fidelidade, mullerbot, inbox, integracoes,
relatorios, users, empresas, tags, marketplace_incidents
```

Cada um × Ações `view/create/edit/delete/approve/export` etc.

## ADMIN bypassa quase tudo, mas NÃO bypassa

- D45 (integrações empresa DIRECTOR-only) — ADMIN aceita por D48, mas log marca
- D46 (decisões financeiras) — idem
- Banimento por race condition: ADMIN não pula validações de schema/Zod
- Audit log: tudo que ADMIN faz fica registrado com `userRole='ADMIN'`

## Multi-tenant: trocar empresa ativa

ADMIN pode operar como se fosse de qualquer tenant via header `X-Empresa-Id`:

- UI: seletor de empresa no topo (combo box)
- Backend: `getCallerEmpresaId(user)` lê header → se ADMIN, aceita qualquer; outros papéis: só de `user.empresaIds`

## Fluxos típicos

### A. Onboarding de novo cliente

1. Comercial fecha contrato com nova empresa
2. ADMIN cria empresa em `/admin/empresas`
3. ADMIN cria DIRECTOR via `/users/invite`
4. DIRECTOR recebe magic link, configura senha
5. DIRECTOR conecta OMIE, define equipe, parte pra operação
6. ADMIN só volta se tiver suporte/debug

### B. Suporte — debug em prod

1. Cliente reporta "minha integração ML não funciona"
2. ADMIN troca pra empresa do cliente no seletor
3. Vai em `/integracoes` → vê ML com erro de refresh
4. Acessa logs (`/admin/logs?empresaId=X`) — vê 401 do ML após refresh
5. Identifica: refresh token expirado (>180d)
6. Reconecta OAuth pessoalmente (com permissão do cliente)
7. Audit log registra todas as ações

### C. Compliance — auditoria de aprovação

1. Cliente questiona "quem aprovou esse desconto absurdo?"
2. ADMIN em `/admin/audit?resource=aprovacao_desconto&resourceId=X`
3. Encontra: GERENTE Y aprovou, motivo "cliente VIP fechando recorrente"
4. Reporta de volta ao cliente

### D. Tenant inadimplente

1. Comercial avisa que cliente Z atrasou 3 mensalidades
2. ADMIN em `/admin/empresas/Z` clica "Desativar"
3. Backend marca `ativa=false` — users do tenant Z não conseguem mais logar
4. Dados ficam preservados (não apaga)
5. Quando paga: ADMIN reativa, tudo volta normal
