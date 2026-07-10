# KANBAN BETINNA (estilo Trello) + MCP SERVER — EXECUÇÃO EM BATCHES

---

## ⚡ COMO EXECUTAR (sem copiar e colar cada batch)

**Passo 1:** salve este arquivo na raiz do projeto Betinna (ou em `docs/`).

**Passo 2:** abra o Claude Code e cole este ÚNICO prompt:

```
Leia o arquivo kanban-betinna-EM-BATCHES.md inteiro antes de qualquer coisa. Ele contém a especificação completa (Partes 1 a 8) e 12 batches de execução na Parte 6. Sua tarefa é executar os batches NA ORDEM, seguindo este protocolo obrigatório:

1. Execute UM batch por vez, exatamente como descrito no prompt do batch.
2. Ao terminar um batch, rode build/lint, corrija erros, e PARE. Me apresente um resumo curto do que foi feito e o que eu devo testar manualmente no app.
3. Só comece o próximo batch quando eu disser "próximo" ou "aprovado".
4. Se eu reportar um problema, corrija dentro do batch atual antes de avançar.
5. Nunca pule batches e nunca execute dois de uma vez.

Comece agora pelo Batch 1.
```

**Passo 3:** a partir daí, seu trabalho é só: testar o que ele pediu → responder **"próximo"**. Se algo estiver errado, descreva o problema que ele corrige antes de seguir.

**Dica:** se a sessão ficar longa e o Claude Code "esquecer" o protocolo, basta dizer: *"Releia o kanban-betinna-EM-BATCHES.md e continue do Batch X seguindo o protocolo."* Como o arquivo está no projeto, ele sempre reencontra tudo.

---


> **Como usar este arquivo no Claude Code:** execute um batch por vez, na ordem.
> Ao final de cada batch, rode o app, valide visualmente, e só então siga para o próximo.
> Não pule batches. Se algo quebrar, corrija dentro do mesmo batch antes de avançar.

---

## PARTE 1 — VISÃO GERAL E DECISÕES

### O que estamos construindo
Um módulo Kanban dentro do Betinna.ai com a mesma lógica e as mesmas funções centrais do Trello, mais um **MCP server** que permite ao Claude Code ler e atualizar os quadros. Objetivo final do Léo: acompanhar visualmente no Betinna o andamento dos projetos que ele executa em sessões do Claude Code (cada sprint/batch vira cards que o Claude move sozinho).

### Regras de negócio (NÃO NEGOCIÁVEIS)
1. **Representante:** pode criar no máximo **1 quadro (board)**. Ao tentar criar o segundo, o backend bloqueia com mensagem clara.
2. **Diretor e Admin:** quadros ilimitados.
3. **Multi-tenant:** TODO acesso a board/lista/card valida `empresaId` do usuário logado. Nenhuma query sem filtro de empresa. (Atenção: este foi exatamente o tipo de falha encontrada na revisão de código do Betinna — Tema A. Não repetir.)
4. **Visibilidade:** o criador do board e os membros convidados veem o board. Diretor e Admin veem todos os boards da própria empresa.
5. Representante só convida membros da própria empresa.

### Paridade com o Trello — o que ENTRA (núcleo completo)
Baseado na estrutura real da API do Trello (Boards → Lists → Cards, com Actions como histórico):

| Recurso Trello | No Betinna |
|---|---|
| Boards (nome, descrição, cor de fundo, fechar/arquivar) | ✅ |
| Lists (criar, renomear, reordenar, arquivar, mover) | ✅ |
| Cards (título, descrição, posição, capa, arquivar) | ✅ |
| Drag & drop de cards e listas | ✅ |
| Labels/etiquetas (cor + nome, por board) | ✅ |
| Membros por card (atribuir/remover) | ✅ |
| Datas (início, entrega, "concluído") | ✅ |
| **Checklists AVANÇADOS (recurso pago do Trello): prazo de entrega POR ITEM + responsável delegado POR ITEM, com % de progresso** | ✅ ★ |
| **Campos Personalizados / Custom Fields (recurso pago): campos extras por board — texto, número, data, checkbox, lista de opções** | ✅ ★ |
| **Visualização Calendário (Premium): cards e itens de checklist com prazo plotados no calendário** | ✅ ★ |
| **Visualização Tabela (Premium): todos os cards em tabela ordenável/filtrável** | ✅ ★ |
| **Visualização Dashboard (Premium): gráficos — cards por lista, por membro, por etiqueta, por vencimento** | ✅ ★ |
| **"Meus itens" (Premium): painel com todos os itens de checklist delegados ao usuário, entre todos os boards** | ✅ ★ |
| Comentários | ✅ |
| Anexos (upload + link) | ✅ |
| Atividade/histórico (o "Actions" do Trello) | ✅ |
| Busca e filtros (por texto, etiqueta, membro, vencimento) | ✅ |
| Arquivar/restaurar (cards, listas, boards) | ✅ |

