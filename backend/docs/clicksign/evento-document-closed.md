---
updatedAt: 2026-06-04T10:53:56.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Evento Document Closed

> 🚧 Atenção
>
> Com a evolução do sistema, as informações podem sofrer alterações. Atente-se para a presença de novos campos.

Quando ocorrerem eventos nos documentos, uma requisição `HTTP POST` será disparada para a URL previamente cadastrada nas configurações da conta. Veja mais em [Cadastro de Webhooks](https://developers.clicksign.com/docs/cadastro-de-webhooks). A seguir, os detalhes do evento **document\_closed**.

| Evento               | Descrição                                                            |
| :------------------- | :------------------------------------------------------------------- |
| **document\_closed** | Ocorre quando um documento é finalizado e está pronto para download. |

```json Body
{
  "event": {
    "name": "document_closed",
    "data": {
      "account": {
        "key": "857ef357-35e5-42ac-8fe3-c73b50e99999"
      }
    },
    "occurred_at": "2023-09-04T14:31:43.272-03:00"
  },
 "document":  [ < Veja exemplo de Documentos > ]},
}
```

Acesse aqui o exemplo do campo ["document"](/docs/exemplo-documento).

<Footer3 />