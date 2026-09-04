---
updatedAt: 2026-06-04T10:57:29.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 3.3. Melhores práticas

## 1. Serviços para testes com Webhooks

Sugerimos a utilização de um serviço para realização de testes com Webhooks que servem para inspecionar as requisições HTTP. Você pode criar uma URL temporária e usá-la como sua URL do Webhook. Ela irá gravar as solicitações HTTP e permitir inspecioná-las para verificar Headers e Body das requisições. Desta forma, você poderá começar a desenvolver sua integração mesmo se ainda não tiver uma URL pública disponível.

* <a href="http://webhook.site" target="_blank"><http://webhook.site></a>
* <a href="https://ngrok.com" target="_blank"><https://ngrok.com></a> - Requisição externa chega no computador do desenvolvedor.

## 2. Responda com HTTP Status Code 200

Responda a requisição do Webhook com uma resposta HTTP 200 OK. Qualquer resposta fora do intervalo <a href="https://httpstatuses.com" target="_blank">2XX</a> informará que você não recebeu seu webhook, incluindo o 301 Redirect. A plataforma Clicksign não segue redirecionamentos para notificações do webhook e considerará um redirecionamento como uma resposta de erro.

Principais erros:

* Requisições HTTP redirecionando para HTTPS.
* Certificados SSL vencidos ou inválidos.

## 3. Responda rapidamente

Recomendamos que sua aplicação responda o mais rápido possível aos Webhooks da Clicksign. Se você precisar realizar outras requisições ou processamentos dos documentos, realize esses procedimentos em *background*.

## 4. Utilize o Header "Event"

Se você precisar filtrar os tipos de eventos recebidos, faça um filtro através do **Request Header "Event"**. Esta é a melhor maneira de buscar qual o tipo de evento, já que para realizar uma busca dentro do Body é necessário realizar primeiramente o *parse* do JSON.

## 5. Siga as dicas de segurança

Siga as práticas de segurança disponíveis em [Segurança de Webhooks](https://developers.clicksign.com/docs/seguranca-de-webhooks), tanto para proteção do seu end-point, como para verificação da integridade das informações recebidas através do HMAC.

## 6. Suporte da Clicksign

Se você estiver com problemas relacionados a Webhooks, [entre em contato com o Suporte](https://www.clicksign.com/suporte) e forneça o máximo de detalhes possível. Informações que nos ajudam a debugar a sua requisição:

```
- Ambiente: sandbox ou produção
- Conta
- URL do Webhook
- E-mail do operador
- Key do documento
- Evento
- Horário da requisição
```

<br />

<Footer3 />