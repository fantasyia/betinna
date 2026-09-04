---
updatedAt: 2026-05-27T10:43:21.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Limite de requisições

Rate Limit da API

# Limites de Requisições na Plataforma Clicksign

A plataforma da Clicksign implementa limites de requisições para garantir a estabilidade e segurança dos serviços, protegendo os clientes contra ataques como DDoS.

## Limites Padrão

Por padrão, os limites de requisições para cada ambiente são os seguintes:

| Ambiente | Limite                                 |
| :------- | :------------------------------------- |
| Produção | 50 requisições por conta / 10 segundos |
| Sandbox  | 20 requisições por conta / 10 segundos |

## Links de download

Os links de download dos documentos não são contabilizados como requisições para o *rate limit*. Eles terão como origem:

| Ambiente | Host                                                     |
| :------- | :------------------------------------------------------- |
| Produção | <https://clicksign-content-production.s3.amazonaws.com/> |
| Sandbox  | <https://clicksign-content-sandbox.s3.amazonaws.com/>    |

## Alteração dos Limites

Se necessário, [entre em contato com o Suporte](https://www.clicksign.com/suporte) para solicitar alterações nos limites de requisições. Porém, observe que não será autorizada a alteração dos limites de requisições para [Polling](https://developers.clicksign.com/docs/introducao-a-webhooks#section-pollings-vs-webhooks) de documentos. Utilize [Webhooks](https://developers.clicksign.com/docs/introducao-a-webhooks) para esse propósito.

## Headers da Requisição

Consulte os `headers` de qualquer requisição da API para obter informações sobre os limites de requisições:

| Nome do Header           | Descrição                                                                                                                                                         |
| :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Rate-Limit`           | Número de requisições permitidas por segundo.                                                                                                                     |
| `X-Rate-Limit-Remaining` | Número de requisições restantes antes de atingir o limite.                                                                                                        |
| `X-Rate-Limit-Reset`     | Horário na qual o limite atual será reiniciado no formato <a href="https://pt.wikipedia.org/wiki/Era_Unix" target="_blank">Unix Time</a>, <br />fuso horário UTC. |

<br />

```http Header
HTTP/2 200 OK
Date: Thu, 29 Feb 2024 12:33:58 GMT
X-Rate-Limit: 50
X-Rate-Limit-Remaining: 49
X-Rate-Limit-Reset: 1709210040
```

## Limite Excedido

Se o limite de requisições for ultrapassado, a Clicksign rejeitará as requisições adicionais até que o horário do limite seja reiniciado. O status retornado nessas situações será **`HTTP 429 Too Many Requests`**.

```http Header
HTTP/2 429 Too Many Requests
Date: Thu, 29 Feb 2024 17:00:15 GMT
X-Rate-Limit: 50
X-Rate-Limit-Remaining: 0
X-Rate-Limit-Reset: 1709226020
```

<Footer3 />