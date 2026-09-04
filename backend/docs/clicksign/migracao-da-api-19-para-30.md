---
updatedAt: 2026-07-20T14:25:02.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Migração da API 1.9 para 3.0

Está na API 1.9? Entenda os benefícios da migração para a 3.0

<Callout icon="⚠️" theme="warn">
  ###

  **Importante:** A API 1.9 é uma API legada, portanto não receberá mais atualizações ou melhorias.
  Todas as evoluções da plataforma estão sendo direcionadas exclusivamente para a versão 3.0 (Envelope).
</Callout>

<br />

# Por que migrar?

Migrar para a 3.0 não é só atualizar a integração — é evoluir para um modelo que facilita debug, traz mais flexibilidade no envio e aumenta a segurança.

<b>O que você ganha com a migração</b>

<Cards columns={2}>
  <CCard title="Mais flexibilidade nos seus processos" icon="https://files.readme.io/98df37ea415a3033975eae090e49916be6a51e24bf9bc74015ef01f085ab1936-high-voltage.svg">
    <p>Configure assinaturas com flexibilidade.!</p>
    <p>Envie 100 contratos para diferentes para 100 pessoas em um único disparo, com total controle sobre quem assina o quê. Cada pessoa acessa apenas o documento atribuído a ela.</p>
  </CCard>

  <CCard title="Economia de tempo" icon="https://files.readme.io/8a3fca7ab7d15f502a27b5184f18bf383f40f74a6766d8a5d2e6d559102bd5db-clock.svg">
    <p>Redução significativa no tempo de configuração do envio massivo de documentos para diferentes signatários, com diferentes autenticações, qualificações e configurações.</p>
  </CCard>

  <CCard title="Novas funcionalidades exclusivas" icon="https://files.readme.io/470f4c2b477cff69f568b0a0f13e5984b65fc0e52a7b84b1eefe873e0401a932-rocket.svg">
    <p>Documentoscopia, biometria facial com verificação governamental, assinatura posicionada, comprovante de endereço,
    usuário observador, e outras funcionalidades disponíveis apenas na 3.0!</p>
  </CCard>

  <CCard title="Segurança aprimorada" icon="https://files.readme.io/2f370b19f598ed173670e810a8d056cfc0a271532ee1e297377a54b50209a03e-shield.svg">
    <p>Solicite uma análise forense para comprovar autenticidade do documento de quem assina, e verifique sua biometria
    facial em bases governamentais através das nossas novas autenticações, garantindo mais segurança ao seu processo
    de assinatura.</p>
  </CCard>
</Cards>

<br />

# O que muda na prática

| **Funcionalidade**              | **API Lote 1.9**                                                              | **API Envelope 3.0**                                                             |
| :------------------------------ | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| Flexibilidade de documentos     | <para type="default">Todos assinam todos os documentos</Para>                 | <para type="success">✔ Cada pessoa assina apenas os documentos designados</Para> |
| Estrutura dos endpoints         | <para type="default">URLs menos padronizadas</Para>                           | <para type="success">✔ Padrão REST mais consistente</Para>                       |
| Autenticações                   | <para type="default">Obrigatoriedade do uso de autenticações primárias</Para> | <para type="success">✔ Autenticações flexíveis</Para>                            |
| Retorno de erros                | <para type="default">Respostas genéricas em muitos casos</Para>               | <para type="success">✔ Códigos e mensagens mais descritivas</Para>               |
| Recursos disponíveis            | <para type="default">Funcionalidades limitadas</Para>                         | <para type="success">✔ Novas funcionalidades exclusivas</Para>                   |
| Suporte e evolução              | <para type="default">Sem novas melhorias</Para>                               | <para type="success">✔ Atualizações contínuas</Para>                             |
| Estrutura padronizada           | <para type="default">Não possui</Para>                                        | <para type="success">✔ Sim, baseada no JSON:API</Para>                           |
| Suporte nativo a filtros e sort | <para type="default">Manual</Para>                                            | <para type="success">✔ Padrão: filter\[], sort=</Para>                           |

<br />

# Como a migração resolve problemas do dia a dia

<div className="CardsGrid">
  <div className="Card" style={{ 'padding-bottom': '15px'}}>
    <p class="Card-title">Contrato com múltiplos documentos</p>
    <Para type="default">"Preciso enviar um contrato principal + 3 documentos para 5 pessoas diferentes, cada uma assinando documentos específicos"</Para>

