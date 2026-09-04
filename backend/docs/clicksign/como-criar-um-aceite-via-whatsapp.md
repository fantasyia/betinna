---
updatedAt: 2026-05-27T10:41:18.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Como criar um Aceite via WhatsApp

## Criando um Aceite

Agora que você já passou pela Introdução aos Conceitos, chegou a hora da parte mais divertida: o código.

Criar um aceite é o primeiro passo da jornada. É aqui que você define **quem** vai receber, **o que** a pessoa deve ler e **como** a sua marca será identificada no WhatsApp do cliente.

***

### 1. O que você precisa ter em mãos?

Antes de disparar o primeiro `POST`, garanta que:

* Você tem um **Access Token** válido.
* Sua conta possui a funcionalidade.
* O número do cliente está "limpo" (apenas números, sem parênteses ou traços).

***

### 2. A Requisição (O "Pulo do Gato")

A API v3 segue o padrão **JSON:API**. Isso significa que os dados não vão "soltos" no JSON; eles ficam organizados dentro de `data` e `attributes`.

**Endpoint de Produção:** `https://sandbox.clicksign.com/api/v3/acceptance_term/whatsapps`

Copie este exemplo, troque o seu Token e o número de telefone, e teste agora mesmo:

```bash
curl --request POST \
  --url https://sandbox.clicksign.com/api/v3/acceptance_term/whatsapps \
  --header 'Accept: application/vnd.api+json' \
  --header 'Authorization: Bearer SEU_TOKEN_AQUI' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
    "data": {
      "type": "acceptance_term_whatsapps",
      "attributes": {
        "title": "Adesão ao Plano Premium 2026",
        "content": "Eu aceito os termos de serviço e a política de privacidade da Empresa Exemplo para o contrato 123.",
        "phone_number": "5511999998888",
        "sender_name_option": "account_name"
      }
    }
  }'
```

## Acompanhando e Listando Aceites

Você enviou o convite, mas e agora? O cliente aceitou? Ele ainda nem abriu a mensagem? Nesta página, você aprenderá a consultar o status dos seus aceites e a listar todos os envios realizados pela sua conta.

Existem duas formas principais de monitorar: **perguntando à API** (Consulta Direta) ou **sendo avisado pela API** (Webhooks).

***

### 1. Consultando um Aceite Específico

Lembra daquele **ID** que você guardou na hora da criação? Você vai usá-lo agora para saber exatamente o que está acontecendo com aquele envio.

**Endpoint:** `GET /api/v3/acceptance_term/whatsapps/{ID_DO_ACEITE}`

```bash
curl --request GET \
  --url https://sandbox.clicksign.com/api/v3/acceptance_term/whatsapps/SEU_ID_AQUI \
  --header 'Accept: application/vnd.api+json' \
  --header 'Authorization: Bearer SEU_TOKEN_AQUI'
```

Nesta página, aprenderá a configurar a requisição para disparar um termo de aceite diretamente para o celular do cliente. A API v3 utiliza o padrão **JSON:API**, exigindo uma estrutura específica de dados e cabeçalhos.

***

## O Endpoint

Para criar um novo aceite, utilize o método **POST**.

| Ambiente     | URL                                                              |
| :----------- | :--------------------------------------------------------------- |
| **Produção** | `https://app.clicksign.com/api/v3/acceptance_term/whatsapps`     |
| **Sandbox**  | `https://sandbox.clicksign.com/api/v3/acceptance_term/whatsapps` |

***

Para mais detalhes de requisições e regras de negócio consulte a <Anchor label="Página de Referência" target="_blank" href="/reference/aceite-por-whatsapps">Página de Referência</Anchor>.

<Footer3 />