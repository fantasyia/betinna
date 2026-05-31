# Bot Muller no WhatsApp da empresa (Fase 2)

> Ligar o chatbot de IA (Muller) ao WhatsApp central da empresa, respondendo
> clientes automaticamente. **Por enquanto é conversa pura** (sem catálogo/RAG) —
> o Muller responde com a persona configurada, mas ainda não consulta os produtos.

---

## 1. Como funciona (visão simples)

1. Um cliente manda mensagem no **WhatsApp central da empresa** (a central de SAC).
2. O Muller lê a mensagem, junta o histórico recente da conversa e a persona
   configurada, e responde sozinho — geralmente em poucos segundos.
3. A resposta dele aparece no Atendimento com a tag **🤖 Muller**.
4. Se um **atendente humano responder** aquela conversa, o bot **se cala
   automaticamente** naquela conversa por algumas horas (handoff). Depois desse
   prazo, volta a responder sozinho.

### O que o bot NUNCA faz

- ❌ **Não responde no WhatsApp pessoal dos representantes.** Só atua no número
  central da empresa. O WhatsApp de cada rep continua 100% humano.
- ❌ **Não responde mensagens que ele mesmo enviou** (anti-eco).
- ❌ **Não atua em conversa pausada** (handoff humano ou pausa manual).
- ❌ **Não faz disparo em massa, ações automáticas nem usa templates.**

### Mensagens só com mídia (sem texto)

O bot só responde quando há **texto de verdade** do cliente:

| O que o cliente manda | O bot... |
|---|---|
| Texto (inclui emoji isolado tipo "👍") | responde normalmente |
| Imagem ou vídeo **com legenda** | responde usando o texto da legenda (a mídia em si é ignorada por ora) |
| Imagem/vídeo **sem legenda**, **áudio**, documento, figurinha, localização, contato | **não responde** — marca a conversa como **🚨 Precisa de humano** e sobe pro topo |

> Áudio escala pra humano por enquanto. **Transcrição de áudio** e **leitura do
> conteúdo de imagem/documento** ficam pra próxima fase. O motivo da não-resposta
> fica registrado no log (`[bot] SEM-RESPOSTA ... motivo="..."`).

### Proteções automáticas

- **Anti-spam:** se o mesmo número mandar mais de 10 mensagens em 1 minuto, o bot
  pausa essa conversa e marca **🚨 Precisa de humano**.
- **Timeout:** se a IA demorar mais de 15 segundos ou falhar, o bot manda uma
  mensagem padrão (*"Recebi sua mensagem! Vou conferir e já te respondo. 👍"*) e
  marca a conversa como **🚨 Precisa de humano** — que sobe pro topo da lista.

---

## 2. Ligar / desligar o bot

### Liga/desliga GERAL (toda a empresa)

Tela **Atendimento → Persona** (`PersonaBotPage`):

- Card **"Bot no WhatsApp da empresa"** → interruptor **Resposta automática**.
- Ligado = o Muller responde os clientes. Desligado = só atendimento humano.
- Por padrão vem **ligado**.

> Tecnicamente: grava `Empresa.botWhatsappAtivo` via `PATCH /empresas/:id`.
> Apenas **DIRECTOR** (ou ADMIN como suporte) consegue mexer.

### Pausar/religar UMA conversa específica

Tela **Atendimento → Inbox**, dentro de uma conversa de WhatsApp:

- Botão **"⏸ Pausar bot"** → o bot para de responder aquela conversa (handoff
  manual). O botão vira **"▶ Religar bot"**.
- Isso acontece **automaticamente** sempre que um humano responde a conversa.

> Endpoints: `POST /inbox/:id/bot/pausar` e `POST /inbox/:id/bot/religar`.

---

## 3. Indicadores visuais no Atendimento

| Indicador | Onde | Significa |
|---|---|---|
| **🤖 Muller** | ao lado do horário da mensagem | resposta foi enviada pelo bot |
| **⏸ Bot pausado** | selo na lista de conversas | o bot está pausado nessa conversa (handoff) |
| **🚨 Precisa de humano** | selo + faixa vermelha; conversa vai pro topo | a IA falhou/spam — alguém precisa assumir |

---

## 4. Configuração (env / Railway)

| Variável | Default | Para que serve |
|---|---|---|
| `OPENAI_API_KEY` | — | Chave da OpenAI usada pelo bot (já configurada pelo Léo). |
| `MULLERBOT_MODEL` | `gpt-4o-mini` | Modelo da OpenAI usado nas respostas. |
| `BOT_HANDOFF_HORAS` | `24` | Quantas horas o bot fica calado numa conversa depois que um humano responde (handoff). |
| `MULLERBOT_WHATSAPP_CATALOGO` | `false` | Liga o catálogo (RAG) no bot. `false` = **puro conversa** (atual). Trocar pra `true` ATIVA o RAG (busca de produtos + guardrails anti-alucinação) **sem mexer em código** — só redeploy. |

Para mudar o tempo de handoff: ajuste `BOT_HANDOFF_HORAS` no Railway (serviços
**api** e **worker**) e redeploy. Ex.: `BOT_HANDOFF_HORAS=4` deixa o bot voltar a
responder 4 horas após o último atendimento humano.

**Ligar o catálogo no futuro:** o código do RAG já está pronto. Para ativar,
defina `MULLERBOT_WHATSAPP_CATALOGO=true` no Railway (api + worker) e redeploy —
o bot passa a buscar produtos relevantes do catálogo e responder com os
guardrails anti-alucinação. O log mostra `catalogo=on(Nprod)` quando ativo.

