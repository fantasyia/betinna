---
updatedAt: 2026-08-26T22:27:15.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Campos e Regras de Negócio

Esta seção da documentação descreve detalhadamente os campos utilizados nas requisições e respostas da API, juntamente com as regras de negócio associadas a cada um deles. Aqui, você encontrará informações sobre:

* **Definições dos campos:** Nome, tipo de dado e formato esperado.
* **Validações aplicadas:** Regras obrigatórias, valores permitidos, e limites de tamanho ou intervalo.
* **Dependências e relações:** Campos que dependem de outros ou influenciam o comportamento da API.
* **Comportamento padrão:** Valores atribuídos automaticamente e tratamento de dados opcionais.

Nosso objetivo é garantir que você tenha uma compreensão clara de como interagir com os campos da API e evitar erros comuns durante a integração. Certifique-se de consultar esta seção ao construir ou validar suas requisições.

# Campos e Regras de Negócio:

## Descrição dos Campos

| Campo                           | Descrição                                                                                                                    | Exemplo              | Tipo        |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- | :------------------- | :---------- |
| **name**                        | O nome do signatário, usado para identificá-lo.                                                                              | Marcos Zumba         | **string**  |
| **email**                       | E-mail do signatário que deverá assinar o documento.                                                                         | <fulano@example.com> | **string**  |
| **phone\_number**               | Número de telefone do signatário que deverá assinar o documento.                                                             | 11987654321          | **string**  |
| **has\_documentation**          | Define se serão solicitados os campos `CPF` e `Data de Nascimento` do signatário. Útil para signatários que não possuem CPF. | true                 | **boolean** |
| **documentation**               | CPF do signatário.                                                                                                           | 123.321.123-40       | **string**  |
| **birthday**                    | Data de nascimento do signatário.                                                                                            | 1983-03-31           | **date**    |
| **refusable**                   | Determina se o signatário pode recusar o documento.                                                                          | false                | **boolean** |
| **group**                       | Determina em qual grupo o signatário deve ser vinculado, conforme ordem de assinatura.                                       | 1                    | **integer** |
| **location\_required\_enabled** | Determina se o signatário deve compartilhar sua localização no momento da assinatura.                                        | true                 | **boolean** |
| **communicate\_events**         | Objeto responsável por definir a comunicação com o signatário.                                                               |                      | **object**  |
| **signature\_host**             | Anfitrião de um processo de assinatura presencial                                                                            |                      | **object**  |

<br />

## Regras de Negócio para os campos

<Table align={["left","left"]}>
  <thead>
    <tr>
      <th>
        Campo
      </th>

      <th>
        Regras de Negócio
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **name**
      </td>

      <td>
        - Informe ao menos um `Nome` e um `Sobrenome`.
        - Não permite o envio de números.
        - São necessários espaços entre os nomes.
      </td>
    </tr>

    <tr>
      <td>
        **phone_number**
      </td>

      <td>
        - É necessário enviar o DDD + Telefone, sem DDI.
      </td>
    </tr>

    <tr>
      <td>
        **has_documentation**
      </td>

      <td>
        - Se for informado `false`, não é possível enviar os campos `documentation` e `birthday`.
      </td>
    </tr>

    <tr>
      <td>
        **birthday**
      </td>

      <td>
        - Se este campo for enviado, o signatário não poderá realizar a alteração da data de nascimento no momento da assinatura.
        - O formato deverá ser AAAA-MM-DD.
        - É necessário enviar uma data válida.
      </td>
    </tr>

    <tr>
      <td>
        **group**
      </td>

      <td>
        - Quando houver signatários em grupos diferentes, os signatários de grupos superiores só poderão assinar após todos os signatários dos grupos anteriores terem assinado.&#x20;
        - Apenas é possível notificar os signatários do grupo ativo, os outros são notificados automaticamente quando os signatários dos grupos anteriores tiverem assinado.
      </td>
    </tr>

    <tr>
      <td>
        **communicate_events**
      </td>

      <td>
        **signature_request:**

        - Indica como a Clicksign deve comunicar ao signatário a solicitação de assinatura do documento

        - Valores possíveis: `email`, `sms`, `whatsapp`, `none`.

        - Padrão: `email`.

        **signature_reminder:**

        - Determina como os lembretes serão entregues, conforme intervalo configurado no atributo `remind_interval` na [criação do Envelope](/v3.0/reference/envelope-campos-e-regras-de-negocio)  .

        - Valores possíveis: `none`, `email`.

        - Padrão: `email`.

        **document_signed:**

        - Indica como a Clicksign deve comunicar ao signatário para enviar o documento que foi assinado por todos os signatários.

        - Valores possíveis: `email`, `whatsapp`.

        - Padrão: `email`.
      </td>
    </tr>

    <tr>
      <td>
        **signature_host**
      </td>

      <td>
        **name**:

        - Indica o Nome do "Anfitrião" do processo de assinatura.

        - Padrão: `null`.

        **email:**

        - E-mail do "Anfitrião" do processo de assinatura do documento.

        - Padrão: `null`.

        **communicate_events:**

        - Indica se o Anfitrião deve ser notificado via email.

        - Tipo de dado: `{ "signature_host_signature_request": "email" }`.

        - Padrão: `{}`.
      </td>
    </tr>
  </tbody>
</Table>

<br />

## Regras dos campos para a Criação

| Campo                           | Obrigatório                                                        | Disponível                           | Valor Padrão |
| :------------------------------ | :----------------------------------------------------------------- | :----------------------------------- | :----------- |
| **email**                       | Apenas se houver valores de `email`.                               | <span class="green-tag"> SIM </span> | null         |
| **phone\_number**               | Apenas se houver valores de `sms`ou `whatsapp`.                    | <span class="green-tag"> SIM </span> | null         |
| **has\_documentation**          | <span class="red-tag"> NÃO </span>                                 | <span class="green-tag"> SIM </span> | true         |
| **documentation**               | <span class="red-tag"> NÃO </span>                                 | <span class="green-tag"> SIM </span> | null         |
| **birthday**                    | <span class="red-tag"> NÃO </span>                                 | <span class="green-tag"> SIM </span> | null         |
| **refusable**                   | <span class="red-tag"> NÃO </span>                                 | <span class="green-tag"> SIM </span> | false        |
| **group**                       | <span class="red-tag"> NÃO </span>                                 | <span class="green-tag"> SIM </span> | 1            |
| **location\_required\_enabled** | <span class="red-tag"> NÃO </span>                                 | <span class="green-tag"> SIM </span> | false        |
| **communicate\_events**         | <span class="red-tag"> NÃO </span>                                 | <span class="green-tag"> SIM </span> | ¹            |
| **signature\_host**             | Apenas se houver requisito de Assinatura Presencial (`presential`) | <span class="green-tag"> SIM </span> | \{}          |

*Valor padrão para communicate\_events¹*

```json
{
  "signature_request":"email",
  "signature_reminder":"email",
  "document_signed":"email"
} 
```

# Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).