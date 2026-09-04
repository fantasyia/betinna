---
updatedAt: 2026-02-19T01:43:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Notificações

Explore Nossos Endpoints de Notificações

Nesta seção, você terá acesso aos endpoints relacionados às notificações de signatários e envelopes em nossa API de assinatura eletrônica. Esses endpoints permitem enviar notificações para informar os signatários sobre a necessidade de assinar documentos em envelopes específicos.

## Endpoints Disponíveis:

#### 1. Notificar um Signatário do Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">POST</span>
* **Endpoint:** **`/api/v3/envelopes/{envelope_id}/signers/{signer_id}/notifications`**
* **Descrição:** Notifica conforme configurado um signatário do envelope, caso esteja no grupo ativo de assinaturas.
* **URL:** [Página de Referência](/v3.0/reference/api-notificar-signatario).

#### 2. Notificar todos os Signatários do Envelope:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">POST</span>
* **Endpoint:** **`/api/v3/envelopes/{envelope_id}/notifications`**
* **Descrição:** Notifica conforme configurado todos os signatário do envelope que estejam no grupo ativo de assinaturas.
* **URL:** [Página de Referência](/v3.0/reference/api-notificar-envelope).

## Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).