### O que FICA FORA (com justificativa)
- **Butler (motor de automação do Premium):** substituído por algo MELHOR no nosso caso — o Claude via MCP. Butler é regras fixas ("quando card entrar na lista X, faça Y"); o Claude entende linguagem natural e faz o mesmo e mais. Não faz sentido construir dois motores de automação.
- **Visualização Mapa (Premium):** cards com localização geográfica. Irrelevante pro caso de uso. Fica fora.
- **Visualização Timeline/Gantt (Premium):** fora do escopo por decisão do Léo. Se mudar de ideia depois, dá pra adicionar sem mexer no resto (as datas dos cards já existem no banco).
- **Power-Ups de terceiros, templates públicos, stickers, e-mail-para-card:** fora do escopo.

### Posicionamento (drag & drop) — mesma técnica do Trello
Usar `posicao Float`. Ao mover um item entre A e B: `posicao = (posA + posB) / 2`. Rebalancear a lista (reatribuir 1024, 2048, 3072...) quando a diferença entre vizinhos ficar < 0.0001. Simples e evita reescrever a lista inteira a cada movimento.

---

## PARTE 2 — MODELOS PRISMA

Adicionar ao `schema.prisma` (ajustar nomes de relação conforme os models existentes de Usuario/Empresa do Betinna):

```prisma
model KanbanBoard {
  id           String        @id @default(cuid())
  nome         String
  descricao    String?
  corFundo     String        @default("#0079BF")
  arquivado    Boolean       @default(false)
  empresaId    String
  criadoPorId  String
  listas       KanbanLista[]
  etiquetas    KanbanEtiqueta[]
  membros      KanbanBoardMembro[]
  atividades   KanbanAtividade[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@index([empresaId])
  @@index([criadoPorId])
}

model KanbanBoardMembro {
  id        String      @id @default(cuid())
  boardId   String
  usuarioId String
  papel     String      @default("membro") // "dono" | "membro"
  board     KanbanBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)

  @@unique([boardId, usuarioId])
}

model KanbanLista {
  id        String       @id @default(cuid())
  boardId   String
  nome      String
  posicao   Float
  arquivada Boolean      @default(false)
  board     KanbanBoard  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  cards     KanbanCard[]

  @@index([boardId])
}

model KanbanCard {
  id            String   @id @default(cuid())
  listaId       String
  titulo        String
  descricao     String?
  posicao       Float
  dataInicio    DateTime?
  dataEntrega   DateTime?
  concluido     Boolean  @default(false)
  corCapa       String?
  arquivado     Boolean  @default(false)
  lista         KanbanLista @relation(fields: [listaId], references: [id], onDelete: Cascade)
  etiquetas     KanbanCardEtiqueta[]
  membros       KanbanCardMembro[]
  checklists    KanbanChecklist[]
  comentarios   KanbanComentario[]
  anexos        KanbanAnexo[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([listaId])
}

model KanbanEtiqueta {
  id      String @id @default(cuid())
  boardId String
  nome    String?
  cor     String
  board   KanbanBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)
  cards   KanbanCardEtiqueta[]
}

model KanbanCardEtiqueta {
  cardId     String
  etiquetaId String
  card       KanbanCard     @relation(fields: [cardId], references: [id], onDelete: Cascade)
  etiqueta   KanbanEtiqueta @relation(fields: [etiquetaId], references: [id], onDelete: Cascade)

  @@id([cardId, etiquetaId])
}

model KanbanCardMembro {
  cardId    String
  usuarioId String
  card      KanbanCard @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@id([cardId, usuarioId])
}

model KanbanChecklist {
  id      String @id @default(cuid())
  cardId  String
  titulo  String
  posicao Float
  card    KanbanCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  itens   KanbanChecklistItem[]
}

model KanbanChecklistItem {
  id            String    @id @default(cuid())
  checklistId   String
  texto         String
  concluido     Boolean   @default(false)
  posicao       Float
  dataEntrega   DateTime? // ★ Advanced Checklist: prazo por item
  responsavelId String?   // ★ Advanced Checklist: delegado por item (usuário membro do board)
  checklist     KanbanChecklist @relation(fields: [checklistId], references: [id], onDelete: Cascade)
}

// ★ Premium: Campos Personalizados (Custom Fields) por board
model KanbanCampoPersonalizado {
  id      String @id @default(cuid())
  boardId String
  nome    String
  tipo    String // "texto" | "numero" | "data" | "checkbox" | "lista_opcoes"
  opcoes  Json?  // para tipo lista_opcoes: ["Alta", "Média", "Baixa"]
  valores KanbanCampoValor[]
}

model KanbanCampoValor {
  id      String @id @default(cuid())
  campoId String
  cardId  String
  valor   Json
  campo   KanbanCampoPersonalizado @relation(fields: [campoId], references: [id], onDelete: Cascade)

  @@unique([campoId, cardId])
}

model KanbanComentario {
  id        String   @id @default(cuid())
  cardId    String
  autorId   String
  texto     String
  card      KanbanCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
}

model KanbanAnexo {
  id        String   @id @default(cuid())
  cardId    String
  nome      String
  url       String
  tipo      String   // "arquivo" | "link"
  card      KanbanCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
}

model KanbanAtividade {
  id        String   @id @default(cuid())
  boardId   String
  cardId    String?
  usuarioId String
  tipo      String   // "card_criado", "card_movido", "comentario", "checklist_item_concluido", etc.
  dados     Json     // detalhes: de qual lista para qual, texto, etc.
  board     KanbanBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@index([boardId, createdAt])
}

model KanbanApiToken {
  id         String   @id @default(cuid())
  usuarioId  String
  empresaId  String
  nome       String   // ex: "Claude Code - Macbook Léo"
  tokenHash  String   @unique // guardar SÓ o hash (sha256), nunca o token puro
  ultimoUso  DateTime?
  revogado   Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@index([usuarioId])
}
```

