# MCP `betinna-fluxos` — PLANO (ponte Claude Code → Fluxos de Automação)

> Espelha o padrão já provado do `betinna-kanban` (ver `docs/kanban-betinna-EM-BATCHES.md`).
> Objetivo: deixar o Claude Code **desenhar e subir fluxos de automação** da Somatec (e de qualquer
> empresa) **pela API do Betinna**, com todos os cadeados de negócio valendo — SEM tocar no banco de produção.

---

## PARTE 1 — POR QUE (e por que NÃO no banco direto)

A sessão `/fluxos-somatec` (repo leo-Skills-master) desenha o grafo de automação e precisa subir pro app.
Escrever direto no Postgres de produção **pula** a validação do grafo, o multi-tenant (`empresaId`), o
schema de import e o ciclo RASCUNHO→ativar. O app **já expõe a porta certa**: `POST /fluxos/importar`
(cria como RASCUNHO). Este MCP só embrulha essas rotas com um Bearer token — mesmo princípio do Kanban.

**Princípios (herdados do Kanban):**
- MCP **não acessa o banco**; chama a API com token (revogável).
- Toda regra de permissão/multi-tenant continua no backend.
- **Escrita sempre não-destrutiva:** import cria RASCUNHO; **ativar/arquivar/excluir NÃO são expostos** no MCP — ficam no app (decisão humana). Disparo real de WhatsApp/e-mail exige o Léo ativar.

---

## PARTE 2 — O BLOQUEIO A RESOLVER (auth)

As rotas de `FluxosController` são protegidas por `@Roles('ADMIN','DIRECTOR')` + o guard de auth **JWT**
padrão. O `betinna-kanban` criou um `KanbanApiToken` + guard próprio que aceita `Authorization: Bearer <token>`
**só nas rotas do kanban**. Para o MCP de fluxos funcionar, o Bearer precisa autenticar como o **usuário dono
do token, carregando o papel dele**, para que `@Roles('ADMIN','DIRECTOR')` passe.

**Decisão de arquitetura (Batch 1):** generalizar o token do Kanban para um **Personal Access Token (PAT)
de plataforma**, reutilizável por qualquer módulo:
- Renomear/estender `KanbanApiToken` → `ApiToken` (ou adicionar `escopo: string[]` — ex.: `["kanban","fluxos"]`).
- O guard do PAT valida o hash, **carrega o usuário dono (com `role` e `empresaId`) e popula `CurrentUser`** —
  assim `@Roles` e o filtro de empresa existentes já funcionam sem reescrever os controllers.
- Aplicar o guard do PAT também no `FluxosController` (aceitar JWT **ou** PAT).
- Migração compatível: tokens de kanban existentes continuam válidos (escopo default `["kanban"]`).

---

## PARTE 3 — TOOLS DO MCP (prefixo `fluxos_`)

Adicionar ao **mesmo pacote MCP** do kanban (um servidor, dois domínios) — o Léo roda **um** `claude mcp add`
e ganha `kanban_*` + `fluxos_*`. Reaproveita `BETINNA_API_URL` + `BETINNA_API_TOKEN`.

| Tool | Rota | Hint | Descrição |
|---|---|---|---|
| `fluxos_listar` | `GET /fluxos` | readOnly | Lista fluxos da empresa (id, nome, status, trigger) |
| `fluxos_ver` | `GET /fluxos/:id` | readOnly | Detalhe: nós + arestas |
| `fluxos_exportar` | `GET /fluxos/:id/exportar` | readOnly | JSON pronto pra reimportar |
| `fluxos_importar` | `POST /fluxos/importar` | write (RASCUNHO) | **Sobe um fluxo de um JSON** → cria RASCUNHO. A principal. |
| `fluxos_atualizar` | `PUT /fluxos/:id` | write (RASCUNHO) | Full-replace de nós/arestas de um fluxo em rascunho |
| `fluxos_testar` | `POST /fluxos/testar` | write (teste) | Dispara execução de teste manual (não é ativação) |
| `fluxos_execucoes` | `GET /fluxos/:id/execucoes` | readOnly | Histórico de execuções |
| `fluxos_metricas` | `GET /fluxos/:id/metricas` | readOnly | Total, taxa de sucesso, etc. |
| `fluxos_cron_preview` | `POST /fluxos/cron/preview` | readOnly | Valida cron e mostra próximas execuções |

