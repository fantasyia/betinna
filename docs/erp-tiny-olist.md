# ERP: sai OMIE, entra Tiny (Olist) — inventário, plano e passo a passo

> Decisão do Léo em 26/08/2026: o ERP passa a ser o **Tiny by Olist** (`erp.olist.com`).
> Este documento é a fonte da verdade da migração. Cobre o que existe hoje, o que muda,
> o que o Léo precisa fazer no painel do Tiny, e como site ↔ ERP ↔ Betinna se falam.

---

## 0. Resumo em cinco linhas

1. O OMIE **nunca foi ligado de verdade**: `OMIE_DEMO_MODE=true`, zero conexões, zero clientes, zero produtos, zero pedidos no banco de produção. A migração é reescrita limpa, não conversão de dados.
2. A API do Tiny é **v3, REST/JSON, OAuth2** — muito mais próxima do resto do sistema que o RPC-sobre-POST do OMIE.
3. Há **uma armadilha operacional séria**: o refresh token do Tiny **dura 1 dia**. Sem um cron renovando, a conexão morre sozinha num fim de semana parado e alguém tem que re-autorizar na mão.
4. Os webhooks do Tiny **não têm assinatura HMAC**. A defesa é segredo na URL + nunca confiar no payload (sempre re-consultar a API).
5. O site já tem checkout, cotação de frete (Melhor Envio) e rota de status **esperando quem chame**. O elo que falta é justamente o ERP.

---

## 1. Inventário — tudo que é OMIE hoje

### 1.1 Módulo de integração (`backend/src/integrations/omie/`)

| Arquivo | O que faz | Vira o quê no Tiny |
|---|---|---|
| `omie-client.service.ts` | HTTP low-level: credenciais por empresa, modo demo, paginação, trata `faultstring` como erro | `tiny-client.service.ts` — Bearer + refresh automático + rate-limit headers |
| `omie-clientes.service.ts` | `sync()` de clientes (incremental por `data_alteracao`) | `tiny-contatos.service.ts` — `GET /contatos?dataAlteracao=` |
| `omie-produtos.service.ts` | `sync()` de produtos + estoque | `tiny-produtos.service.ts` — `GET /produtos?dataAlteracao=` + `GET /estoque/{id}` |
| `omie-pedidos.service.ts` | `enviarPedido()` — push do pedido, grava `numeroOmie` | `tiny-pedidos.service.ts` — `POST /pedidos` |
| `omie-amostras.service.ts` | Remessa de amostra grátis, CFOP 5911/6911 | `tiny-amostras.service.ts` — pedido + nota (ver §6, item em aberto) |
| `omie-sync.job.ts` | Cron 04:00 UTC — clientes + produtos, incremental | igual |
| `omie-estoque.job.ts` | Cron 30 min — só estoque | igual |
| `omie-webhook.controller.ts` | `POST /webhooks/omie/cliente-status` e `/produto` | `POST /webhooks/tiny/{estoque,pedido,nota,rastreio}` |
| `omie.controller.ts` | `GET status`, `POST sync/clientes`, `sync/produtos`, `sync/forcar` | igual + `GET oauth/start`, `GET oauth/callback` |
| `omie.demo.ts` / `omie.mapper.ts` / `omie.types.ts` | mock, mapeamento, tipos | reescritos |

### 1.2 Banco (`schema.prisma`)

| Onde | Campo | Ação |
|---|---|---|
| `Cliente` | `codigoOmie` (+ `@@unique([empresaId, codigoOmie])`) | renomear → `codigoErp` |
| `Cliente` | `omieStatus: ClienteOmieStatus` (+ índice) | renomear → `erpStatus: ClienteErpStatus` |
| `Produto` | `codigoOmie` (+ unique) | renomear → `codigoErp` |
| `Pedido` | `numeroOmie` (+ unique), `enviadoOmieEm` | renomear → `numeroErp`, `enviadoErpEm` |
| `Amostra` | `numeroOmie`, `enviadoOmieEm` | idem |
| enum `PedidoStatus` | `ENVIADO_OMIE` | renomear → `ENVIADO_ERP` |
| enum `NotificacaoTipo` | comentários citando OMIE | texto |
| `IntegracaoConexao.servico` | `'omie'` | `'tiny'` |

