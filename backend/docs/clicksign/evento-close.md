---
updatedAt: 2026-06-04T10:53:56.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Evento Close

> 🚧 Atenção
>
> Com a evolução do sistema, as informações podem sofrer alterações. Atente-se para a presença de novos campos.

Quando ocorrerem eventos nos documentos, uma requisição `HTTP POST` será disparada para a URL previamente cadastrada nas configurações da conta. Veja mais em [Cadastro de Webhooks](https://developers.clicksign.com/docs/cadastro-de-webhooks). A seguir, os detalhes do evento **close**.

| Evento    | Descrição                                            |
| :-------- | :--------------------------------------------------- |
| **close** | Ocorre quando um documento é finalizado manualmente. |

```json Body
{
  "event"=>{
    "name"=>"close",
    "data"=>{
      "user" => {
        "email" => "email@empresa.com", "name" => "Empresa de Teste"
      }, "account" => {
        "key" => "18ccd207-58b8-410f-a73e-585a4109a483"
      }
    }
  },
  document: < Veja exemplo de documentos >
}
```

Acesse aqui o exemplo do campo ["document"](/docs/exemplo-documento).

<Footer3 />