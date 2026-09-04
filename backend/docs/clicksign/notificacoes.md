---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Notificações

# O que são notificações?

As notificações são uma parte essencial do processo de assinatura, permitindo que você informe os signatários sobre a necessidade de assinatura de documentos.

# Sobre as notificações

As notificações somente podem ser realizadas a partir de envelopes "em progresso" (`running`), então antes de executar chamadas, garanta que seu envelope cumpriu todos os requisitos e ative-o.

Atualmente, existem três tipos de notificações configuráveis para o signatário. No entanto, apenas uma delas é entregue por meio dos endpoints: a **Solicitação de Assinatura**.

# Rate-limit

É importante observar que as notificações de solicitação de assinatura têm um `rate-limit` de 1 notificação por minuto por endpoint. Isso significa que você só pode enviar uma notificação por minuto para cada endpoint.

<Image align="center" border={true} src="https://files.readme.io/9b93e23-Screenshot_20240320_102819.png" className="border" />

# Endpoints

* [**Notificar um Signatário**](/v3.0/reference/api-notificar-signatario): Endpoint que permite enviar uma notificação para um signatário específico, solicitando a assinatura de um documento dentro de um envelope. A notificação é entregue ao signatário por meio do canal de comunicação configurado, informando sobre a necessidade de assinatura do documento.

* [**Notificar todos Signatários**](/reference/api-notificar-envelope): O endpoint permite enviar uma notificação para todos os signatários do envelope, solicitando a assinatura de documentos. A notificação é entregue a todos os signatários configurados no envelope, informando sobre a necessidade de assinatura dos documentos contidos no mesmo.

As notificações são entregues aos signatários por meio do canal de comunicação configurado (pelo campo `signature_request`), informando sobre a necessidade de assinatura do documento. Em caso de dúvida sobre a configuração do signatário, veja a página [Campos do Signatário: communicate\_events](/v3.0/reference/envelope-campos-e-regras-de-negocio).

# Páginas relacionadas

[**Notificar Signatários**](/v3.0/reference/notificacao-campos-e-regras-de-negocio): Consulte a página para entender como funcionam nossas notificações, opções disponíveis, cobrança e mantenha-se atualizado com as últimas informações sobre o processo de notificação dos signatários.

<Footer3 />