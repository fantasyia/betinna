---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Signatários

# O que são signatários?

Os signatários são partes fundamentais do processo de assinatura, sendo responsáveis por revisar e assinar documentos essenciais. Aqui, você aprenderá como adicionar, configurar e interagir com os signatários em seus envelopes, assegurando que o fluxo de assinatura seja eficiente, seguro e livre de erros.

# Adição de signatário

Ao adicionar um signatário ao envelope, você tem a flexibilidade de fornecer informações relevantes, como nome, endereço de e-mail, número de celular e outras opções essenciais para o processo de assinatura. Essas informações permitem que o signatário participe ativamente da assinatura dos documentos.

Através do endpoint de [Adicionar Signatário no Envelope](/v3.0/reference/api-criar-signatario), você pode iniciar o processo de inclusão de um novo signatário no envelope, permitindo que o fluxo de assinatura seja configurado de acordo com suas necessidades.

## Restrições e limitações

Ao adicionar signatários a envelopes na Clicksign API, existem algumas considerações importantes a serem observadas para garantir uma integração bem-sucedida:

* **Adição de Signatários:** A adição de novos signatários é permitida apenas em envelopes com status `draft`  ou `running`. Envelopes com status `finalizado` ou `cancelado` não podem ter novos signatários adicionados.
* **Adicionando Signatários a Envelopes 'em andamento'**: Envelopes que já estão em processo de assinatura (status `running`) exigem um procedimento específico para a adição de seus requisitos. Utilize a funcionalidade de operações em massa, descrita na [página de documentação](/v3.0/reference/operações-em-massa)."

# Exclusão de signatário

Caso seja necessário remover um signatário de um envelope, a Clicksign API permite a exclusão, desde que o envelope esteja em um estado apropriado. É importante observar as seguintes regras ao excluir um signatário:

* **Estado do Envelope:** Para excluir um signatário, o envelope não pode estar com o status `finalizado` ou `cancelado`. A exclusão é permitida apenas quando o envelope está no estado `draft` ou `running`, e desde que o signatário **não tenha iniciado o processo de assinatura**.
* **Alteração de Dados do Signatário:** Não é possível alterar as informações de um signatário após sua adição ao envelope. Por isso, é crucial revisar todos os detalhes antes de adicionar o signatário ao envelope.
* **Exclusão de Signatário:** Se um signatário ainda não iniciou o processo de assinatura, é possível excluí-lo do envelope, mesmo que o envelope esteja no estado "em progresso" (running). No entanto, a exclusão não é possível após a assinatura ter sido iniciada.

Essas regras e restrições visam garantir que o processo de gerenciamento de signatários seja realizado de forma organizada e eficiente, permitindo uma experiência de assinatura eletrônica tranquila.

<Footer3 />