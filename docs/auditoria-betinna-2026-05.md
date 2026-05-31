# Auditoria Completa do betinna.ai

**Data de início:** 2026-05-31
**Última atualização:** 2026-05-31 (Entrega Final)

> Documento vivo. Cada fase é acrescentada aqui, sem apagar as anteriores.
> Linguagem simples — o dono não é técnico. **Auditoria = diagnóstico, não conserto.**
> Gravidades: 🚨 crítico · 🔴 alto · 🟡 médio · 🟢 baixo/ok

## Sumário

- [x] **Fase 1 — Saúde Técnica**
- [x] **Fase 2 — Segurança e Permissões**
- [x] **Fase 3 — Consistência Visual e Experiência**
- [x] **Fase 4 — Integridade das Integrações**
- [x] **Fase 5 — Módulo WhatsApp/Atendimento (análise de produto)**
- [x] **Fase 6 — Performance e Prontidão para Beta**
- [x] **Entrega Final — Relatório Consolidado + Lista Priorizada**

---

## Fase 1 — Saúde Técnica

**Como foi feita:** varredura do backend (NestJS), frontend (React) e banco (Prisma) — leitura real dos arquivos, `npm audit` nas duas pastas, suíte de testes do backend, e análise do schema/migrations. 4 frentes em paralelo: erros/exceptions, schema/banco, código morto e inconsistências de dados.

### 🟢 Saúde geral — o que está BEM
- **Backend: 1377 testes passando** (96 arquivos), `typecheck` limpo. Base sólida.
- **Frontend:** `typecheck` limpo. (Só tem testes E2E/Playwright — não há testes unitários.)
- **Multi-tenant bem isolado:** toda tabela de operação filtra por `empresaId` com índices compostos.
- **Migrations consistentes** com o schema — nada pendente, nenhuma "meio aplicada".
- **Git limpo**, tudo commitado e no `main`.

---

### 1. Inconsistências de dados (undefined / NaN / Infinity) — 🔴 prioridade

> É o que o Léo já viu em **Métricas**. A varredura achou o mesmo padrão em **vários lugares**.

**Causa raiz (uma só):** quando uma conta no backend não tem registros, ele devolve `null` (ex.: soma/média de vendas vazias). O frontend usa esse valor direto em `.toFixed()`/divisões, e aparece **`NaN%`**, **`undefined`** ou **`Infinity`** na tela.

| Onde | O que aparece de errado | Gravidade |
|---|---|---|
| **Dashboard** (`DashboardPage.tsx:219`) | `taxaConversao` sem proteção → `NaN%` | 🔴 |
| **Relatórios → Funil/Amostras/Campanhas** (`RelatoriosPage.tsx:309,319,874,905-908,949`) | taxas de conversão e cálculo "pendentes" → `NaN%` | 🔴 |
| **Detalhe do Cliente** (`ClienteDetailPage.tsx:1825`) | desconto `1 - preço/precoTabela` → **`Infinity`** se preço-tabela for 0 | 🔴 |
| **Metas** (`MetasPage.tsx:340-341`) | `progresso.toFixed()` se vier nulo | 🟡 |
| **Comissões** (`ComissoesPage.tsx:89,123,220`) | `fmtBRL`/`fmtPct` com valor nulo | 🟡 |
| **Funis** (`FunisPage.tsx:227,231`) | `etapas.length` / `_count` possivelmente nulos | 🟡 |
| **Backend agregações** (`relatorios.service.ts:333,395,400`) | `_sum`/`_avg` do Prisma retornam `null`, não `0` | 🟡 |

> ✅ **Já existe a solução pronta:** o componente de Campanhas tem uma função robusta (`fmtPct`) que trata nulo. Basta **padronizar** o uso dela (e devolver `?? 0` no backend). Conserto relativamente simples e de alto impacto visual.

---

### 2. Erros e exceptions / logs

**a) Logs de diagnóstico deixados no frontend (produção)** — 🟡
- `LoginPage.tsx` (8×), `lib/sentry.ts` (vários), `NotificationBell.tsx`, `main.tsx` — `console.log/info/warn/error` que sobraram de depurações (alguns marcados como "test"/"hotpatch"). Aparecem no console do navegador do usuário. Não expõem senha/token, mas **poluem e vazam detalhes internos** (URLs de API, status). Recomenda limpar.

**b) "Catch vazio" — erros engolidos sem aviso** — 🟡
- Vários `catch { }` sem registrar o erro: cache de relatórios (`relatorios.service.ts:85`), decriptação de credenciais (`integracoes.service.ts:260`), busca de empresa em dead-letter (campanhas e fluxos). **Não quebram o app** (são "melhor-esforço"), mas se algo falhar, ninguém fica sabendo. Recomenda ao menos **logar um aviso**.

**c) Resposta da IA sem validação** — 🟡
- `campanhas.service.ts:479` lê `choices[0]` sem checar se a IA retornou algo → pode **enviar mensagem vazia** numa campanha. Recomenda validar antes.

> ✅ Não foram encontrados endpoints quebrando com 500 de forma sistemática, nem SQL injection / bypass de auth nesta varredura. O foco aqui é **visibilidade** (logar) e **limpeza**.

---

### 3. Banco de dados — schema e índices

**a) Índices faltando (performance futura)**
- 🔴 **`Message.autorUsuarioId` sem índice** — quando o Inbox/SAC filtrar mensagens por atendente em volume, vai varrer a tabela inteira (lenta). É o mais importante.
- 🟡 `AprovacaoDesconto.representanteId` e `OcorrenciaComentario.autorId` sem índice — impacto menor (volume baixo), mas recomendável.

**b) Valores monetários como `Float` (não `Decimal`)** — 🟡/🔴
- Preços, totais, descontos e comissões (`Produto`, `Pedido`, `Proposta`, `Comissao`) usam **número quebrado (Float)**, que pode acumular **erro de centavos** em pedidos grandes. Como você integra com **OMIE (fiscal)**, exatidão importa. Curiosamente, **Metas e Fidelidade já usam Decimal** (o certo) — há uma inconsistência.
- ⚠️ Trocar Float→Decimal é uma mudança de banco (migration) e **não deve ser feita agora sem planejamento**. Fica anotado pra uma fase própria.

**c) Colunas "mortas"** — 🟡
- `Usuario.regiao` e `Produto.popularidade` são preenchidas (seed) mas **nunca lidas** em nenhuma tela/filtro. Ocupam espaço, sem uso.

---

### 4. Código morto (sobras de features removidas)

