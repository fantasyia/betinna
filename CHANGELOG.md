# Changelog

Todo trabalho relevante neste projeto é documentado aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versionamento segue [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Não versionado] — 2026-08-19

### 📤 Fluxo pode falar pelo WhatsApp PESSOAL do rep (a metade que faltava)

O app deixa cada rep conectar o próprio WhatsApp, o inbound já recebe por ele
(instância `user_<id>`) e o gatilho até tem `escopo: 'pessoal'` — filtro que só
faz sentido se a intenção sempre foi rodar fluxo em cima da conversa do rep.
**Mas o envio nunca seguiu:** os nós de fluxo mandavam sempre pelo número da
empresa. Na prática o cliente escrevia pro rep e a Somatec respondia de outro
número; do lado do rep, o WhatsApp conectado era só leitura pro motor.

Não era feature faltando, era **inconsistência**: a resposta humana pela Inbox e
o bot do WhatsApp já passavam o `proprietarioId` certo. Só o motor de fluxos não.

**Regra (`remetente-whatsapp.util.ts`), em duas partes:**
1. resposta sai pela porta por onde a mensagem entrou;
2. **mas só quando o destinatário é o LEAD.** Os modos `numero`/`contato` são
   aviso interno (diretoria, grupo) — mandar ISSO do celular do rep faria o
   diretor receber alerta do sistema pelo número pessoal de um funcionário.

`remetenteUsuarioId` no nó (com dropdown no editor) escolhe explicitamente, e
ganha de tudo. **Validação dura:** usuário tem que ser da empresa e a instância
dele estar conectada — senão o passo **falha com o motivo**, nunca cai calado pro
número da empresa. Mandar do número errado é pior que não mandar.

Cobre os dois nós: `ENVIAR_WHATSAPP` (texto e mídia) e `CONVERSAR_IA` — este era
a metade maior, porque conduz a conversa inteira (abertura, cada turno, os
documentos e o aviso de espera). O passo grava de onde veio a decisão
(`remetente: configurado | conversa | empresa`), que é o que responde "por qual
número isso saiu?" quando o cliente reclama.

18 testes novos.


### ✏️ Editar prompt por TRECHO, em vez de reenviar o texto inteiro

Trocar uma linha do prompt de prospecção exigia reenviar os 64 mil caracteres —
não porque é caro, porque é **arriscado**: quem edita tem que reproduzir 754
linhas verbatim, e uma linha comida no meio de um prompt de produção é bem pior
que o erro que a edição conserta. Uma correção de emoji ficou parada por isso.

`PATCH /mullerbot/prompts/:id` (e a tool `prompts_atualizar`) aceitam
`substituir: [{ de, para }]`, com o contrato de um editor de arquivo:

- cada `de` tem que casar **exatamente uma vez** — zero → erro dizendo que não
  achou; duas ou mais → erro dizendo quantas. **Nunca "troca a primeira"**: um
  prompt de 64k repete frase o tempo todo, e acertar a ocorrência errada em
  silêncio é o pior desfecho possível;
- **tudo ou nada** — a validação roda antes de qualquer escrita, então se a
  segunda falhar a primeira não fica gravada (nem abre transação);
- retorna `tamanhoAntes`/`tamanhoDepois`/`delta`, pra conferir a troca sem
  baixar o prompt de volta;
- versiona igual: o snapshot guarda o texto ANTIGO e a versão sobe;
- `texto` completo continua aceito — mas junto com `substituir` é recusado, que
  é intenção ambígua.

O `para` é literal: `$&` e afins não viram referência de regex (`replace` com
string as interpretaria, e prompt cheio de template tem `$` à vontade).


### 📊 Execução de teste não conta mais como resultado de produção

O painel do T1 mostrava **0% de sucesso** com erro de nó, e o fluxo estava
PAUSADO — nunca tinha visto mensagem real. As duas execuções vinham do botão de
testar. O número mandou alguém caçar um bug que não existia.

**`FluxoExecucao.teste` virou coluna** (migration + backfill do que já estava
gravado com `_teste` no contexto). Coluna e não filtro por JSON de propósito:
excluir por caminho JSON no Postgres tropeça em NULL — `NOT (contexto->'_teste'
= 'true')` é NULL quando a chave não existe, e a linha some. O filtro esconderia
exatamente as execuções de PRODUÇÃO.

Agora ficam de fora do que é resultado: métricas do fluxo, contadores do Monitor,
"N execuções" do card, e o histórico (que abre em **Produção** por padrão, com
abas Produção / Testes / Todas e selo 🧪 em cada execução de teste). As métricas
devolvem `testes` à parte, pra tela poder dizer "não rodou ainda (N testes)" em
vez de "0% de sucesso".

### 🧪 Dá pra testar fluxo de WhatsApp contra uma conversa real

Todo fluxo com `MENSAGEM_CANAL` + `CRIAR_LEAD` falhava **sempre** no teste: o
teste não simula conversa, `conversationId` vinha vazio e o nó morria. Ou seja,
o T1 — porta de entrada de todo o inbound — era justamente o que a ferramenta de
teste não alcançava.

- `fluxos_testar` aceita `conversationId` e semeia o contexto **no formato do
  evento real** (canal/conversationId/texto/leadId/proprietarioId), a partir da
  conversa escolhida. Copiar o formato importa: teste com contexto diferente do
  de produção valida o fluxo errado.
- Sem conversa, e com nó que exige uma (`CRIAR_LEAD`, `TRANSFERIR_ATENDIMENTO`,
  `PAUSAR_IA`), **recusa antes de criar a execução**, nomeando o nó e dizendo o
  que fazer. Melhor recusar do que gerar um FALHOU que não diz nada.
- A mensagem de erro do nó parou de mandar consertar o que estava certo: agora
  separa "em produção = gatilho errado" de "num teste = teste sem conversa".

### 🩹 O alerta do dashboard também contava teste (faltou na primeira passada)