---

## PARTE 3 — ENDPOINTS (NestJS)

Módulo `kanban/` novo no backend. Todas as rotas protegidas pelo guard de autenticação existente + validação de empresa. Espelhando a organização da API do Trello (boards, lists, cards, actions):

```
# Boards
GET    /kanban/boards                      # meus boards (diretor/admin: todos da empresa)
POST   /kanban/boards                      # cria (VALIDA limite: representante = máx 1)
GET    /kanban/boards/:id                  # board completo: listas + cards + etiquetas + membros
PATCH  /kanban/boards/:id                  # nome, descrição, cor
DELETE /kanban/boards/:id                  # arquiva (soft delete)
POST   /kanban/boards/:id/membros          # convidar membro (da mesma empresa)
DELETE /kanban/boards/:id/membros/:usuarioId

# Listas
POST   /kanban/boards/:id/listas
PATCH  /kanban/listas/:id                  # renomear, arquivar
PATCH  /kanban/listas/:id/mover            # { posicao }

# Cards
POST   /kanban/listas/:id/cards
GET    /kanban/cards/:id                   # card completo (checklists, comentários, anexos, atividade)
PATCH  /kanban/cards/:id                   # título, descrição, datas, concluído, capa, arquivar
PATCH  /kanban/cards/:id/mover             # { listaId, posicao } — o coração do drag & drop
POST   /kanban/cards/:id/etiquetas/:etiquetaId
DELETE /kanban/cards/:id/etiquetas/:etiquetaId
POST   /kanban/cards/:id/membros/:usuarioId
DELETE /kanban/cards/:id/membros/:usuarioId

# Etiquetas do board
POST   /kanban/boards/:id/etiquetas
PATCH  /kanban/etiquetas/:id
DELETE /kanban/etiquetas/:id

# Checklists
POST   /kanban/cards/:id/checklists
PATCH  /kanban/checklists/:id
DELETE /kanban/checklists/:id
POST   /kanban/checklists/:id/itens
PATCH  /kanban/checklist-itens/:id         # texto, concluído, posição, dataEntrega ★, responsavelId ★
DELETE /kanban/checklist-itens/:id
GET    /kanban/meus-itens                  # ★ todos os itens delegados a mim, todos os boards, ordenado por prazo

# ★ Campos personalizados (Custom Fields)
POST   /kanban/boards/:id/campos           # criar campo (nome, tipo, opções)
PATCH  /kanban/campos/:id
DELETE /kanban/campos/:id
PUT    /kanban/cards/:cardId/campos/:campoId  # definir valor do campo no card

# ★ Views Premium
GET    /kanban/boards/:id/calendario?mes=  # cards + itens de checklist com prazo no mês
GET    /kanban/boards/:id/tabela?ordenar=&filtro=
GET    /kanban/boards/:id/dashboard        # agregados: por lista, membro, etiqueta, vencimento

# Comentários e anexos
POST   /kanban/cards/:id/comentarios
DELETE /kanban/comentarios/:id             # só autor ou admin
POST   /kanban/cards/:id/anexos
DELETE /kanban/anexos/:id

# Atividade e busca
GET    /kanban/boards/:id/atividades?limit=50
GET    /kanban/boards/:id/busca?q=&etiqueta=&membro=&vencimento=

# Tokens de API (para o MCP)
POST   /kanban/api-tokens                  # gera token, mostra UMA vez, salva hash
GET    /kanban/api-tokens                  # lista tokens do usuário (sem o valor)
DELETE /kanban/api-tokens/:id              # revoga
```

