# Assinatura eletrônica do contrato (ClickSign)

O contrato de LOCAÇÃO vai pra assinatura **depois do aceite do cliente** —
mandar documento pra assinar antes de a pessoa aceitar a proposta inverte a
conversa comercial.

```
proposta (rep) → e-mail com o LINK de aceite → cliente aceita
   → o app cria o envelope, monta o contrato pelo Modelo e dispara
   → cliente assina (token + CPF) · Somatec assina
   → contrato assinado → sobe pro ERP
```

## O texto do contrato NÃO mora no nosso código

Ele é um **Modelo** dentro do ClickSign, com variáveis `{{...}}`; o app manda só
os dados que mudam por cliente (`contrato-variaveis.util.ts`). Quando o jurídico
mexer numa cláusula, é edição no painel — sem deploy, sem commit, sem build.

## Variáveis de ambiente (api **e** worker)

| variável | sandbox | produção |
|---|---|---|
| `CLICKSIGN_API_URL` | `https://sandbox.clicksign.com` | `https://app.clicksign.com` |
| `CLICKSIGN_ACCESS_TOKEN` | token da conta sandbox | token da conta real |
| `CLICKSIGN_TEMPLATE_KEY` | modelo do sandbox | **outro id** — o modelo tem que ser subido de novo na conta real |
| `CLICKSIGN_AUTH_CANAL` | `email` | `email` (aceita `whatsapp`/`sms`) |
| `CLICKSIGN_SIGNATARIO_NOME` | Leandro de Albuquerque Pereira Lima | idem |
| `CLICKSIGN_SIGNATARIO_EMAIL` | `marketing@somatecblocking.com.br` | ⚠️ **`leandro@somatecblocking.com.br`** |
| `CLICKSIGN_SIGNATARIO_NASCIMENTO` | `1982-11-12` | idem |
| `CLICKSIGN_SIGNATARIO_DOCUMENTO` | CPF do Leandro | idem |
| `CLICKSIGN_SOMATEC_AUTO` | `false` enquanto o termo não estiver assinado | `true` |

⚠️ **O e-mail do signatário da casa MUDA entre os dois ambientes.** No sandbox é
o `marketing@` porque quem está testando é o Leonardo, assinando no lugar do
Leandro. **Em produção tem que ser `leandro@somatecblocking.com.br`** — é a
assinatura dele que vale, e o termo de assinatura automática é vinculado ao
e-mail.

## Assinatura automática da casa

O Leandro é signatário **de verdade** (tem log próprio, com data e
autenticação), mas não clica em nada. Exige um **Termo de Assinatura Automática**
assinado uma vez, e o termo **vale por conta** — sandbox e produção pedem cada um
o seu.

Solicitar o termo (não existe tela pra isso; é chamada):

```
POST /api/v3/auto_signature/terms
{ "data": { "type": "auto_signature_terms", "attributes": {
    "admin_email": "…", "api_email": "…",
    "signer": { "name": "…", "email": "…", "documentation": "CPF", "birthday": "AAAA-MM-DD" } } } }
```

Sem o termo assinado, o requisito `auto_signature` volta com *"O signatário deve
ter um termo assinado para a utilização da assinatura automática"*. Enquanto isso,
`CLICKSIGN_SOMATEC_AUTO=false` faz a casa assinar manualmente e o fluxo roda
inteiro.

## Armadilhas da API — todas descobertas batendo, não lendo

- **`status: running` NÃO manda e-mail.** O envelope fica "em andamento" e
  ninguém recebe nada. O aviso é `POST /envelopes/{id}/notifications`, chamada à
  parte. É a pior falha possível aqui: parece sucesso.
- **Nome de signatário tem que ser de PESSOA.** Razão social volta com *"name não
  está em um formato válido"* — por isso a proposta tem `signatarioNome`.
- **`has_documentation: true` sem mandar o documento** faz a ClickSign PEDIR o
  CPF na hora de assinar. Não precisamos ter o dado.
- **`email`, `sms` e `whatsapp` são o MESMO tipo de requisito ("token")** — só um
  por signatário. Não existe "e-mail e WhatsApp".
- **`official_document` não anda junto de biometria facial.**
- **`auto_signature` tem que ser a ÚNICA autenticação** do signatário.
- **Telefone vai em dígitos com DDI** (`5511999998888`). Com `+` a API recusa.
- **O `filename` do documento precisa terminar em `.docx`.**
- **Modelo pode ser criado por API** (`POST /templates` com `content_base64`),
  mas o endpoint **recusa o atributo `filename`**.
- **Envelope em `running` não pode ser cancelado nem apagado** pela API (`status
  deve estar em: draft, running`, e voltar pra `draft` é recusado). Rascunho a
  API apaga. Por isso: em teste, gerar e conferir em rascunho.
- **No termo, `documentation` e `birthday` vão DENTRO do `signer`** — embora a
  mensagem de erro aponte pra `/data/attributes/documentation`.
- **Variável com lixo vira 401 mudo.** O `ler()` do service limpa `NOME=`, aspas
  e `<>` — este último porque o token foi colado dentro do `<seu token>` da
  instrução e ficou com 38 caracteres.