**a) Tabelas órfãs no banco (features removidas, mas o schema ficou)** — 🔴
- **Fidelidade** (4 tabelas: Programa/Recompensa/Saldo/Movimento) — removida do projeto em 21/05 (passou pro ERP). Tabelas existem, **vazias e sem nenhum código usando**.
- **Formulários** (3 tabelas: Formulario/Campo/Resposta) — feature removida. Mesmo caso.
- **Marketplace legado** (`MarketplaceMsg`, `MarketplaceOrder`) — substituídos por `Conversation`/`Message`. Abandonados.
- ➡️ Não quebram nada (servem de "histórico"), mas é **ruído** que confunde. Limpeza recomendada quando for mexer no schema.

**b) Restos no frontend** — 🟡
- `LeadsPage.tsx` ainda tem o canal **"Formulário"** no dropdown (nunca mais é criado).
- Comentário de exemplo citando uma `FidelidadePage` que não existe.

**c) Matriz de permissões** — 🟡 (esclarecimento)
- Os "módulos" `reps` e `audit_log` aparecem na matriz mas **não têm controller** (são implementados de outra forma — usuários e decorator de auditoria). É ruído, não bug.
- ✅ **Correção de uma anotação antiga:** `metas` **NÃO é código morto** — está totalmente implementado (CRUD completo). O `CLAUDE.md` (D49) o listava como dead-code por engano.

**d) Mantido de propósito (não é lixo)** — 🟢
- Rota pública de **NPS** (`/n/:slug`) — tirada do menu mas mantida pra clientes responderem pesquisa por link. OK.

---

### 5. Dependências (vulnerabilidades)

| Pasta | Vulnerabilidades | Detalhe |
|---|---|---|
| **Backend** | 3 moderadas | `qs` (DoS) + `uuid` (via `exceljs`) |
| **Frontend** | 2 moderadas + **1 alta** | `tmp` + `uuid` (via `exceljs`) |

- As simples saem com `npm audit fix`. As de `uuid`/`exceljs` exigem `--force` (mudança que pode quebrar a exportação de planilha — testar antes).
- ⚠️ Mexer em dependências é da sua lista de "pergunte antes". Fica anotado pra fazermos com cuidado depois.

---

### 6. Logs de erro do Railway — ⚠️ não verificável por aqui
- **Não tenho acesso aos logs de produção do Railway** (são no painel da Railway). Recomendo: como o **Sentry já está configurado**, o melhor é olhar o painel do Sentry pra ver os erros reais que acontecem em produção (com os usuários). Se quiser, numa próxima sessão a gente revisa juntos o que o Sentry está capturando.

---

### Resumo da Fase 1 — o que tratar primeiro

| Prioridade | Item | Esforço |
|---|---|---|
| 🔴 1 | **NaN/undefined em Métricas/Relatórios/Dashboard** (padronizar formatação + `?? 0`) | Baixo, alto impacto |
| 🔴 2 | **Índice em `Message.autorUsuarioId`** (Inbox SAC em escala) | Baixo (1 migration) |
| 🟡 3 | **Limpar `console.log` do frontend** + logar nos `catch` vazios | Baixo |
| 🟡 4 | **Validar resposta da IA** em campanhas (mensagem vazia) | Baixo |
| 🟡 5 | **Limpeza de código/tabelas mortas** (Fidelidade/Formulários/Marketplace legado) | Médio (mexe em schema → planejar) |
| 🟡 6 | **Float → Decimal** em valores monetários (fiscal/OMIE) | Alto (migração + auditoria) → fase própria |
| 🟡 7 | **Dependências** (`npm audit fix`) | Baixo (mas testar exceljs) |

> Nada disso está **quebrando** o app agora (1377 testes passam). São melhorias de robustez, performance e limpeza pra deixar redondo pro beta.

---

## Fase 2 — Segurança e Permissões

**Como foi feita:** 4 frentes em paralelo (autorização/RBAC, isolamento multi-tenant/IDOR, segredos/criptografia/exposição de dados, validação/injeção/webhooks) + checagens diretas (SQL cru, XSS, endpoints abertos). **Importante:** todo achado "grave" foi **verificado lendo o código real** antes de reportar (uma varredura automática apontou um "vazamento entre empresas" que, ao conferir, se mostrou FALSO — detalhe abaixo).

### 🟢 Resultado geral: SEGURANÇA SÓLIDA
**Nenhuma vulnerabilidade crítica real encontrada.** A base de segurança está bem feita. Só há itens de robustez ("defesa em profundidade") pra reforçar.

### ⚠️ Correção importante de um falso alarme (transparência)
A análise automática apontou **"IDOR crítico — vazamento de dados entre empresas"** em 7 módulos (leads, ocorrências, amostras, agenda, tags, inbox, produtos). **Eu fui no código conferir um por um e NÃO procede.** Todos esses módulos **validam a empresa ANTES** de qualquer leitura/escrita (via `findById`/`baseWhere` com filtro de empresa): um ID de outra empresa estoura "não encontrado" imediatamente. Ou seja, **um usuário NÃO consegue ver/editar dado de outra empresa** sabendo o ID. O alarme era falso. (Fica como 🟡 "padrão frágil", explicado abaixo.)

### O que está BEM (✅)
- **Multi-tenant isolado de verdade:** toda operação por ID valida a empresa do usuário antes. REP só vê a própria carteira (RepScopeService). ADMIN cross-tenant é proposital (D48).
- **Autorização/RBAC coerente:** endpoints sensíveis protegidos por cargo; financeiro/fiscal e integrações exigem ADMIN/DIRECTOR (D45/D46); nenhuma escrita "aberta" indevida.
- **Endpoints públicos legítimos:** OAuth, webhooks, login/health — e os links públicos (aceite de proposta, catálogo compartilhado, NPS) são **protegidos por token JWT forte + rate-limit**, não por ID adivinhável.
- **Criptografia forte:** credenciais de integração (OMIE/marketplaces/WhatsApp/Google) cifradas em **AES-256-GCM**, com ponto único de decifragem. Nada salvo em texto puro.
- **Sem segredos vazando:** nada sensível no frontend (`VITE_*` só tem URLs/chave pública), sem segredo hardcoded, sem `passwordHash` exposto (autenticação é do Supabase).
- **Logs/erros limpos:** PII (e-mail/CPF/telefone/token) é redatada nos logs e no Sentry; em produção o erro é genérico (não vaza stack/query).
- **Cookies/sessão (D47):** refresh token em cookie `httpOnly + secure + sameSite` correto; access token só em memória.
- **Webhooks blindados:** todos validam assinatura HMAC + anti-replay (o do Mercado Livre, que não tem HMAC, usa lista de IPs).
- **Sem SQL injection:** os 3 usos de SQL cru são internos/fixos; o `TRUNCATE` (limpeza) tem trava que impede rodar em produção.
- **Upload de arquivos:** valida tamanho + tipo (MIME) + nome seguro (anti path-traversal).
- **Hardening:** rate-limit no login (anti força-bruta) e no bot; CORS por lista; Helmet ativo; proteção contra SSRF (inclusive DNS rebinding) nos webhooks de fluxo.
- **Sem XSS:** nenhum `dangerouslySetInnerHTML`/`eval` no frontend.