O painel de fluxos (`/dashboard/resumo`, sala de fluxos do Monitor) tem as
PRÓPRIAS consultas de execução — duas do Prisma e **duas em SQL crua** — e não
passam pelo `fluxos.service`. Corrigi as métricas e o histórico e o alerta
vermelho continuou lá: "⚠ 0%" com "Passo b9ad952b… esgotou 3 tentativas", de dois
testes num fluxo pausado.

As quatro filtram `teste = false` agora. Um teste lê o próprio arquivo-fonte e
exige o filtro em toda leitura de `FluxoExecucao` — o problema aqui não foi a
regra, foi ter mais consultas do que eu tinha achado.

### 🔇 Teste não manda mensagem pra pessoa (a não ser que você peça)

Consequência do item acima que não podia ficar de pé: testar contra uma conversa
REAL significa que do outro lado tem alguém real. Um teste do T1 dispararia o
opener — "oi, é da Somatec…" — pra um cliente que não pediu nada, sem desfazer.

Agora `enviarDeVerdade` é **opt-in** (default `false`). Desmarcado, o fluxo roda
inteiro (condições, IA, tags, etapas) e os envios de WhatsApp ficam registrados
como **simulados**, com o texto que sairia — que é o que se quer conferir num
teste. Marcado, envia.

### 🕰️ Passo de versão anterior do grafo fica marcado no histórico

Reescrever um fluxo regenera os ids dos nós, então um erro antigo apontava pra um
nó que não existe mais e mandava a pessoa procurar um passo que sumiu. O painel
agora marca "· versão anterior" quando o `noId` do log não está no grafo atual.


### 🏷️ Selo de regra de envio no nó do fluxo

A janela e o teto moram no pacing — decisão certa, mas deixa a regra **invisível
pra quem monta o fluxo**: quem abre o C2 no editor não tem como saber que aquela
mensagem pode esperar até as 8h. Tirar a regra da memória do runtime e deixá-la
exigida de quem monta não fecha o problema.

Agora o nó `ENVIAR_WHATSAPP` e o `CONVERSAR_IA` mostram o que vale pra eles:
- gatilho de mensagem (`MENSAGEM_CANAL`/`LEAD_RESPONDEU`) → "responde a qualquer hora";
- qualquer outro → horário configurado, teto configurado, aviso de que nada é
  descartado, e a exceção de conversa viva.

**O texto vem de `GET /empresas/config/envio-whatsapp`, que devolve a config já
RESOLVIDA** pelas mesmas funções que o `WhatsappPacingService` usa. Sem isso o
front teria que reimplementar defaults e correções (janela invertida, dias
vazios) pra saber o que o motor faz — duas implementações que divergem no dia em
que alguém corrige uma. É o defeito do rótulo do `PAUSAR_IA` de novo.

Enquanto a config não carrega, o selo **some** em vez de chutar 8h–20h: selo que
mente é pior que selo ausente.

Link no selo abre Configurações já na aba Avançado, na âncora do card de ritmo.

8 testes de render.


### 🔴 A janela de envio segurava o C1 no meio da conversa

Achado pela master ao conferir o `da8857d`. A primeira versão decidia
"resposta vs abordagem" pelo **gatilho** do fluxo, e furou no handoff entre
fluxos:

1. pessoa escreve às 22h → T1 dispara por `MENSAGEM_CANAL` → isento, responde ✅
2. ela responde a triagem → T1 classifica e **move o lead de etapa**
3. C1 dispara por `LEAD_ETAPA_MUDOU` → tratado como abordagem → **adiado pras 8h**
4. quem acabou de responder leva 10 horas de silêncio

Exatamente o dano que a regra existia pra evitar, entrando por outra porta. O C1
não é abordagem: é a mesma conversa, dois segundos depois.

**Consertado trocando o critério:** não é mais o gatilho, é **ter alguém do
outro lado agora**. Se o lead mandou mensagem nas últimas 4h, o que o fluxo
manda é resposta — passa a qualquer hora. Senão é abordagem e espera. O gatilho
(`MENSAGEM_CANAL`/`LEAD_RESPONDEU`) continua como atalho, sem consultar nada.

Por que é melhor que isentar `LEAD_ETAPA_MUDOU`: esse gatilho também é o da
família S, que é abordagem de verdade — isentar por atacado liberaria disparo às
3h. E o critério novo cobre o handoff T1→C1, o C1→C2 e qualquer fluxo futuro sem
precisar lembrar de nada.

Usa `Lead.ultimaMensagemEm`, que já é carimbado a cada mensagem recebida do lead
(em todos os ids irmãos, quando há duplicata). **Falha fechado**: sem leadId, sem
carimbo ou com o banco fora, a resposta é "não" e a mensagem espera.

4h é folgado de propósito — o handoff leva segundos, a folga é pra conversa com
pausa humana no meio, e cada mensagem nova do lead reinicia a contagem. Não pode
ser 24h: quem escreveu de manhã e recebe fluxo às 23h não está do outro lado.


### 🚦 Teto diário de envio proativo

A janela de horário fechou o "não manda de madrugada". Faltava a outra metade:
ritmo e horário **não limitam volume**. 12/min dentro de uma janela de 12h dá
**8.640 mensagens num dia** sem nada barrar — e o que derruba número pareado
(Evolution, sem template nem janela de 24h) é volume acumulado com taxa de
bloqueio, não pico por minuto.

O teto não existe pra ritmar o trabalho normal. Existe pro acidente: fluxo com
laço, importação torta, campanha com filtro errado transformando 30 mil contatos
em disparo. É a diferença entre "número banido" e "log com N adiados".

**Padrão: 500/dia**, configurável em ⚙️ Avançado → 🐢 Ritmo de envio. Conservador
de propósito e bem abaixo do que o ritmo permitiria: uma campanha de 3.000 reps
leva 6 dias em vez de sair num pico — que é a forma segura de fazer num número
pareado. Como estourar **adia** (nunca descarta), teto baixo atrasa; teto alto é
o que não dá pra desfazer.

**Só conta PROATIVO.** Resposta a quem escreveu não gasta cota.

