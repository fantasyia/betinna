# Documentação dos módulos — Betinna.ai

Este diretório explica **como cada módulo funciona** e **quem usa o quê**.
Cada arquivo cobre um grupo coeso de módulos com fluxos de exemplo, papéis
envolvidos e endpoints relevantes.

## Sumário

| Doc | Cobre | Quem usa |
|---|---|---|
| [auth-users.md](./auth-users.md) | Auth, Users, Empresas, Permissions, Audit | ADMIN, DIRECTOR |
| [crm.md](./crm.md) | Clientes, Tags, Documentos, Catálogo, Produtos | Todos |
| [vendas.md](./vendas.md) | Pedidos, Propostas, Aprovações, Comissões, Amostras | REP, GERENTE, DIRECTOR |
| [pipeline.md](./pipeline.md) | Leads/Kanban, Ocorrências/SAC, Agenda | REP, GERENTE, SAC |
| [inbox.md](./inbox.md) | Inbox unificada, WhatsApp, Meta, Marketplaces, Incidentes | SAC, REP, GERENTE |
| [automacao.md](./automacao.md) | Fluxos de Automação, Campanhas | DIRECTOR, GERENTE |
| [fidelidade.md](./fidelidade.md) | Programa Fidelidade, Recompensas, Resgates | DIRECTOR, REP |
| [mullerbot.md](./mullerbot.md) | MullerBot RAG, OpenAI integration | Todos |
| [integracoes.md](./integracoes.md) | Integrações empresa + usuário, OAuth flows | DIRECTOR (empresa), Todos (usuário) |
| [relatorios.md](./relatorios.md) | Dashboard executivo, KPIs por módulo | DIRECTOR, GERENTE |
| [admin.md](./admin.md) | Operação cross-tenant, suporte | ADMIN |
| [notificacoes.md](./notificacoes.md) | Notificações in-app + e-mails transacionais | Todos |
| [import-export.md](./import-export.md) | Import CSV + Export CSV/Excel/Word/PDF | Todos (export); ADMIN/DIRECTOR/GERENTE (import) |
| [observabilidade.md](./observabilidade.md) | Logs, Sentry, Prometheus, health, backup, rate limit | DevOps |

---

## Papéis (matriz resumida)

| Papel | Escopo | Pode |
|---|---|---|
| **ADMIN** | Plataforma inteira (cross-tenant) | Criar empresas, suporte universal, override de config |
| **DIRECTOR** | 1 empresa (tenant) | Configurar integrações, definir tetos/comissões, fechar mês, dados fiscais |
| **GERENTE** | Carteira dos REPs sob gerência | Aprovar descontos, ver pedidos/leads dos REPs subordinados |
| **SAC** | Atendimento inbox + ocorrências | Responder marketplaces, IG/FB, abrir/resolver ocorrências |
| **REP** | Própria carteira | CRUD clientes próprios, criar pedidos/propostas, WhatsApp pessoal |

Detalhes completos em [auth-users.md](./auth-users.md#papéis-userrole).

---

## Matriz Módulo × Papel (resumida)

| Módulo | ADMIN | DIRECTOR | GERENTE | SAC | REP |
|---|:-:|:-:|:-:|:-:|:-:|
| Clientes | ✅ | ✅ | ⚠️ subordinados | ❌ | ⚠️ próprios |
| Pedidos | 👁️ | ✅ | ⚠️ subordinados | ❌ | ⚠️ próprios |
| Aprovações | ✅ | ✅ | ✅ subordinados | ❌ | 👁️ próprias |
| Catálogo | ✅ | ✅ | ✅ | ❌ | ⚠️ próprio |
| Comissões | 👁️ | ✅ fechar/pagar | 👁️ subordinados | ❌ | 👁️ próprias |
| Inbox | ✅ todos canais | ✅ todos canais | ✅ todos canais | ✅ todos canais | ⚠️ próprio WhatsApp |
| Marketplaces | ✅ | ✅ | ✅ | ✅ | ❌ |
| Fluxos | ✅ | ✅ | ✅ | ❌ | ❌ |
| Fidelidade | ✅ config | ✅ config | 👁️ | ❌ | ✅ resgatar |
| Integrações Empresa | 👁️ | ✅ | ❌ | ❌ | ❌ |
| Integrações Usuário | ✅ próprias | ✅ próprias | ✅ próprias | ✅ próprias | ✅ próprias |
| Relatórios | ✅ | ✅ | ✅ | 👁️ SAC | 👁️ próprios |
| Admin/Empresas | ✅ | ❌ | ❌ | ❌ | ❌ |

Legenda: ✅ total · 👁️ só visualizar · ⚠️ escopo limitado · ❌ sem acesso

---

## Glossário rápido

- **Tenant / Empresa**: cada cliente Betinna.ai. Multi-tenant — dados isolados via `empresaId` em todas as queries.
- **Carteira**: conjunto de clientes atribuídos a um REP via `Cliente.representanteId`.
- **Mandato (DIRECTOR)**: poder de decisão contratual/fiscal do tenant.
- **Master (ADMIN)**: operador da plataforma, cross-tenant.
- **OMIE**: ERP usado como fonte da verdade fiscal (preços, status cliente, push de pedido).
- **MullerBot**: assistente IA do REP que consulta o catálogo via RAG.
- **Fluxo de automação**: grafo trigger → ação executado por BullMQ.
- **Inbox unificada**: caixa de entrada agregando WhatsApp + IG + FB + ML + Shopee + Amazon + TikTok + e-mail.
- **MarketplaceIncident**: reclamação/devolução/disputa canal-agnóstica com status unificado.
