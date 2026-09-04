---
updatedAt: 2026-05-27T10:41:31.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Guia de migração

Preparação conceitual completa para migração da API 1.9 para a API 3.0 com segurança e clareza

<Callout icon="⚠️" theme="warn">
  **Importante:** A API 1.9 é uma API legada, portanto não receberá mais atualizações ou melhorias.
  Todas as evoluções da plataforma estão sendo direcionadas exclusivamente para a versão 3.0 (Envelope).
</Callout>

<br />

# Por que atualizamos nossa API?

A versão antiga da API (1.9) não representava o que realmente acontece na assinatura: pessoas, documentos e regras caminhando juntas até a conclusão de um acordo. Essa lógica ficava espalhada entre Document, List, Batch e Signature, o que gerava acoplamento, pouco espaço para ajustes e difícil evolução.
Nossa versão 3.0 Envelope trata cada envio como uma **transação**. Você cria o envelope (draft), adiciona os documentos e as pessoas que deverão assiná-los, define **requisitos** que ligam quem assina o quê e como ela será autenticada, e então ativa. Tudo fica explícito (Requirements e Evidence), cada pessoa interage só com o que precisa, dá para ajustar, os erros são mais claros e os webhooks mais granulares.

**Resultado**: menos retrabalho, mais flexibilidade e uma base sólida para recursos novos.

<br />

# Comparação: 1.9 vs 3.0

O diagrama a seguir ilustra as entidades e seus relacionamentos nas duas arquiteturas, destacando a complexidade da arquitetura antiga e a flexibilidade da nova.

<Image align="center" border={false} width="0px" src="https://files.readme.io/76a2e3e9f29b0fbaaba5fdb98c170a33bab66756a0a3ccadea94ceb686a74d75-diagrama-3.0.png" />

<Image align="center" border={false} width="0px" src="https://files.readme.io/03e2822ad53adac922e7fc00a9c3d1852a7e44d817691c577b03d17309b26a8b-diagrama1.9.png" />

<Columns columns={2}>
  <Card>
    <p><strong>1.9</strong></p>

    <Image align="center" src="https://files.readme.io/03e2822ad53adac922e7fc00a9c3d1852a7e44d817691c577b03d17309b26a8b-diagrama1.9.png" />

    Sistema baseado em processamento sequencial de documentos individuais com relacionamentos complexos e acoplados.

    * Documento como entidade central
    * Signatários acoplados ao documento
    * Configurações distribuídas
    * Processamento individual
    * Relacionamentos implícitos
  </Card>

  <Card>
    <p><strong>3.0</strong></p>

    <Image align="center" src="https://files.readme.io/76a2e3e9f29b0fbaaba5fdb98c170a33bab66756a0a3ccadea94ceb686a74d75-diagrama-3.0.png" />

    Sistema baseado em transações que agrupam documentos, pessoas e requisitos em uma única entidade coesa e flexível.

    * Envelope como container de transação
    * Entidades desacopladas e flexíveis
    * Configurações centralizadas
    * Processamento em massa inteligente
    * Relacionamentos explícitos via Requirements
  </Card>
</Columns>

<br />

# Glossário de termos essenciais

Entenda as principais diferenças arquiteturais entre as duas versões da API Clicksign.

<br />

<Cards columns={3}>
  <CCard title="Envelope" icon="https://files.readme.io/dbe797550afec61ed74032077899ed5bb0d7fb2598fd1beb4edec8b72720c663-envelope.svg">
    <p>Na API 1.9, os documentos eram enviados de forma isolada. Agora
    temos a figura do Envelope: um compartimento que grupa documentos, signatários e requisitos em uma única entidade,
    representando uma transação completa, e facilitando a gestão dos documentos que são enviados juntos.	</p>
  </CCard>

  <CCard title="Signatário (Signer)" icon="https://files.readme.io/2c675c2a1734cf69ef238ccea5c2c1455cf823631fbd271fef3e6b265af31720-bust-person.svg">
    <p>Pessoa que assina o documento. Agora os signatários são
    adicionados ao Envelope e conectados aos documentos por meio de Requirements. Na 1.9, todos precisavam assinar
    todos os documentos; agora é possível enviar vários de uma vez e definir quem assina o quê, ou apenas observa.</p>
  </CCard>

  <CCard title="Documento (Document)" icon="https://files.readme.io/36d26d67769051dd43b1b5b3c3967c10cce6d0de030bb6815de4bc5eb5be1b14-page.svg">
    <p>Arquivo que será assinado, adicionado ao Envelope. Na nova arquitetura, documentos são mais simples - não carregam lógica de signatários ou configurações. Isso fica no Envelope e nos Requirements.</p>
  </CCard>

  <CCard title="Requisito (Requirement)" icon="https://files.readme.io/287338fe0c65a65e61540465b61b1eb1c1ffd9725da960a4df9f1dba4c0c8a67-gear.svg">
    <p>Um Requirement conecta um signatário a um documento. Existem dois requisitos obrigatórios: Qualificação (define em qual papel o signatário assina; ex.: Contratante) e Autenticação (define qual método de autenticação será utilizado; ex.: Biometria facial). Ele substitui o "List" da API 1.9.</p>
  </CCard>

  <CCard title="Evidência (Evidence)" icon="https://files.readme.io/2aa5dc700689bb1da668dea9a9070cb12883dc3c076489565a6868d4df72172e-magnifying.svg">
    <p>Representação das "provas" criadas pelos signatários para cumprir os Requirements. Cada Evidence tem um tipo específico e artefatos associados (imagens, textos, etc.), ex.: a imagem da Biometria facial.
    Substitui o conceito de "Signature" da API 1.9.</p>
  </CCard>

  <CCard title="Notificação (Notification)" icon="https://files.readme.io/f9ef5e7f5cac5fa4a38d85403546efd64fdad97d1c878ef99bd4024e453d434a-envelope-arrow.svg">
    <p>Disparo das notificações para os signatários, permitindo que você os informe sobre a necessidade de assinatura dos documentos enviados.</p>
  </CCard>
</Cards>

<br />

# Fluxo do novo processo de assinatura

Entenda como funciona o processo completo na nova arquitetura, desde a criação até a finalização.

1. **Criar Envelope** - Adicionar Documentos
2. **Adicionar Documentos**  - Upload dos arquivos que fazem parte da transação
3. **Adicionar Signatários** - Pessoas envolvidas no processo (incluindo observadores)
4. **Criar Requirements** - Definir o que cada pessoa precisa fazer com cada documento
5. **Configurar Envelope** - Prazos, idioma, mensagens, configurações gerais
6. **Ativar Envelope** - Iniciar o processo
7. **Enviar Notificação** - Informar todos os envolvidos

<Image align="center" border={false} src="https://files.readme.io/5a16a35dff7791169667cfa7d2ea425f0c13c2ca3eaef5e047a7c1bd6c2a50ef-Prof_Services_Fluxograma_API.jpg" />

<br />

# Pronto para construir?

Confira as diferenças técnicas entre as duas versões de API, com exemplos de código, tudo pensado para facilitar ainda mais a sua migração:

[Comparativo técnico](https://developers.clicksign.com/docs/comparativo-tecnico#/)

<Footer3 />