Detalhes que importam:
- reserva **atômica** em Lua (`GET` + compara + `INCR`): ler e depois incrementar
  em duas chamadas deixaria dois workers passarem juntos no último slot, e um
  `INCR` seco inflaria o contador nas tentativas negadas — o teto "vazaria" pra
  baixo a cada retry;
- a cota é consumida no **último instante** antes do envio, não na consulta —
  senão passo descartado depois (LGPD, lead sem telefone) gastaria cota;
- contador por **data de Brasília** (23h de quarta ainda é quarta), TTL 36h;
- corrida na borda do teto **reagenda** em vez de marcar a execução `FALHOU`;
- Redis fora = passa direto. Teto que vira apagão quando o Redis pisca seria pior
  que não ter teto.

23 testes novos.


### 🌙 Janela de envio: abordagem por WhatsApp não sai de madrugada

O motor de fluxos conta milissegundos, não sabe que horas são: um `DELAY` de 3h
disparado às 21h manda à meia-noite. Mensagem ativa de madrugada é o padrão mais
denunciável que existe — e o número é o mesmo que atende o SAC.

A regra ficou no **pacing**, não em cada fluxo: é o gargalo único por onde já
passava todo outbound, então uma regra só cobre T1, C1, C2, campanhas e o que for
criado amanhã. Padrão **8h–20h, todos os dias** (configurável em Configurações →
"🐢 Ritmo de envio": horário, e se pode abordar no fim de semana).

**Só vale pro PROATIVO.** Responder quem acabou de escrever às 23h continua
saindo na hora — a pessoa está acordada e falando com você. Quem decide é o
GATILHO do fluxo: `MENSAGEM_CANAL` e `LEAD_RESPONDEU` são resposta; cron, tag,
lead criado são abordagem.

**Adia, não descarta.** Fora do horário o passo volta pra fila com delay até a
janela abrir — nunca um `await` de 10 horas, que prenderia um slot do worker a
noite inteira e evaporaria no primeiro redeploy, deixando a execução
`EM_EXECUCAO` pra sempre.

Cobre os três caminhos proativos: nó `ENVIAR_WHATSAPP`, abertura do
`CONVERSAR_IA` e campanha (campanha de e-mail passa direto — e-mail às 3h não
acorda ninguém). O reenvio pós-reconexão do Baileys tem dispensa explícita
(`ignorarJanela`): é reparo de mensagem que já passou pelo gate uma vez.

Config torta não pode calar a empresa: janela invertida (22h→6h) e lista de dias
vazia caem no padrão, e a busca é fail-open. 18 testes na janela, 5 no motor, 3
na campanha.


### 🧹 MCP: excluir lead e apagar etiqueta — as duas faltavam

**`leads_excluir`** (`POST /crm/contato/excluir`, escopo `crm`). Existia
`DELETE /leads/:id` na API, mas nada no MCP — limpar resíduo de teste de fluxo
dependia do Léo na tela.

O cuidado extra tem motivo concreto: em produção a tabela `Lead` guarda **26**
leads de funil e **30.282** contatos da base de prospecção importada, separados
só pelo `funilId`. Um filtro errado apagaria o ativo mais caro do projeto. Por
isso a rota **não aceita filtro**, só lista explícita de até 50 ids, com três
travas antes de apagar qualquer coisa (tudo-ou-nada): id que não resolve derruba
a chamada inteira, lead **sem funil** é recusado por definição, e a contagem tem
que ser repetida no payload (`confirmoExclusaoDe`) — mesmo padrão do
`confirmoEnvioAoCliente`. Devolve o que foi apagado (nome/telefone/funil/etapa),
porque depois a linha não existe mais pra ser consultada.

**`tags_remover`** — a falta que a master apontou depois de usar o `tags_listar`:
achou uma etiqueta torta fora da taxonomia e não tinha como apagar (renomear só
desloca o lixo quando o nome certo já existe). A tool lê os usos antes e
**recusa** se a etiqueta tiver lead ou cliente, a menos que venha
`confirmoRemocaoComUsos: true`.

80 tools no MCP (era 78).


### 🐛 Incidente: conversas de WhatsApp voltavam depois de excluídas

**Sintoma:** "apaguei todas as conversas do WhatsApp e no dia seguinte elas
estavam de volta, com o histórico".

**Trilha do banco:** limpeza às 21:53:24 · conversas recriadas às 21:54:00 —
36 segundos depois, com as mensagens de 21:45–21:47 dentro.

**Causa raiz:** o tombstone que impede reimportação
(`Conversation.mensagensZeradasEm`) mora na PRÓPRIA conversa, e a limpeza geral
APAGA a conversa. O tombstone morria junto. O poll de fallback do Evolution
(a cada minuto, janela de 45s–12min) reimportava tudo em conversas novas — sem
tombstone, prontas pra ressuscitar de novo. `zerar UMA conversa` funcionava (a
linha permanece); `limpar TODAS` nunca teve chance.

**Correção:**
- `InboxLimpeza` (empresa, canal) — marca que SOBREVIVE à exclusão. Mensagem
  anterior à marca não entra mais, nunca. Migration `20260819010000_inbox_limpeza`.
- Teto de idade na ingestão (30min) **só no WhatsApp** — mata o
  `messaging-history.set` do Baileys e o sync inicial do Evolution sem quebrar o
  poll de recuperação (45s–12min). Escopado por canal de propósito: marketplace
  ingere por pull com timestamp de origem, e pergunta do ML de 3h sem resposta é
  SAC legítimo.
- `syncFullHistory: false` explícito na criação da instância Evolution.

**Lição:** tombstone de anti-reimportação não pode morar na linha que a operação
destrutiva apaga.

---

## [1.5.0] — 2026-05-19

Entrega da **SESSÃO MASTER 3** — follow-ups + features deferidas +
performance + hardening + a11y. Foco em deixar o produto pronto para
abertura aos primeiros clientes reais (GO/NO-GO).

### ✨ Features

#### Backend

