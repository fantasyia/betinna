# betinna-kanban-mcp

MCP server (stdio) que conecta o **Claude Code** aos **Quadros (Kanban)** do Betinna.ai.

O Claude passa a enxergar e operar seus quadros: listar, criar cards, mover entre
listas, comentar, marcar itens de checklist, delegar com prazo — tudo pela API do
Betinna, autenticado com um token que **só acessa rotas do Kanban** e pode ser
revogado a qualquer momento no app.

## 26 tools

| Tool | O que faz |
|---|---|
| `kanban_listar_boards` | Lista os quadros acessíveis |
| `kanban_ver_board` | Quadro completo (listas + cards resumidos) |
| `kanban_ver_card` | Card completo (checklists, comentários, atividade) |
| `kanban_meus_itens` | Itens de checklist delegados ao dono do token |
| `kanban_buscar` | Busca cards por texto |
| `kanban_atividade_recente` | Últimas ações no quadro |
| `kanban_criar_board` | Cria quadro |
| `kanban_criar_lista` | Cria lista (coluna) |
| `kanban_criar_card` | Cria card (descrição, prazo, etiquetas) |
| `kanban_atualizar_card` | Título/descrição/prazo/concluído |
| `kanban_mover_card` | Move card pra outra lista (por NOME ou id) |
| `kanban_comentar_card` | Comenta no card |
| `kanban_criar_checklist` | Checklist c/ itens (prazo + responsável por e-mail ★) |
| `kanban_marcar_item` | Conclui/reabre item de checklist |
| `kanban_atualizar_item` | Texto/prazo/responsável do item ★ |
| `kanban_definir_campo` | Campo personalizado por NOME ★ |
| `kanban_criar_etiqueta` | Cria etiqueta no quadro (cor + nome) |
| `kanban_etiquetar_card` | Aplica/remove etiqueta num card (por NOME, cor ou id) |
| `kanban_atualizar_lista` | Renomeia e/ou arquiva/restaura uma lista |
| `kanban_mover_lista` | Reordena coluna (posição 1-based) |
| `kanban_adicionar_itens` | Adiciona itens a checklist já existente ★ |
| `kanban_excluir_checklist` | Exclui um checklist inteiro (destrutivo) |
| `kanban_excluir_item` | Exclui um item de checklist (destrutivo) |
| `kanban_mover_item` | Reordena item dentro do checklist (posição 1-based) |
| `kanban_anexar` | Anexa ARQUIVO local (upload) ou LINK ao card |
| `kanban_excluir_anexo` | Remove um anexo do card (destrutivo) |

`kanban_anexar` aceita `caminhoArquivo` (upload multipart — HTML/CSS/JS/JSON/SVG,
imagens, PDF, CSV/TXT, .docx/.xlsx, .zip, máx 10MB) **ou** `url` + `nome` (link).

Excluir card/lista continua só pelo app; excluir checklist/item agora dá pelo MCP
(marcados como destrutivos). Arquivar lista é reversível (`arquivada: false`).

## 9 tools de Fluxos (prefixo `fluxos_`)

Exigem token com escopo **`fluxos`** (marque "Fluxos de automação" ao gerar em Quadros → Tokens de API).

| Tool | O que faz |
|---|---|
| `fluxos_listar` | Lista fluxos (id, nome, status, trigger) |
| `fluxos_ver` | Detalhe: nós + arestas |
| `fluxos_exportar` | JSON pronto pra reimportar |
| `fluxos_importar` | **Sobe um fluxo (nós+arestas) → cria RASCUNHO** |
| `fluxos_atualizar` | Full-replace de nós/arestas de um rascunho |
| `fluxos_testar` | Dispara execução de teste (não ativa) |
| `fluxos_execucoes` | Histórico de execuções |
| `fluxos_metricas` | Total, taxa de sucesso, etc. |
| `fluxos_cron_preview` | Valida cron e mostra próximas execuções |

**Não expõe** `ativar`/`pausar`/`arquivar`/`excluir` — ativação = decisão humana no app.
Import sempre cria **RASCUNHO**; disparo real de WhatsApp/e-mail só depois do Léo ativar.

## 3 tools de Funis + Contatos (leitura — base do e-mail marketing)

Só **leitura**. Cada uma exige o escopo próprio (marque em Quadros → Tokens de API):
"Funis (somente leitura)" e "Contatos (somente leitura)". O guard barra qualquer
método != GET nessas rotas — o token **nunca** escreve em funis nem contatos.

| Tool | Escopo | O que faz |
|---|---|---|
| `funis_listar` | `funis` | Lista os funis (pipelines) + etapas |
| `funis_ver` | `funis` | Detalhe de um funil (dados + etapas ordenadas) |
| `contatos_listar` | `contatos` | Lista contatos (Lead+Cliente+Conversa dedup por telefone), paginado + filtros |

**Contatos = dados pessoais (PII).** Sem endpoint de detalhe único: filtre com `search`.
Escrita (criar leads, ação em massa) continua só no app.

## Build

```bash
cd mcp-server
npm install
npm run build   # gera dist/index.js
```

## Configurar no Claude Code

1. No Betinna: **Quadros → Tokens de API → Gerar token** (copie o valor `bkt_...` — aparece uma única vez).
2. Registre o MCP:

```bash
claude mcp add betinna-kanban \
  --env BETINNA_API_URL=https://SUA-API.up.railway.app \
  --env BETINNA_API_TOKEN=bkt_SEU_TOKEN_AQUI \
  -- node /caminho/para/betinna/mcp-server/dist/index.js
```

Pra testar contra o backend local: `BETINNA_API_URL=http://localhost:3001`.

## Fluxo recomendado (CLAUDE.md do seu projeto)

> Ao iniciar um batch, mova o card correspondente para "Em execução" via
> `kanban_mover_card`. Ao concluir e testar, mova para "Concluído" e comente
> um resumo do que foi feito via `kanban_comentar_card`.

## Testar com o inspector

```bash
npx @modelcontextprotocol/inspector \
  -e BETINNA_API_URL=http://localhost:3001 \
  -e BETINNA_API_TOKEN=bkt_... \
  node dist/index.js
```

## Erros comuns

- **401 "Token de API inválido ou revogado"** — gere outro token no app.
- **403 "só pode acessar rotas /kanban"** — o token é escopado; use o app pro resto.
- **"Lista X não existe"** — a mensagem lista as colunas disponíveis; use o nome exato.
