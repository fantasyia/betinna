---
updatedAt: 2026-05-27T12:22:04.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Requisitos

Explore Nossos Endpoints para Requisitos de um Envelope.

Aqui você pode verificar como configurar se um requisito é uma evidência, como token por e-mail, ou uma qualificação, como parte, contratante, contratado, testemunha, entre outros, ou até mesmo solicitar que o documento seja rubricado.

Em caso de dúvidas, consulte nossa <Anchor target="_blank" href="https://developers.clicksign.com/docs/tipos-de-requisitos-de-autenticacao">página de documentação teórica sobre Requisitos.</Anchor>

## Endpoints Disponíveis:

#### 1. Consultar Requisitos de um Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** `/envelopes/{envelope_id}/requirements`
* **Descrição:** Lista os requisitos associados a um envelope específico.
* **URL:** [Página de Referência](/v3.0/reference/api-listar-requisitos).

#### 2. Criar Requisitos:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:** `/envelopes/{envelope_id}/requirements`
* **Descrição:** Cria requisito de assinatura relacionando um signatário a um documento do envelope com status "em rascunho" (`draft`).
* **URL:**
  * [Página de Referência para Criação de Requisito de Qualificação](/v3.0/reference/criar-requisito-qualificacao).
  * [Página de Referência para Criação de Requisito de Autenticação](/v3.0/reference/criar-requisito-de-autenticacao).
  * [Página de Referência para Criação de Requisito de Rubrica](/v3.0/reference/criar-requisito-de-rubrica).

#### 3. Visualizar Requisito:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get " data-testid="http-method">GET</span>
* **Endpoint:**`/envelopes/{envelope_id}/requirements/{id}`
* **Descrição:** Recupera os detalhes de um requisito específico com base no ID fornecido.
* **URL:** [Página de Referência](/v3.0/reference/detalhes-do-requisito).

#### 4. Excluir Requisito:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_delete" data-testid="http-method">DELETE</span>
* **Endpoint:**`/envelopes/{envelope_id}/requirements/{id}`
* **Descrição:** Exclui permanentemente um requisito de um envelope com status `draft`.
* **URL:** [Página de Referência](/v3.0/reference/api-excluir-requisito).

## Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).