---
updatedAt: 2026-07-17T13:46:44.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# MCP Server

O MCP Server é a forma oficial de conectar assistentes de IA à Clicksign. Com ele, seu assistente de código, agente ou produto de IA entende como a Clicksign funciona e pode executar operações na sua conta — sem que você precise escrever integrações na mão para cada passo.

## O que é o MCP Server

O **Model Context Protocol (MCP)** é um protocolo aberto que padroniza como modelos de linguagem se conectam a ferramentas e fontes de dados externas. Na prática, ele funciona como uma interface universal: qualquer cliente que fale MCP consegue conversar com qualquer servidor MCP.

O **MCP Server da Clicksign** expõe as operações da nossa plataforma como ferramentas que uma IA pode consultar e executar: criar e enviar documentos para assinatura, trabalhar com templates, acompanhar o status de envelopes e ler dados de documentos. Além disso, ele carrega o contexto da Clicksign — nosso modelo de envelopes, o fluxo de assinatura, os métodos de autenticação de signatários — direto para dentro da IA.

O resultado: em vez de ler a referência da API, montar o fluxo de chamadas manualmente e testar por tentativa e erro, você (ou seu produto) simplesmente descreve o que precisa em linguagem natural.

## O que você precisa

Antes de conectar, garanta que você tem:

