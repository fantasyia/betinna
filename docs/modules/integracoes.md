# Integrações

Dois escopos distintos: **EMPRESA** (tenant inteiro) e **USUÁRIO** (cada user com a sua).

## Escopo EMPRESA (`IntegracaoConexao`)

**Quem conecta**: DIRECTOR ou ADMIN (D45 + D48).

**Por quê DIRECTOR-only?** Cada integração empresa tem responsabilidade contratual ou fiscal:
- OMIE → dados fiscais/contábeis
- Marketplaces → TOS comerciais, comissões, repasse fiscal
- Social (FB/IG) → identidade da marca
- WhatsApp empresa → risco de ban Meta no número dedicado

ADMIN aceita como override de suporte (D48).

### Lista de integrações empresa

| Serviço | Função | OAuth? |
|---|---|---|
| `omie` | ERP — pedidos, clientes, produtos, NFe | API key + secret (não OAuth) |
| `whatsapp` | Número central da empresa (SAC) | Pareamento QR Code (Baileys) |
| `facebook` | Messenger | Sim (Facebook Login + Page Access Token) |
| `instagram` | Direct | Sim (vinculado à page do FB) |
| `mercadolivre` | SAC ML | Sim (OAuth 2.0) |
| `shopee` | SAC Shopee | Partner-level (não OAuth padrão) |
| `amazon` | SAC Amazon SP-API | Sim (LWA) |
| `tiktok` | SAC TikTok Shop | Sim (shop authorization) |

### Credenciais cifradas

Todos os tokens armazenados em `IntegracaoConexao.credenciais` (JSON cifrado AES-256-GCM). Chave: `ENCRYPTION_KEY` (64 hex). Ponto único de decifragem: `IntegracoesService.obterCredenciaisInternas` (D9).

### Cache

5min em memória pra evitar decifragem em cada request. Invalidação imediata em mudanças.

### Guard DIRECTOR-only

`IntegracoesService.assertDirectorRequerido` checa metadata por serviço (`SERVICO_METADATA.requerDirector=true`). Ponto único de enforcement.

## Escopo USUÁRIO (`UsuarioIntegracao`)

**Quem conecta**: o próprio usuário.

| Serviço | Função | OAuth? |
|---|---|---|
| `whatsapp` | Número pessoal do REP/usuário | Pareamento QR |
| `google_calendar` | Calendar pra agendar visitas | Sim |
| `sendgrid` | Enviar emails do usuário | API key |
| `openai` | MullerBot pro REP (D39) | API key |
| `anthropic` | Reserva — não usado MVP | — |

### Por quê escopos separados?

Postgres NULL-em-unique é traiçoeiro (D12). Em vez de gambiarra com uma tabela só + `userId/empresaId` nullable, modelos separados deixam o escopo explícito no schema e mantêm padrão `upsert` limpo.

## OAuth state com CSRF protection (D14)

State JWT HS256 derivado da `ENCRYPTION_KEY`:

```
secret = SHA256(ENCRYPTION_KEY + "<scope>-oauth-state")
state  = jwt.sign({ userId, scope, nonce }, secret, { exp: 5min })
```

- **Isolamento criptográfico**: comprometer state JWT não vaza ENCRYPTION_KEY direto
- **TTL 5min**: janela curta pra ataque
- **Nonce JTI**: bloqueia replay (state usado, fica gravado em cache curto)

Verificação no callback rejeita state inválido/expirado/replay → `BusinessRuleException`.

## Refresh transparente

Todos os clientes OAuth (Google, ML, Shopee, Amazon, TikTok, Meta) implementam refresh **com margem 60s antes do exp**:

```
if (token.exp - now < 60s) {
  newToken = await refreshAccessToken(refreshToken)
  await updateConexao({ accessToken: newToken, exp: now + ttl })
}
```

Aplicação não vê o refresh — métodos do client retornam dados como se o token nunca tivesse expirado.

## Webhooks HMAC-validados (D11)

Sempre que possível, webhook tem HMAC SHA-256 do body cru + `timingSafeEqual`:

| Webhook | Header | Assinatura sobre |
|---|---|---|
| OMIE | `x-omie-signature` | body |
| Meta | `x-hub-signature-256` | body |
| Shopee | `Authorization` | `<url>\|<rawBody>` |
| TikTok | `x-tts-signature` | `app_key + timestamp + rawBody` |
| ML | (sem HMAC oficial — IP whitelist via `ML_WEBHOOK_IP_WHITELIST`, D27) | — |
| Amazon | (sem webhook HTTP — pull SQS/cron, D35) | — |

`WebhookSignatureUtil.verify({ rawBody, signature, secret })` é o utilitário compartilhado.

## Endpoints

### Empresa
- `GET /integracoes` — lista todas (com `status`: conectada/desconectada/erro)
- `POST /integracoes/:servico/conectar` — fluxo varia por serviço (OAuth start, QR Code, key form)
- `POST /integracoes/:servico/desconectar` — apaga credenciais
- `POST /integracoes/omie/sync/forcar` — sync completo (D21c)
- `GET /integracoes/omie/sync/status` — quando foi último sync, sucessos/falhas
- `GET /integracoes/{servico}/oauth/start` + `callback` — fluxos OAuth

### Usuário
- `GET /usuario/integracoes` — próprias
- `POST /usuario/integracoes/:servico/conectar` — idem por serviço
- `POST /usuario/integracoes/:servico/desconectar`

## Fluxos típicos

### A. DIRECTOR conecta OMIE

1. DIRECTOR em `/integracoes` aba OMIE
2. Cola `appKey` + `appSecret` (do dashboard OMIE)
3. Backend testa com `producao/clientes/listarclientescadastrados` (1 página)
4. Se 200: cifra + salva, status `CONECTADA`
5. Botão "Sync agora" → roda `/sync/forcar` em background, retorna job id
6. UI faz polling em `/sync/status` até `concluido=true`
7. Tela mostra: 1234 clientes + 567 produtos importados

### B. REP conecta WhatsApp pessoal

1. REP em `/usuario/integracoes/whatsapp` clica "Conectar"
2. Backend cria sessão Baileys, gera QR Code
3. UI mostra QR
4. REP escaneia com app WhatsApp do celular
5. Backend persiste auth state cifrado, status `CONECTADA`
6. Daqui pra frente, qualquer mensagem que chegar no número do REP aparece na inbox dele

### C. ADMIN dá suporte — vê integrações de tenant problemático

1. ADMIN troca empresa ativa via `X-Empresa-Id` header (UI: seletor no topo)
2. Vai em `/integracoes` — vê todas conexões dessa empresa
3. Identifica `mercadolivre` com `status=ERRO` (refresh failed)
4. Pode reconectar OAuth ou apenas analisar logs
5. Audit log registra que ADMIN-X interveio no tenant-Y

### D. Token expirou no meio de uma operação

1. SAC tenta enviar mensagem ML às 14h
2. Backend chama `MLClient.postMessage` → cliente percebe `token.exp - now < 60s`
3. Faz `POST /oauth/token { grant_type: refresh_token }`
4. Recebe novo access + refresh, atualiza `IntegracaoConexao`
5. Continua a request original com novo token
6. SAC nem percebe — mensagem chega normal
