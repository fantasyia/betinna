---
updatedAt: 2026-02-19T01:43:04.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Observadores de Assinaturas

**Bem-vindo à Página de Criação de Observadores da Clicksign!**

Estamos muito felizes em vê-lo por aqui! Nesta seção, você tem a oportunidade de definir observadores para o processo de assinatura. Aqui você pode configurar os observadores e nível de acompanhamento de cada um.

## Endpoints Disponíveis:

#### 1. Consultar Observadores de um Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** **`/envelopes/{envelope_id}/signature_watchers`**
* **Descrição:** Lista os observadores associados a um envelope específico.
* **URL:** [Página de Referência](/v3.0/reference/api-listar-observadores).

#### 2. Criar Observadores:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:** **`/envelopes/{envelope_id}/signature_watchers`**
* **Descrição:** Cria observador ao processo de assinatura.
* **URL:** [Página de Referência](/v3.0/reference/api-criar-observadores).

#### 3. Visualizar um Observador:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get " data-testid="http-method">GET</span>
* **Endpoint:`/envelopes/{envelope_id}/signature_watchers/{id}`**
* **Descrição:** Recupera os detalhes de um observador específico com base no ID fornecido.
* **URL:** [Página de Referência](/v3.0/reference/api-detalhes-do-observador).

#### 4. Excluir Observador:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_delete" data-testid="http-method">DELETE</span>
* **Endpoint:`/envelopes/{envelope_id}/signature_watchers/{id}`**
* **Descrição:** Exclui permanentemente um observador de um envelope.
* **URL:** [Página de Referência](/v3.0/reference/api-excluir-observador).

## Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).