### Itens de robustez a reforçar (🟡 — não urgente, bom pro beta)
| # | Item | Por quê | Gravidade |
|---|---|---|---|
| 1 | **Re-leitura sem filtro de empresa** após update (`findUniqueOrThrow({ where: { id } })`) em leads/ocorrências/amostras/agenda/tags/inbox/produtos | Hoje é **seguro** (a empresa é validada antes). Mas é frágil: se alguém remover a validação no futuro, vira vazamento. Reforço: usar `findFirstOrThrow({ where: { id, empresaId } })`. | 🟡 defesa em profundidade |
| 2 | **`@UsePipes` no método** em metas/nps/segmentos | Era a causa do bug de hoje (corrompia o usuário logado → "Empresa não definida"). **Já corrigi na raiz** (o validador agora ignora o usuário). Mover o validador pro `@Body` nesses 3 controllers é só limpeza. | 🟡 já mitigado |
| 3 | **`/metrics` público** (Prometheus) | Métricas operacionais acessíveis sem login. Sem PII, mas o ideal é **restringir por IP** no Railway/infra. | 🟡 |
| 4 | **Callbacks OAuth** (Google/Meta/ML/Shopee/TikTok/Amazon) | Usam `state` JWT (proteção CSRF, D14). A varredura não validou cada um empiricamente — padrão documentado, baixa prioridade conferir. | 🟢 |

### Resumo da Fase 2

| Categoria | Veredito |
|---|---|
| Isolamento entre empresas (multi-tenant) | ✅ Sólido (o "IDOR crítico" era falso alarme — verificado) |
| Autorização / cargos (RBAC) | ✅ Coerente com as regras (D45/D46/D48) |
| Segredos / criptografia / exposição | ✅ Muito bom |
| Webhooks / injeção / upload / rate-limit / CORS / SSRF | ✅ Blindado |
| Itens de robustez (defesa em profundidade) | 🟡 4 itens, nenhum urgente |