**Regras obrigatórias de serviço:**
- Toda operação registra em `KanbanAtividade` (é o que alimenta o histórico e o acompanhamento).
- Limite do representante validado no service, não só no frontend.
- Toda busca de board/lista/card começa verificando: o recurso pertence à `empresaId` do usuário E o usuário é dono/membro (ou diretor/admin da empresa). Escrever helper único `verificarAcessoBoard(usuarioId, boardId)` e usar em TUDO.

---

## PARTE 4 — FRONTEND (React)

### Biblioteca de drag & drop
Usar **@dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`). É a padrão atual do React, leve e acessível.

### Telas
1. **`/kanban`** — grade de boards (estilo home do Trello): cartões coloridos com nome, botão "Criar quadro". Se representante já tem 1 board, botão desabilitado com tooltip explicando o limite.
2. **`/kanban/:boardId`** — o quadro:
   - Listas em colunas horizontais com scroll lateral
   - Cards arrastáveis entre listas; listas arrastáveis entre si
   - Card mostra: etiquetas (faixas coloridas), título, badges (data de entrega com cor por status: verde concluído / amarelo próximo / vermelho vencido), contador de checklist (ex: 3/7), avatares dos membros, ícones de comentário/anexo
   - Botão "+ Adicionar card" no fim de cada lista (input inline, Enter salva)
   - Botão "+ Adicionar lista" no fim do board
3. **Modal do card** (abre ao clicar, igual Trello):
   - Título editável inline, lista atual, descrição com editor simples
   - Sidebar de ações: Membros, Etiquetas, Checklist, Datas, Capa, Mover, Arquivar
   - **Checklists AVANÇADOS** ★: barra de progresso + em CADA item, dois botões pequenos (igual Trello pago): 📅 prazo e 👤 responsável. Item com prazo mostra badge de data (vermelho se vencido); item delegado mostra avatar. Ao delegar, registra atividade "item_delegado" e o item aparece no "Meus itens" da pessoa.
   - **Campos personalizados** ★: seção no modal exibindo os campos do board com edição inline conforme o tipo
   - Comentários com avatar e data
   - Atividade do card no rodapé
4. **Painel de atividade do board** (drawer lateral): feed em tempo quase real — **polling a cada 15s** quando a aba do board está aberta. É isso que faz o Léo ver o Claude Code movendo cards "sozinho". (WebSocket fica pra depois; polling resolve.)
5. **Filtros no topo do board:** texto, etiqueta, membro, vencimento.
6. **★ Alternador de visualização no topo do board** (igual Trello Premium): `Quadro | Calendário | Tabela | Dashboard`
   - **Calendário:** grade mensal; cards e itens de checklist com prazo aparecem no dia; clicar abre o modal; arrastar card entre dias muda a dataEntrega
   - **Tabela:** todas as colunas (título, lista, membros, etiquetas, prazo, campos personalizados), ordenável e filtrável
   - **Dashboard:** 4 gráficos (usar recharts): cards por lista, cards por membro, cards por etiqueta, cards por vencimento (vencidos/próximos/sem data)
7. **★ Página `/kanban/meus-itens`:** todos os itens de checklist delegados ao usuário logado, entre todos os boards, agrupados por prazo (vencidos / hoje / esta semana / depois). É o painel pessoal de "o que eu tenho que fazer".

### UX obrigatória
- Atualização otimista no drag & drop (move na tela imediatamente, reverte se a API falhar)
- Toda ação com feedback (toast de erro em PT-BR)
- Mobile: colunas com scroll horizontal por swipe

---

## PARTE 5 — MCP SERVER (a ponte com o Claude Code)

### Arquitetura
```
Claude Code (sessão do Léo)
      │  (protocolo MCP, via stdio local)
      ▼
