# Inbox unificada + Marketplaces

A inbox agrega **todos** os canais de conversação em uma única tela. Adapter por canal converte mensagens externas para o modelo unificado.

## Arquitetura

```
                      ┌─────────────────────────┐
                      │   CanalAdapterRegistry  │
                      └────────────┬────────────┘
                                   │
   ┌───────────┬───────────┬───────┴───────┬──────────────┬──────────────┐
   │           │           │               │              │              │
WhatsApp   Meta(FB+IG)   ML            Shopee         Amazon         TikTok
(Baileys)  (Graph API)   (REST+IP)     (HMAC+OAuth)   (LWA+SP-API)   (HMAC sandwich)
   │           │           │               │              │              │
   ▼           ▼           ▼               ▼              ▼              ▼
   Conversation + Message (modelos canal-agnósticos)
```

## Modelos

### `Conversation`
- `canal` (enum `MessageChannel`: WHATSAPP, INSTAGRAM, FACEBOOK, EMAIL, MARKETPLACE_ML/SHOPEE/AMAZON/TIKTOK)
- `externalId` (peerId estruturado, ex: `pack:123`, `q:456`, `claim:789`)
- `proprietarioId` (FK Usuario, nullable) — D38 dual-owner
- `clienteId` (resolvido por sufixo telefone, D18)
- `categoria` (`GERAL`, `PRE_VENDA`, `POS_VENDA`, `RECLAMACAO`, `MEDIACAO`, `DEVOLUCAO`, `DISPUTA`)
- `incidentId` (FK opcional pra MarketplaceIncident)
- `status` (`ABERTA`, `EM_ATENDIMENTO`, `RESOLVIDA`)

### `Message`
- `tipo` (TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, LOCATION)
- `direcao` (INBOUND, OUTBOUND)
- `status` (PENDING, SENT, DELIVERED, READ, FAILED)
- `externalId` (idempotência via unique)

## WhatsApp (Baileys) — D15/D17/D38

**Dual-owner:**
- **Empresa**: 1 número central, persistido em `IntegracaoConexao(servico='whatsapp')`, operado pelo SAC
- **Pessoal**: cada usuário/REP tem o próprio, em `UsuarioIntegracao(servico='whatsapp')`

Sessões Baileys indexadas por `ownerKey` (`emp:<id>` ou `user:<id>`). Boot restaura ambas.

### Pareamento

1. User em `/whatsapp` (empresa, ADMIN/DIRECTOR) ou `/usuario/integracoes/whatsapp` (pessoal)
2. Clica "Conectar"
3. Backend gera QR Code via Baileys, retorna Data URL
4. User escaneia com WhatsApp do celular
5. Auth state cifrado AES-256-GCM e persistido (debounce 200ms, D17)
6. Sessão fica conectada — desconecta só por logout manual ou ban

### Limitações
- 1 socket por número (não escala horizontal sem gateway)
- Só 1:1 (grupos e broadcasts ignorados)
- Mídia: marca `tipo` + `mediaMime` mas guarda placeholder (download p/ Storage não implementado)
- Risco ban Meta — usar número dedicado, não pessoal

### Acesso por papel

- **SAC/GERENTE/DIRECTOR/ADMIN**: veem todos os canais (incluindo WhatsApp empresa)
- **REP**: vê APENAS o próprio WhatsApp pessoal (qualquer pessoa que ele conversar — cliente, prospect, fornecedor). NÃO acessa marketplaces nem redes sociais.

## Meta (Facebook + Instagram) — D19/D20

Graph API oficial. Uma `IntegracaoConexao` por canal (`facebook` e `instagram`), `externalAccountId` = pageId/igUserId (indexável).

### OAuth flow

1. DIRECTOR em `/integracoes` clica "Conectar Facebook"
2. Redireciona Meta com state JWT (HS256 derivado da `ENCRYPTION_KEY`, D14)
3. Meta retorna code → backend troca por user token short-lived → long-lived (~60d)
4. Lista pages do user → DIRECTOR escolhe (MVP usa a primeira, D20)
5. Page Access Token cifrado e persistido
6. Se page tem IG Business vinculado: cria segunda `IntegracaoConexao` com `igUserId`

### Webhook único

`POST /webhooks/meta`:
- GET handshake com `META_GRAPH_VERIFY_TOKEN`
- POST com HMAC SHA-256 do `META_GRAPH_APP_SECRET`
- Routing: `messaging` → Messenger, `messages` (IG) → Instagram