**Por que renomear agora:** zero linhas em todas essas tabelas (verificado em produção em 26/08). `ALTER TYPE ... RENAME VALUE` e `ALTER TABLE ... RENAME COLUMN` são instantâneos hoje e caros depois. Deixar `codigoOmie` guardando ID do Tiny é o tipo de dívida que confunde todo mundo daqui a seis meses.

### 1.3 Env (`env.schema.ts`)

Saem: `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_WEBHOOK_SECRET`, `OMIE_DEMO_MODE`, `OMIE_REQUIRE_REAL`, `OMIE_BASE_URL`, `OMIE_TIMEOUT_MS`, `OMIE_PRECO_FABRICA_RATIO`, `OMIE_CFOP_AMOSTRA_UF`, `OMIE_CFOP_AMOSTRA_INTERESTADUAL`, `OMIE_CENARIO_IMPOSTO_AMOSTRA`.

Entram:

```
TINY_BASE_URL=https://api.tiny.com.br/public-api/v3
TINY_OAUTH_AUTH_URL=https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth
TINY_OAUTH_TOKEN_URL=https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token
TINY_CLIENT_ID=          # do painel do Tiny
TINY_CLIENT_SECRET=      # do painel do Tiny — SÓ no Railway, nunca no repo
TINY_REDIRECT_URI=https://api-production-9426.up.railway.app/api/v1/integracoes/tiny/oauth/callback
TINY_WEBHOOK_SECRET=     # segredo que vai NA URL do webhook (Tiny não assina)
TINY_TIMEOUT_MS=30000
TINY_DEMO_MODE=true      # mock enquanto não conectar
```

`OMIE_PRECO_FABRICA_RATIO` **morre sem substituto** — e isso é ganho: o Tiny devolve `precos.precoCusto` de verdade, então o preço de fábrica deixa de ser o chute de 70% que estava documentado como pendência desde maio.

### 1.4 Quem consome (fora do módulo)

- `modules/pedidos/pedidos.service.ts` → `enviarPedido`
- `modules/amostras/amostras.service.ts` → `enviarAmostra`
- `modules/integracoes/integracoes.constants.ts` → `'omie'` na lista de serviços DIRECTOR-only (D45)
- Front: `lib/pedidoStatus.ts`, `pages/PedidoDetailPage`, `PedidosPage`, `ClienteDetailPage`, `ClientesPage`, `ProdutosPage`, `IntegracoesPage`, `AdminPage`, `RelatoriosPage`, `i18n/{pt-BR,en-US}.json`

### 1.5 O que estava ESPERANDO o OMIE (agora espera o Tiny)

1. **Status do pedido dentro do app** — card 📦 do quadro DEV. Hoje, cliente que pergunta "meu pedido saiu?" faz o bot pausar e abrir tarefa. Com o Tiny isso deixa de ser interino.
2. **Preço de custo real** (§1.3).
3. **Estoque com saldo confiável** no catálogo do rep.
4. **Bloqueio de cliente** (`omieStatus`) — no Tiny é a situação do contato.
5. **Checkout do site fechando venda de verdade** — checklist "🛒 E-commerce do checkout NI" do card 🔌 Integrações & Dados: gateway → frete → ERP.

---

## 2. A API do Tiny em uma página

**Base:** `https://api.tiny.com.br/public-api/v3` · **Auth:** `Authorization: Bearer <access_token>`

### 2.1 OAuth2 (o ponto de atenção)

| Item | Valor |
|---|---|
| Authorize | `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth` |
| Token | `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token` |
| Grants | `authorization_code` (1ª vez) e `refresh_token` (renovação) |
| Scope | `openid` |
| **Access token** | **4 horas** |
| **Refresh token** | **1 dia** |

