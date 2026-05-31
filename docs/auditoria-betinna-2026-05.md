# Auditoria Completa do betinna.ai

**Data de início:** 2026-05-31
**Última atualização:** 2026-05-31 (Fase 1)

> Documento vivo. Cada fase é acrescentada aqui, sem apagar as anteriores.
> Linguagem simples — o dono não é técnico. **Auditoria = diagnóstico, não conserto.**
> Gravidades: 🚨 crítico · 🔴 alto · 🟡 médio · 🟢 baixo/ok

## Sumário

- [x] **Fase 1 — Saúde Técnica**
- [ ] Fase 2 — Segurança e Permissões
- [ ] Fase 3 — Consistência Visual e Experiência
- [ ] Fase 4 — Integridade das Integrações
- [ ] Fase 5 — Módulo WhatsApp/Atendimento (análise de produto)
- [ ] Fase 6 — Performance e Prontidão para Beta
- [ ] Entrega Final — Relatório Consolidado + Lista Priorizada

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
</content>
