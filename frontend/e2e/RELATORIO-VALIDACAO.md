# 🧪 Relatório de Validação Pré-Beta — betinna.ai

> Varredura automatizada (Playwright/Chromium) contra o app rodando **local e isolado**
> (Supabase local em Docker, banco de teste semeado, bot mockado, OMIE em demo, Resend vazio).
> **Nenhum dado real foi tocado.**

## 1. Resumo executivo

- **86 testes** rodaram — **86 passaram**, 0 falharam, 0 pulados.
- Cobertura: autenticação, multi-tenant, permissões, carteira, clientes, pedidos, propostas→OMIE, inbox, dashboard, relatórios, catálogo, produtos, funil, campanhas, tags, segmentações, metas, comissões, persona/bot, integrações, admin, modo escuro, mobile e fluxos de e-mail/WhatsApp.
- **2 bugs reais foram encontrados E corrigidos** durante a varredura (detalhes abaixo).
- **Veredito:** os fluxos **críticos do beta funcionam**. Recomendo entrar no beta **após** uma conferência manual rápida do **menu mobile** (item 🟡 abaixo) e do recebimento de WhatsApp ao vivo (não automatizável).

## 2. Bugs encontrados (priorizados)

### 🚨 Bloqueadores
- Nenhum.

### 🔴 Alto — encontrados e **JÁ CORRIGIDOS**
1. **Campanhas — resumo mostrava `undefined`** nos cards *Total* e *Alcance 30d*.
   - Causa: o backend devolvia `totalDestinatariosUltimos30d` e não mandava `total`; o front lia `total`/`alcanceUltimos30d`.
   - Correção: backend alinhado ao contrato (`backend/src/modules/campanhas/campanhas.service.ts`). Testes de unidade atualizados (43 verdes).
2. **Relatórios → aba "Comissões" quebrava a tela** ("Algo deu errado").
   - Causa: o componente lia `data.porRep` mas o backend manda `data.detalhes` (descasamento de contrato; os outros tabs já tinham proteção, esse não).
   - Correção: normalização defensiva no componente (`frontend/src/pages/RelatoriosPage.tsx`).

### 🟡 Médio — **precisa de conferência manual** (não corrigido)
3. **Menu mobile (drawer) instável.** No celular (375px), tocar no hambúrguer **abre** o menu (o fundo escuro aparece), mas o menu parece **re-fechar sozinho** logo em seguida (o backdrop fica não-clicável). Provável `useEffect` reagindo a mudança de rota e fechando o drawer.
   - Onde: `frontend/src/components/PageLayout.tsx` (sidebar mobile + effect de `location.pathname`).
   - Impacto: no celular o usuário pode ter dificuldade de navegar pelo menu lateral.
   - **Ação:** conferir num celular real. O teste valida a abertura; deixei marcado no código (`mobile.spec.ts`).

### 🟢 Baixo — pontos de UX (não são bugs)
4. **Lista de Clientes no mobile** usa tabela com rolagem horizontal (não vira cards). Funciona, mas pode ser revisto pra melhor leitura no celular.

## 3. Precisa de olho humano (revisão visual)

O robô tirou screenshots que ele **não consegue julgar** (cores, layout, estética). Reveja em lote:

- **Modo escuro:** `frontend/e2e/output/screenshots/robustez-dark-*.png` (dashboard, clientes, pedidos no tema escuro).
- **Mobile (iPhone 375×812):** `frontend/e2e/output/screenshots/mobile-*.png` (login, dashboard, clientes, inbox).
- **Demais telas:** todas as capturas de início/meio/fim de cada teste estão em `frontend/e2e/output/screenshots/`.
- **Relatório visual completo** (com filtros, vídeos das falhas e screenshots embutidos): rode `npm run e2e:report`.

## 4. Limitações conhecidas da varredura

- **Recebimento de WhatsApp AO VIVO** não é automatizável: o WhatsApp (Baileys) é via socket, não há endpoint HTTP pra simular uma mensagem entrante. O teste valida as conversas semeadas no Inbox; o recebimento real precisa de **teste manual** com o número pareado.
- Mesmo bloqueio para o **bot Muller respondendo a uma mensagem recebida** (depende do gatilho de mensagem entrante).

## 5. Como rodar de novo

Pré-requisitos: Docker rodando, Supabase local + Redis de pé, backend (4001) e frontend (5174) no ar. Veja `.test-credentials.md` na raiz pra subir o ambiente do zero.

```bash
cd frontend
npm run e2e          # roda TUDO (86 testes)
npm run e2e:smoke    # só a Camada 1 (fluxos críticos)
npm run e2e:report   # abre o relatório HTML (bonito, com screenshots)
```

Pra resetar os dados de teste: `cd backend && npx dotenv -e .env.test -- npx tsx prisma/seed-test.ts` (idempotente).