> ⚠️ **Refresh de 1 dia é a diferença mais importante em relação ao OMIE.** O OMIE usava app_key/app_secret estáticos — ligava e esquecia. No Tiny, se ninguém renovar em 24h, a conexão **morre** e exige re-autorização manual no navegador. O desenho tem que ter cron de renovação folgado (a cada 3h) + alerta pro DIRECTOR quando falhar, senão a integração cai sozinha num feriado e ninguém percebe até um pedido não subir.

### 2.2 Endpoints que vamos usar

| Necessidade | Endpoint |
|---|---|
| Listar produtos (incremental) | `GET /produtos?dataAlteracao=&situacao=A&limit=&offset=` |
| Estoque de um produto | `GET /estoque/{idProduto}` → `saldo`, `reservado`, `disponivel`, por depósito |
| Listar contatos/clientes | `GET /contatos` |
| Criar pedido | `POST /pedidos` |
| Listar/consultar pedido | `GET /pedidos?...` / `GET /pedidos/{id}` |
| Situação do pedido | `PUT /pedidos/{id}/situacao` |
| **Rastreio** | `PUT /pedidos/{id}/despacho` → `codigoRastreamento`, `urlRastreamento`, `formaEnvio`, `dataPrevista` |
| Nota fiscal do pedido | `POST /pedidos/{id}/gerar-nota-fiscal` |
| Formas de envio | `GET /formas-envio` |

**Situações do pedido (inteiros):** `8` dados incompletos · `0` aberta · `3` aprovada · `4` preparando envio · `1` faturada · `7` pronto envio · `5` enviada · `6` entregue · `2` cancelada · `9` não entregue.

### 2.3 Rate limit

Por **conta** (não por aplicativo), por minuto, com teto maior pra leitura que pra escrita. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. O `HttpClientService` precisa ler o `Reset` e esperar em vez de martelar — vale a mesma disciplina do pacing do WhatsApp.

### 2.4 Webhooks

Eventos: **Vendas** (pedido criado/alterado), **Envios** (virou "enviado"), **Estoque**, **Notas Fiscais**. Configurados no painel (requer o app "Webhooks" instalado). Retenta até **10x com atraso progressivo de +5 min**; responder `200` confirma.

> ⚠️ **Sem HMAC.** Não há assinatura nem header de autenticação documentado. Desenho obrigatório:
> 1. segredo longo **no path** da URL (`/webhooks/tiny/{TINY_WEBHOOK_SECRET}/pedido`);
> 2. tratar o payload como **dica, não como verdade** — ao receber, re-consultar o recurso pela API v3 (é o mesmo princípio que o webhook do OMIE já usava: "preferimos pull do estado real em vez de confiar nos valores do evento");
> 3. anti-replay pelo `WebhookAntiReplayService`, que já existe.

---

## 3. Arquitetura: quem fala com quem

```
   Site (Next.js + Supabase)          Betinna (NestJS)                Tiny (Olist)         Melhor Envio
   ─────────────────────────          ────────────────                ────────────         ────────────
   checkout                                                                                cotação de frete
     │  cotação  ─────────────────────────────────────────────────────────────────────────────▶ (direta)
     │
     └─ POST /api/pedidos ──▶ Supabase (número do pedido, visão do cliente)
            │
            └── POST /leads + pedido ──▶ Betinna ──── POST /pedidos ────▶ Tiny
                                              ▲                            │
                                              │                            ├─ separação/etiqueta ──▶ ME
                                              │                            │   (integração nativa)
                                              └── webhook (situação/rastreio) ◀──┘
                                              │
                    POST /api/pedidos/status ─┘  (site atualiza a tela do cliente)
```

**Betinna é o hub.** Razões:
- é quem já tem `IntegracaoConexao` com credencial cifrada (AES-256-GCM), multi-tenant;
- é quem tem cron e fila (BullMQ) pra refresh de token, retry e reconciliação — o site é stateless na borda e não tem onde guardar refresh token com segurança;
- é onde o bot precisa do status pra responder "seu pedido saiu?" (o card 📦).

