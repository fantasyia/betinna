---
updatedAt: 2026-05-20T13:28:01.000Z
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

| Campo                              | Descrição                                                       | Tipo        |
| :--------------------------------- | :-------------------------------------------------------------- | :---------- |
| **role**                           | Define o nível de acesso do usuário a funcionalidades da conta  | **string**  |
| **consumption\_accessible**        | Define se o usuário vai ter acesso à página de cobrança         | **boolean** |
| **tracking\_accessible**           | Define se o usuário vai ter acesso à página de e-mails enviados | **boolean** |
| **folder\_management\_accessible** | Define se o usuário vai poder criar, editar e deletar pastas    | boolean     |

<br />

## Regras dos campos para a Criação

<Table align={["left","left","left","left"]}>
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

      <th>
        Valor Padrão
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **role**
      </td>

      <td>
        <span class="red-tag"> SIM </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        -
      </td>
    </tr>

    <tr>
      <td>
        **consumption\_accessible**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        false
      </td>
    </tr>

    <tr>
      <td>
        **tracking\_accessible**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        false
      </td>
    </tr>

    <tr>
      <td>
        **folder\_management\_accessible**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        true
      </td>
    </tr>
  </tbody>
</Table>

<br />

# Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).