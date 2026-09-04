---
updatedAt: 2026-05-27T10:42:15.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Primeiros passos

Configure seu ambiente de desenvolvimento em 4 passos simples

## Neste guia você vai configurar sua integração com a API 3.0

<br />

**O que você vai aprender:**

• Como criar sua conta de desenvolvimento

• Como gerar suas credenciais de acesso (Access Token)

• Como fazer sua primeira requisição à API

• Como testar se tudo está funcionando

<br />

**Já usa a versão anterior da API?** Veja o guia de migração [aqui](https://developers.clicksign.com/v3.0/update/docs/migra%C3%A7%C3%A3o-da-api-19-para-30)

**Precisa de ajuda?** [Entre em contato com o Suporte](https://www.clicksign.com/suporte)

<br />

<Callout icon="⚠️" theme="warn">
  **Importante:** O envelope está ativo para contas criadas a partir de 01/07/2024. Caso receba o erro de serviço indisponível, entre em contato com nosso [Time de Suporte](https://www.clicksign.com/suporte)
</Callout>

# Configure seu acesso à API

## 1. Crie uma conta no ambiente Sandbox

Acesse <https://sandbox.clicksign.com/signup> e crie uma conta gratuita para testes.

<Image align="center" border={true} width="400px" src="https://files.readme.io/c03d96506106e2cd1b6fbc04b4f2e269f6fd08897b73eeecbf0b551aca94dc97-login.png" className="border" />

<br />

<Callout icon="💡" theme="default">
  **O que é o Sandbox?** É um ambiente seguro para testar sua integração. Documentos criados aqui não têm valor legal - é só para desenvolvimento.
</Callout>

<br />

## 2. Gere um Access Token

1. Faça login na sua conta *Sandbox*
2. Vá em *Configurações* e depois em *API*
3. Clique em *Gerar Access Token*
4. Crie a descrição e clique em *Gerar*
5. Copie e guarde o token.

<Image align="center" border={true} width="600px" src="https://files.readme.io/58a07bca30cca7de5b40deed6fb2e0e9a120d2751f21da49422da66ea69fb42d-sandbox.png" className="border" />

<br />

<Callout icon="🚧" theme="warn">
  **Importante** Trate o Access Token como uma senha - não compartilhe publicamente.
</Callout>

## 3. Associe o usuário à API

Na mesma tela onde gerou o token, certifique-se de associar seu email à API e clique em *Salvar e-mail*.

<Image align="center" border={true} width="600px" src="https://files.readme.io/9d42da3c9d887a3eab833d40cd726ccba9e9e3884c0f5903a74ecc08934bee35-sandbox2.png" className="border" />

## 4. Faça um teste de autenticação

Vamos verificar se tudo está funcionando. Abra seu navegador e acesse:

<a href="https://sandbox.clicksign.com/api/v3/envelopes?access_token={{access_token}}" target="_blank">`https://sandbox.clicksign.com/api/v3/envelopes?access_token={{access_token}}`</a>

substituindo `{{access_token}}` pelo seu Access Token.

<br />

### Exemplos de resposta:

```json
{
  "data": [],
  "meta": {
    "record_count": 0
  },
  "links": {
    "first": "https://sandbox.clicksign.com/api/v3/envelopes?page%5Bnumber%5D=1&page%5Bsize%5D=20",
    "last": "https://sandbox.clicksign.com/api/v3/envelopes?page%5Bnumber%5D=1&page%5Bsize%5D=20"
  }
}
```

# Entenda o fluxo básico de um envelope

Agora que sua conta está configurada, vamos entender como funciona o fluxo básico de um envelope:

## Fluxo básico de um envelope::

1. [Criar Envelope](/v3.0/reference/api-criar-envelope): Solicita a criação de um novo Envelope.
2. [Adicionar Documento](/v3.0/reference/api-upload-documentos): Inclui um novo documento no Envelope previamente criado.
3. [Adicionar Signatário](/v3.0/reference/api-criar-signatario): Integra um novo signatário para assinar um documento.
4. [Adicionar Requisito de Qualificação](/v3.0/reference/criar-requisito-qualificacao): Define uma condição para a autenticação do signatário.
5. [Adicionar Requisito de Autenticação](/v3.0/reference/criar-requisito-de-autenticacao): Estabelece uma condição para a qualificação da assinatura do signatário.
6. [Ativar ou Alterar Configurações do Envelope](/v3.0/reference/api-editar-envelope): A Ativação do Envelope se dá com a alteração do status de `draft` para `running`.

## Notificação para Assinatura

* [Disparar Notificação de Signatário](/v3.0/reference/api-notificar-signatario): Envia uma notificação ao signatário para assinar o documento.
* [Disparar Notificação de Envelope](/reference/api-notificar-envelope): Notifica todos os signatários associados ao Envelope para assinatura.

## Outras Operações

* [Consultar Eventos](/v3.0/reference/api-eventos): Consulta eventos de todos documentos relacionados ao envelope.
* [Cancelar ou Finalizar um Documento](/v3.0/reference/editar-documento): O cancelamento ou finalização de um documento se dá com a alteração do status para `canceled` ou `closed`.

## Pronto para implementar?

Temos um guia prático completo:

<Recipe slug="criação-e-configuração-do-envelope" title="Criação e Configuração do Envelope" />

Neste guia você vai aprender a criar seu o passo a passo para realizar requisições utilizando cURL.

## Formato JSON da API com Envelope

A API da Clicksign utiliza o padrão [JSON API](https://jsonapi.org/) para formatação de requisições e respostas. No contexto do Envelope, é essencial seguir essas especificações. Para isso, é necessário configurar os cabeçalhos HTTP da seguinte forma:

* **Accept:** `application/vnd.api+json`
* **Content-Type:** `application/vnd.api+json`

```http
GET /api/v3/envelopes HTTP/2
Host: sandbox.clicksign.com
Authorization: {{access_token}}
Accept: application/vnd.api+json
Content-Type: application/vnd.api+json
```
```curl
curl --request GET \
  --url 'https://sandbox.clicksign.com/api/v3/envelopes' \
  --header 'Authorization: {{access_token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --header 'accept: application/vnd.api+json'
```

<Footer3 />