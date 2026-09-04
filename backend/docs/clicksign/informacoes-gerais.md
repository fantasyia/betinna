---
updatedAt: 2026-06-04T10:32:12.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 1.2. Informações gerais

Ambientes, autenticação, formatos e versões

# Ambientes / Hosts

A Clicksign oferece dois ambientes para você desenvolver e usar a API:

<br />

### **🧪 Sandbox (Desenvolvimento)**

• Para testes e desenvolvimento da sua integração
• Documentos criados aqui não têm valor legal
• Ambiente seguro para experimentar
• Sempre na mesma versão do ambiente de produção

### **🏢 Produção (Uso real)**

• Para uso real com clientes e processos oficiais
• Documentos assinados aqui têm validade jurídica
• Ambiente para sua aplicação final

**Como migrar do Sandbox para Produção?**

Quando estiverem prontos para migrar para o ambiente de Produção, basta atualizar as variáveis Host e Access Token com os parâmetros correspondentes. s ambientes Sandbox e Produção estão sempre na mesma versão. Portanto, todas as atualizações realizadas no ambiente de Produção também são refletidas automaticamente no ambiente Sandbox.

<br />

| Ambiente | Host                                                                                        | Validade Jurídica |
| :------- | :------------------------------------------------------------------------------------------ | :---------------- |
| Produção | <a href="https://app.clicksign.com" target="_blank"><https://app.clicksign.com></a>         | `true`            |
| Sandbox  | <a href="https://sandbox.clicksign.com" target="_blank"><https://sandbox.clicksign.com></a> | `false`           |

# Autenticação

A autenticação é realizada através do parâmetro **access\_token** que identifica e autentica o usuário. O parâmetro pode ser enviado no **header** da requisição, com a chave **Authorization**.

# Formato JSON (JSON:API)

A API Clicksign utiliza a especificação da JSON:API para todas as requisições e respostas. Você deve configurar os cabeçalhos HTTP para indicar que está enviando e esperando receber dados no formato:

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

# Formatação de datas

Para padronização, todas as datas devem ser formatadas de acordo com a norma <a href="https://en.wikipedia.org/wiki/ISO_8601" target="_blank">ISO 8601</a>, por exemplo:
`2020-02-05T15:40:15.335-03:00`.

As respostas das requisições sempre estarão no fuso horário UTC.

<Image align="center" alt={392} border={false} width="250px" src="https://files.readme.io/e85ef75-iso_8601.png" />

# Versões da API

Para possibilitar a evolução contínua da API, a Clicksign implementa um sistema de versões. Dessa forma é necessário que as requisições contenham a versão da API através do path, por exemplo: `sandbox.clicksign.com/api/v3/envelopes`.

Uma nova versão é lançada apenas quando há quebra de funcionalidade. Ou seja, melhorias, novas funcionalidades e correções de *bugs*, desde que não alterem o comportamento esperado, não implicam lançamento de uma nova versão.

<Footer3 />

<br />