- **Upload de logo da empresa** (`@modules/empresas`)
  - Schema: `Empresa.logoUrl String?`
  - Migration `20260519000000_add_empresa_logo`
  - `EmpresaLogoService` — upload/remove/getSignedUrl via Supabase Storage
    (bucket `empresa-logos`, signed URL TTL 7 dias)
  - Endpoints: `GET /empresas/:id/logo` (qualquer auth),
    `POST /empresas/:id/logo` (ADMIN ou DIRECTOR),
    `DELETE /empresas/:id/logo`
  - Limites: 2MB, formatos PNG/JPG/WebP/SVG
  - Substitui logo anterior (remove arquivo antigo do storage)

- **AgendaItem recorrência** (`@modules/agenda`)
  - Schema: `recorrencia` enum (NENHUMA/DIARIA/SEMANAL/QUINZENAL/MENSAL/ANUAL),
    `parentId` self-FK
  - Migration `20260519010000_add_agenda_recorrencia`
  - Service gera N instâncias filhas (default 12, configurable 2-52) ao criar
    com recorrência != NENHUMA — cálculo direto na data (sem dep RRULE)
  - Delete suporta `scope`: `this` | `this_and_future` | `series`

- **FormularioCampo multi-step** (`@modules/formularios`)
  - Schema: `passo Int @default(1)`
  - Migration `20260519020000_add_formulario_campo_passo`
  - Service persiste/retorna `passo` no payload público

#### Frontend

- **LogoUploader** (`components/LogoUploader.tsx`)
  - Drag-and-drop + click pra selecionar
  - Preview imediato (data URL) antes do upload
  - Validações client-side: tamanho, formato
  - Warning suave se aspect ratio != 1:1 (não bloqueia)
  - Botão "Remover" com `useConfirm` (dialog brandbook)
  - Toasts success/error
  - Brandbook: bordas tracejadas, hover magenta

- **Logo da empresa no Sidebar** (`components/PageLayout.tsx`)
  - Hook `useEmpresaLogo` busca signed URL (cache 7d)
  - Fallback automático pro `betinna-symbol.svg` se logo falhar
  - `onError` esconde img se URL expirar

- **AgendaPage recorrência** UI
  - Select 'Repetir' na criação (default: Não repetir)
  - Input 'Quantas ocorrências' aparece quando recorrência != NENHUMA
  - Select de escopo no delete (this/this_and_future/series) quando item é
    parte de série

- **FormularioBuilder multi-step** UI
  - Input 'Passo' (1..10) no inspector lateral
  - Novo campo herda o passo do último campo (continua no mesmo)

- **FormularioPublicoPage multi-step**
  - Detecta automaticamente quando há campos com `passo > 1`
  - Progress bar "Passo X de N" + barra %
  - Renderiza apenas campos do passo atual
  - Botões Anterior/Próximo com validação antes de avançar
  - Submit só no último passo
  - Smooth scroll ao topo ao avançar (UX mobile)

- **FluxoEditor undo/redo**
  - History stack manual (max 50 snapshots) com `useRef` (zero deps externas)
  - Push em: drop nó novo, conexão criada, edição inspector, delete nó
  - Atalhos: Cmd/Ctrl+Z desfaz, Cmd/Ctrl+Shift+Z e Cmd/Ctrl+Y refazem
  - Botões Undo/Redo na toolbar superior com tooltip indicando atalho
  - Disabled state quando histórico vazio

- **OnboardingTour aprimorado**
  - Atalhos teclado: ESC pula, ← anterior, → próximo
  - Focus automático no botão Próximo a cada step (focus trap leve)
  - Body scroll lock quando aberto
  - aria-live="polite" anuncia mudança de step
  - Animações fade-in 200ms + slide-up 220ms cubic-bezier
  - Visual brandbook (navy bg, magenta CTA, cyan acento, off-white texto)
  - Hint de atalhos no rodapé do dialog

- **PwaBanner** customizado (`components/PwaBanner.tsx`)
  - Substituiu `window.confirm` feio do update
  - Captura `beforeinstallprompt` → banner "Instalar Betinna.ai"
  - Captura evento custom `pwa:needRefresh` → banner "Nova versão"
  - Dismiss persistido em localStorage
  - Reset no evento `appinstalled` (Chrome)
  - Brandbook: navy bg + magenta CTA + cyan ícone + radius 10px

### ⚡ Performance

- **Bundle splitting otimizado** (`vite.config.ts`)
  - manualChunks: react-vendor, reactflow, exports-xlsx, exports-pdf,
    exports-docx, dnd-kit, sentry, i18n, icons
  - Chunks pesados (xlsx 271KB, jspdf 128KB) ficam fora do path principal
  - Páginas leves (Login/Dashboard) carregam ~40KB entry + react-vendor

### 🎨 PWA Brandbook

- Manifest com cores oficiais:
  - `theme_color: #bd1fbf` (magenta)
  - `background_color: #101820` (preto profundo)
  - `short_name: 'Betinna'` (mais limpo na home screen)
- Ícone: `betinna-symbol.svg` (purpose `any maskable`)

### ♿ Acessibilidade (WCAG AA)

- Skip-to-content link visível ao receber focus (radius 10px, brandbook)
- `<main id="main-content">` com `tabIndex={-1}` pra receber focus
- Atalho Tab no carregamento → "Pular para o conteúdo"

### 🔍 SEO

- `<title>` descritivo: "Betinna.ai — Plataforma comercial B2B"
- Meta description expandida
- Open Graph (og:type/title/description/image/locale)
- Twitter Card summary
- apple-touch-icon
- `robots.txt`: bloqueia rotas autenticadas, libera `/f/` e `/n/` (públicas)
- viewport-fit=cover (notch iPhone)
- preconnect API URL (reduz RTT do primeiro fetch)
- color-scheme light+dark

### 📚 Documentação

- `backend/docs/MIGRATIONS.md` — guia completo de migrations versionadas:
  estrutura, criar nova migration, aplicar em prod, rollback, smart deploy
  script (3 cenários), drift detection, db push vs migrate

### 🚀 Deploy

- Commit vazio força redeploy Railway frontend para catch-up com main
  (bundle prod estava atrás por várias releases)

---

## [1.4.0] — 2026-05-19

