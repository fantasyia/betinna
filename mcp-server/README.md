# betinna-kanban-mcp

MCP server (stdio) que conecta o **Claude Code** aos **Quadros (Kanban)** do Betinna.ai.

O Claude passa a enxergar e operar seus quadros: listar, criar cards, mover entre
listas, comentar, marcar itens de checklist, delegar com prazo — tudo pela API do
Betinna, autenticado com um token que **só acessa rotas do Kanban** e pode ser
revogado a qualquer momento no app.

## 16 tools

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

Sem tools de delete — arquivar/excluir só pelo app (decisão da spec).

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
