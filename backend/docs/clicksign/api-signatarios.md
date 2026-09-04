---
updatedAt: 2026-02-19T01:42:12.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Signatários

Explore Nossos Endpoints: CRUD do Signatário de um Envelope

Aqui, você encontrará uma lista completa de endpoints para gerenciar signatários em nossa API de assinatura eletrônica. Cada endpoint vem com uma breve descrição de sua função, facilitando sua integração em sua aplicação. Explore e simplifique seus processos de assinatura conosco.

## Endpoints Disponíveis:

#### 1. Consultar Signatários de um Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** **`/envelopes/{envelope_id}/signers`**
* **Descrição:** Lista os signatários associados a um envelope específico.
* **URL:** [Página de Referência](/v3.0/reference/api-listar-signatarios).

#### 2. Criar Signatário:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:** **`/envelopes/{envelope_id}/signers`**
* **Descrição:** Adiciona um novo signatário ao processo de assinatura de um envelope.
* **URL:** [Página de Referência](/v3.0/reference/api-criar-signatario).

#### 3. Visualizar Signatário:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get " data-testid="http-method">GET</span>
* **Endpoint:`/envelopes/{envelope_id}/signers/{id}`**
* **Descrição:** Recupera os detalhes de um signatário específico com base no ID fornecido.
* **URL:** [Página de Referência](/v3.0/reference/api-detalhes-do-signatario).

#### 4. Excluir Signatário:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_delete" data-testid="http-method">DELETE</span>
* **Endpoint:`/envelopes/{envelope_id}/signers/{id}`**
* **Descrição:** Exclui permanentemente um signatário de um envelope com status `draft`.
* **URL:** [Página de Referência](/v3.0/reference/api-excluir-signatario).

## Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).