> **Conclusão:** a segurança do app está **pronta pro beta** do ponto de vista de furos reais. Os 🟡 são reforços recomendados (principalmente o #1, padronizar a re-leitura com filtro de empresa) — fáceis e baratos, valem fazer antes de escalar.

---

## Fase 3 — Consistência Visual e Experiência

**Como foi feita:** 4 frentes em paralelo: brandbook/tokens, textos/ortografia/UX, consistência de componentes/estados, responsividade mobile.

### 🟢 O que está BEM
- **Tokens sincronizados:** cores, fontes e border-radius estão iguais nos 3 arquivos obrigatórios (`styles.ts`, `index.css`, `tailwind.config.ts`). ✅
- **Fontes corretas:** Cabin (UI), Fira Sans (display), Fira Mono (mono) em todo lugar. Sem Inter/system-ui. ✅
- **Componentes UI do design system** (Button, Card, Badge, Dialog, Drawer, Input, Spinner) — todos usam CSS vars, cores semânticas, radius correto. ✅
- **Estados de loading/erro/vazio** bem tratados via `StateView` em todas as páginas principais. Sem telas em branco. ✅
- **Modais consistentes:** fecham com X e ESC, nunca com clique no fundo (prevenção de perda acidental de dados). ✅
- **Ações destrutivas protegidas** por confirmação em todos os lugares verificados (deletar cliente, amostra, meta, funil, catálogo). ✅
- **Feedback de toast** (sucesso/erro) em operações — padrão seguido em toda a app. ✅
- **Paginação** presente em todas as listas longas com indicador de total. ✅
- **Sem links quebrados:** rotas declaradas no App.tsx apontam para páginas que existem; features removidas (Fidelidade/Formulários) não têm mais rota. ✅
- **Sem erros técnicos crus** ("Cannot read property of undefined", stack trace) aparecendo na tela. ✅

---

### 1. Cores hardcoded fora do design system — 🔴

O maior problema visual da Fase 3. Várias páginas usam cores do Tailwind padrão (não da Betinna) diretamente, o que faz botões/badges/gráficos aparecerem em cores erradas — azul Tailwind (`#0891b2`) e violeta Tailwind (`#7c3aed`) em vez das cores oficiais.

| Página | Detalhe | Gravidade |
|---|---|---|
| **CampanhasPage.tsx** (~10 ocorrências) | `#0891b2`, `#7c3aed`, `#22c55e` em `STATUS_COLOR`, `CANAL_COLOR`, `StatBox` | 🔴 Visível na tela |
| **AdminPage.tsx** (múltiplas) | `#0891b2`, `#7c3aed`, `#d97706` em mapas de status/badges | 🔴 |
| **AgendaPage.tsx** | `#2563eb`, `#0891b2`, `#7c3aed` nos tipos de evento (Visita/Ligação/Reunião) | 🔴 |
| **AmostrasPage.tsx** | `#0891b2` no status ENVIADA | 🔴 |
| **AsyncCombobox.tsx** | sombra `rgba(0,0,0,0.08)` hardcoded | 🟡 |

> **O que usar no lugar:** `colors.info` (que aponta pra `#2bcae5` — o cyan oficial), `colors.magenta`, `colors.secondary`. Para tipos de evento/status, criar um mapa usando tokens do design system.

---

### 2. Border-radius 8px — padrão Betinna é 10px — 🟡

Alguns componentes e páginas ainda usam `borderRadius: 8` em vez do padrão `radius.lg` (10px). Diferença pequena visualmente, mas quebra a consistência.

Locais: `Modal.tsx:69`, `NotificationBell.tsx`, `charts.tsx:76`, `CampanhasPage.tsx` (4 ocorrências), `WhatsAppPage.tsx` (6 ocorrências), `PropostaAceitePage.tsx`.

---

### 3. Inconsistência de linguagem — 🟡

| O que é | Variações encontradas | Deve ser |
|---|---|---|
| Representante | `'sem rep'`, `'Remover rep'`, `'Remover atribuição (deixar sem rep)'` em ClientesPage + LeadsPage | `'Sem representante'`, `'Remover representante'` |
| Campo vazio | `'não informado'` (minúsculo) em ClientesPage:1011 | `'Não informado'` |
| Erro genérico | `'Erro desconhecido'` em AgendaPage:170, AdminPage:556/585, LoginPage:162 | Mensagem contextual ("Não foi possível mover o compromisso. Tente novamente.") |

---

### 4. Responsividade / Mobile — 🔴🟡

O app é um PWA usado por representantes em campo (mobile). Problemas encontrados:

| Problema | Arquivo | Gravidade |
|---|---|---|
| **FluxoEditor** — layout 3 colunas com `w-[240px]` + `w-[300px]` fixas; em tela de 375px: tela negativa, layout quebrado | `FluxoEditor.tsx:645,742` | 🔴 Inutilizável em mobile |
| **PedidosPage** — inputs de data com `w-[150px]` fixo em filtro horizontal | `PedidosPage.tsx:472,484` | 🔴 |
| **Botões/inputs abaixo de 44px** (tamanho mínimo WCAG para dedos) — Button sm=28px, md=32px; Input=32px; Checkbox=16px | `Button.tsx`, `Input.tsx`, `Checkbox.tsx` | 🟡 Dificulta uso |
| **Texto 10-11px** em headers de tabela e legendas | `PedidosPage.tsx`, `styles.ts` | 🟡 Ilegível sem zoom |
| **Dropdown menus** (`ExportMenu` etc.) sem responsividade — podem sair da tela | `PedidosPage.tsx:861` | 🟡 |

> ✅ **Infraestrutura pronta:** o app já tem hook `useIsMobile()` e breakpoint 768px configurado — falta aplicar nos componentes com problema.

---

### Resumo da Fase 3

| Categoria | Veredito |
|---|---|
| Tokens brandbook (sincronização) | ✅ Sincronizados nos 3 arquivos |
| Fontes | ✅ Corretas em todo lugar |
| Cores hardcoded fora do sistema | 🔴 ~20 ocorrências em 4 páginas |
| Border-radius 8px | 🟡 ~12 ocorrências |
| Linguagem/textos | 🟡 Inconsistência "rep" vs "representante", erros genéricos |
| Estados UI (loading/erro/vazio) | ✅ Consistente |
| Modais / confirmações / feedback | ✅ Consistente |
| Responsividade mobile | 🔴 FluxoEditor + PedidosPage; 🟡 touch targets |

**Prioridade de correção:**
1. 🔴 Cores hardcoded em CampanhasPage/AdminPage/AgendaPage (impacto visual imediato, conserto simples)
2. 🔴 FluxoEditor mobile (inutilizável pra rep em campo)
3. 🟡 Touch targets (botões/inputs), mensagens genéricas "Erro desconhecido", "sem rep"
4. 🟢 Border-radius 8px, dropdown mobile

---

## Fase 4 — Integridade das Integrações

**Como foi feita:** 4 frentes em paralelo (OMIE/ERP, marketplaces, WhatsApp+Meta+MullerBot, e-mail+Google+OpenAI+resiliência geral). **Achados graves foram verificados no código real** antes de reportar — alguns que a análise automática marcou como "crítico/trava o app" se mostraram exagerados (detalhe abaixo).

### 🟢 O que está BEM (a base de integração é bem feita)
- **Renovação de token (OAuth):** todos os marketplaces (ML/Shopee/Amazon/TikTok) renovam o token **antes de expirar** (margem de 60s). ✅
- **Retry/timeout consistente:** cliente HTTP compartilhado com timeout de 30s + retry com backoff (3 tentativas) em 429/5xx/rede. Usado por todas as integrações. ✅
- **Idempotência:** mensagens/incidentes não duplicam (chave `externalId` por empresa/canal). ✅
- **Isolamento de falha:** os crons (10min) tratam erro por empresa — uma empresa com problema não derruba as outras. E uma integração externa fora do ar **não derruba o app** (degrada). ✅
- **WhatsApp:** reconexão automática com backoff (máx 10 tentativas); auth cifrado restaura no boot; mídia que falha o download vira placeholder sem perder a mensagem. ✅
- **MullerBot:** trata falha da OpenAI (timeout 15s + fallback + escala pra humano); limite de tokens com truncagem do catálogo (sem custo descontrolado). ✅
- **Fiscal (amostras):** CFOP 5911/6911 e regra mesma-UF vs interestadual estão **corretos**. ✅

### ⚠️ Reframe de exageros da análise automática (transparência)
A varredura marcou como "🔴 CRÍTICO: trava a operação" o envio de pedido ao OMIE e o envio de proposta por e-mail. **Conferi e não é bem assim:**
- **Enviar pedido ao OMIE** que falha → mostra erro e o pedido NÃO fica marcado como enviado. Isso é **comportamento correto** (a ação É "enviar ao OMIE"; falhar alto é o certo), não um travamento.
- **E-mail** (convite/proposta/aprovação) é **best-effort** (loga e segue, não estoura) — confirmado no `TransactionalEmailService`. O risco real não é "travar", é o e-mail **não sair sem aviso claro** (item 3 abaixo).

### Achados reais a tratar

| # | Item | Gravidade | Detalhe |
|---|---|---|---|
| 1 | **Integração que cai não avisa o usuário** | 🔴 | Quando um token de marketplace expira, o WhatsApp é deslogado/banido, ou o token do Meta vence, a integração **para de funcionar em silêncio** — o status fica só no painel de integrações, sem alerta. O operador só descobre quando percebe que parou de receber mensagens (horas depois). É o achado mais recorrente. **Recomendação:** marcar "⚠ Reconectar" em vermelho no painel + (ideal) e-mail ao DIRECTOR. |
| 2 | **OMIE em modo demo em produção** | 🔴 | `OMIE_DEMO_MODE=true` é o padrão e **só gera warning** (não aborta) em produção. Se esquecer de trocar pra `false` ao plugar o OMIE real, os pedidos **parecem enviados** (recebem número fake e status "ENVIADO_OMIE") mas **não chegam ao ERP**. Risco comercial/fiscal no go-live. **Recomendação:** ao plugar OMIE real, garantir `OMIE_DEMO_MODE=false` (idealmente abortar boot se demo em prod). |
| 3 | **E-mail: 2 provedores + convite pode não sair** | 🟡 | Existem SendGrid **e** Resend. O envio prefere Resend, cai pro SendGrid. Se **nenhum** estiver configurado (ou mal configurado — ex.: `RESEND_API_KEY` sem `RESEND_FROM_EMAIL`), o e-mail (convite de usuário, proposta) **não sai** e o aviso é fraco (só log). Já sabíamos disso (aguarda `RESEND_API_KEY` no Railway). **Recomendação:** configurar 1 provedor e validar; deixar claro na tela se o convite não foi enviado. |
| 4 | **Meta (FB/IG): token sem renovação automática** | 🟡→🔴 | A análise indica que o token de página do Facebook/Instagram **expira (~60 dias) e não é renovado automaticamente** — depois disso, FB/IG ficam desconectados sem aviso. Vale **confirmar e implementar refresh** antes de depender de FB/IG a longo prazo. (Marketplaces e WhatsApp já renovam; o Meta é a exceção.) |
| 5 | **TikTok: reembolso falhado aparece como "Resolvido"** | 🟡 | Confirmado no código: status `REFUND_FAIL` é mapeado para `RESOLVIDO`. Um reembolso que **falhou** some das pendências como se estivesse resolvido. **Recomendação:** mapear pra um status que peça atenção. |
| 6 | **OMIE: preço por heurística (70%)** | 🟡 | O preço de fábrica é **estimado** (70% do preço de tabela), não lido da tabela real do OMIE (TODO no código). Risco de **margem/lucro calculados errados**. Limitação de MVP documentada — resolver quando plugar o OMIE real com tabelas. |
| 7 | **OMIE: pedido sem transação/idempotência forte** | 🟡 | Em caso de timeout (OMIE criou o pedido mas a resposta HTTP se perdeu), um reenvio **poderia duplicar** no ERP. Cenário raro, mas vale validar antes de volume real (usar `codigo_pedido_integracao` como chave + checar antes de reenviar). |

### Resumo da Fase 4

| Categoria | Veredito |
|---|---|
| Renovação de token / retry / timeout / idempotência | ✅ Sólido na maioria (Meta é a exceção — item 4) |
| Isolamento de falha (app degrada, não cai) | ✅ Bom (exceto Redis, acoplado ao boot) |
| Aviso ao usuário quando integração cai | 🔴 Faltando (item 1 — o mais importante) |
| OMIE — go-live (demo mode + preço + idempotência) | 🔴🟡 Cuidados antes de plugar o ERP real |
| E-mail (provedor único + feedback de convite) | 🟡 Resolver config |
| TikTok status de reembolso | 🟡 Corrigir mapeamento |

> **Conclusão:** as integrações estão **bem construídas na engenharia** (renovação de token, retry, idempotência, degradação graciosa). Os pontos a tratar são mais de **operação/visibilidade** (avisar quando algo cai) e **preparação pro go-live do OMIE** do que bugs no código. O item #1 (aviso de desconexão) é o que mais agrega valor pro beta.

---

## Fase 5 — Módulo WhatsApp/Atendimento (análise de PRODUTO)

**Como foi feita:** análise de produto/UX (não caça-bug) do atendimento — inbox unificada, bot Muller e multicanal — sob a ótica de "um atendente/dono usando isso o dia todo". 3 frentes.

### Veredito geral
A **base do atendimento é boa e funciona** (recebe, responde, atribui, manda mídia/áudio, SLA nas ocorrências, handoff do bot). Mas, comparado a uma ferramenta de SAC madura, **faltam recursos de produtividade e clareza** que vão aparecer já no primeiro mês de uso real. E o **bot, hoje, entrega pouco** (por escolha sua — está em "puro conversa", sem catálogo).

---

### A) A Inbox / SAC como ferramenta de trabalho

**✅ O que está bom:** lista com não-lidas, ordenação (precisa-humano sobe), busca por nome/telefone, filtros por canal/status/atribuição, atribuir conversa, enviar texto/imagem/áudio (até gravar voz), marcar resolvido/arquivar, e ocorrências com SLA colorido + timeline.

**❌ Lacunas que vão incomodar no dia a dia:**
| # | Falta | Gravidade | Por quê |
|---|---|---|---|
| 1 | **Respostas rápidas / templates** | 🔴 | O atendente digita "deixa eu verificar", "obrigado por procurar", etc. **dezenas de vezes por dia**. É a #1 reclamação de quem usa SAC sem isso. |
| 2 | **Aviso ativo de mensagem nova** (som/toast) | 🔴 | Hoje a lista atualiza sozinha a cada 4s, mas **nada chama a atenção**. Mensagem pode ficar parada sem ninguém ver. |
| 3 | **Dois atendentes na mesma conversa** (sem trava) | 🔴 | Nada impede 2 pessoas responderem o mesmo cliente ao mesmo tempo. Sem indicador "fulano está atendendo". |
| 4 | **SLA/urgência não aparece na Inbox** | 🟡 | Conversa parada há 6h aparece igual a uma recente. Sem "está te esperando há X". (As Ocorrências têm SLA; a Inbox não.) |
| 5 | **Tags e notas internas** | 🟡 | Não dá pra marcar "aguardando documento" nem deixar recado interno ("cliente quer desconto, ver com gerência"). |
| 6 | **KPIs de atendimento** | 🟡 | Sem "tempo médio de 1ª resposta", "% resolvido pelo bot" — métricas básicas de SAC. |

> ⚠️ É **tempo real por polling de 4s**, não WebSocket — aceitável pro começo, mas dá uma leve sensação de atraso.

---

### B) O bot Muller como produto

**Importante:** isso reflete a SUA escolha de manter o bot em **"puro conversa"** (sem catálogo) por enquanto. Então não é "defeito" — é o estágio atual. Mas vale registrar pro go-live:

| # | Ponto | Gravidade | Detalhe |
|---|---|---|---|
| 1 | **Valor limitado sem catálogo** | 🔴 | Hoje o bot só "conversa" com base no seu prompt. Se o cliente pergunta preço/produto, ele **não sabe** (e se o prompt mandar "consulte o catálogo", ele não tem o catálogo). O valor real só aparece quando ligar o **RAG** (gancho pronto, é um flag) com o catálogo do OMIE. |
| 2 | **Sem registro/auditoria das respostas do bot** | 🔴 | Você **não consegue ver facilmente** tudo que o bot respondeu (só está no banco). Se ele falar algo errado, você só descobre quando o cliente reclamar. Risco operacional. |
| 3 | **Sem horário de atendimento** | 🟡 | O bot responde 24/7. Fora do horário comercial, cria expectativa de que tem alguém. |
| 4 | **Sem saudação inicial / encerramento / "não entendi"** | 🟡 | Recursos básicos de um bot decente (cumprimentar, fechar com elegância, limite de tentativas) não existem. |
| 5 | **Sem preview/teste do prompt** | 🟡 | Você edita o prompt "no escuro" — não dá pra simular uma conversa e ver como o bot responderia **antes** de soltar pros clientes. (Tem o "Testar agora", mas ele só testa a conexão, não a conversa.) |
| 6 | **Sem teto de custo** | 🟡 | Não há limite de gasto diário com a OpenAI — em bug/abuso, o custo pode disparar. |
| ✅ | **Handoff (bot → humano)** | 🟢 | **Muito bem feito**: quando o humano responde, o bot pausa sozinho; tags 🤖/⏸/🚨 deixam claro o que é do bot. |

---

### C) Coerência multicanal (WhatsApp + marketplaces + redes)

| # | Ponto | Gravidade | Detalhe |
|---|---|---|---|
| 1 | **Cada marketplace tem regra diferente — e o atendente não é avisado** | 🔴 | Amazon **não tem chat livre**, TikTok **bloqueia responder texto**, Shopee deixa no chat mas **não em devolução**. O atendente vai tentar responder e **falhar sem entender por quê**. Falta um aviso claro na tela ("este canal não aceita resposta livre"). É o achado de produto mais importante do multicanal. |
| 2 | **WhatsApp empresa vs pessoal do rep não é claro na Inbox** | 🟡 | A tela de conexão separa bem, mas dentro da conversa **não fica claro** de qual número (empresa ou pessoal) aquela conversa veio. |
| 3 | **Status de entrega/leitura inconsistente** | 🟡 | WhatsApp/Meta mostram; marketplaces não expõem. O atendente não sabe se a mensagem foi entregue. |
| ✅ | **Identidade do contato** | 🟢 | Nome, telefone (já corrigimos o número oculto/LID), avatar, vínculo com cliente cadastrado — está bom. |
| ✅ | **Conexão WhatsApp (QR) + reconexão** | 🟢 | Fluxo claro, reconexão automática (já corrigimos o QR). |
| ✅ | **Marketplaces como atendimento** | 🟢 | Modelo unificado de incidentes (devolução/disputa) com SLA colorido — bem estruturado. |

---

### Resumo da Fase 5 — prioridades de PRODUTO

| Prioridade | Item | Onde |
|---|---|---|
| 🔴 1 | **Respostas rápidas / templates** | Inbox — maior ganho de produtividade |
| 🔴 2 | **Avisar quais marketplaces não aceitam resposta livre** (Amazon/TikTok/Shopee-devolução) | Inbox/Incidentes |
| 🔴 3 | **Aviso ativo de mensagem nova** (som/notificação) | Inbox |
| 🔴 4 | **Auditoria das respostas do bot** + **teto de custo** | Bot Muller (pré-produção) |
| 🟡 5 | **Trava de 2 atendentes na mesma conversa** | Inbox |
| 🟡 6 | **Horário de atendimento + saudação** no bot | Bot Muller |
| 🟡 7 | **SLA visível na Inbox**, tags/notas internas, KPIs | Inbox |
| 🟢 | Ligar o **catálogo (RAG)** no bot quando quiser — é o que destrava o valor real dele | Bot Muller |

> **Conclusão:** o atendimento **funciona e tem boa fundação**, mas pra ser uma ferramenta de SAC que o time usa o dia todo sem frustração, os itens 🔴 (templates, aviso de mensagem, clareza dos canais, auditoria do bot) valem muito. O bot, especificamente, **ganha vida quando você ligar o catálogo** — antes disso, ele é mais "simpático" do que "útil".

---

## Fase 6 — Performance e Prontidão para Beta

**Como foi feita:** análise de performance (backend Prisma/queries/jobs, frontend bundle/render) e de **prontidão operacional** ("se subir amanhã pra clientes reais, o que pode dar errado e a gente nem fica sabendo?"). 3 frentes em paralelo. Achados-chave verificados no código real.

### Veredito geral
**Tecnicamente, está pronto pra aguentar um beta.** A engenharia é boa: queries paginadas, índices nos lugares certos, jobs com retry/lock, cache de relatórios, logging estruturado, health checks, validação de configuração no boot. **Não há gargalo crítico de performance pro volume de um beta** (poucas empresas, dezenas de usuários, milhares de mensagens).

Os riscos reais **não são de velocidade — são de operação**: backup não roda sozinho, e quando algo cai (WhatsApp, fila, IA) você só descobre quando o cliente reclama. São esses que valem resolver antes de abrir pra clientes.

---

### A) Performance do backend (queries, índices, jobs)

**✅ O que está muito bom:**
- **Paginação em 100% das listagens** (clientes, pedidos, leads, inbox, ocorrências…) — limite máximo travado (100/200 itens). Nada "traz tudo".
- **Índices certos** nas tabelas que crescem: `empresaId` em tudo, e compostos como `[empresaId, criadoEm]`, `[empresaId, status]`, SLA de ocorrências. Mensagens usam paginação por cursor (aguenta conversa com 10 mil mensagens).
- **Jobs (BullMQ) bem feitos:** retry com backoff, locks no Redis pra não rodar duplicado, dead-letter pra falhas, sync de marketplace a cada 10min como rede de segurança.
- **Cache de relatórios** (Redis, 60s) — alivia as telas mais pesadas.
- **Nenhum N+1** (aquele padrão que multiplica consultas) encontrado.

**🟡 Pontos de atenção (não urgentes — aparecem só quando o volume crescer):**
| # | Ponto | Gravidade | Quando vira problema |
|---|---|---|---|
| 1 | Busca de produtos do bot carrega **todos os produtos na memória** | 🟡 | OK até ~500 produtos. Acima disso, migrar pra busca vetorial (o código já está preparado pra trocar). |
| 2 | Faltam 2 índices: `Amostra.followUpEm` e `Cliente.ultimoPedidoEm` | 🟡 | O robô de follow-up/inatividade vai ficar lento quando passar de ~5 mil clientes/amostras por empresa. |

> Resumo: **zero ação urgente** no backend. Os 2 índices são "anote pra daqui 1-2 meses".

---

### B) Performance do frontend (carregamento, telas, listas)

**✅ O que está bom:**
- **Carregamento por partes** (lazy loading) — cada tela baixa só o seu pedaço; as libs pesadas de exportar Excel/PDF só carregam quando precisa. Abertura rápida.
- **Estados de carregando/erro/vazio bem tratados** — tem "tela de erro com botão tentar de novo" em toda rota, mensagens de "nenhum registro", e o app **não fica em branco** quando algo falha.
- **Responsivo + PWA** (instala no celular, funciona offline pros assets).

**🟡 Pontos de atenção:**
| # | Ponto | Gravidade | Detalhe |
|---|---|---|---|
| 1 | **Listas longas sem "virtualização"** | 🟡 | Inbox, Kanban de leads e threads de mensagem renderizam todos os itens de uma vez. Com 40-50 itens tá ok; **acima de ~100** pode travar/engasgar, principalmente em celular mais fraco. |
| 2 | **Inbox atualiza por "polling" a cada 4s** | 🟡 | Funciona (já registrado na Fase 5), mas não é tempo real de verdade — gera bastante requisição e force re-render. Aceitável no beta; WebSocket fica pra depois. |
| 3 | Libs de exportação (Excel/PDF) recarregam por página | 🟡 | Pequeno desperdício de banda em quem abre várias telas. Não trava nada. |

> Resumo: **frontend está beta-ready.** O único que vale testar antes: abrir a Inbox/Kanban com **100+ itens** e ver se engasga no celular.

---

### C) Prontidão operacional (o que pode quebrar sem a gente saber)

Aqui estão os achados que **realmente importam pro go-live** — não são bugs, são "rede de segurança":

| # | Ponto | Gravidade | Por quê importa |
|---|---|---|---|
| 1 | **Backup do banco NÃO roda sozinho** | 🔴 | O script de backup existe, mas **nenhum agendamento o chama** — é manual. Se o banco for apagado/corromper, **não há recuperação automática**. É o achado mais importante da fase. Precisa virar um cron diário + testar a restauração **antes** de entrar cliente. *(verificado: `backend/scripts/backup-to-storage.ts` existe, sem `@Cron`.)* |
| 2 | **Você não é avisado quando algo cai** | 🔴 | Se o WhatsApp desconectar sozinho (a Meta faz isso), a fila travar ou a OpenAI sair do ar, **ninguém é alertado** — você só descobre quando o cliente reclama. Falta um aviso/painel de status. (Conecta com o item #1 da Fase 4.) |
| 3 | **Sentry (captura de erros) vem desligado** | 🟡 | O sistema de relatório de erros está pronto, mas precisa **ligar a chave (SENTRY_DSN) no Railway** — senão, erros de cliente não chegam até você. Config de 5 minutos. |
| 4 | **Onboarding do primeiro acesso é "cru"** | 🟡 | Um diretor novo entra e vê telas vazias (sem produtos, sem integrações, sem WhatsApp) e **pode achar que quebrou**. Falta um "passo a passo de primeira configuração". |
| 5 | **Migration no boot pode travar deploy** | 🟡 | Migrações rodam ao subir. Se uma for lenta (ex: índice em tabela grande), pode travar o start. Mitigado, mas vale testar migrations com volume real. |

**✅ O que JÁ está bem feito na operação:**
- **Health checks completos** (`/health` simples + `/health/deep` que checa banco, Redis, filas).
- **Logging estruturado** (Pino) + filtro de erros que esconde dados sensíveis.
- **Validação de configuração no boot** — se faltar chave crítica, o app avisa claramente em vez de quebrar no meio.
- **Degrada com elegância** quando uma API externa cai (OpenAI/marketplace/OMIE fora → erro limpo, não derruba o resto).
- **Deploy de migrations inteligente** (4 níveis de fallback) e **rate-limit que "falha aberto"** se o Redis piscar (não trava o app).
- **LGPD:** já tem rotina de retenção/expurgo de dados antigos (auditoria 24m, mensagens 24m).

> ⚠️ Observação de segurança (mais tema da Fase 2): telefones e conversas ficam protegidos **em trânsito** (HTTPS) e o banco Supabase é criptografado em disco pela infra, mas **não há criptografia extra a nível de campo**. Pro beta é aceitável; anotar pra revisão futura.

---

### Resumo da Fase 6 — prioridades pro go-live

| Prioridade | Item | Esforço |
|---|---|---|
| 🔴 1 | **Backup automático diário + teste de restauração** | Médio (criar cron) — **mais crítico pro go-live** |
| 🔴 2 | **Aviso/painel quando WhatsApp/fila/IA caem** | Médio (junta com Fase 4) |
| 🟡 3 | **Ligar o Sentry no Railway** (SENTRY_DSN) | Baixo (config) |
| 🟡 4 | Testar Inbox/Kanban com 100+ itens (e virtualizar se engasgar) | Baixo testar / Médio corrigir |
| 🟡 5 | "Passo a passo" de primeira configuração pro diretor | Médio |
| 🟢 | Anotar pra depois: 2 índices, busca vetorial de produtos, WebSocket na Inbox | Quando crescer |

> **Conclusão:** a **performance não é o risco** — está bem dimensionada pro beta. O que falta é **rede de segurança operacional**: garantir backup e ser avisado quando algo cai. Resolvendo o backup automático e um alerta básico de "caiu", o sistema está confortável pra receber os primeiros clientes reais.

---

# 🏁 Entrega Final — Relatório Consolidado

**O que é isto:** o fechamento das 6 fases num só lugar. Junta tudo numa **lista única, em ordem do que fazer primeiro**, pra virar plano de ação. Nada aqui é novo — é a soma do que já está detalhado acima.

---

## Veredito geral do betinna.ai

**O sistema está bem construído e é confiável.** A base técnica é sólida: 1377 testes passando, segurança sem furos reais, integrações com renovação de token/retry/idempotência, multi-tenant bem isolado, performance dimensionada pro beta. **Não há nada "quebrado" travando o uso hoje.**

O que a auditoria encontrou são, em sua maioria, **itens de acabamento e de rede de segurança** — não bugs graves. E há **um tema que se repete em quase todas as fases** e merece ser o foco número um:

> ### 🔁 O tema recorrente: "ser avisado quando algo dá errado"
> Apareceu na Fase 1 (erros engolidos sem log), na Fase 4 (integração/WhatsApp cai em silêncio), na Fase 5 (não dá pra auditar o que o bot respondeu) e na Fase 6 (nada alerta quando fila/IA/banco falham, e backup não roda sozinho).
>
> **O sistema funciona bem quando tudo está OK. O risco é quando algo quebra e você só descobre pelo cliente reclamando.** Investir em **visibilidade e backup** é o que mais protege o go-live.

---

## 📊 Placar por fase

| Fase | Tema | Veredito | 🔴 abertos |
|---|---|---|---|
| 1 | Saúde Técnica | 🟢 Base sólida (1377 testes) | NaN nas telas, índice SAC, valores Float |
| 2 | Segurança | 🟢 Sólida (sem furos reais) | nenhum — só reforços 🟡 |
| 3 | Visual / UX | 🟢 Bom, com retoques | cores fora do brand, FluxoEditor mobile |
| 4 | Integrações | 🟢 Bem feitas | aviso de desconexão, OMIE demo em prod |
| 5 | Atendimento (produto) | 🟢 Funciona, falta produtividade | templates, aviso de msg, regras de canal, auditoria do bot |
| 6 | Performance / Beta | 🟢 Pronto tecnicamente | backup automático, alerta de "caiu" |

> **Em uma frase:** *engenharia muito boa, segurança sólida — falta acabamento de produto e rede de segurança operacional.*

---

## ✅ O que está MUITO BEM (não mexer)
- **Segurança** — multi-tenant isolado, criptografia AES-256, webhooks com HMAC, sem SQL injection/XSS, RBAC coerente. (O "IDOR crítico" apontado por varredura automática foi **verificado e era falso**.)
- **Engenharia de integrações** — renovação de token, retry com backoff, idempotência, degradação graciosa.
- **Base técnica** — 1377 testes, typecheck limpo, migrations consistentes, jobs com retry/lock.
- **Handoff do bot** (bot→humano), **health checks**, **logging estruturado**, **LGPD** (expurgo automático).

---

## 🚦 LISTA PRIORIZADA ÚNICA (plano de ação)

### P0 — Antes de abrir pro primeiro cliente (go-live blockers)
*Coisas que, se faltarem, podem causar perda de dados, prejuízo ou má impressão imediata.*

| # | O quê | Fase | Por quê é P0 | Esforço |
|---|---|---|---|---|
| 1 | **Backup automático diário do banco + testar restauração** | F6 | Hoje o backup é manual. Banco corrompido = perda total sem volta. | Médio |
| 2 | **Garantir `OMIE_DEMO_MODE=false` ao plugar o OMIE real** (ideal: abortar boot se demo em prod) | F4 | Senão pedidos *parecem* enviados ao ERP mas não chegam — risco fiscal/comercial. | Baixo |
| 3 | **Ligar o Sentry no Railway** (`SENTRY_DSN`) | F6 | Sem isso, erro de cliente não chega até você. Config de minutos. | Baixo |
| 4 | **Corrigir NaN / undefined / Infinity** nas telas de Métricas/Relatórios/Dashboard | F1 | É a cara do produto pro cliente. Conserto simples (já existe `fmtPct`). | Baixo |
| 5 | **Trocar cores fora do brand** (CampanhasPage, AdminPage, AgendaPage) | F3 | Visível na tela, destoa da identidade. Conserto simples. | Baixo |

### P1 — Durante as primeiras semanas do beta (alto valor)
*Faz o produto ser usável de verdade no dia a dia e te dá visibilidade.*

| # | O quê | Fase | Por quê | Esforço |
|---|---|---|---|---|
| 6 | **Avisar quando uma integração/WhatsApp cai** (status "⚠ Reconectar" + e-mail ao diretor) | F4+F6 | O tema recorrente. Hoje cai em silêncio. | Médio |
| 7 | **Respostas rápidas / templates na Inbox** | F5 | #1 ganho de produtividade pro atendente. | Médio |
| 8 | **Aviso ativo de mensagem nova** (som/notificação) | F5 | Mensagem fica parada sem ninguém ver. | Baixo |
| 9 | **Avisar quais canais não aceitam resposta livre** (Amazon/TikTok/Shopee-devolução) | F5 | Atendente tenta responder e falha sem entender. | Médio |
| 10 | **Auditoria das respostas do bot + teto de custo OpenAI** | F5 | Saber o que o bot disse; evitar gasto descontrolado. | Médio |
| 11 | **Índice em `Message.autorUsuarioId`** | F1 | Inbox/SAC fica lento ao filtrar por atendente em volume. | Baixo |
| 12 | **FluxoEditor utilizável no celular** | F3 | Hoje inutilizável em mobile (rep em campo). | Médio |
| 13 | **Validar resposta da IA em campanhas** (evitar mensagem vazia) | F1 | Campanha pode disparar mensagem em branco. | Baixo |
| 14 | **TikTok: reembolso falhado não pode aparecer "Resolvido"** | F4 | Pendência some indevidamente. | Baixo |
| 15 | **Confirmar/implementar refresh do token Meta (FB/IG)** | F4 | Expira em ~60d sem renovar; desconecta sozinho. | Médio |
| 16 | **E-mail: 1 provedor configurado + avisar se convite não saiu** | F4 | Convite/proposta pode não ser enviado em silêncio. | Baixo |

### P2 — Quando crescer / planejado (anote, não é pra agora)
*Importam com volume ou são mudanças que pedem planejamento próprio.*

| # | O quê | Fase | Quando |
|---|---|---|---|
| 17 | **Float → Decimal** em valores monetários (fiscal/OMIE) | F1 | Fase própria (migração + auditoria de centavos) |
| 18 | **Limpeza de código/tabelas mortas** (Fidelidade/Formulários/Marketplace legado) | F1 | Quando for mexer no schema |
| 19 | 2 índices (`Amostra.followUpEm`, `Cliente.ultimoPedidoEm`) | F6 | Acima de ~5 mil clientes/empresa |
| 20 | Busca **vetorial** de produtos no bot | F6 | Catálogo acima de ~500 produtos |
| 21 | **WebSocket na Inbox** (substituir polling 4s) + **virtualizar listas 100+** | F5+F6 | Quando o volume de conversas crescer |
| 22 | Reforço multi-tenant (`findFirst` com `empresaId` na re-leitura) | F2 | Defesa em profundidade — barato, antes de escalar |
| 23 | Touch targets ≥44px, "rep"→"representante", erros contextuais, radius 8→10px | F3 | Polimento de UX mobile |
| 24 | OMIE: **preço real** (não 70%) + **idempotência forte** no envio de pedido | F4 | Ao plugar OMIE real com tabelas |
| 25 | Inbox: tags/notas internas, SLA visível, KPIs, trava de 2 atendentes | F5 | Evolução do SAC |
| 26 | Dependências (`npm audit fix`) + onboarding de primeiro acesso | F1+F6 | Com cuidado (testar exceljs) |

---

## 🎯 Recomendação de sequência

1. **Semana do go-live:** fechar o **P0 inteiro** (1 a 5) — são todos baixo/médio esforço e blindam o lançamento.
2. **Primeiras 2-3 semanas de beta:** atacar o **tema recorrente** (item 6, aviso de queda) + os 🔴 de produto do atendimento (7, 8, 9, 10), que é onde o cliente sente valor.
3. **Conforme o feedback do beta chegar:** puxar P1 restante e ir anotando o P2 pra um "depois do beta".

> **Mensagem final:** o betinna.ai **está pronto pra um beta controlado.** Não há dívida técnica perigosa nem furo de segurança. O caminho mais inteligente é **lançar pequeno**, com o P0 fechado e o backup/alerta no lugar, e usar o beta real pra priorizar o resto. A fundação aguenta. 🚀

*Fim da auditoria — 6 fases + entrega final. Documento concluído em 2026-05-31.*
</content>
