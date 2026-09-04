---
updatedAt: 2026-06-04T10:57:14.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 3.1.  Visão geral Webhooks

# Webhooks: Visão Geral

Os Webhooks são a base de uma integração eficiente e escalável com a Clicksign. Eles permitem que sua aplicação reaja automaticamente às mudanças de estado dos documentos, sem a necessidade de solicitar informações repetidamente.\
Em termos de arquitetura, os **Webhooks transformam sua integração de um modelo passivo para um modelo reativo**.

## O que são?

Imagine que você está esperando uma encomenda.

* **Sem Webhook (Polling):** Você liga para os correios a cada 10 minutos perguntando: "Já chegou?". Na maioria das vezes, a resposta é "Não". Isso gasta seu tempo e ocupa a linha telefônica deles.
* **Com Webhook:** Você fornece seu número de telefone aos correios e diz: "Me ligue assim que o pacote chegar". Você fica livre para fazer outras tarefas e recebe a informação no instante exato em que o evento ocorre.

Tecnicamente, um Webhook é uma requisição HTTP POST que a Clicksign envia para uma URL configurada por você (endpoint), contendo um payload JSON com os detalhes do evento (ex: documento assinado, finalizado ou cancelado).

## Por que usar Webhooks (vs. Polling)?

Uma prática comum, porém **ineficiente**, é o **Polling** — configurar um script (cron job) que consulta nossa API (*GET /documents/:key*) em intervalos fixos para verificar se o status mudou.

Abaixo, detalhamos por que você deve migrar de Polling para Webhooks:

| Aspecto             | Webhooks (Recomendado)                                                                 | Polling (Desaconselhado)                                                                                                      |
| :------------------ | :------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **Latência**        | **Tempo Real:** A notificação é enviada milissegundos após o evento.                   | **Alta:** O atraso depende do intervalo do seu script (ex: se o script roda a cada 10 min, seu atraso pode ser de até 9m59s). |
| **Uso de Recursos** | **Eficiente:** Processamento ocorre apenas quando há novidades.                        | **Desperdício:** 99% das chamadas são desnecessárias (recebem o mesmo status anterior).                                       |
| **Limites da API**  | **Sem Impacto:** Webhooks não consomem sua cota de requisições (Rate Limit).           | **Alto Risco:** Polling agressivo pode estourar seu limite de requisições (Rate Limit), bloqueando operações legítimas.       |
| **Escalabilidade**  | **Automática:** Se o volume de assinaturas triplicar, você apenas recebe mais eventos. | **Manual:** Você precisaria reescrever sua lógica de loop para lidar com filas crescentes de documentos.                      |

**Nota de Arquitetura:** O uso de Webhooks é considerado uma melhor prática para sistemas assíncronos. Evite construir rotinas de verificação de status (pooling), a menos que seja estritamente necessário por limitações de firewall, por exemplo.

**Pollings** e **webhooks** tem o **mesmo objetivo, porém eles são muito mais eficientes**, pois só transferem dados quando há uma atualização no recurso esperado. Segundo o <Anchor label="Zapier" target="_blank" href="http://resthooks.org/#why">Zapier</Anchor>, mais de 98,5% das requisições que realizam pollings são desperdiçadas. Isso significa que pollings geram, em média, 66x mais requisições do que webhooks.

<Image align="center" alt="Fonte: https://docs.cloud-elements.com." caption="fonte: <a href=&#x22;https://docs.cloud-elements.com/home/webhook-polling-events&#x22; target=&#x22;_blank&#x22;>[https://docs.cloud-elements.com](https://docs.cloud-elements.com)</a>." src="https://files.readme.io/19e33d45fca92c0063958582e3e615a2a21306aa5494379a0f7539df6abed2da-image.png" />

> 🚧 Limite de requisições
>
> A Clicksign controla o limite de requisições realizadas. Não é permitido realizar *polling* em documentos. Se for necessário realizar essa prática por qualquer motivo, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte), solicitando permissão prévia.

# Pronto para os próximos passos?

<Para type="default">Agora que você entende o valor estratégico do gerenciamento automatizado de webhooks, direcione seu time técnico para as referências de implementação:</Para>

* [Referência Técnica (Endpoints)](https://developers.clicksign.com/reference/webhooks)
* [Segurança de Webhooks](/docs/seguranca-de-webhooks) – Para garantir a integridade da integração.
* [Melhores práticas](/docs/melhores-praticas-webhooks) - Aplique boas práticas à sua integração.
* [Eventos do Documento](/docs/eventos) – Para escolher quais notificações fazem sentido para o seu produto.
* [Eventos do Aceite via Whatsapp](/docs/eventos-aceite-via-whatsapp) – Para escolher quais notificações fazem sentido para o seu produto.

<Footer3 />

<br />