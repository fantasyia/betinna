---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Gerenciamento e consultas de Envelopes

Depois que os envelopes estão "em progresso", sua aplicação precisa de visibilidade. Seja para criar um dashboard interno, confirmar uma assinatura ou oferecer suporte ao seu cliente final, saber como consultar e filtrar dados é essencial.

Na API v3, utilizamos o padrão **JSON:API** para buscas, o que permite filtros poderosos e paginação eficiente.

***

## 🔍 Consultar detalhes de um Envelope

Se você tem o `ID` do envelope, pode obter o status atual, a lista de documentos vinculados e o progresso das assinaturas em uma única chamada.

* **Método:** `GET`
* **Endpoint:** `https://app.clicksign.com/api/v3/envelopes/{id}`

> **Documentação Técnica:** Veja todos os campos de retorno em <Anchor label="Referência da API: Detalhes do Envelope" target="_blank" href="/reference/api-detalhes-do-envelope">Referência da API: Detalhes do Envelope</Anchor>.

### O que observar no retorno?

No objeto `attributes`, o campo **`status`** é o seu principal indicador:

* `draft`: Ainda em montagem.
* `running`: Disponível para assinatura.
* `closed`: Sucesso! Processo finalizado.
* `canceled`: A transação não foi concluída.

***

## 📑 Listar e filtrar Envelopes

Para sistemas com alto volume, listar todos os envelopes de uma vez é inviável. Por isso, a API v3 oferece filtros nativos.

* **Endpoint:** `GET /api/v3/envelopes`

### Exemplos de filtros úteis:

| Objetivo                       | Parâmetro de Query                          |
| :----------------------------- | :------------------------------------------ |
| **Buscar por nome**            | `?filter[name]=Contrato_123`                |
| **Filtrar por status**         | `?filter[status]=closed`                    |
| **Ver Envelopes de uma pasta** | <font color="red">Em desenvolvimento</font> |

> **Dica de performance:** Sempre utilize filtros para reduzir o tempo de resposta e o consumo de banda da sua integração.
> Confira a lista completa de filtros na <Anchor label="Referência da API: Listar Envelopes" target="_blank" href="/reference/api-listar-envelopes">Referência da API: Listar Envelopes</Anchor>.

***

## 📦 Paginação (escalabilidade)

Se a sua conta possui milhares de envelopes, os resultados serão entregues em "páginas".
No final do JSON de resposta, você encontrará o objeto `links` com as URLs para `next` (próxima) e `prev` (anterior).

* **Padrão:** 25 itens por página.
* **Como mudar:** Use `?page[number]=2&page[size]=50`.

***

## 🛠️ Ações de gerenciamento

Além de consultar, você pode precisar intervir em um fluxo existente:

### 1. Editar um Envelope

Mudar o nome ou a data de expiração de um rascunho.

* **Método:** `PATCH /api/v3/envelopes/{id}`
* <Anchor label="Referência: Editar Envelope" target="_blank" href="https://developers.clicksign.com/reference/api-editar-envelope">Referência: Editar Envelope</Anchor>

### 2. Excluir um Rascunho

Se o envelope ainda for um `draft`, você pode removê-lo completamente.

* **Método:** `DELETE /api/v3/envelopes/{id}`
* <Anchor label="Referência: Excluir Envelope" target="_blank" href="https://developers.clicksign.com/reference/api-excluir-envelope">Referência: Excluir Envelope</Anchor>

***

## 💡 Boas práticas de monitoramento

1. **Não faça "polling":** Evite ficar perguntando à API o status do envelope de minuto em minuto. Isso consome recursos desnecessários.
2. **Use webhooks:** Deixe que a Clicksign avise seu sistema quando o status mudar para `completed`. Use a consulta (`GET`) apenas quando precisar de detalhes específicos após o aviso.
3. **Visibilidade:** Há uma etapa você gostaria de ter mais visão e ainda não existe o webhook? Fale com a gente.
4. **Cache de metadados:** Salve o `id` da Clicksign atrelado ao ID do seu banco de dados interno para consultas instantâneas.

***

<br />

<br />