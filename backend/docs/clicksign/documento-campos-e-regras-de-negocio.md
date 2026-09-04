---
updatedAt: 2026-02-19T01:41:53.000Z
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

| Campo               | Descrição                                                                                                                                                                         | Tipo       |
| :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------- |
| **status**          | A alteração desse campo determina se deseja `cancelar` ou `finalizar` o documento e está disponível apenas na atualização do documento com status `em progresso` (`running`).     | **string** |
| **filename**        | Define o nome do Arquivo com extensão, está disponível apenas na criação do documento.                                                                                            | **string** |
| **content\_base64** | Define o arquivo a ser adicionado ao processo **via upload**, está disponível apenas na criação de documentos que não possuam `template` ou `duplicate`.                          | **string** |
| **template**        | Define parâmetros para a criação de um documento **a partir de um modelo**, está disponível apenas na criação de documentos que não possuam `content_base` ou `duplicate`.        | **object** |
| **duplicate**       | Define parâmetro para criar um documento **a partir de um documento finalizado**, está disponível apenas na criação de documentos que não possuam `content_base64` ou `template`. | **object** |
| **metadata**        | Metadados do documento, os dados cadastrados serão enviados com o documento nos webhooks para facilitar a identificação deles pelo sistema que implementa a integração.           | **object** |

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
        Valores possíveis: `draft`, `running`, `canceled`, `closed\`.
      </td>
    </tr>

    <tr>
      <td>
        **filename**
      </td>

      <td>
        * Extensões suportadas via Upload: `doc`, `docx`, `pdf`, `jpg`, `jpeg`, `png`, `txt`. <br />- Extensões suportadas via Modelo: `docx`.
      </td>
    </tr>

    <tr>
      <td>
        **content_base64**
      </td>

      <td>
        Utilize o quando tiver o base64 do arquivo a ser assinado. [Veja a estrutura na página de referência](https://developers.clicksign.com/v3.0/reference/api-upload-documentos).
      </td>
    </tr>

    <tr>
      <td>
        **template**
      </td>

      <td>
        O objeto deve conter a chave do template/modelo e os dados para a criação do arquivo. [Veja a estrutura na página de referência](/reference/criar-documento-por-modelo).
      </td>
    </tr>

    <tr>
      <td>
        **duplicate**
      </td>

      <td>
        O objeto deve conter a chave do documento que será duplicado, este deve estar finalizado. [Veja a estrutura na página de referência](/reference/api-duplicar-documento).
      </td>
    </tr>

    <tr>
      <td>
        **metadata**
      </td>

      <td>
        Não há validação dos dados que deseje salvar no documento.
      </td>
    </tr>
  </tbody>
</Table>

<br />

## Regras dos campos para a Criação

| Campo               | Obrigatório                          | Disponível                           | Valor Padrão |
| :------------------ | :----------------------------------- | :----------------------------------- | :----------- |
| **status**          | <span class="red-tag"> NÃO </span>   | <span class="red-tag"> NÃO </span>   | -            |
| **filename**        | <span class="green-tag"> SIM </span> | <span class="green-tag"> SIM </span> | null         |
| **content\_base64** | <span> Apenas via Upload </span>     | <span> Apenas via Upload </span>     | null         |
| **template**        | <span> Apenas via Modelo </span>     | <span> Apenas via Modelo </span>     | null         |
| **duplicate**       | <span> Apenas via Duplicar </span>   | <span> Apenas via Duplicar </span>   | null         |
| **metadata**        | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | `{}`         |

<br />

## Regras dos campos para a Atualização

| Campo               | Obrigatório                        | Disponível                           |
| :------------------ | :--------------------------------- | :----------------------------------- |
| **status**          | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> |
| **filename**        | -                                  | <span class="red-tag"> NÃO </span>   |
| **content\_base64** | -                                  | <span class="red-tag"> NÃO </span>   |
| **template**        | -                                  | <span class="red-tag"> NÃO </span>   |
| **duplicate**       | -                                  | <span class="red-tag"> NÃO </span>   |
| **metadata**        | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> |

# Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).