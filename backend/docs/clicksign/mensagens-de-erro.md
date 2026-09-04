---
updatedAt: 2026-05-27T10:43:21.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Mensagens de erro

Códigos de erros e explicações

# HTTP Status Codes

A Clicksign segue o padrão de <a href="https://httpstatuses.com" target="_blank">HTTP Status Codes</a>. Os erros na faixa 4xx ocorrem quando há algo errado na requisição enviada pelo cliente para a Clicksign. Já os erros na faixa 5xx são erros inesperados que ocorrem nos servidores da Clicksign.

## Sobre as mensagens de erro

Seguindo a especificação [JSONAPI](https://jsonapi.org/format/#errors), todas as mensagens de erro incluirão detalhes no corpo da resposta, fornecendo `code`, `status`, `title`, `detail`, e, quando necessário, `source`.

## 4×× Client Error

**Sempre verifique o BODY da resposta**, o retorno da requisição mostrará o motivo pelo qual a requisição não foi aceita pelos servidores da Clicksign.

| Código  | Referência           | Explicação                                                                                                                    |
| :------ | :------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **400** | BAD REQUEST          | O servidor não processará a solicitação devido a algo que é percebido como sendo um erro do cliente. Este é um erro genérico. |
| **401** | UNAUTHORIZED         | O servidor não autorizou a requisição. Access Token inválido.                                                                 |
| **403** | FORBIDDEN            | O servidor não autorizou a requisição. O Access Token não possui permissão para acessar o recurso.                            |
| **404** | NOT FOUND            | O servidor não encontrou o recurso ou não está disposto a divulgar sua existência.                                            |
| **422** | UNPROCESSABLE ENTITY | O servidor não conseguiu processar as informações contidas na requisição.                                                     |

### Exemplos de retorno de requisição inválida

```json 400: Bad Request
{
  "errors": [
    {
      "code": "bad_request",
      "status": 400,
      "source": {
        "pointer": "/data/attributes/filename"
      },
      "detail": "filename deve ser informado(a)"
    }
  ]
}
```
```json 401: Anauthorized
{
  "errors": [
    {
      "code": "unauthorized",
      "status": 401,
      "title": "Não autorizado",
      "detail": "Access Token inválido"
    }
  ]
}
```

## 5×× Server Error

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Código
      </th>

      <th>
        Referência
      </th>

      <th>
        Explicação
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **500**
      </td>

      <td>
        INTERNAL SERVER ERROR
      </td>

      <td>
        Ocorreu um erro interno inesperado.
      </td>
    </tr>

    <tr>
      <td>
        **503**
      </td>

      <td>
        SERVICE UNAVAILABLE
      </td>

      <td>
        Serviço Indisponível.

        O envelope está ativo para contas criadas a partir de 01/07/2024. Caso receba o erro de serviço indisponível, [fale com o Suporte](https://www.clicksign.com/suporte).
      </td>
    </tr>
  </tbody>
</Table>

### A Clicksign possui sistema de monitoramento de erros 500.

# Suporte da Clicksign

Se você estiver com problemas relacionados à integração, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte) e forneça o máximo de detalhes possível. Informações que nos ajudam a debugar a sua requisição:

```
- Ambiente: sandbox ou produção
- Conta
- E-mail do operador
- Path da requisição
- Método da requisição
- Código HTTP de erro
- JSON enviado
- JSON recebido
- Key do documento
- E-mails contidos na lista de assinatura
- Horário da requisição
- IP de origem
- Print screen
```

<Footer3 />

<br />