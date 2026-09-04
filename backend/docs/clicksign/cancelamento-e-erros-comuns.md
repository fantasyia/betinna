---
updatedAt: 2026-05-27T10:41:18.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Cancelamento e erros comuns

Nem tudo sai perfeito na primeira tentativa, e está tudo bem! Esta página é o seu guia de sobrevivência para lidar com imprevistos, números errados ou aqueles momentos em que a API diz "não".

***

## 1. Como cancelar um Aceite

Digitou o número errado ou o cliente desistiu? Você pode cancelar um aceite que ainda esteja pendente. Isso invalida o link enviado e interrompe o processo.

**Regra Importante:** Se o cliente já aceitou ou se o prazo expirou, não será possível cancelar o aceite e a API retornará um erro.

### Exemplo de requisição (cURL)

```bash
curl --request PATCH \
  --url https://sandbox.clicksign.com/api/v3/acceptance_term/whatsapps/SEU_ID_AQUI \
  --header 'Accept: application/vnd.api+json' \
  --header 'Authorization: Bearer SEU_TOKEN_AQUI' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
    "data": {
      "id": "SEU_ID_AQUI",
      "type": "acceptance_term_whatsapps",
      "attributes": {
        "status": "canceled"
      }
    }
  }'
```

<br />

## 2. Decifrando os códigos de erro (HTTP Status)

Se a API retornar algo diferente de `200 OK`, o código HTTP te dará a pista do que aconteceu:

| Status                   | O que significa?       | O que fazer?                                                                          |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| 401 Unauthorized         | Token inválido.        | Verifique se o seu `access_token` está correto no Header.                             |
| 404 Not Found            | Aceite não encontrado. | O ID está correto? Verifique se o aceite pertence à conta do Token usado.             |
| 422 Unprocessable Entity | Solicitação inválida.  | Geralmente acontece quando uma regra de negócio é ferida.                             |
| 429 Too Many Requests    | Limite atingido.       | Reduza a velocidade das chamadas, você está enviando muitas requisições em sequência. |

## 3. Os "suspeitos de sempre" (FAQ de Erros)

Se a mensagem não chegou ou o cancelamento falhou, verifique estes pontos:

### O cliente não recebeu o WhatsApp

Mesmo com um retorno `201` na criação, a mensagem pode não chegar se:

* O número não possui uma conta de WhatsApp ativa.
* O número foi enviado sem o DDD.

Dica: Sempre valide o formato `11999998888` antes de enviar.

### 📝 O erro do "Content-Type"

A API v3 é rigorosa: se você usar apenas `application/json`, ela pode recusar a chamada.

Solução: Use sempre `application/vnd.api+json` nos headers de `Accept` e `Content-Type`.

### O fluxo do status

Lembre-se: um aceite cancelado não pode ser "reativado". Se precisar enviar novamente para o mesmo cliente, você deve criar um novo recurso (novo `POST`).

### Dica de Ouro: analise o "detail"

Sempre que receber um erro `422`, olhe o corpo da resposta JSON. A Clicksign envia um campo chamado `detail` que explica exatamente por que a ação foi negada (ex: `"status must be sent to be canceled"`).