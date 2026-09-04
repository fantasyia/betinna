---
updatedAt: 2026-03-19T17:21:49.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Envelope

Explore Nossos Endpoints: CRUD do Envelope

Abaixo, você encontrará uma lista detalhada de todos os endpoints disponíveis para criar, ler, atualizar e excluir envelopes usando nossa API. Cada endpoint é acompanhado por uma breve descrição de sua função, permitindo que você integre nossa API em sua aplicação com facilidade.:

## Endpoints Disponíveis

#### 1. Listar Envelopes

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:`/envelopes`**
* **Descrição:** Lista todos os envelopes disponíveis, fornecendo detalhes básicos de cada envelope.
* **URL:** [Página de Referência](/v3.0/reference/api-listar-envelopes).

#### 2. Criar Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:`/envelopes`**
* **Descrição:** Cria um envelope para iniciar o processo de assinatura eletrônica.
* **URL:** [Página de Referência](/v3.0/reference/api-criar-envelope).

#### 3. Ativar Envelope \[EM DESENVOLVIMENTO]:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:`/envelopes/{id}/activate`**
* **Descrição:** Executa de forma assíncrona a ativação do envelope, retornando a resposta do processamento via webhook.
* **URL:** [Página de Referência](/v3.0/reference/api-ativar-envelope) .

#### 4. Atualizar Envelope:)

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_patch" data-testid="http-method">PATCH</span>
* **Endpoint:`/envelopes/{id}`**
* **Descrição:** Atualiza os detalhes de um envelope existente, como adicionar/remover destinatários, documentos ou configurar notificações.
* **URL:** [Página de Referência](/v3.0/reference/api-editar-envelope) .

#### 5. Visualizar Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:`/envelopes/{id}`**
* **Descrição:** Recupera os detalhes de um envelope específico com base no ID fornecido.
* **URL:** [Página de Referência](/v3.0/reference/api-detalhes-do-envelope).

#### 6. Excluir Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_delete" data-testid="http-method">DELETE</span>
* **Endpoint:`/envelopes/{id}`**
* **Descrição:** Exclui permanentemente um envelope e todos os seus documentos associados.
* **URL:** [Página de Referência](/v3.0/reference/api-excluir-envelope).

<Footer3 />