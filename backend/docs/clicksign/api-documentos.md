---
updatedAt: 2026-02-19T01:41:19.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Documentos

Explore Nossos Endpoints: CRUD do Documento de um Envelope

Abaixo, apresentamos uma lista abrangente de todos os endpoints disponíveis para consultar, criar, visualizar e excluir documentos usando nossa API. Cada endpoint é acompanhado por uma breve descrição de sua função, facilitando a integração de nossa API em sua aplicação.

## Endpoints Disponíveis:

#### 1. Consultar Documentos de um Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** **`/envelopes/{envelope_id}/documents`**
* **Descrição:** Lista os documentos associados a um envelope específico.
* **URL:** [Página de Referência](/v3.0/reference/api-listar-documentos).

#### 2. Criar Documento:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:** **`/envelopes/{envelope_id}/documents`**
* **Descrição:** Adiciona um documento ao processo de assinatura de um envelope.
* **URL:**
  * [Página de Referência para Criação de Documentos por Upload](/v3.0/reference/api-upload-documentos).
  * [Página de Referência para Criação de Documentos por Modelo](/v3.0/reference/criar-documento-por-modelo).

#### 3. Editar Documento:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_patch " data-testid="http-method">PATCH</span>
* **Endpoint:`/envelopes/{envelope_id}/documents/{id}`**
* **Descrição:** Altera o status de um documento.
* **URL:** [Página de Referência](/v3.0/reference/editar-documento).

#### 4. Visualizar Documento:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get " data-testid="http-method">GET</span>
* **Endpoint:`/envelopes/{envelope_id}/documents/{id}`**
* **Descrição:** Recupera os detalhes de um documento específico com base no ID fornecido.
* **URL:** [Página de Referência](/v3.0/reference/detalhes-do-documento).

#### 5. Excluir Documento:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_delete" data-testid="http-method">DELETE</span>
* **Endpoint:`/envelopes/{envelope_id}/documents/{id}`**
* **Descrição:** Exclui permanentemente um documento com status `draft`.
* **URL:** [Página de Referência](/v3.0/reference/api-excluir-documento).

## Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).