Fechamento final da **SESSÃO MASTER 2** — entrega das últimas 2 frentes
pendentes (AgendaPage drag + E2E coverage) e validação de que FluxoEditor
(Parte 3) e FormularioBuilder (Parte 2) já estavam **implementados em
sessões pré-Master 2** (descoberto durante audit, não precisaram refazer).

### ✨ Features

#### Frontend
- **AgendaPage — drag & drop entre dias** — usa `@dnd-kit/core` (já no
  projeto, sem dep nova):
  - `DndContext` envolve o grid de 7 colunas
  - `PointerSensor` com `activationConstraint distance:8` — click curto
    abre modal de edição, drag-longo (>8px) move o compromisso
  - `DayColumn` (novo) com `useDroppable`, id = data ISO do dia
  - `DraggableItem` (novo) com `useDraggable`, mantém click=editar
  - Visual feedback no drop target (background navy + border) e no item
    sendo arrastado (opacity 0.5 + zIndex 100)
  - `handleDragEnd` recalcula nova data preservando hora, faz
    `PATCH /agenda/:id`, toast de feedback, refetch
  - No-op se largado no mesmo dia (evita request desnecessário)
  - Sem recorrência (defer — exige schema change `AgendaItem.recorrencia`)

### 🧪 Tests
- **5 specs E2E novos no Playwright** — 25 testes cobrindo features das
  releases v1.1.1 → v1.3.0:
  - `login-redesign.spec.ts` (6) — brandbook colors + fluxo login funcional
  - `seed-demo.spec.ts` (4) — popular/limpar dataset + RBAC
  - `audit-log.spec.ts` (5) — filtros + dropdown recurso + refresh
  - `configuracoes-tabs.spec.ts` (5) — troca de aba + ARIA + conteúdo
  - `mullerbot-session.spec.ts` (5) — sessionId localStorage + persist reload
- Total: **13 spec files → 18** (+ 25 testes novos)

### 🔍 Validações da auditoria

Durante o trabalho desta sessão, foi confirmado por inspeção de código
que as seguintes frentes do prompt original **já estavam entregues** em
commits pré-Master 2 (não catalogadas no `MASTER_2_PROMPT_ORIGINAL.md`):

- **FluxoEditor** (Parte 3) — 890 LOC em `src/pages/FluxoEditor.tsx` com
  `@xyflow/react`, 3 colunas (palette + canvas + inspector), drag da
  paleta, save via `PUT /fluxos/:id`. Integrado via `FluxosPage` em modo
  fullscreen modal.
- **FluxoTemplatesPage** — 626 LOC, biblioteca de templates pré-prontos.
- **FormularioBuilder** (Parte 2) — `src/pages/FormularioBuilder.tsx`,
  paleta de tipos de campo (8 tipos), editor de campos editáveis, preview
  público, save via `PUT /formularios/:id`. Integrado via `FormulariosPage`.
- Ambos com Markdown rendering, validação de slug, auto-naming.

Decisão: **não duplicar trabalho**. As partes 2.FormularioBuilder e 3.
FluxoEditor são marcadas como ✅ já existente no relatório final
(`SESSAO_MASTER_2_FINAL_2026-05-19.md`).

### 📦 Versão
- `backend/package.json` e `frontend/package.json`: `1.3.0` → `1.4.0`
  (minor — feature additive: drag + E2E coverage).

### ⏭️ Único item explicitamente diferido
- **AgendaPage recorrência** (RRULE/DAILY/WEEKLY/MONTHLY) — exige
  schema change (`AgendaItem.recorrencia` enum + handler backend), fora
  do escopo de patch UI.

---

## [1.3.0] — 2026-05-19

Sprint de continuação da Master 2 — entrega de **3 das 5 páginas da Parte 2**
em 3 commits sequenciais. Skipados nesta sessão (precisam libs novas ou
schema change): AgendaPage drag/recorrência (react-big-calendar) e
FormularioBuilder multi-step/condicional (dnd-kit + schema).

### ✨ Features

#### Frontend
- **AdminPage 📋 Audit log viewer** — nova seção entre SeedDemo e DeadLetter:
  - Lista paginada (20/pg) consumindo `GET /audit` (backend já existia
    desde v1.1.0 mas sem UI)
  - Filtros: ação (contains), recurso (dropdown via `/audit/recursos`),
    usuarioId
  - Colunas: Quando, Usuário, Ação (badge ciano), Recurso + recursoId, IP
  - Paginação ← / → com disabled states
  - Cores oficiais (#201554 navy nos títulos, #2bcae5 cyan nos badges,
    radius 10px)

- **MullerBotPage sessionId persistente** — contexto multi-turn server-side:
  - `loadOrCreateSessionId()` gera UUID via `crypto.randomUUID()` na 1ª
    visita, persiste em **localStorage** (sobrevive reload)
  - Payload do `POST /mullerbot/perguntar` agora inclui `sessionId` sempre
  - Backend já carregava histórico via `MullerBotCacheService.getHistorico`
    e injetava na chamada do OpenAI — só faltava o frontend enviar
  - Novo botão "Nova conversa" rotaciona id + chama
    `DELETE /mullerbot/historico/:sessionId` (best-effort, Redis tem TTL)
  - Botão antigo "Limpar histórico" virou "Limpar UI" (só local)

- **ConfiguracoesPage tabs UX** — reorganização em 3 abas:
  - 🏢 Empresas (default) — CRUD existente preservado integralmente
  - 💎 Plano — visão agregada (3 cards Free/Pro/Enterprise com contagem,
    lista das 5 primeiras empresas de cada plano)
  - ⚙️ Avançado — hub de atalhos pra Integrações / Permissões / Usuários /
    Notificações / Painel admin / Fluxos (cards com border-left colorido
    brandbook, sem duplicar conteúdo)
  - Tabs strip com ARIA correto (role=tablist/tab/tabpanel)
  - Indicador ativo via bottom border magenta + texto navy bold
  - Botão "+ Nova empresa" só aparece na aba Empresas

### 📦 Versão
- `backend/package.json` e `frontend/package.json`: `1.2.0` → `1.3.0`
  (minor — 3 features de polish UX).

