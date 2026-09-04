---
updatedAt: 2026-05-27T10:41:31.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Comparativo técnico

Comparativo técnico entre a API 1.9 e a API 3.0

<Callout icon="⚠️" theme="warn">
  **Importante:** A API 1.9 é uma API legada, portanto não receberá mais atualizações ou melhorias.
  Todas as evoluções da plataforma estão sendo direcionadas exclusivamente para a versão 3.0 (Envelope).
</Callout>

<br />

# Pronto para ver na prática?

<Para type="default">Agora que explicamos concentualmente as diferenças entre as versões, confira as diferenças mais técnicas entre ambas, com exemplos de código, tudo pensado para facilitar ainda mais a sua migração:</Para>

A Clicksign possui, essencialmente, duas arquiteturas de API principais mencionadas na documentação: a versão Legada (anteriormente chamada de API 1.9 ou v1/v2) e a versão atual, robusta e modular (API 3.0).

O foco da migração é a mudança de um modelo centrado no **Documento** para um modelo centrado no **Envelope**, o que oferece maior flexibilidade e gestão.

<table>
  <thead>
    <tr>
      <td>Característica</td>
      <td>API Legada (v1 / v1.9) - (<code>/v1/documents</code>)</td>
      <td>API Atual (v3) - (<code>/v3/envelopes</code>)</td>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td><b>Entidade Central</b></td>
      <td><b>Documento</b></td>
      <td><b>Envelope</b> (Transação)</td>
    </tr>

    <tr>
      <td><b>Arquitetura</b></td>
      <td>Entidades complexas e acopladas.</td>
      <td>Sistema baseado em transações. Entidades <b>desacopladas</b> e modulares.</td>
    </tr>

    <tr>
      <td><b>Signatários/Pessoas</b></td>
      <td>Não possui um ciclo de vida.</td>
      <td>Possui o mesmo ciclo de vida do Envelope.</td>
    </tr>

    <tr>
      <td><b>Flexibilidade de Fluxo</b></td>
      <td>Configuração de ações (assinar) acoplada ao documento, com pouca flexibilidade para múltiplos papéis.</td>
      <td><b>Máxima flexibilidade</b> com a entidade Requirements. Você define o que (documento), quem (signatário) e como (ação/autenticação) em um único lugar.</td>
    </tr>

    <tr>
      <td><b>Requisitos de Assinatura</b></td>
      <td>Configuração mais limitada, sem todas formas de Autenticação (sem Documentoscopia, Biometria Serpro, Assinatura Posicionada e mais).</td>
      <td><b>Rica e modular.</b> Suporte a qualificação, todas formas de Autenticação (Token, Biometria, Selfie, PIX, etc.) e Rubrica.</td>
    </tr>

    <tr>
      <td><b>Padrão de Dados (Payload)</b></td>
      <td>Estrutura JSON personalizada (não padronizada).</td>
      <td><b>JSON:API</b> `(application/vnd.api+json)`.</td>
    </tr>

    <tr>
      <td><b>Vantagem JSON:API</b></td>
      <td>Exigia a criação de parsers manuais e gestão complexa de relacionamentos.</td>
      <td>Reduz o tempo de desenvolvimento ao permitir o uso de bibliotecas client prontas em várias linguagens (JavaScript, Ruby, Python, PHP, etc.), simplificando a serialização e o consumo de dados e relacionamentos.</td>
    </tr>
  </tbody>
</table>

## Detalhes Importantes da Migração

### 1. Assinatura via API (Passou a ser Assinatura Automática)

* **API 1.9:** O endpoint `POST /api/v1/sign` permitia que a sua aplicação assinasse documentos em nome de um signatário, utilizando um `secret` (chave secreta) e o cálculo de um `secret_hmac_sha256`. Este recurso era destinado a assinaturas recorrentes com autorização prévia.
* **API 3.0 (Envelope):** O conceito de assinatura programática sem interação do usuário é gerenciado pelo recurso de Assinatura Automática. O processo não utiliza mais o `endpoint /sign`, mas sim a configuração de requisitos de assinatura dentro do Envelope e o uso de um tipo específico de requisito ou feature.

### 2. Cancelamento

* **API 1.9:** O cancelamento era feito diretamente no endpoint do documento `documents/:id/cancel`.
* **API 3.0 (Envelope):** A entidade central é o Envelope. Para cancelar um processo, você deve primeiro garantir que os documentos contidos no Envelope sejam canceláveis/excluíveis (o que geralmente é feito via `PATCH` no documento para alterar seu status, ou `DELETE` se for um rascunho). A exclusão do Envelope (via `DELETE /envelopes/{id}`) só é permitida se ele estiver no status de rascunho (`draft`) e não tiver documentos em processo.

### 3. Duplicação de Documentos

