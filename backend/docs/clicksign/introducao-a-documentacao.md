---
updatedAt: 2026-06-19T17:30:27.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 1.1. Introdução à documentação

Introdução à documentação, seções e contato de suporte

Aprenda os conceitos essenciais para integrar com a API do Envelope da Clicksign.

> ⚠️
>
> **Importante:** O envelope está ativo para contas criadas a partir de 01/07/2024. Caso receba o erro de serviço indisponível, entre em contato com nosso [Time de Suporte](https://www.clicksign.com/suporte)

<Columns layout="auto">
  <Column>
    <h1>O que é a API do Envelope?</h1>

    <p>
      A API do Envelope é a nova forma de integrar com a Clicksign. Um envelope é um compartimento que agrupa documentos e signatários em uma única transação, oferecendo mais flexibilidade e controle sobre o processo de assinatura. Com ele, você pode definir exatamente quem assina o quê e configurar a ordem de assinatura
    </p>
  </Column>

  <Column>
    <Image align="center" src="https://files.readme.io/76a2e3e9f29b0fbaaba5fdb98c170a33bab66756a0a3ccadea94ceb686a74d75-diagrama-3.0.png" />
  </Column>
</Columns>

# Glossário de Termos Essenciais

Entenda os principais conceitos da API do Envelope.

<Cards columns={3}>
  <CCard title="Envelope" icon="https://files.readme.io/36d26d67769051dd43b1b5b3c3967c10cce6d0de030bb6815de4bc5eb5be1b14-page.svg">
    <p>Compartimento que grupa documentos, signatários e requisitos em uma única entidade, representando uma transação completa, e facilitando a gestão dos documentos que são enviados juntos.</p>
  </CCard>

  <CCard title="Signatário (Signer)" icon="https://files.readme.io/2c675c2a1734cf69ef238ccea5c2c1455cf823631fbd271fef3e6b265af31720-bust-person.svg">
    <p>Pessoa que assina o documento. Os signatários são adicionados ao Envelope e conectados aos documentos por meio de Requisitos. É possível enviar vários documentos de uma vez para diferentes signatários, e definir quem assina o quê, ou quem apenas observa.</p>
  </CCard>

  <CCard title="Documento (Document)" icon="https://files.readme.io/36d26d67769051dd43b1b5b3c3967c10cce6d0de030bb6815de4bc5eb5be1b14-page.svg">
    <p>Arquivo que será assinado, adicionado ao Envelope. Na nossa arquitetura, documentos são simples - não carregam lógica de signatários ou configurações. Isso fica no Envelope e nos Requisitos.</p>
  </CCard>

  <CCard title="Requisito (Requirement)" icon="https://files.readme.io/287338fe0c65a65e61540465b61b1eb1c1ffd9725da960a4df9f1dba4c0c8a67-gear.svg">
    <p>Um Requisito conecta um signatário a um documento. Existem dois requisitos obrigatórios: Qualificação (define em qual papel o signatário assina; ex.: Contratante) e Autenticação (define qual método de autenticação será utilizado; ex.: Biometria facial). </p>
  </CCard>

  <CCard title="Evidência (Evidence)" icon="https://files.readme.io/2aa5dc700689bb1da668dea9a9070cb12883dc3c076489565a6868d4df72172e-magnifying.svg">
    <p>Representação das "provas" criadas pelos signatários para cumprir os Requisitos. Cada Evidence tem um tipo específico e artefatos associados (imagens, textos, etc.).</p>
  </CCard>

  <CCard title="Notificação (Notification)" icon="https://files.readme.io/f9ef5e7f5cac5fa4a38d85403546efd64fdad97d1c878ef99bd4024e453d434a-envelope-arrow.svg">
    <p>Disparo das notificações para os signatários, permitindo que você os informe sobre a necessidade de assinatura dos documentos enviados.</p>
  </CCard>
</Cards>

> 🤖 **Integrando com auxílio de IA?** Disponibilizamos a documentação otimizada para ChatGPT, Claude, Cursor e outros agentes. [Conhecer os recursos disponíveis](https://developers.clicksign.com/docs/integre-com-aux%C3%ADlio-de-ia#/).

# Escolha seu caminho de aprendizado

<Cards columns={2}>
  <CCard title="Primeiros Passos" icon="https://files.readme.io/470f4c2b477cff69f568b0a0f13e5984b65fc0e52a7b84b1eefe873e0401a932-rocket.svg">
    <p>Novo na API do Envelope? Comece aqui para criar sua primeira integração e entender o fluxo básico.</p>
    <a href="https://developers.clicksign.com/docs/primeiros-passos">Começar integração</a>
  </CCard>

  <CCard title="Migração da API 1.9" icon="https://files.readme.io/82e0e99b0c4a3eeb6754d3f812f40de9395961814a7b36557d467d293ffd1183-arrows.svg">
    <p>Já usa a API anterior? Aprenda as diferenças e como migrar sua integração existente.</p>
    <a href="https://developers.clicksign.com/docs/guia-de-migracao">Começar migração</a>
  </CCard>

  <CCard title="Configurações Avançadas" icon="https://files.readme.io/287338fe0c65a65e61540465b61b1eb1c1ffd9725da960a4df9f1dba4c0c8a67-gear.svg">
    <p>Explore recursos avançados como autenticações, webhooks e integrações complexas.</p>
    <a href="https://developers.clicksign.com/docs/introducao-a-webhooks">Ver recursos avançados</a>
  </CCard>

  <CCard title="FAQ" icon="https://files.readme.io/57e7c333671e603b61a08f6cc50f757cd55efec38979ea9546ec0df0f1f42b54-sos.svg">
    <p>Tenho uma dúvida específica ou problema pontual que preciso resolver rapidamente.</p>
    <a href="">Buscar respostas</a>
  </CCard>
</Cards>

# Como a API está organizada?

A documentação da API do Envelope está dividida em seções principais para facilitar sua navegação e aprendizado. Cada seção foca em um aspecto específico da integração.

1. **[ENVELOPE](https://developers.clicksign.com/v3.0/docs/envelope):** É a forma de realizar a integração back end com sua aplicação. É através da API REST que se dá, por exemplo, a criação de documentos, adição e remoção de signatários e finalização de documentos.

2. **[ACEITE VIA WHATSAPP](https://developers.clicksign.com/v3.0/docs/informa%C3%A7%C3%B5es-gerais-aceite-via-whatsapp):** É a funcionalidade que permite aceitar termos ou acordos diretamente pelo WhatsApp por meio da integração com a API Clicksign.

3. **[WEBHOOKS](https://developers.clicksign.com/v3.0/docs/introducao-a-webhooks):** São notificações dos eventos ocorridos na Clicksign para sua aplicação. Quando um evento ocorre, a Clicksign notifica a sua aplicação imediatamente, através de uma requisição HTTP POST para uma URL previamente cadastrada.

4. **[WIDGET EMBEDDED](https://developers.clicksign.com/v3.0/docs/introducao-ao-widget-embedded):** É a integração front end que permite que assinaturas sejam realizadas dentro da sua aplicação. Ele preserva o fluxo contínuo do usuário em uma contratação por não implicar troca de contexto para o website da Clicksign.

5. **[SINGLE SIGN ON VIA SAML](https://developers.clicksign.com/v3.0/docs/introdu%C3%A7%C3%A3o-ao-sso-com-saml):** É um padrão aberto que autoriza que provedores de identidades (IdP) passem credenciais de autorização para provedores de serviços (SP). Ele permite que a sua empresa tenha total controle sobre as políticas de segurança dos usuários cadastrados na sua conta Clicksign. Após ter o SAML configurado, todos os usuários que possuem e-mail corporativo, com domínio igual ao configurado, terão essa forma de login (SSO via SAML) como padrão.

<Footer3 />

<br />