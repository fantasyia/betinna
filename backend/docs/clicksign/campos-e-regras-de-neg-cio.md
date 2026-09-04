---
updatedAt: 2026-01-23T14:18:40.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Campos e regras de Negócio

Esta seção da documentação descreve detalhadamente os campos utilizados nas requisições e respostas da API, juntamente com as regras de negócio associadas a cada um deles. Aqui, você encontrará informações sobre:

* **Definições dos campos:** Nome, tipo de dado e formato esperado.
* **Validações aplicadas:** Regras obrigatórias, valores permitidos e limites de tamanho.
* **Dependências e relações:** Campos que dependem de outros ou influenciam o comportamento da API.
* **Comportamento padrão:** Valores atribuídos automaticamente e tratamento de dados opcionais.

***

# Campos e Regras de Negócio:

## Descrição dos Campos

| Campo                    | Descrição                                                       | Tipo       |
| :----------------------- | :-------------------------------------------------------------- | :--------- |
| **title**                | Nome/título do Aceite para identificação interna.               | **string** |
| **sender\_name\_option** | Opção que define a composição do nome do remetente na mensagem. | **string** |
| **sender\_phone**        | Telefone de contato do remetente (mínimo 10 dígitos).           | **string** |
| **message**              | Texto descritivo contendo o termo de aceite a ser enviado.      | **string** |
| **signer\_phone**        | Telefone do destinatário que receberá a mensagem no WhatsApp.   | **string** |
| **signer\_name**         | Nome do destinatário que irá realizar o aceite.                 | **string** |
| **status**               | Representa o estado atual do fluxo de aceite.                   | **string** |
| **sender\_name**         | Nome final do remetente, gerado automaticamente pelo sistema.   | **string** |

## Regras de Negócio para os campos

| Campo                    | Regras de Negócio                                                                                               |
| :----------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **title**                | Limite máximo padrão de 255 caracteres.                                                                         |
| **sender\_name\_option** | Valores aceitos: `user_name`, `account_name` ou `user_and_account_name`.                                        |
| **sender\_phone**        | Deve conter apenas números, incluindo DDD. Opcional.                                                            |
| **message**              | Limite máximo de 1500 caracteres. Aceita quebras de linha.                                                      |
| **signer\_phone**        | Obrigatório. Deve ser um número válido com WhatsApp ativo.                                                      |
| **signer\_name**         | Limite máximo de 200 caracteres.                                                                                |
| **status**               | Fluxo: `enqueued` -> `sent` -> (`completed` / `refused`). <br />Outros estados: `error`, `expired`, `canceled`. |
| **sender\_name**         | Este campo é ReadOnly. Ele é montado com base no `sender_name_option` e dados da conta.                         |

## Regras dos campos para a Criação

| Campo                    | Obrigatório                          | Disponível                           | Valor Padrão |
| :----------------------- | :----------------------------------- | :----------------------------------- | :----------- |
| **title**                | <span class="green-tag"> SIM </span> | <span class="green-tag"> SIM </span> | -            |
| **sender\_name\_option** | <span class="green-tag"> SIM </span> | <span class="green-tag"> SIM </span> | -            |
| **sender\_phone**        | <span class="red-tag"> NÃO </span>   | <span class="green-tag"> SIM </span> | null         |
| **message**              | <span class="green-tag"> SIM </span> | <span class="green-tag"> SIM </span> | -            |
| **signer\_phone**        | <span class="green-tag"> SIM </span> | <span class="green-tag"> SIM </span> | -            |
| **signer\_name**         | <span class="green-tag"> SIM </span> | <span class="green-tag"> SIM </span> | -            |

## Regras dos campos para a Atualização

| Campo      | Obrigatório                        | Disponível                             |
| :--------- | :--------------------------------- | :------------------------------------- |
| **status** | <span class="red-tag"> NÃO </span> | Apenas para transição para `canceled`. |

<Footer3 />