* **API 3.0 (Envelope):** Na nova API, a duplicação se integra ao fluxo de criação de documentos dentro de um Envelope. Você usa o mesmo endpoint de criação de documento (`POST /envelopes/{envelope_id}/documents`), mas inclui o ID do documento de origem no payload para indicar que ele deve ser duplicado.

## Requirements: A definição de regras

Esta é a chave da nova arquitetura. O Requirement define o "contrato" entre o signatário e o documento, respondendo às três perguntas essenciais:

* Quem assina?
* O quê assina (qual documento)?
* Como se autentica (token, biometria, etc.)?

Isso transforma a forma como você constrói seus fluxos, permitindo que a Clicksign gerencie a complexidade da solução por você.

## Bibliotecas Client JSON: API por Linguagem

Utilize bibliotecas especializadas que já implementam todo o padrão [JSON:API](https://jsonapi.org/format/):

<table>
  <thead>
    <tr>
      <th width="25%">Linguagem/Plataforma</th>
      <th width="35%">Bibliotecas Recomendadas</th>
      <th width="40%">Principais Funcionalidades</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td><strong>JavaScript/TypeScript</strong><br /><small>Node.js e Browser</small></td>

      <td>
        • <code>kitsu</code><br />
        • <code>jsonapi-serializer</code><br />
        • <code>jsonapi-datastore</code>
      </td>

      <td>
        • Client HTTP completo integrado<br />
        • Serialização/deserialização automática<br />
        • Cache e gerenciamento de estado<br />
        • Suporte a relacionamentos e inclusões
      </td>
    </tr>

    <tr>
      <td><strong>Ruby</strong><br /><small>Ruby on Rails</small></td>

      <td>
        • <code>jsonapi-client</code><br />
        • <code>jsonapi-resources</code>
      </td>

      <td>
        • Interface ActiveRecord-like<br />
        • Integração nativa com Rails<br />
        • Mapeamento automático de relacionamentos<br />
        • Suporte a includes e eager loading
      </td>
    </tr>

    <tr>
      <td><strong>Python</strong></td>

      <td>
        • <code>jsonapi-requests</code><br />
        • <code>django-rest-framework-json-api</code>
      </td>

      <td>
        • Integração com requests/httpx<br />
        • Suporte a Django e Flask<br />
        • Filtros e paginação automáticos<br />
        • Validação de schemas
      </td>
    </tr>

    <tr>
      <td><strong>PHP</strong></td>

      <td>
        • <code>neomerx/json-api</code><br />
        • <code>eloquent-json-api</code>
      </td>

      <td>
        • Framework completo de serialização<br />
        • Integração com Laravel Eloquent<br />
        • Encoders e decoders customizáveis<br />
        • Suporte a sparse fieldsets
      </td>
    </tr>

    <tr>
      <td><strong>.NET / C#</strong></td>

      <td>
        • <code>JsonApiDotNetCore</code><br />
        • <code>JSONAPI.Net</code>
      </td>

      <td>
        • Middleware para ASP.NET Core<br />
        • Mapeamento automático com Entity Framework<br />
        • Suporte a filtros LINQ<br />
        • Validações integradas
      </td>
    </tr>

    <tr>
      <td><strong>Java</strong></td>

      <td>
        • <code>jsonapi-converter</code><br />
        • <code>crnk-framework</code>
      </td>

      <td>
        • Conversão automática de POJOs<br />
        • Integração com Spring Boot<br />
        • Suporte a JPA/Hibernate<br />
        • Filtros e ordenação dinâmicos
      </td>
    </tr>

    <tr>
      <td><strong>Go</strong></td>

      <td>
        • <code>jsonapi</code><br />
        • <code>go-jsonapi</code>
      </td>

      <td>
        • Marshaling/unmarshaling automático<br />
        • Compatível com encoding/json<br />
        • Suporte a tags de struct<br />
        • Performance otimizada
      </td>
    </tr>
  </tbody>
</table>

<br />

## Vantagens da padronização

O ponto crucial é que o padrão JSON:API oferece um contrato rigoroso entre o servidor (Clicksign v3) e o client (sua aplicação).

Ao usar qualquer uma dessas libs, você não precisa escrever código personalizado para:

* **Serialização:** Transformar seus objetos em um payload JSON:API válido.

* **Desserialização:** Ler a resposta da Clicksign, extrair os dados, e resolver os relacionamentos (relationships e included).

* **Filtros/Paginação:** Formatar requisições com os parâmetros de filter, sort e page de forma padronizada.

<br />

# Pronto para esclarecer todas as dúvidas?

<Para type="default">Abaixo está o link do FAQ contendo as principais dúvidas relacionadas a migração:</Para>

[FAQ: Migração](https://developers.clicksign.com/docs/faq-migracao/)

<Footer3 />

<br />