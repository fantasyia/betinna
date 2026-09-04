---
updatedAt: 2026-05-27T12:18:58.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Descubra sua versão da API

Como descobrir qual versão da API você está integrado

<Callout icon="⚠️" theme="warn">
  **Importante:** A API 1.9 é uma API legada, portanto não receberá mais atualizações ou melhorias. Todas as evoluções da plataforma estão sendo direcionadas exclusivamente para a versão 3.0 (Envelope).
</Callout>

<br />

## Como identificar a versão da API da Clicksign que você está usando

Na Clicksign, estamos sempre evoluindo nossa API para oferecer mais recursos e flexibilidade. Se você não tem certeza de qual versão sua aplicação está utilizando, a forma mais simples de descobrir é analisar o caminho das requisições (URL).

A versão da API é indicada logo no início da URL de cada chamada.

<table>
  <thead>
    <tr>
      <th>Versão da API</th>
      <th>Status</th>
      <th>Prefixo da URL (Caminho)</th>
      <th>Exemplo simplificado</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td><strong>API 1.9</strong></td>
      <td>Antiga (Legada)</td>
      <td>Inicia com: <b>/v1</b> ou <b>/v2</b></td>
      <td><code>[https://app.clicksign.com/api/v1/](https://app.clicksign.com/api/v1/)...</code></td>
    </tr>

    <tr>
      <td><strong>API 3.0</strong></td>
      <td>Nova (Atual)</td>
      <td>Inicia com: <strong>/v3</strong></td>
      <td><code>[https://app.clicksign.com/api/v3/](https://app.clicksign.com/api/v3/)...</code></td>
    </tr>
  </tbody>
</table>

<br />

### Em resumo

Se sua URL começa com /v1 ou /v2, você está usando a API Antiga (1.9).

Se sua URL começa com /v3, você já está na versão mais atual (3.0).

<br />

### Próximos passos sugeridos

Está integrado com a versão legada? Veja como começar sua [migração para o Envelope (API 3.0)](https://developers.clicksign.com/docs/migracao-da-api-19-para-30).

Já está na versão mais recente? Então, você já tem acesso a todos os recursos mais recentes da nossa plataforma!

<table>
  <tr>
    <th>Sua versão atual</th><th>Sugestão</th>
  </tr>

  <tr>
    <th>API 1.9 (Legada)</th>
    <td>Planejar uma migração para a nova versão baseada em <b>Envelope (API 3.0)</b> pode ser interessante para aproveitar as novas funcionalidades e melhorias de performance.</td>
  </tr>

  <tr>
    <th>API 3.0 (Atual)</th>
    <td>Já possui acesso aos recursos mais recentes e a estrutura otimizada da nossa plataforma.</td>
  </tr>
</table>

<br />