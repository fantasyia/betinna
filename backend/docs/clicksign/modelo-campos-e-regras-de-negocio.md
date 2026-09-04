---
updatedAt: 2026-05-12T12:37:20.000Z
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

| Campo               | Descrição                                                                       | Tipo       |
| :------------------ | :------------------------------------------------------------------------------ | :--------- |
| **name**            | Nome do arquivo do documento a ser criado.                                      | **string** |
| **color**           | A cor de identificação do template via interface.                               | **string** |
| **content\_base64** | Conteúdo do arquivo em formato base 64 que está sendo enviado para a Clicksign. | **string** |

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
        Informe uma extensão `.docx`.
      </td>
    </tr>

    <tr>
      <td>
        **color**
      </td>

      <td>
        Valores possíveis:
        * \#1474F5 <span style={{ color: '#1474F5' }}>(azul)</span>.
        * \#15D3C9 <span style={{ color: '#15D3C9' }}>(azul-turquesa)</span>.
        * \#05C412 <span style={{ color: '#05C412' }}>(verde)</span>.
        * \#FCCF00 <span style={{ color: '#FCCF00' }}>(amarelo)</span>.
        * \#F77C04 <span style={{ color: '#F77C04' }}>(laranja)</span>.
        * \#CF2E58 <span style={{ color: '#CF2E58' }}>(rosa-escuro)</span>.
        * \#FF86D5 <span style={{ color: '#FF86D5' }}>(rosa-claro)</span>.
        * \#8726D9 <span style={{ color: '#8726D9' }}>(roxo)</span>.
        * \#577B8D <span style={{ color: '#577B8D' }}>(cinza)</span>.

      </td>
    </tr>

    <tr>
      <td>
        **content_base64**
      </td>

      <td>
        * O documento deve estar em formato .docx para criar um modelo.<br />- Em caso de dúvida, utilize o site a seguir para transformar um arquivo em base 64: [https://jpillora.com/base64-encoder/](https://jpillora.com/base64-encoder/).
      </td>
    </tr>
  </tbody>
</Table>

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
        **name**
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        * <br />
      </td>
    </tr>

    <tr>
      <td>
        **color**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        # 1474F5
      </td>
    </tr>

    <tr>
      <td>
        **content_base64**
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        * <br />
      </td>
    </tr>
  </tbody>
</Table>

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
        **name**
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
        **color**
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
        **content_base64**
      </td>

      <td>
        * <br />
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>
    </tr>
  </tbody>
</Table>

# Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).