### 🧪 Tests
- **Backend: 1372 / 1372 verde** (sem regressão).
- Frontend typecheck + build OK.

### ⏭️ Deferido pra próxima sessão
- **AgendaPage** — drag & drop + recorrência (`react-big-calendar`, 1-2h).
- **FormularioBuilder** — multi-step + condicional (schema change
  `FormularioCampo.condicionalDe/Valor` + dnd-kit, 2-3h).
- **Parte 3** — FluxoEditor React Flow (8-12h, sprint dedicada).
- **Parte 5** — 5 E2E specs novos (2-3h, sprint de QA).

---

## [1.2.0] — 2026-05-19

Sprint de continuação da Master 2 — entrega da **Parte 4 (Seed Demo)** inteira
em 4 commits sequenciais (schema → service → endpoints → frontend), feature
que estava deferida na v1.1.1.

### ✨ Features

#### Backend
- **Novo módulo `admin`** (`src/modules/admin/`) — guarda-chuva pra ferramentas
  administrativas cross-tenant. Por enquanto contém só seed-demo, vai crescer.
- **`SeedDemoService`** — gera dataset realista de ~750 records numa empresa:
  - 50 clientes (cidades/UFs/regiões variadas, prazos, limites)
  - 200 produtos (4 linhas: Alimentos / Bebidas / Limpeza / Embalagens)
  - 300 pedidos espalhados em 3 meses (status variados, itens reais com desconto)
  - 50 propostas (status RASCUNHO/ENVIADA/NEGOCIACAO/ACEITA/RECUSADA/EXPIRADA)
  - 30 conversas Inbox (WhatsApp/IG/FB/Email com mensagens realistas)
  - 1 pesquisa NPS + 100 respostas (DETRATOR/PASSIVO/PROMOTOR distribuídos)
  - 20 amostras (envio + follow-up de 7 dias)
  - 3 meses × N reps de comissões fechadas
  - `multiplier` em [0.1, 5] permite escalar dataset
- **Endpoints `/admin/seed-demo`** (gate `@Roles('ADMIN', 'DIRECTOR')` + `@Audit`):
  - `GET /admin/seed-demo/status?empresaId=` — contagens por modelo
  - `POST /admin/seed-demo` `{ empresaId, multiplier? }` — popula (idempotente)
  - `DELETE /admin/seed-demo?empresaId=` — limpa só `isDemo=true`
- **Idempotência garantida** — `run()` sempre chama `wipe()` antes
- **Safety**: `wipe()` filtra SEMPRE por `isDemo=true` (jamais toca dado real)

#### Frontend
- **Nova seção 📦 Dados de demonstração na AdminPage** — entre SystemStatus
  e DeadLetterSection:
  - Cards das 8 contagens com borda esquerda ciano (`#2bcae5`)
  - Badge magenta (`#bd1fbf`) quando populado / cinza quando vazio
  - Botão "Popular dataset demo" em magenta oficial com confirmação
  - Botão "Limpar dados demo" outline danger com confirmação destrutiva
  - Loading/error states via StateView, toast de feedback
  - Border radius 10px (padrão Betinna)

### 🗄️ Schema
- **Migration `20260518100000_add_is_demo_flag`** — adiciona
  `isDemo Boolean @default(false)` em 8 modelos: Cliente, Produto, Pedido,
  Proposta, Amostra, Comissao, Conversation, RespostaNPS. Todos com índice
  composto `@@index([empresaId, isDemo])` (RespostaNPS usa `@@index([isDemo])`
  porque não tem empresaId direto — escopo via PesquisaNPS).
- **Zero impacto em dados existentes** (aditiva, NOT NULL DEFAULT false).
- **Prisma 6.19.3 mantido** — sem upgrade.

### 🧪 Tests
- **10 specs novas** no `seed-demo.service.spec.ts`: smoke + comportamento
  crítico (wipe filtra isDemo=true, run chama wipe antes, multiplier escala
  dataset, todos os createMany marcam isDemo=true).
- **Total: 1372 / 1372 verde** (era 1362 na v1.1.1).

### 📦 Versão
- `backend/package.json` e `frontend/package.json`: `1.1.1` → `1.2.0` (minor,
  porque adicionou feature nova — módulo admin completo).

---

## [1.1.1] — 2026-05-18

Sprint de polish + correção de bugs reportados pós-1.1.0. Foco em qualidade
visual (LoginPage no padrão brandbook) e estabilidade da suíte de testes.

### 🎨 Visual
- **LoginPage redesign completo** — refeito do zero seguindo `BRANDBOOK.md`:
  - Background gradient radial navy escuro (`#15093c` → `#201554`)
  - Card com glow magenta sutil + backdrop-blur, border radius 10px
  - Tipografia oficial: Fira Sans Black (título) + Cabin (corpo)
  - Inputs com focus ring ciano (`#2bcae5`) + box-shadow
  - CTA magenta (`#bd1fbf`) com hover scale + lift
  - Mensagens de erro humanizadas por status HTTP (401/429/5xx)
  - Acessibilidade: `aria-label`, `aria-describedby`, `role=alert`, `autoFocus`
  - Fade-in animation no mount, mobile responsive (max-w 440px)
  - **Fluxo de auth D47 (cookie httpOnly) inalterado**

### 🧪 Tests
- **`mullerbot.service.spec.ts`** — 11 specs agora passando.
  Causa: `MullerBotService` ganhou `MullerBotPersonaService` como 6º arg
  (system prompt vem da persona configurável por empresa via UI
  `/mullerbot/persona`). Adiciona `makePersona()` stub determinístico e
  aplica em todos os 12 sítios de `new MullerBotService(...)`.
- **`leads.service.spec.ts`** — 2 specs corrigidas:
  - Adiciona mocks `funil.findFirst` e `funilEtapa.findFirst/findMany` (default `null`/`[]`) — multi-funnel feature não estava coberto.
  - Atualiza teste de "transição inválida" de `NOVO → GANHO` (agora válido — pipeline real fecha venda direto do lead novo) para `PERDIDO → GANHO` (continua inválido — PERDIDO só pode voltar pra etapas ATIVAS).
