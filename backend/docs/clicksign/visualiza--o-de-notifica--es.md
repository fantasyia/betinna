---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Confirmação de visualização das notificações

<Callout icon="🆕" theme="default">
  **NOVIDADE:** Agora você pode saber que seu signatário visualizou o documento para assinatura!
</Callout>

Acompanhar o status de uma assinatura não precisa ser um jogo de adivinhação. Com a nova atualização da API 3.0 da Clicksign, você ganha o poder de monitorar a intenção do signatário em tempo real, otimizando seus processos!

Você já se deparou com a dúvida se o e-mail com o documento enviado para o seu signatário caiu no spam? Se o seu signatário simplesmente optou por não assinar, ou apenas nem se que viu o documento para assinatura?

Agora, através do evento `signature_started`, sua plataforma recebe a confirmação exata de que o signatário clicou no botão de visualização do documento e acessou o widget de assinatura.

<br />

### 🔄 Antes e depois

| FUNCIONALIDADE       | Como era antes                                | Como é agora                                     |
| :------------------- | :-------------------------------------------- | :----------------------------------------------- |
| **Visibilidade**     | Visibilidade apenas que o e-mail foi enviado. | Confirmação de visualização do documento.        |
| **Consumo de dados** | Era necessário baixar todo o log de eventos.  | Você solicita apenas o evento específico.        |
| **Agilidade**        | Follow-up baseado em suposições.              | Ações baseadas no comportamento real do usuário. |

<br />

### 💡 Casos de uso

**Vendas e onboarding:** Configure o disparo de um lembrete apenas para clientes que ainda não abriram o link de assinatura após 24 horas.

**Gestão de contratos:** Monitore se um e-mail foi enviado para a pessoa errada, pois se o status de entrega é positivo, mas o de visualização é nulo, sua equipe pode agir preventivamente.

**Gestão proativa de prazos (SLA):** Identifique gargalos antes que o prazo expire. Se não houver visualização em contratos urgentes, sua equipe de CS pode atuar de forma consultiva para garantir a conclusão do negócio.

<br />

### 🚀 Como começar

A implementação é simples e segue o padrão de filtros da especificação JSON:API.\
Para obter apenas os eventos de início de assinatura (visualização), basta realizar uma requisição `GET /api/v3/envelopes/{envelope_id}/events` ao endpoint de eventos passando o parâmetro de filtro:

`filter[name]=signature_started`

Você encontrará todos os detalhes técnicos e payloads de exemplo <Anchor label="nessa página" target="_blank" href="https://developers.clicksign.com/reference/eventos-do-envelope">nessa página</Anchor>. Caso queira conferir quais outros tipos de eventos disponibilizamos, veja <Anchor label="aqui" target="_blank" href="https://developers.clicksign.com/docs/eventos">aqui</Anchor>.

<br />