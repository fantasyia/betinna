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

Para mudar o tempo de handoff: ajuste `BOT_HANDOFF_HORAS` no Railway (serviços
**api** e **worker**) e redeploy. Ex.: `BOT_HANDOFF_HORAS=4` deixa o bot voltar a
responder 4 horas após o último atendimento humano.

---

## 5. Monitorar custo / tokens

Cada resposta da IA gera uma linha de log no serviço **api** (Railway → Logs):

```
[bot] OK conv=<id> peer=<numero> msg="..." tokens_in=123 tokens_out=45 tempo=812ms
[bot] FALLBACK conv=<id> peer=<numero> msg="..." tempo=15003ms status=falha
[bot] anti-spam: peer=<numero> excedeu 10/min — pausado + precisa humano
```

- `tokens_in` / `tokens_out` = consumo daquela resposta (use pra estimar custo).
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

6. **Fallback (opcional / avançado)**
   - Com uma `OPENAI_API_KEY` inválida, mande mensagem pro número da empresa.
   - Deve chegar a mensagem padrão *"Recebi sua mensagem…"* e a conversa sobe pro
     topo com **🚨 Precisa de humano**.

---

## 7. O que ainda falta (próximos passos da Fase 1/2)

- **Conectar o catálogo (RAG):** hoje o bot conversa, mas não consulta os
  produtos importados do OMIE. O próximo passo é ligar o `ProdutoSearchService`
  pra ele responder preço/disponibilidade de SKU. *(combinado com o Léo: "deixa
  puro conversa por enquanto, depois te explico como conectar o catálogo".)*
- **Download de mídia recebida:** áudio/imagem que o cliente manda ainda chegam
  como placeholder (`[áudio]`, `[imagem]`) — o bot não "ouve/vê" o conteúdo.
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
