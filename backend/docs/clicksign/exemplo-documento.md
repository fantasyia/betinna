---
updatedAt: 2026-06-04T10:53:56.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Exemplo do campo "Document"

> 🚧 Atenção
>
> Com a evolução do sistema, as informações podem sofrer alterações. Atente-se para a presença de novos campos.

A seguir, um exemplo do campo **Document**, necessário em alguns eventos:

```json Body
{
  "key"=>"db4a2cf7-0a48-481f-b669-54f2a2260ac2",
  "account_key"=>"f9d9b699-fa73-4949-b8c5-c45df202744b",
  "path"=>"/blank-4.pdf",
  "filename"=>"blank-4.pdf",
  "uploaded_at"=>"2023-03-13T14:28:02.235Z",
  "updated_at"=>"2023-03-13T16:37:09.228Z",
  "finished_at"=>"2023-03-13T16:37:02.628Z",
  "deadline_at"=>"2023-04-12T11:27:53.617-03:00",
  "status"=>"closed",
  "auto_close"=>true,
  "locale"=>"pt-BR",
  "metadata"=>{},
  "sequence_enabled"=>false,
  "signable_group"=>null,
  "remind_interval"=>3,
  "block_after_refusal"=>false,
  "downloads"=>
  {
    "original_file_url"=> "/2023/03/13/888twv3942_blank_4.pdf",
    "signed_file_url"=> "/2023/03/13/1q42v26p3o_blank_4_Clicksign.pdf",
    "ziped_file_url"=> "/2023/03/13/99e8ang3j2_blank_4_Clicksign.zip"
  },
  "template"=>null,
  "signers"=> [ < Veja exemplo de Signatários > ],
  "events"=> [ < Veja exemplos de Eventos >],
  "attachments"=>[],
  "links"=> {"self"=>"/db4a2cf7-0a48-481f-b669-54f2a2260ac2"}
}
```

Acesse aqui o exemplo do campo [Signers](https://developers.clicksign.com/docs/exemplo-signers).

Acesse aqui o exemplo do campo [Events](https://developers.clicksign.com/docs/eventos).

<br />

<Footer3 />