```
<Columns>
  <div class="rm-card-dark-red" style={{ padding: '0.5rem', flex: '1' }}>
    <i class="Card-icon fa-duotone fa-solid fa-close" style={{ '--Card-icon-color': 'red' }}></i> 			             <strong className="ml-8">Com a API 1.9:</strong>

    * 4 envios separados
    * Configuração individual para cada documento
    * Impossível corrigir erros sem reenviar tudo
    * Processo demorado e burocrático
  </div>

  <div style={{padding: '0.5rem', flex: '1'}} className="rm-card-dark-green">
    <i class="Card-icon fa-duotone fa-solid fa-square-check" style={{ '--Card-icon-color': 'green' }}></i> 		      <strong className="ml-8">Com a API 3.0:</strong>

    * 1 único envelope
    * Configuração centralizada
    * Possível corrigir enquanto o envelope estiver em processo
    * Mais agilidade e flexibilidade
  </div>
</Columns>
```

  </div>
</div>

<div className="CardsGrid">
  <div className="Card" style={{ 'padding-bottom': '15px'}}>
    <p class="Card-title">Processo corporativo com aprovações</p>
    <Para type="default">"Contrato que precisa passar por aprovação do jurídico, assinatura do diretor e depois do cliente"</Para>

```
<Columns>
  <div class="rm-card-dark-red" style={{ padding: '0.5rem', flex: '1' }}>
    <i class="Card-icon fa-duotone fa-solid fa-close" style={{ '--Card-icon-color': 'red' }}></i>

    <strong className="ml-8">Com a API 1.9:</strong>

    * Gerenciamento manual da sequência
    * Múltiplos sistemas para acompanhar
    * Retrabalho se houver mudanças
    * Tempo: Semanas
  </div>

  <div style={{ padding: '0.5rem', flex: '1'}} className="rm-card-dark-green">
    <i class="Card-icon fa-duotone fa-solid fa-square-check" style={{ '--Card-icon-color': 'green' }}></i>     	     <strong className="ml-8">Com a API 3.0:</strong>

    * Fluxo automatizado no envelope
    * Acompanhamento centralizado
    * Usuário observador (jurídico)
    * Tempo: Dias
  </div>
</Columns>
```

  </div>
</div>

<br />

# Funcionalidades exclusivas

<Para type="default">Ao migrar para a API 3.0, você garante acesso a funcionalidades exclusivas que aumentam a segurança e a flexibilidade das suas jornadas de assinatura:</Para>

<p>🔍 **Documentoscopia**</p>

<Para type="default">Usufrua de uma análise forense das diversas características de um documento, com o objetivo de comprovar sua autenticidade e reduzir riscos de fraude.</Para>

<span>🧑‍💻 **Biometria facial com verificação em bases oficiais** </span>

<Para type="default">Obtenha uma camada extra de segurança, com validação biométrica vinculada à uma base governamental (Serpro).</Para>

<span>✍️ **Assinatura posicionada**</span>

<Para type="default">Configure os locais de assinatura e rubrica para cada signatário no documento.</Para>

<span>📬 **Comprovante de endereço**</span>

<Para type="default">Solicite o envio de um comprovante de endereço para o seu signatário.</Para>

<span>:card\_index\_dividers:**&#x20;Assinatura em massa deslogada**</span>

<Para type="default">Permita que os usuários assinem múltiplos documentos (envelopes distintos) de uma só vez de forma ágil, mesmo sem estarem logados na plataforma.</Para>

<span>:magic\_wand: **Criação automática de assinatura manuscrita**</span>

<Para type="default">Facilite a experiência gerando automaticamente opções de assinatura manuscrita e rubrica personalizadas para o signatário.</Para>

<span>:gear: **Assinatura automática via API**</span>

<Para type="default">Integre e automatize totalmente o seu fluxo de trabalho, permitindo a execução de assinaturas de forma automática diretamente pelo seu sistema.</Para>

<span>:speech\_balloon: **Remetente customizado no WhatsApp**</span>

<Para type="default">Personalize o nome e a identificação da sua empresa nos disparos de WhatsApp, gerando mais confiança e reconhecimento da marca.</Para>

<span>:calling: **Jornadas 100% WhatsApp**</span>

<Para type="default">Ofereça uma experiência fluida e sem atritos onde todo o processo de assinatura ocorre dentro do próprio aplicativo, utilizando tecnologia Flow e Webview.</Para>

<span>:jigsaw:**&#x20;Widget Embedded com Certificado Digital**</span>

<Para type="default">Incorpore a jornada de assinatura diretamente no seu site ou aplicativo (white-label), agora com suporte nativo à autenticação por Certificado Digital.</Para>

# Pronto para os próximos passos?

<Para type="default">Agora que você entendeu os novos benefícios, é hora de começar a implementação. Acesse o nosso guia:</Para>

[Guia de migração](https://developers.clicksign.com/docs/guia-de-migracao)

<Footer3 />

<br />