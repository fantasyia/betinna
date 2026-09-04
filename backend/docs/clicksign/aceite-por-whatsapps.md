---
updatedAt: 2026-01-06T16:30:17.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Aceite por WhatsApp

**Bem-vindo à Página de Aceite via WhatsApp da Clicksign!**

Estamos muito felizes em vê-lo por aqui! Nesta seção, você pode criar e gerenciar  aceite enviados via WhatsApp para seus signatários.

## Endpoints Disponíveis:

#### 1. Listar Aceite por WhatsApp:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** **`/acceptance_term/whatsapps`**
* **Descrição:** Lista todos os aceites via WhatsApp da sua conta.
* **URL:** [Página de Referência](/reference/api-listar-aceites-via-whatsapp).

#### 2. Criar Aceite por WhatsApp:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:** **`/acceptance_term/whatsapps`**
* **Descrição:** Cria um novo aceite e envia via WhatsApp para o signatário.
* **URL:** [Página de Referência](/v3.0/reference/api-criar-aceite-whatsapp).

#### 3. Visualizar Aceite por WhatsApp:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** **`/acceptance_term/whatsapps/{whatsapp_id}`**
* **Descrição:** Recupera os detalhes de um aceite de WhatsApp específico.
* **URL:** [Página de Referência](/reference/visualizar-um-aceite-via-whatsapp).

#### 4. Editar Aceite por WhatsApp:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_patch" data-testid="http-method">PATCH</span>
* **Endpoint:** **`/acceptance_term/whatsapps/{whatsapp_id}`**
* **Descrição:** Cancela um aceite de WhatsApp que foi enviado (status `sent`).
* **URL:** [Página de Referência](/reference/editar-um-aceite-via-whatsapp).

<Footer3 />