---

## 5. Monitorar custo / tokens

Cada resposta da IA gera uma linha de log no serviço **api** (Railway → Logs):

```
[bot] OK conv=<id> peer=<numero> modelo=gpt-4o-mini msg="..." prompt_aprox=420tok tokens_in=123 tokens_out=45 tempo=812ms
[bot] SEM-RESPOSTA conv=<id> peer=<numero> tipo=AUDIO motivo="mídia sem texto (audio)" → marcado precisa humano
[bot] FALLBACK conv=<id> peer=<numero> msg="..." tempo=15003ms status=falha
[bot] anti-spam: peer=<numero> excedeu 10/min — pausado + precisa humano
```

- `prompt_aprox` = estimativa do tamanho do prompt enviado (em tokens). Quando o
  catálogo for ligado no contexto, esse número sobe — assim dá pra ver quanto do
  gasto vem do catálogo.
- `tokens_in` / `tokens_out` = consumo real daquela resposta (use pra estimar custo).
- O custo real aparece no **painel da OpenAI** (platform.openai.com → Usage).
- `gpt-4o-mini` é barato; ainda assim, acompanhe o volume nas primeiras semanas.

---

## 6. Passo a passo de teste (manual)

> Pré-requisito: WhatsApp da empresa **conectado** (Atendimento → WhatsApp, QR lido)
> e `OPENAI_API_KEY` válida no Railway.

1. **Bot responde (caminho feliz)**
   - De outro celular, mande uma mensagem pro número da empresa (ex.: *"Oi, vocês
     atendem em todo o Brasil?"*).
   - Em poucos segundos deve chegar uma resposta. No Atendimento, ela aparece com
     a tag **🤖 Muller**.

2. **Handoff automático**
   - Na mesma conversa, um atendente humano responde algo pelo Inbox.
   - Mande nova mensagem do celular cliente → **o bot NÃO responde** (está pausado).
   - A conversa mostra o selo **⏸ Bot pausado**.

3. **Religar manual**
   - No header da conversa, clique **▶ Religar bot**.
   - Mande nova mensagem do celular → o bot volta a responder.

4. **WhatsApp pessoal do rep não é afetado**
   - Mande mensagem pro WhatsApp pessoal de um representante.
   - O bot **nunca** responde ali — confirmação da regra de segurança.

5. **Desligar geral**
   - Em Atendimento → Persona, desligue **Resposta automática**.
   - Mande mensagem pro número da empresa → o bot **não responde** (só humano).
   - Religue ao final do teste.

6. **Mídia sem texto escala pra humano**
   - Do celular cliente, mande **só um áudio** (ou uma imagem sem legenda) pro
     número da empresa.
   - O bot **não responde**; a conversa aparece com **🚨 Precisa de humano** no
     topo do Inbox.
   - Agora mande uma **imagem com legenda** (ex.: *"esse produto vocês têm?"*) →
     o bot responde considerando o texto da legenda.

7. **Fallback (opcional / avançado)**
   - Com uma `OPENAI_API_KEY` inválida, mande mensagem pro número da empresa.
   - Deve chegar a mensagem padrão *"Recebi sua mensagem…"* e a conversa sobe pro
     topo com **🚨 Precisa de humano**.

---

## 7. O que ainda falta (próximos passos da Fase 1/2)

- **Ligar o catálogo (RAG) no bot do WhatsApp:** hoje o bot roda em **puro
  conversa** (sem catálogo). O caminho do RAG **já está implementado e pronto** —
  é só definir `MULLERBOT_WHATSAPP_CATALOGO=true` no Railway e redeploy (sem
  mexer em código). O log `prompt_aprox` + `catalogo=on(Nprod)` mostram o custo
  extra. Evolução futura: tornar "sob demanda" (só quando a mensagem citar produto).
- **Transcrição de áudio / leitura de mídia:** áudio e imagem sem legenda hoje
  escalam pra humano. Transcrever áudio e "ler" imagem/documento fica pra próxima
  fase (o cliente que manda só mídia é atendido por uma pessoa).
- **Histórico mais longo / memória:** hoje o bot usa as últimas 10 mensagens de
  texto da conversa. Sem resumo de conversas antigas.
- **Horário de atendimento:** não implementado — o bot responde 24/7 enquanto
  estiver ligado.
- **Métricas de uso do bot na UI:** consumo de tokens só via logs do Railway /
  painel da OpenAI; ainda não há um dashboard dentro do app.

---

## 8. Arquivos principais

| Arquivo | Papel |
|---|---|
| `backend/src/modules/mullerbot/muller-whatsapp.service.ts` | Motor do bot: decide se responde, anti-spam, timeout, fallback. |
| `backend/src/modules/mullerbot/mullerbot.service.ts` | `responderComoEmpresa()` — chama a OpenAI com a persona. |
| `backend/src/modules/mullerbot/persona.service.ts` | `compilarSystemPromptConversa()` — prompt conversacional (sem catálogo). |
| `backend/src/modules/inbox/inbox.service.ts` | Hook do bot, `responderComoBot`, handoff, pausar/religar. |
| `frontend/src/pages/InboxPage.tsx` | Tag 🤖, selos, botões pausar/religar. |
| `frontend/src/pages/PersonaBotPage.tsx` | Toggle global do bot no WhatsApp. |