- **Total: 1362 / 1362 verde** (era 1349 / 1362).

### 🛡️ Observability
- **Sentry helpers `window.__BETINNA_*` validados em produção** — eventos
  chegando no dashboard com eventId correlacionado. `__BETINNA_SENTRY__`
  (status init), `__BETINNA_TEST_SENTRY__()` (test trigger + flush) e
  `__BETINNA_SENTRY_SDK__` (SDK exposure pra debug) já em produção desde
  v1.1.0 (commit `378bcf3`).

### 🔧 Brandbook compliance
- LoginPage **não usa mais** `#7c3aed` (Tailwind violet), `#BB29BB` ou
  `#4AC9E3` (aproximações erradas listadas no Don'ts do BRANDBOOK).

### 📦 Versão
- `backend/package.json` e `frontend/package.json` finalmente sincronizados com CHANGELOG (estavam em `1.0.0` desde o lançamento).

---

## [1.1.0] — 2026-05-17

Sprint de auditoria master final + correções P0/P1/P2/P3. Sistema revalidado para produção: 1362 tests passing, 0 vulnerabilities, 0 lint warnings, build clean.

### ✨ Features

#### Backend
- **Módulo `fidelidade`** — programa de pontos por cliente (acumular/resgatar) DIRECTOR-only
- **Módulo `import`** — CSV importer (clientes/produtos) via Zod schema, limite 1MB
- **Módulo `notificacoes`** — CRUD + marcar lida + bulk + filtros (NotificationBell no header)
- **`AuditController` viewer** — endpoint `/audit` ADMIN-only com filtros, paginação, `/audit/recursos` distinct
- **`metrics` (Prometheus)** — `/metrics` endpoint com counters por módulo
- **`catalog-share`** — share JWT TTL 7d pra envio de catálogo via WhatsApp
- **`mullerbot-cache`** — cache Redis de respostas (TTL 1h)
- **Validadores BR** — CPF/CNPJ/telefone/CEP com 25 specs
- **`RetentionCleanupJob` (LGPD)** — cron dia 2 às 05:00 UTC purga AuditLog/Message (24m) + Notificacao lidas (6m). Retentions configuráveis via env. Auto-registra PURGE no AuditLog
- **Sentry APM tracing** — `tracesSampleRate` configurável (default 0.1 prod / 1.0 dev) + `prismaIntegration` (spans SQL) + auto-instrumentação http/express/redis
- **OMIE retry exponencial** em faults (`isRetryableFault`)
- **WhatsApp/Meta media download** — `whatsapp-media.service.ts`, `meta-media.service.ts`
- **SendGrid templates** + `transactional-email.service.ts`
- **`scripts/backup-to-storage.ts`** — backup automatizado pro Supabase Storage

#### Frontend
- **NotificacoesPage** + **NotificationBell** + **OnboardingTour** + **LanguageSelect** + **Markdown**
- **i18n**: pt-BR + en-US + es (i18next)
- **PWA**: service worker + manifest
- **Exports**: PDF (jspdf), DOCX (docx), XLSX (exceljs em worker), CSV (papaparse)
- **13 E2E specs Playwright**: auth, RBAC, CRUD smoke, inbox, inbox-bulk, fidelidade, notificações, onboarding, pedidos, relatórios, catalog-audit, import-metrics

### 🛡️ Security
- **LGPD compliance**: política formal de retenção implementada (`LGPD_*_RETENTION_MONTHS` configuráveis)
- **Body parser 2MB explícito** (P1): default Express 100KB conflitava com CSV import 1MB. Usa `app.useBodyParser` (preserva `rawBody:true` pros webhooks)
- **OMIE `enviarPedido(id, empresaId?)`** (P3 defensive scoping): aceita empresaId opcional para defesa em profundidade
- **`xlsx` CVE fix**: substituído por `exceljs` (Prototype Pollution + ReDoS)
- **0 vulnerabilities** em `npm audit` (backend + frontend)

### 🚀 Performance
- **7 índices compostos novos**: `Pedido(criadoEm)`, `Cliente(empresaId,representanteId)`, `Conversation(canal,ultimaMensagemEm)`, `MarketplaceIncident(empresaId,status)`, `AuditLog(empresaId,criadoEm)`, `Notificacao(usuarioId,lida)`, `Comissao(empresaId,periodo)`
- **Bundle frontend ~105KB gzip** (após D47 — Supabase SDK removido do path principal)

### 🔧 Fixed
- **Inbox race condition** no upsert manual de `Conversation` — migration `20260517010000_inbox_race_unique` (índice único parcial)
- **CronLock atomicity** — 4 specs novos cobrem race & TTL edge cases
- **Deps cleanup**: `@nestjs/terminus`, `nestjs-zod` (backend), `jose` (frontend) — removidas

### 🧪 Tests
- **Backend**: 1362 tests passing em 94 spec files (+62 vs versão 1.0.0)
- **Frontend**: 13 E2E spec files (108 specs Playwright, +98 vs scaffold inicial)
- **Canonical typecheck**: `npm run typecheck` (usa `tsconfig.build.json`) — clean
  - Nota: `tsc --noEmit` direto inclui specs com mocks parciais (ML/Shopee/TikTok types incompletos) e mostra ~80 erros estáticos que **não afetam runtime** (vitest aceita)

### 📚 Docs
- `backend/_audit/MASTER_VALIDATION_REPORT_2026-05-17.md` — relatório das 12 fases
- `AUDIT_REPORT.md` (raiz) — histórico de findings + status
- `DEPLOY.md` — passo-a-passo Railway + smoke tests + rollback
- `docs/modules/` — documentação por módulo (16 arquivos)

### 📦 Migrations
- `20260517000000_fidelidade` — programa de pontos
- `20260517010000_inbox_race_unique` — race condition fix via índice único parcial
- `20260517020000_indexes_performance` — 7 índices compostos

### 🎯 Auditoria
- 12 fases concluídas conforme `_audit/MASTER_VALIDATION_REPORT_2026-05-17.md`
- **0 P0 abertos · 0 P1 abertos · 0 P2 abertos · 0 P3 abertos (4 P3 endereçados nesta rodada)**

---

## [1.0.0] — 2026-05-15

Primeira release pronta para produção. Resultado de 5 sprints de auditoria
+ remediação após audit inicial detectar 44 P0 + 80 P1 + 57 P2 issues.

### 🛡️ Security
- **Sprint 1** — 10 fixes P0 (deploy blockers):
  - Webhook secrets obrigatórios em produção (OMIE/Meta/Shopee/TikTok)
  - Express `trust proxy` + ML webhook IP whitelist correto
  - AuthGuard Redis cache (TTL 60s) — elimina 2 queries DB por request
  - `bulkAssignRep` com `@Roles` gate + scope GERENTE
  - `ComissoesService` filtro empresaId (ADMIN bypass, others restritos)
  - `FluxoExecutor` empresaId obrigatório em 6 ações
  - `EmpresaSequence` + `SequenceService` atomic (substitui `count()+1`)
  - Campaign idempotency `SETNX` + lock otimista no `disparar`
  - Cron singleton lock distribuído (8 jobs)
  - Comissão snapshot percentual preservado

- **Sprint 2** — 8 fixes multi-tenant + critical services (P1):
  - `AgendaItem.empresaId` (schema + service refactor)
  - `Tag.empresaId` (`@@unique([empresaId, nome])` substitui global)
  - `PricingService` empresaId obrigatório em todos métodos
  - `RelatoriosService` scope completo (SAC/Campanhas/Amostras agora filtram)
  - SSRF protection (`safe-request.ts` + 35 testes)
  - Schema audit: 38/38 modelos com tenant isolation
  - JWT hardening + `UsersService` ADMIN-only para cross-tenant
  - Rate limiting per-endpoint via Throttler + Redis storage

- **Sprint 3** — 8 fixes reliability + observability:
  - Webhook anti-replay (timestamp window 5min + signature dedup Redis 10min)
  - Refresh token rotation + reuse detection
  - BullMQ Dead Letter Queue + admin endpoint + Sentry capture
  - Pino sanitize PII + AsyncLocalStorage requestId
  - Sentry init com `beforeSend` strip PII
  - Health endpoints `/health` (liveness) + `/health/deep` (DB+Redis+BullMQ)
  - Pre-deploy backup script + restore script (com confirmação interativa)
  - Docker Compose + nginx (deploy VPS alternative — Railway é primary)

- **Sprint 3.5** — Redis TLS audit:
  - `buildRedisOptions()` helper aplica TLS em Railway production
  - Aplicado em 3 instâncias (RedisService, Throttler storage, BullMQ)

### ✨ Features
- **Sprint 4** — 8 fixes Railway readiness:
  - `railway.toml` (Web + Worker) com healthcheckPath
  - Worker entry point separado (`src/worker.ts` + `SERVICE_TYPE`)
  - WhatsApp session persistence via PostgreSQL (Baileys auth state cifrado AES-256-GCM)
  - Frontend scaffold: Vite + React 18 + Router 6 (createBrowserRouter)
  - Frontend hardening: api.ts singleton + JWT em memória + ErrorBoundary + usePermission RBAC
  - Playwright E2E: 10 testes smoke
  - `env.example.railway.txt` com 60+ vars categorizadas
  - Bundle inicial: **67.42 KB gzipped** (target era < 200KB)

- **Sprint 5** — 8 fixes CI/CD + monitoring:
  - GitHub Actions CI pipeline (build + test + e2e + Railway deploy)
  - Security workflow (npm audit + Prisma validate + gitleaks)
  - k6 load tests (smoke + stress + spike) com thresholds
  - Lighthouse CI budgets (performance > 85, a11y > 90, FCP < 2s, LCP < 3s)
  - UptimeRobot setup docs (`docs/monitoring.md`)
  - Backup automatizado diário pra S3-compatible com retention 30 dias
  - Restore runbook detalhado (12 passos + smoke tests pós-restore)
  - CHANGELOG + release workflow + `/version` endpoint

### 🏗️ Infrastructure
- Multi-tenant scope: 38/38 modelos Prisma com `empresaId`
- Tests: **332 unit** + **10 E2E** Playwright
- Sprint 1+2 schemas: `EmpresaSequence`, `Comissao.empresaId`, `Tag.empresaId`, `AgendaItem.empresaId`
- `Pedido.numero` e `Proposta.numero` agora unique por empresa (era global → cross-tenant collision)

### 📦 Dependencies
- NestJS 11 + Prisma 6.19.3 + Postgres 16 (Supabase) + BullMQ 5 + Redis 7
- Vite + React 18 + React Router 6
- Node.js 20 LTS

### 🔍 Auditoria
Audit inicial em `backend/_audit/AUDITORIA_2026-05-15.md` (181 findings).
Resultado pós-Sprint 5: **0 P0 + 0 P1 + ~10 P2 hardening** (não-bloqueantes).

### 🚦 Production status
- ✅ Railway deploy ready (3 services + 2 plugins)
- ✅ CI/CD pipeline (GitHub Actions)
- ✅ Monitoring (UptimeRobot + Sentry + Railway metrics)
- ✅ Backup diário S3
- ✅ DR runbook validado

---

## Próximas versões (planejadas)

### [1.1.0] — Próximo sprint (não iniciado)
- Frontend integração completa com APIs (módulos clientes, pedidos, campanhas)
- E2E expandido (visual regression via Playwright snapshots)
- Multi-region Railway deployment (latência menor pra SP/RJ)
- Mobile app (React Native + Expo) — fase 2

### [2.0.0] — Roadmap longo prazo
- Migração WhatsApp Baileys → WhatsApp Business API oficial (compliance Meta)
- Prisma upgrade 6.x → 7.x
- pgvector pra MullerBot (substitui keyword search quando volume > 500 produtos/empresa)
- Multi-language UI (i18n pt-BR + es-AR + en-US)
- White-label tenant branding