betinna-kanban-mcp  (pacote Node/TypeScript separado, pasta /mcp-server no repo)
      │  (HTTPS com Bearer token — o KanbanApiToken)
      ▼
API do Betinna (endpoints da Parte 3)
      ▼
Postgres
```

O MCP server **não acessa o banco direto**: ele chama a API do Betinna com um token. Assim toda regra de permissão e multi-tenant continua valendo, e o token pode ser revogado a qualquer momento na tela de tokens.

### Stack do MCP server
- TypeScript + `@modelcontextprotocol/sdk` (SDK oficial)
- Transporte: **stdio** (roda local na máquina do Léo, chamado pelo Claude Code)
- Validação de inputs com Zod
- Config via variáveis de ambiente: `BETINNA_API_URL` e `BETINNA_API_TOKEN`

### Ferramentas (tools) expostas — nomes com prefixo `kanban_`
```
kanban_listar_boards        → lista boards acessíveis (id, nome, nº de cards)
kanban_ver_board            → board completo: listas com seus cards resumidos
kanban_criar_board          → nome, descrição, cor (respeita limite de representante)
kanban_criar_lista          → boardId, nome
kanban_criar_card           → listaId, titulo, descricao?, dataEntrega?, etiquetas?
kanban_ver_card             → card completo (checklists, comentários, atividade)
kanban_atualizar_card       → titulo?, descricao?, dataEntrega?, concluido?
kanban_mover_card           → cardId, listaDestinoId (posição: fim da lista)
kanban_comentar_card        → cardId, texto
kanban_criar_checklist      → cardId, titulo, itens[] (cada item: texto, dataEntrega?, responsavelEmail?)
kanban_marcar_item          → itemId, concluido
kanban_atualizar_item       → itemId, texto?, dataEntrega?, responsavelEmail?  ★ delega e dá prazo por item
kanban_definir_campo        → cardId, nomeCampo, valor  ★ campos personalizados
kanban_meus_itens           → itens delegados a um membro, ordenados por prazo
kanban_buscar               → boardId, texto → cards que batem
kanban_atividade_recente    → boardId, limit → últimas ações (leitura de status)
```

**Boas práticas obrigatórias (do guia oficial de MCP):**
- Descrições curtas e claras em cada tool (o Claude escolhe a tool pela descrição)
- Anotações: `readOnlyHint: true` nas de leitura; `destructiveHint: false` em tudo (não expomos delete via MCP — arquivar só pelo app)
- Erros com mensagem acionável: ex. `"Card não encontrado. Use kanban_ver_board para listar os IDs válidos."`
- Respostas enxutas: `kanban_ver_board` retorna resumo (id, título, lista, entrega, % checklist), não o card inteiro

### Conexão no Claude Code (o Léo roda uma vez)
```bash
claude mcp add betinna-kanban \
  --env BETINNA_API_URL=https://api.betinna.ai \
  --env BETINNA_API_TOKEN=SEU_TOKEN_AQUI \
  -- node /caminho/para/mcp-server/dist/index.js