* **Uma conta Clicksign com plano ativo.** O acesso ao MCP Server está incluído no seu plano — veja a seção [Custo](#custo).
* **Acesso de administrador**, para executar ações ou fazer consultas em uma conta você necessitará de acesso de administrador com seu usuário conectado.&#x20;
* **Um cliente compatível com MCP**, como um assistente de código, uma IA de mercado ou uma aplicação sua que fale o protocolo.

## Casos de uso

### 1. Acelerar sua integração com um assistente de código

Este é o cenário principal para quem está integrando com a Clicksign. Ao conectar o MCP Server ao seu assistente de código (Claude Code, Cursor e outros), a IA passa a ter contexto sobre a Clicksign e consegue responder dúvidas técnicas sem você sair do editor:

* "Como funciona o modelo de envelopes da Clicksign?"
* "Qual o passo a passo para enviar um documento para assinatura?"
* "Quais métodos de autenticação existem para um signatário?"
* "Gera o código para criar um envelope a partir de um template."

Em vez de alternar entre a documentação, o Postman e o seu código, você pergunta e a IA responde já ancorada no funcionamento real da API — e pode gerar o código da integração na hora. O MCP também permite que a IA execute chamadas reais durante o desenvolvimento (criar um envelope de teste, consultar um status), encurtando o ciclo de tentativa e erro.

<br />

### 2. Construir produtos de IA sobre a Clicksign

Você pode usar o MCP Server como a camada de integração de um produto de IA próprio — um assistente interno, um copiloto ou um agente que envia e acompanha documentos. Como as operações da Clicksign já chegam ao modelo como ferramentas estruturadas, você não precisa reescrever a orquestração de chamadas: aponta o seu agente para o MCP Server e ele passa a operar contratos.

Esse é o mesmo caminho que a Clicksign usa internamente para construir novos produtos com IA.

### 3. Executar ações e consultas na Clicksign

Por fim, o MCP Server permite operar a Clicksign diretamente por linguagem natural a partir de qualquer cliente MCP: enviar um documento, preencher variáveis de um template, listar envelopes ou verificar quem ainda não assinou. É o modo mais direto de interagir com a plataforma sem construir uma integração dedicada.

## Como conectar

### URL do servidor

Conecte seu cliente MCP à seguinte URL:

```
https://mcp.clicksign.com/mcp/oauth2
```

Na primeira conexão, o cliente abrirá o fluxo de autenticação (OAuth 2.0) no navegador. Você autoriza o acesso com a sua conta Clicksign e o cliente passa a enxergar as ferramentas disponíveis. É uma autorização única por cliente.

### Compatibilidade

O MCP Server funciona com **qualquer IA ou aplicação que suporte a conexão via protocolo MCP**. Não há dependência de fornecedor: o mesmo servidor atende assistentes de código, agentes e produtos de IA.

### Tutoriais dedicados

Para as ferramentas mais usadas, temos guias passo a passo com a configuração específica de cada uma:

* <Anchor target="_blank" href="https://www.clicksign.com/integracoes/claude">Conectar o MCP Server ao Claude</Anchor>
* <Anchor target="_blank" href="https://www.clicksign.com/integracoes/cursor">Conectar o MCP Server ao Cursor</Anchor>
* <Anchor target="_blank" href="https://www.clicksign.com/integracoes/chatgpt">Conectar o MCP Server ao ChatGPT</Anchor>

### Configuração manual (outros clientes)

Clientes compatíveis com MCP remoto geralmente aceitam uma configuração como a abaixo. Consulte a documentação do seu cliente para o formato exato:

```json
{
  "mcpServers": {
    "clicksign": {
      "url": "https://mcp.clicksign.com/mcp/oauth2"
    }
  }
}
```

## Autenticação e permissões

A autenticação do MCP Server ocorre via **OAuth 2.0**, vinculada à sua conta Clicksign. Nenhuma chave de API é exposta ao cliente MCP: o acesso é concedido pelo fluxo de autorização no navegador e pode ser revogado a qualquer momento.

**Apenas usuários com acesso de administrador podem executar ações na conta** — como criar e enviar documentos ou gerenciar templates. Essa restrição garante que operações que geram efeito na conta fiquem sob o mesmo controle de permissões já existente na Clicksign.

## O que o MCP Server oferece

O servidor expõe um conjunto de ferramentas organizadas por finalidade. Os principais grupos são:

| Grupo                     | Para que serve                                                                  | Exemplos de ferramentas                                                                     |
| :------------------------ | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------ |
| Criação e envio           | Criar envelopes e enviar documentos para assinatura, via URL pública ou Modelos | `quick_send_envelope`, `create_envelope_with_file_url`, `create_envelope_with_template`     |
| Envio de lembretes        | Envie lembretes para qualquer envelope enviado que esteja pendente              | `send_envelope_reminders`, `send_signer_reminder`                                           |
| Modelos                   | Criar, editar e consultar Modelos e seus campos                                 | `create_template`, `edit_template`, `list_templates`, `get_template_fields`                 |
| Consulta e acompanhamento | Listar e inspecionar envelopes e documentos e acompanhar status                 | `list_envelopes`, `get_envelope_details`, `list_envelope_documents`, `get_document_details` |

## Documentação da API como Resource

Além das ferramentas (tools), o MCP Server expõe a documentação da Clicksign como **resources** — conteúdo que a IA consegue ler diretamente, sem sair do cliente MCP e sem navegar pelo site. Assim, o modelo carrega o contexto sob demanda (formato de payloads, campos obrigatórios, limites e regras) no momento em que vai executar uma operação.

Enquanto as *tools* executam ações, os *resources* fornecem o **conhecimento** que orienta essas ações. As próprias ferramentas referenciam esses documentos (por exemplo, `create_envelope_with_file_url` aponta para `clicksign://docs/payload-signers`), permitindo que a IA consulte a referência certa antes de montar a chamada.

### Índice dinâmico (llms.txt)

O ponto de entrada é um índice no formato <Anchor target="_blank" href="https://developers.clicksign.com/llms.txt">llms.txt</Anchor>, que lista os guias, referências e recipes disponíveis:

| Resource                          | URI                     | Descrição                                                              |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| Clicksign API Documentation Index | `clicksign://docs/llms` | Índice dinâmico (llms.txt) com os guias, referências e recipes da API. |

A partir desse índice, a IA descobre e acessa os guias específicos abaixo.

### Guias de referência

| Resource                              | URI                                               | Para que serve                                                                     |
| ------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| File URL Envelope Guide               | `clicksign://docs/payload-envelope-document-file` | Referência do payload de envelopes criados a partir de uma URL pública de arquivo. |
| Template Envelope Guide               | `clicksign://docs/payload-envelope-document`      | Referência do payload de envelopes e documentos baseados em Modelos.               |
| Signer Guide                          | `clicksign://docs/payload-signers`                | Campos do signatário e requisitos mínimos (qualificação e autenticação).           |
| Envelope Reminder Notifications Guide | `clicksign://docs/payload-notifications`          | Payload, limites, rate limiting e tratamento de erros das ferramentas de lembrete. |

Todos os resources são entregues em `text/markdown`, o que facilita a leitura pela IA e pelo desenvolvedor.

### Como usar

Clientes compatíveis com MCP listam os resources disponíveis e permitem que o modelo os leia quando necessário — automaticamente (quando uma tool referencia o guia) ou sob demanda ("consulte o guia de signatários antes de criar o envelope"). Não é preciso configuração adicional: os resources ficam disponíveis na mesma conexão OAuth 2.0 usada pelas ferramentas.

## Custo

**Não há custo extra para usar o MCP Server.** O acesso está incluído em qualquer conta com plano ativo — você usa o MCP com o mesmo consumo já previsto no seu plano, sem cobrança adicional pela conexão.

## Próximos passos

* Escolha seu cliente e siga o tutorial dedicado: <Anchor target="_blank" href="https://www.clicksign.com/integracoes/claude">Claude</Anchor>, <Anchor target="_blank" href="https://www.clicksign.com/integracoes/cursor">Cursor</Anchor> ou <Anchor target="_blank" href="https://www.clicksign.com/integracoes/chatgpt">ChatGPT</Anchor>.
* Conecte o MCP Server ao seu assistente de código e comece perguntando como funciona o fluxo de assinatura da Clicksign.
* Consulte a [referência da API](/reference) quando precisar de controle programático completo — a API tradicional continua disponível e complementa o MCP Server.

<br />