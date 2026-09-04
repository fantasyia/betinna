---
updatedAt: 2026-07-15T12:11:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 4.1. Integre com auxílio de IA

Está usando assistentes de código como ChatGPT, Claude, Cursor, GitHub Copilot ou outros agentes para integrar com a Clicksign? Disponibilizamos a documentação em formatos otimizados para que esses agentes consumam o conteúdo com mais precisão e menos ruído visual, evitando que processem código HTML, scripts e elementos de navegação irrelevantes.

# Recursos disponíveis

<Cards columns={3}>
  <CCard title="Arquivo llms.txt" icon="https://files.readme.io/36d26d67769051dd43b1b5b3c3967c10cce6d0de030bb6815de4bc5eb5be1b14-page.svg">
    <p>Mapa completo da documentação em um único arquivo Markdown. Forneça como contexto inicial ao seu agente para que ele conheça toda a estrutura da API Envelope, Webhooks, Widget Embedded, Aceite via WhatsApp e demais recursos.</p>
    <a href="https://developers.clicksign.com/llms.txt">Acessar llms.txt</a>
  </CCard>

  <CCard title="Versão .md de qualquer página" icon="https://files.readme.io/2aa5dc700689bb1da668dea9a9070cb12883dc3c076489565a6868d4df72172e-magnifying.svg">
    <p>Adicione <code>.md</code> ao final de qualquer URL desta documentação para receber o conteúdo em Markdown puro, sem navegação, scripts ou estilos.</p>
    <p>Exemplo: <code>/docs/primeiros-passos</code> → <code>/docs/primeiros-passos.md</code></p>
  </CCard>

  <CCard title="Botão Copy Page" icon="https://files.readme.io/287338fe0c65a65e61540465b61b1eb1c1ffd9725da960a4df9f1dba4c0c8a67-gear.svg">
    <p>No canto superior direito de qualquer página, use o botão <strong>Copy Page</strong> para copiar o conteúdo em Markdown e colar diretamente no LLM da sua preferência, junto com sua pergunta.</p>
  </CCard>
</Cards>

<br />

# Como usar com seu agente

<Columns layout="auto">
  <Column>
    <p><strong>Fluxo recomendado</strong></p>

    <ol>
      <li>Forneça <a href="https://developers.clicksign.com/llms.txt"><code>llms.txt</code></a> como contexto inicial. O agente passa a conhecer o catálogo completo da documentação.</li>
      <li>Deixe o agente decidir quais páginas em <code>.md</code> consultar a partir do mapa.</li>
      <li>Para dúvidas pontuais durante a integração, use o botão <strong>Copy Page</strong> diretamente na página relevante e cole o conteúdo no chat com o LLM, junto com sua pergunta.</li>
    </ol>

    <p>Para referência específica de endpoint, aponte direto para a página em <code>.md</code> dentro de <a href="https://developers.clicksign.com/reference">Referências da API</a>.</p>
  </Column>

  <Column>
    <p><strong>Boas práticas</strong></p>

    <ul>
      <li>Informe ao agente que você está integrando com a <strong>API 3.0 Envelope</strong>. A API 1.9 é legada e não recebe novas funcionalidades.</li>
      <li>Sempre teste o código gerado em <a href="https://developers.clicksign.com/docs/informacoes-gerais">ambiente sandbox</a> antes de enviar para produção.</li>
      <li>Valide a assinatura HMAC dos webhooks antes de processar qualquer evento.</li>
      <li>Para alto volume, oriente o agente a usar a <a href="https://developers.clicksign.com/docs/ativacao-escala-performatica">ativação performática assíncrona</a>.</li>
    </ul>
  </Column>
</Columns>

<br />

# Casos de uso comuns

<Cards columns={2}>
  <CCard title="Integração nova do zero" icon="https://files.readme.io/470f4c2b477cff69f568b0a0f13e5984b65fc0e52a7b84b1eefe873e0401a932-rocket.svg">
    <p>Cole o <code>llms.txt</code> no início da conversa com o agente. Em seguida, peça para ele guiar você pela criação do primeiro envelope, deixando claro a stack que você usa (Node.js, Java, Python, etc.) e o tipo de integração (REST + Webhooks, Widget Embedded, etc.).</p>
  </CCard>

  <CCard title="Dúvida em uma página específica" icon="https://files.readme.io/57e7c333671e603b61a08f6cc50f757cd55efec38979ea9546ec0df0f1f42b54-sos.svg">
    <p>Acesse a página em questão, clique em <strong>Copy Page</strong> e cole no LLM seguido da sua pergunta. Útil para entender comportamento de campos, regras de negócio e códigos de erro.</p>
  </CCard>

  <CCard title="Migração da API 1.9 para 3.0" icon="https://files.readme.io/82e0e99b0c4a3eeb6754d3f812f40de9395961814a7b36557d467d293ffd1183-arrows.svg">
    <p>Forneça ao agente o <a href="https://developers.clicksign.com/docs/comparativo-tecnico.md"><code>comparativo-tecnico.md</code></a> junto com um trecho do seu código atual. Peça para identificar o que precisa ser refatorado para o modelo Envelope.</p>
  </CCard>

  <CCard title="Geração de cliente HTTP" icon="https://files.readme.io/287338fe0c65a65e61540465b61b1eb1c1ffd9725da960a4df9f1dba4c0c8a67-gear.svg">
    <p>Combine o <code>llms.txt</code> com o link para uma página de referência específica (por exemplo, <a href="https://developers.clicksign.com/reference/api-criar-envelope.md"><code>api-criar-envelope.md</code></a>) e peça ao agente um cliente tipado na linguagem da sua preferência.</p>
  </CCard>
</Cards>

<br />

> 💡 **Dica:** Ao pedir ao agente para gerar código, mencione explicitamente que se trata da API Clicksign 3.0 Envelope. Isso evita que o assistente recorra a padrões de assinatura eletrônica de outros provedores ou a versões antigas da nossa API que ainda podem estar nos dados de treinamento dele.

<br />

***

❓ Precisa de ajuda? [Entre em contato com o Suporte](https://www.clicksign.com/suporte)

📚 Respostas rápidas? [Visite nosso FAQ](https://developers.clicksign.com/docs/faq-duvidas-e-problemas-comuns)