**NÃO expor:** `ativar`, `pausar`, `arquivar`, `excluir/permanente` — ficam no app (mesma regra do Kanban de
não expor delete). `destructiveHint:false` em tudo. Erros acionáveis (ex.: "Fluxo não encontrado. Use fluxos_listar").

**Schema do JSON de `fluxos_importar`** (validado pelo `importFluxoSchema` do backend):
```json
{ "betinnaFluxo":1, "tipo":"fluxo", "nome":"…", "descricao":"…",
  "triggerTipo":"LEAD_RECEBEU_TAG", "triggerConfig":{ "tag":"medicao-solicitada" },
  "nos":[ {"id":"trigger","tipo":"TRIGGER","titulo":"…","config":{},"posX":0,"posY":0},
          {"id":"ia1","tipo":"ACAO","acaoTipo":"CONVERSAR_IA","titulo":"…","config":{}} ],
  "arestas":[ {"sourceNoId":"trigger","targetNoId":"ia1","label":null} ] }
```
`nos[].id` = chave estável referenciada pelas arestas (backend gera ids internos). Máx 200 nós / 400 arestas.

---

## PARTE 4 — BATCHES DE EXECUÇÃO

### BATCH 1 — Backend: generalizar o PAT + aplicar no FluxosController
```
Leia docs/mcp-fluxos-PLANO.md (Partes 2 e 3) e docs/kanban-betinna-EM-BATCHES.md (Parte 2/6, modelo KanbanApiToken).
Generalize o token de API do kanban para um PAT de plataforma reutilizável: adicione escopo (["kanban","fluxos"])
ou renomeie para ApiToken; o guard do PAT deve validar o hash, carregar o usuário dono (com role e empresaId) e
popular CurrentUser, de modo que @Roles e o filtro de empresa existentes continuem valendo. Aplique o guard do PAT
no FluxosController (aceitar JWT OU PAT). Migração compatível com tokens existentes (default escopo ["kanban"]).
Registre atividade/uso do token (ultimoUso). Ao final, confirme migração + testes passando.
```

### BATCH 2 — MCP: adicionar as tools `fluxos_*` ao pacote existente
```
No pacote /mcp-server (o do betinna-kanban), adicione as 9 tools fluxos_* da Parte 3 com schemas Zod,
descrições em PT, readOnlyHint correto, respostas resumidas e erros acionáveis. fluxos_importar recebe o
envelope JSON e chama POST /fluxos/importar (sempre RASCUNHO). NÃO exponha ativar/pausar/arquivar/excluir.
Reaproveite o cliente HTTP e a config de token já existentes. Atualize o README com a lista de tools.
Teste com @modelcontextprotocol/inspector.
```

### BATCH 3 — Teste ponta a ponta (com a Somatec)
```
1) Gere um token de API no app (escopo kanban+fluxos) e configure no Claude Code.
2) Via MCP: fluxos_listar (vazio ok); fluxos_importar com um fluxo de qualificação de lead da Somatec
   (trigger LEAD_RECEBEU_TAG "medicao-solicitada" → CONVERSAR_IA → CONDICAO qualificado → CRIAR_TAREFA).
3) Confirme no app que o fluxo apareceu como RASCUNHO, com nós e arestas corretos.
4) fluxos_testar dispara execução de teste; fluxos_execucoes/metricas leem o resultado.
5) Léo revisa e ativa MANUALMENTE no app (ativação nunca via MCP). Escreva o resumo final.
```

---

## PARTE 5 — ESTIMATIVA
- Batch 1 (backend PAT + guard): ~2-3 dias · Batch 2 (tools MCP): ~1-2 dias · Batch 3 (e2e): ~0,5 dia.
- **Total: ~1 semana.** Depende de o `betinna-kanban` (MCP + token) já estar de pé — está.