## Marketplaces

Modelo `MarketplaceIncident` canal-agnóstico cobre reclamações/devoluções/disputas/mediações:

| Status MarketplaceIncident | Significado |
|---|---|
| `ABERTO` | Recém criado |
| `AGUARDANDO_VENDEDOR` | Bola está com a gente |
| `AGUARDANDO_COMPRADOR` | Esperando comprador agir |
| `EM_MEDIACAO` | Marketplace mediando |
| `RESOLVIDO` | Encerrado favorável a ambos |
| `EXPIRADO` | SLA estourou |
| `CANCELADO` | Comprador desistiu |

Endpoint `/marketplace/incidentes` filtra por canal/tipo/status/aguardandoMim/prazoUrgente.

### Mercado Livre (D26/D27)

**Cobre 100% do atendimento ML**: questions pré-venda + chat pós-venda (packs) + claims + mediações + devoluções + cancelamentos.

- OAuth 2.0 + refresh rotativo (margem 60s)
- Webhook `/webhooks/mercadolivre` com IP whitelist (ML não tem HMAC)
- `MLService.enviarTexto` roteia por prefixo do peerId:
  - `q:<id>` → POST /answers (pergunta pré-venda)
  - `pack:<id>` → POST /messages (chat pós-venda)
  - `claim:<id>` → POST /claims/.../messages
- Cron fallback **10 min** (D28)

### Shopee (D29/D30/D31)

- HMAC SHA-256 em CADA request (`ShopeeSigner` com 3 modos: public/shop/merchant)
- Shop authorization (não OAuth padrão) → access_token (4h) + refresh_token (30d)
- Webhook `/webhooks/shopee` assina `<url>|<body>`
- Chat via `conv:<conversation_id>` peerId; returns/disputes bloqueiam texto livre (usar `abrirDisputa`/`aceitarOferta`)

### Amazon SP-API (D32/D33/D34/D35)

**Cobertura limitada pela API**: sem chat livre, sem mensagens INBOUND expostas. A-to-Z Claims só via Seller Central.

- OAuth LWA + `x-amz-access-token` (sem AWS Sigv4 desde out/2023)
- Multi-região (NA/EU/FE + sandbox)
- 4 Permitted Actions: `confirmDeliveryDetails`, `confirmOrderDetails`, `unexpectedProblem`, `getCustomerInformation` (NFe FORA do escopo — sai pelo hub fiscal externo do cliente)
- Adapter rejeita texto < 5 chars

### TikTok Shop (D36/D37)

- HMAC sandwich `secret + path + sorted_params + body + secret` (`TikTokSigner`)
- OAuth shop authorization (access ~7d, refresh ~365d)
- **Bloqueia envio de texto livre** — TikTok Shop não expõe chat via API
- Returns via endpoints estruturados (seller_proposal/seller_reject/seller_evidence)

## Fluxos típicos

### A. SAC responde reclamação ML

1. ML manda webhook `claims/created` → backend cria `Conversation` + `MarketplaceIncident`
2. SAC em `/inbox` vê item destacado (categoria `RECLAMACAO`, badge laranja)
3. Lê histórico (mensagens + foto comprador)
4. Responde via campo de texto → `MLService.enviarTexto` → POST `/claims/.../messages`
5. Comprador responde no app do ML → webhook reflete na inbox
6. SAC marca `RESOLVIDO` quando comprador aceita

### B. REP atende cliente no WhatsApp pessoal

1. Cliente manda mensagem no WhatsApp do REP
2. Baileys recebe → backend cria/encontra `Conversation` (`proprietarioId=rep.id`)
3. REP em `/inbox` vê só as próprias (filtro automático por `proprietarioId`)
4. Responde via campo de texto → Baileys envia
5. Status atualiza de PENDING → SENT → DELIVERED → READ

### C. Devolução Shopee

1. Comprador abre devolução no app Shopee
2. Webhook `code=6/15/16` → cria `MarketplaceIncident` tipo `DEVOLUCAO`
3. SAC em `/marketplace/incidentes` filtra "Aguardando vendedor"
4. Avalia: aceita devolução ou abre disputa
5. Se disputa: `POST /marketplace/incidentes/:id/abrir-disputa` chama Shopee API
6. Shopee responde com mediação → status vira `EM_MEDIACAO`