O site continua dono da **visão do cliente** (número do pedido, tela de acompanhamento) — a rota `POST /api/pedidos/status`, protegida por `PEDIDOS_STATUS_SECRET`, já existe exatamente pra ser chamada por essa integração. Não precisa de tela de admin no site.

### 3.1 Frete — resolvendo a divergência que estava em aberto

O `checkout-ni-spec.md` dizia "frete via ERP, **não** chamada direta ao Melhor Envio"; o Léo mandou implementar direto e o código está direto. Com o Tiny, dá pra fechar a questão sem escolher um lado errado, porque são **dois momentos diferentes**:

- **Cotação no checkout** (antes de existir pedido): **direto no Melhor Envio**, como está. O Tiny não expõe endpoint público de cotação — o `cotacao-fretes` da API v2 é o inverso (o Tiny chama o integrador pedindo cotação).
- **Etiqueta e rastreio** (depois do pedido): **pelo Tiny**, via integração nativa Tiny ↔ Melhor Envio. O operador separa, gera etiqueta e o rastreio nasce lá; o webhook de Envios traz o código pra cá.

Ou seja: o código do site está certo e a spec estava certa — cada um sobre uma metade.

### 3.1.1 Frete grátis: o que a cotação passa a servir (decidido 26/08)

Todos os pedidos saem com **frete grátis pro cliente**. Isso muda o propósito da
cotação, não a arquitetura:

- **Prazo** — é o que o cliente quer saber, e prazo real por CEP só o Melhor
  Envio dá. A diferença entre a capital e o interior do Norte é grande demais
  pra tabela fixa.
- **Custo por pedido** — frete grátis não é frete sem custo: quem paga é a
  empresa. Ter o valor amarrado ao pedido é o que permite margem de contribuição
  por venda. Sem isso, o custo só aparece na fatura do mês, sem ligação com a
  venda que o gerou.

**Regra de escolha do serviço: o MAIS BARATO.** Não existe transportadora
padrão — o Melhor Envio é hub, e a regra é o critério, não a marca. Consequência
pro checkout: o prazo mostrado é o **da opção mais barata**, que é a que vai ser
despachada. Mostrar o prazo da mais rápida e despachar pela mais barata é
prometer 3 dias e entregar em 9.

### 3.1.2 Onde o custo do frete tem que cair (DRE e margem por venda)

Dois campos DIFERENTES no pedido do Tiny, e a separação é o que faz o DRE fechar:

| Campo | O que é | Com frete grátis |
|---|---|---|
| `valorFrete` | o que o CLIENTE pagou | 0 (ou só o extra do expresso) |
| `fretePagoEmpresa` | o que a EMPRESA desembolsou pela etiqueta | o custo real |

Margem de contribuição por venda = valor da venda − custo dos produtos
(`precos.precoCusto`, que o Tiny traz de verdade) − `fretePagoEmpresa` − taxa do
gateway. **A taxa do gateway entra na conta desde o primeiro dia**: sem ela a
margem parece melhor do que é (num ticket de ~R$ 900 são uns R$ 35 invisíveis).

⚠️ **A verificar no primeiro envio real:** a documentação não diz se o Tiny
preenche `fretePagoEmpresa` sozinho quando a etiqueta é comprada pela integração
nativa com o Melhor Envio. Se preencher, nada a fazer. Se não preencher, a saída
é buscar o valor da etiqueta na própria conta do Melhor Envio pelo código de
rastreio (é a mesma conta) e gravar no pedido via `PUT /pedidos/{id}/despacho`.
Não inventar o número: sem o dado, o campo fica vazio e o DRE mostra o buraco em
vez de um valor errado.

### 3.1.3 Opção expressa paga (aprovada, mas depende do gateway)

O cliente pode escolher receber mais rápido pagando a diferença.

