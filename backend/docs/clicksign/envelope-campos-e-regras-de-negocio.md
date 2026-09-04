---
updatedAt: 2026-04-10T12:19:03.000Z
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

| Campo                                    | Descrição                                                                                                                                                                                                                                                              | Tipo         |
| :--------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- |
| **status**                               | A alteração desse campo determina a ativação do Envelope e está disponível apenas na atualização do envelope (update)                                                                                                                                                  | **string**   |
| **name**                                 | Define o nome do Envelope.                                                                                                                                                                                                                                             | **string**   |
| **locale**                               | Determina o idioma do documento. Os e-mails, página de assinatura e log do documento assinado estarão no idioma definido.                                                                                                                                              | **string**   |
| **auto\_close**                          | Determina se o documento será finalizado automaticamente logo após a assinatura do último signatário.                                                                                                                                                                  | **boolean**  |
| **remind\_interval**                     | Determina se o documento terá opção de lembretes automáticos ativada. O intervalo é medido em dias. Com a inclusão do parâmetro serão enviados até três lembretes automaticamente.                                                                                     | **integer**  |
| **block\_after\_refusal**                | Determina se o processo de assinatura tem que ser pausado ou não após um signatário ter recusado.                                                                                                                                                                      | **boolean**  |
| **deadline\_at**                         | Data limite para a realização das assinaturas dos documentos relacionados. Documento será finalizado automaticamente quando a data limite for atingida. Se houver assinaturas, o Documento ficará com o status finalizado, caso contrário, o documento será cancelado. | **datetime** |
| **default\_subject**                     | Define o assunto do e-mail que será enviado aos signatários na solicitação de assinatura.                                                                                                                                                                              | **string**   |
| **default\_message**                     | Define a mensagem padrão que será enviada aos signatários.                                                                                                                                                                                                             | **string**   |
| **deadline\_partial\_signature\_action** | Define o comportamento para finalização do documento                                                                                                                                                                                                                   | **string**   |

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
        **status**
      </td>

      <td>
        Valores possíveis: draft, running, canceled, closed.
      </td>
    </tr>

    <tr>
      <td>
        **locale**
      </td>

      <td>
        Valores possíveis: pt-BR, en-US.
      </td>
    </tr>

    <tr>
      <td>
        **auto_close**
      </td>

      <td>
        Valores possíveis: true, false.
      </td>
    </tr>

    <tr>
      <td>
        **remind_interval**
      </td>

      <td>
        Valores possíveis: null, 1, 2, 3, 7, 14.
      </td>
    </tr>

    <tr>
      <td>
        **block_after_refusal**
      </td>

      <td>
        Valores possíveis: true, false.
      </td>
    </tr>

    <tr>
      <td>
        **deadline_at**
      </td>

      <td>
        * Data limite máxima é de 90 dias contados a partir do upload. <br />- Uma vez cancelado, o processo não pode ser retomado. <br />- O valor deve ser maior que a data/hora atual.
      </td>
    </tr>

    <tr>
      <td>
        **default_subject**
      </td>

      <td>
        * Se esse atributo não for informado, o assunto padrão será enviado. <br />- Há um limite de 100 caracteres.
      </td>
    </tr>

    <tr>
      <td>
        **default_message**
      </td>

      <td>
        * É possível enviar uma mensagem específica para cada signatário usando o parâmetro message ao [disparar notificação de signatário](/v3.0/reference/api-notificar-signatario). <br /> - A mensagem informada no parâmetro message terá prioridade sobre a mensagem definida no atributo `default_message`.
      </td>
    </tr>

    <tr>
      <td>
        **deadline_partial_signature_action**
      </td>

      <td>
        Valores possíveis: closed, canceled
      </td>
    </tr>
  </tbody>
</Table>

<br />

## Regras dos campos para a Criação

| Campo                                    | Obrigatório                          | Disponível                           | Valor Padrão       |
| :--------------------------------------- | :----------------------------------- | :----------------------------------- | :----------------- |
| **status**                               | -                                    | <span class="red-tag"> NÃO </span>   | -                  |
| **name**                                 | <span class="green-tag"> SIM </span> | <span class="green-tag"> SIM </span> | -                  |
| **locale**                               | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | pt-BR              |
| **auto\_close**                          | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | true               |
| **remind\_interval**                     | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | 3                  |
| **block\_after\_refusal**                | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | false              |
| **deadline\_at**                         | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | datetime + 30 dias |
| **default\_subject**                     | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | null               |
| **default\_message**                     | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | ""                 |
| **deadline\_partial\_signature\_action** | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | null               |

<br />

## Regras dos campos para a Atualização

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Campo
      </th>

      <th>
        Obrigatório
      </th>

      <th>
        Disponível
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **status**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>

    <tr>
      <td>
        **name**
      </td>

      <td>
        * <br />
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>
    </tr>

    <tr>
      <td>
        **locale**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>

    <tr>
      <td>
        **auto_close**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>

    <tr>
      <td>
        **remind_interval**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>

    <tr>
      <td>
        **block_after_refusal**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>

    <tr>
      <td>
        **deadline_at**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>

    <tr>
      <td>
        **default_subject**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        Disponível apenas quando o estado é `draft`
      </td>
    </tr>

    <tr>
      <td>
        **default_message**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>

    <tr>
      <td>
        **deadline_partial_signature_action**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>
    </tr>
  </tbody>
</Table>

<Footer3 />