```

### O fluxo que o Léo quer (caso de uso real)
1. Léo cria no Betinna um board "Betinna — Correções Revisão de Código" com listas: `Backlog | Em execução | Em teste | Concluído`, um card por batch.
2. Na sessão do Claude Code, adiciona ao CLAUDE.md do projeto: *"Ao iniciar um batch, mova o card correspondente para 'Em execução' via kanban_mover_card. Ao concluir e testar, mova para 'Concluído' e comente um resumo do que foi feito via kanban_comentar_card."*
3. Léo abre o board no Betinna (no celular ou desktop) e acompanha os cards andando em tempo quase real, com comentários do Claude em cada card.

---

## PARTE 6 — BATCHES DE EXECUÇÃO

> Copie e cole cada prompt abaixo numa sessão do Claude Code, um por vez.

### BATCH 1 — Banco de dados
```
Leia o arquivo kanban-betinna-EM-BATCHES.md (Partes 1 e 2). Adicione ao schema.prisma todos os models Kanban descritos na Parte 2, ajustando os nomes de relações para bater com os models existentes de Usuario e Empresa deste projeto. Gere a migração (prisma migrate dev --name kanban-inicial) e rode. Não crie nada de backend ainda. Ao final, confirme que a migração aplicou sem erros.
```

### BATCH 2 — Backend: boards, listas e permissões
```
Leia as Partes 1 e 3 do kanban-betinna-EM-BATCHES.md. Crie o módulo kanban no NestJS com: controller, service e DTOs para os endpoints de Boards e Listas. Implemente o helper verificarAcessoBoard(usuarioId, boardId) que valida empresaId + dono/membro/diretor/admin, e use-o em todos os métodos. Implemente o limite: role representante só pode ter 1 board não-arquivado (erro 403 com mensagem em português). Registre toda ação em KanbanAtividade. Siga os padrões de guard/autenticação já existentes no projeto.
```

### BATCH 3 — Backend: cards e movimentação
```
Continue o módulo kanban: endpoints de Cards da Parte 3, incluindo PATCH /kanban/cards/:id/mover com a lógica de posição Float descrita na Parte 1 (média entre vizinhos + rebalanceamento quando diferença < 0.0001). Toda movimentação registra KanbanAtividade com tipo "card_movido" e dados { deListaNome, paraListaNome }. Valide acesso com verificarAcessoBoard em tudo.
```

### BATCH 4 — Backend: etiquetas, checklists AVANÇADOS, membros, campos personalizados
```
Continue o módulo kanban: endpoints de Etiquetas, Checklists e membros de card da Parte 3. Os itens de checklist são AVANÇADOS: aceitam dataEntrega e responsavelId (o responsável precisa ser membro do board — validar). Implemente também GET /kanban/meus-itens (itens delegados ao usuário logado em todos os boards da empresa, ordenados por prazo) e os endpoints de campos personalizados (criar campo por board com tipos texto/numero/data/checkbox/lista_opcoes, definir valor por card). Registre atividades ("checklist_item_concluido", "item_delegado", "membro_adicionado", etc).
```

### BATCH 5 — Backend: comentários, anexos, atividade, busca
```
Finalize o backend do kanban: comentários (deletar só autor ou admin), anexos (upload usando a infra de arquivos já existente no projeto + anexo tipo link), GET de atividades paginado, e o endpoint de busca com filtros (texto no título/descrição, etiquetaId, membroId, vencimento: "vencidos" | "proximos7dias" | "sem_data"). 
```

### BATCH 6 — Backend: tokens de API para o MCP
```
Implemente KanbanApiToken conforme Parte 2 e endpoints da Parte 3: POST gera token aleatório de 40+ caracteres, retorna o valor UMA única vez e persiste apenas o hash sha256; GET lista tokens sem o valor; DELETE revoga. Crie um guard/strategy que aceita "Authorization: Bearer <token>" nas rotas do kanban: valida o hash, carrega o usuário dono do token e atualiza ultimoUso. Token revogado = 401.
```

### BATCH 7 — Frontend: home do kanban + estrutura do board
```
Leia a Parte 4 do kanban-betinna-EM-BATCHES.md. Instale @dnd-kit/core e @dnd-kit/sortable. Crie a rota /kanban (grade de boards, criar board com nome+cor, limite do representante refletido na UI) e a rota /kanban/:boardId com listas em colunas horizontais, criação inline de listas e cards, e drag & drop funcional de cards entre listas e de listas entre si, com atualização otimista e rollback em erro. Siga o design system existente do Betinna.
```

### BATCH 8 — Frontend: modal do card completo (com checklist avançado)
```
Implemente o modal do card conforme Parte 4: título editável, descrição, sidebar de ações (membros, etiquetas com criação inline, datas de início/entrega, cor de capa, mover, arquivar), comentários e atividade. CHECKLISTS AVANÇADOS: cada item tem botão de prazo (date picker) e botão de responsável (seletor de membros do board); item com prazo mostra badge de data (vermelho vencido, amarelo próximo); item delegado mostra avatar. Seção de campos personalizados com edição inline por tipo. Badges no card do board: etiquetas, data com cor, contador de checklist, avatares, ícones de comentário/anexo.
```

### BATCH 9 — Frontend: atividade, filtros, busca e tokens
```
Finalize o frontend: drawer de atividade do board com polling de 15s, barra de filtros no topo (texto, etiqueta, membro, vencimento), tela de gerenciamento de tokens de API (criar mostrando o valor uma vez com botão copiar, listar, revogar) em configurações, e revisão de responsividade mobile do board.
```

### BATCH 10 — Frontend: views Premium (Calendário, Tabela, Dashboard) + Meus Itens
```
Implemente o alternador de visualização no topo do board (Quadro | Calendário | Tabela | Dashboard) conforme Parte 4: Calendário mensal com cards e itens de checklist plotados por prazo (arrastar entre dias atualiza a data); Tabela ordenável/filtrável com todas as colunas incluindo campos personalizados; Dashboard com 4 gráficos usando a lib de gráficos já presente no projeto (ou recharts). Crie também a página /kanban/meus-itens com os itens delegados ao usuário agrupados por prazo (vencidos / hoje / esta semana / depois), cada um linkando para o card.
```

### BATCH 11 — MCP Server
```
Leia a Parte 5 do kanban-betinna-EM-BATCHES.md. Crie a pasta /mcp-server no repositório: projeto TypeScript com @modelcontextprotocol/sdk, transporte stdio, config via env (BETINNA_API_URL, BETINNA_API_TOKEN). Implemente as 16 tools listadas na Parte 5 com schemas Zod, descrições claras em português, readOnlyHint correto, respostas resumidas e mensagens de erro acionáveis — incluindo kanban_atualizar_item (prazo e responsável por item de checklist), kanban_definir_campo e kanban_meus_itens. As tools chamam a API do Betinna com o Bearer token. Inclua README com instruções de build e o comando claude mcp add. Teste com npx @modelcontextprotocol/inspector.
```

### BATCH 12 — Teste ponta a ponta
```
Teste o fluxo completo: 1) crie um board de teste via app com listas Backlog/Em execução/Concluído e 3 cards; 2) num card, crie um checklist com 3 itens, delegue cada item a um membro diferente e coloque prazo em cada um; 3) confira o Calendário (itens aparecem nos dias certos), a Tabela e o Dashboard; 4) confira /kanban/meus-itens de um dos membros; 5) gere um token de API e configure o MCP no Claude Code; 6) via MCP: liste boards, mova um card para "Em execução", comente, use kanban_atualizar_item para delegar um item com prazo, marque itens como concluídos, mova para "Concluído"; 7) confirme que tudo refletiu no app (cards, checklist, atividade, Meus Itens). Corrija divergências e escreva um resumo final.
```

---

## PARTE 7 — MAPEAMENTO TRELLO PREMIUM → BETINNA (referência rápida)

| Função do Trello pago | Status neste projeto |
|---|---|
| Boards ilimitados | ✅ (para diretor/admin; representante limitado a 1 por regra SUA, não técnica) |
| Checklists avançados (prazo + responsável por item) | ✅ Batches 4 e 8 |
| Campos personalizados (Custom Fields) | ✅ Batches 4 e 8 |
| View Calendário | ✅ Batch 10 |
| View Tabela | ✅ Batch 10 |
| View Dashboard | ✅ Batch 10 |
| Painel "Meus itens" entre boards | ✅ Batch 10 |
| View Timeline/Gantt | ❌ fora do escopo (pode ser adicionada depois se quiser) |
| Automação Butler | ❌ substituída pelo Claude via MCP (mais poderoso) |
| View Mapa | ❌ irrelevante pro caso de uso |
| Controles administrativos de workspace | ✅ já coberto pelos papéis do Betinna (admin/diretor/representante) |

## PARTE 8 — ESTIMATIVA E ORDEM DE PRIORIDADE

- Batches 1–6 (backend completo + tokens): ~1,5 a 2 semanas de sessões
- Batches 7–10 (frontend + views Premium): ~1,5 a 2 semanas
- Batches 11–12 (MCP + testes): ~3 a 5 dias
- **Total: ~4 a 5 semanas** no ritmo atual de sessões

**Importante:** as correções de segurança críticas do Betinna (Batches 1–3 da revisão de código) vêm ANTES deste projeto. Kanban novo em cima de falha de multi-tenant só multiplica o problema.