- **Cobra exatamente o delta**, arredondado pra cima: se a mais barata é R$ 38 e
  a expressa R$ 62, o cliente paga R$ 24. Sem markup — numa loja que anuncia
  frete grátis, qualquer margem embutida no frete lê como pegadinha.
- **No máximo duas opções na tela** ("Grátis — chega até dd/mm" · "Expresso —
  R$ X a mais, chega até dd/mm"), e só quando o ganho é real: menos de 2 dias de
  diferença, ou delta desproporcional, não entra.
- **Contabilização:** o extra entra em `valorFrete` (receita) e o custo real em
  `fretePagoEmpresa` — dá pra ver se o upsell se paga.
- ⚠️ **O risco é operacional, não técnico.** Quem promete o prazo é o site; quem
  cumpre é quem compra a etiqueta no Tiny. Se o cliente pagou expresso e alguém
  despachar pelo mais barato por hábito, a promessa já foi cobrada e foi
  quebrada. O serviço escolhido tem que chegar VISÍVEL na tela da expedição, não
  escondido em observação.
- **Bloqueada pelo gateway:** cobrar o extra exige cobrar, e hoje o checkout
  fecha como lead. A cotação já devolve preço e prazo de todos os serviços, então
  quando o gateway entrar o trabalho é de tela, não de integração.

### 3.2 Ciclo de vida do pedido (mapeamento de status)

| Tiny (`situacao`) | Betinna (`PedidoStatus`) | Site (`STATUS_PEDIDO`) |
|---|---|---|
| 0 aberta / 3 aprovada | `ENVIADO_ERP` | `recebido` |
| 4 preparando envio / 7 pronto envio / 1 faturada | `EM_SEPARACAO` (novo) | `em_separacao` |
| 5 enviada | `ENVIADO` | `enviado` (+ rastreio) |
| 6 entregue | `ENTREGUE` | `entregue` |
| 2 cancelada | `CANCELADO` | `cancelado` |
| 9 não entregue | `ENTREGA_FALHOU` (novo) | fica em `enviado` + tarefa pro humano |

`9 não entregue` **não pode virar status silencioso** — é conversa de gente: cria tarefa e avisa, como já faz o ramo de dinheiro do fluxo RT.

---

### 3.4 Comissões — duas por venda, e o ERP registra as duas (decidido 26/08)

Toda venda gera **duas** comissões: a do representante e a do Léo (que existe
porque ele trouxe o rep pra base — não é override de gerência sobre volume, é
comissão de originação).

O Tiny tem **um** vendedor por pedido e a comissão dele nem aparece na API — é
campo de painel. Então a modelagem correta não é forçar dois vendedores:
**comissão é conta a pagar**, que é o que ela é contabilmente.

| | Comissão do rep | Comissão do Léo |
|---|---|---|
| Contato | o representante | o Léo |
| Nº do documento | número do pedido | o mesmo |
| Categoria | Comissões sobre vendas | idem |
| Competência | mês do faturamento da nota | idem |
| Vencimento | dia 5 do mês SEGUINTE ao faturamento | idem |

**A regra de vencimento é fixa:** nota faturada em qualquer dia do mês N vence
dia 05 do mês N+1 (05/01 e 29/01 vencem os dois em 05/02). A **competência**
fica no mês do faturamento, senão a venda de 29/01 apareceria como custo de
fevereiro e o resultado de janeiro sairia inflado.

**Percentuais do Léo (definidos em 26/08):**

- **6%** sobre o valor quando é **LOCAÇÃO por representante**
- **12%** sobre o valor quando é **VENDA pelo site** (linha não-industrial)

A assimetria é do modelo de negócio, não um erro: o site vende, o rep loca.

⚠️ **Em aberto:** na locação, a comissão de 6% incide **uma vez** sobre o
contrato ou **todo mês** enquanto o equipamento estiver locado? Receita
recorrente e comissão de uma vez só são coisas diferentes no DRE, e a resposta
muda quantas contas a pagar nascem por contrato.

**O cálculo fica no Betinna** (que já modela comissão em dois níveis, D41) e o
ERP recebe as contas a pagar. Não duplicar a regra: dois sistemas calculando
dinheiro divergem, e aí ninguém sabe qual está certo.

**Cadastro da categoria no painel** (Cadastros → Categorias de receita e
despesa): "Considera no DRE" = **Como despesas operacionais** (o padrão "Não
considera" deixaria a comissão fora do DRE) e "Competência padrão" = **Mês
anterior ao vencimento** (que, com vencimento dia 5 do mês seguinte, cai no mês
da venda). O default vale pro lançamento manual; o que a integração cria leva a
competência explícita.

## 4. Passo a passo pro Léo dentro do Tiny

> Faça na ordem. Os passos 1–3 são pré-requisito pra qualquer linha de código funcionar.

### Passo 1 — Criar o aplicativo da API v3

1. No Tiny: **menu → configurações → aba geral → Aplicativos**
2. **+ novo aplicativo**
3. **Nome do aplicativo:** `Betinna` (é o nome que aparece na tela de autorização)
4. **URLs de redirecionamento:** cole exatamente
   ```
   https://api-production-9426.up.railway.app/api/v1/integracoes/tiny/oauth/callback
   ```
5. Salvar. Depois **editar o aplicativo** → seção **Chaves de acesso** → lá estão **Client ID** e **Client Secret**.
6. Ainda na edição, seção **Permissões do aplicativo** — marque, com nível **Leitura + Incluir e editar** (não precisa "Excluir" em nenhum):
   - Produtos · Estoque · Contatos · Pedidos · Notas fiscais · Expedição/Logística · Formas de envio/pagamento
   - **Não** marque contas a pagar/receber por ora — só marcamos o que vamos usar.
7. **Salvar.**

> Limite da conta: 5 aplicativos. E o Client Secret dá acesso total à conta — trate como senha.

### Passo 2 — Instalar o app de Webhooks

1. **Loja de aplicativos** do Tiny → instalar **Webhooks** (depende do plano; se não aparecer, é isso que precisa ser destravado com eles).
2. **menu → configurações → aba geral → outras configurações → Webhooks**
3. Preencher as URLs (o `SEGREDO` eu te passo quando o endpoint subir):
   ```
   Vendas         https://api-production-9426.up.railway.app/api/v1/webhooks/tiny/SEGREDO/pedido
   Envios         https://api-production-9426.up.railway.app/api/v1/webhooks/tiny/SEGREDO/rastreio
   Estoque        https://api-production-9426.up.railway.app/api/v1/webhooks/tiny/SEGREDO/estoque
   Notas Fiscais  https://api-production-9426.up.railway.app/api/v1/webhooks/tiny/SEGREDO/nota
   ```

### Passo 3 — Ligar o Melhor Envio dentro do Tiny

1. No Tiny, **integrações → Melhor Envio** → conectar (login da conta Melhor Envio, autorizar).
2. Conferir **CEP de origem** e os serviços habilitados (PAC/SEDEX/Jadlog…) — precisam bater com o que o site cota.
3. Confirmar que a impressão de etiqueta gera **código de rastreio no pedido** (é ele que o webhook de Envios traz).

### Passo 4 — Cadastro mínimo pra virar venda

1. **Produtos:** cadastrar os modelos MB com **SKU igual ao do site** (`masterblock.ts`) — o SKU é a chave que amarra site ↔ ERP. Peso e dimensões preenchidos (o Melhor Envio precisa).
2. **Depósito:** anotar o ID do depósito padrão (o `POST /pedidos` exige `deposito.id`).
3. **Vendedor:** criar um vendedor para as vendas do site (o `POST /pedidos` exige `vendedor.id`) — sugiro `Site Somatec`, pra separar do que vem por representante.
4. **Formas de envio e de pagamento:** conferir as que existem, porque vou mapear as do checkout pra elas.

### Passo 5 — Me devolver

- Client ID e Client Secret (o Secret **você** cola no Railway — eu não devo digitar segredo em campo nenhum, é regra minha; te passo o nome exato da variável)
- ID do depósito e ID do vendedor
- Confirmação de que o app de Webhooks instalou
- Print da tela de permissões, pra eu conferir se falta alguma

---

## 5. Plano de execução (ordem proposta)

| # | Entrega | Depende de |
|---|---|---|
| 1 | Renomear campos/enums OMIE→ERP no schema + migration + front | nada (faço já) |
| 2 | Módulo `integrations/tiny`: client HTTP + OAuth (authorize/callback/refresh) + cron de refresh 3h + alerta | Client ID/Secret |
| 3 | Sync de produtos + estoque (cron 04:00 e 30 min, incremental por `dataAlteracao`) | 2 |
| 4 | Sync de contatos + situação do cliente | 2 |
| 5 | Push de pedido (`POST /pedidos`) substituindo `enviarPedido` | 2 + depósito/vendedor |
| 6 | Webhooks (pedido, rastreio, estoque, nota) com segredo na URL + re-pull | 2 + passo 2 do Léo |
| 7 | Ponte site ↔ Betinna: pedido do site vira pedido no Tiny; status/rastreio voltam pro site (`POST /api/pedidos/status`) | 5 + 6 |
| 8 | Bot lê status do pedido (fecha o card 📦) | 6 |
| 9 | Remessa de amostra no Tiny (CFOP) | 5 + decisão fiscal |
| 10 | Deletar o módulo OMIE inteiro + envs | 3–6 no ar |

Enquanto 1–6 não estiverem prontos, **nada quebra**: hoje o OMIE está em modo demo e ninguém depende dele.

---

## 6. Decisões que ainda são suas

1. **Amostra grátis** — no OMIE a remessa saía com CFOP 5911/6911 e cenário fiscal opcional. No Tiny o caminho é pedido + nota. Precisa alguém do fiscal confirmar como quer emitir. Até lá, mantenho a amostra sem envio ao ERP (como está hoje na prática).
2. **Gateway de pagamento** — segue sendo o item que trava o checkout fechar venda de verdade. O ERP não substitui isso.
3. **Contas a pagar/receber** — o Tiny tem API. Não incluí no escopo; se quiser o financeiro no Betinna, vira card próprio.
4. **Acesso pelo Claude Chrome** — útil pro passo 1 e 2 (criar app, marcar permissões, cadastrar as URLs de webhook). Mas o **Client Secret quem copia é você**: não digito segredo em campo nenhum, nem no Railway. Eu configuro o que é clique; você faz o que é chave.

---

## 7. Fontes

- [Índice da API v3 (llms.txt)](https://api-docs.erp.olist.com/llms.txt)
- [Autenticação OAuth2](https://api-docs.erp.olist.com/documentacao/comecando/autenticacao.md)
- [Criando um aplicativo](https://api-docs.erp.olist.com/documentacao/comecando/criando-um-aplicativo.md) · [Passo a passo no painel](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao)
- [Limites de consulta](https://api-docs.erp.olist.com/documentacao/comecando/limites-de-consulta.md)
- [Webhooks](https://api-docs.erp.olist.com/documentacao/webhooks/webhooks.md)
- [Criar pedido](https://api-docs.erp.olist.com/api-reference/pedidos/criar-pedido.md) · [Listar pedidos](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos.md) · [Rastreamento](https://api-docs.erp.olist.com/api-reference/pedidos/atualizar-informações-de-rastreamento-do-pedido.md)
- [Listar produtos](https://api-docs.erp.olist.com/api-reference/produtos/listar-produtos.md) · [Estoque do produto](https://api-docs.erp.olist.com/api-reference/estoque/obter-o-estoque-de-um-produto.md)
- [Tiny × Melhor Envio](https://tiny.com.br/integracoes/melhor-envio)
