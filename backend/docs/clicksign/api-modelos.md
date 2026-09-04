---
updatedAt: 2026-01-15T18:25:56.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Modelos

Explore Nossos Endpoints: CRUD do Modelos

**Bem-vindo à Página de Modelos da Clicksign!**

Aqui, você terá a possibilidade de criar seus próprios modelos criados em Microsoft Word. Esses modelos serão predefinições que você poderá utilizar como base para criar novos documentos de maneira rápida e eficiente. Confira mais em nossa página de Ajuda.

Com esta funcionalidade, você poderá utilizar templates criados em Microsoft Word para criação automática de documentos baseados em metadados. Confira mais em nossa [página de Ajuda](https://ajuda.clicksign.com/automa%C3%A7%C3%A3o-de-documentos).

## Endpoints Disponíveis:

#### 1. Consultar Modelos:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** **`/templates`**
* **Descrição:** Lista todos os Modelos cadastrados na conta.
* **URL:** [Página de Referência](/v3.0/reference/api-listar-modelos).

#### 2. Criar Modelo:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:** **`/templates`**
* **Descrição:** Criar um Modelo.
* **URL:** [Página de Referência](/v3.0/reference/api-criar-modelo).

#### 3. Editar Modelo:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_patch" data-testid="http-method">PATCH</span>
* **Endpoint:** **`/templates/{id}`**
* **Descrição:** Atualiza os detalhes de um Modelo existente.
* **URL:** [Página de Referência](/v3.0/reference/api-editar-modelo).

#### 4. Visualizar Modelo:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:** **`/templates/{id}`**
* **Descrição:** Recupera os detalhes de um Modelo.
* **URL:** [Página de Referência](/v3.0/reference/api-visualizar-modelo).

#### 5. Excluir Modelo:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_delete" data-testid="http-method">DELETE</span>
* **Endpoint:** **`/templates/{id}`**
* **Descrição:** Exclui permanentemente um Modelo.
* **URL:** [Página de Referência](/v3.0/reference/api-excluir-modelo).

# Referência: Geração de tabelas

Este documento é a referência técnica completa para a funcionalidade de geração de tabelas em modelos.

## Método 1: Tabelas automáticas

Use este método quando precisar de máxima flexibilidade para definir cabeçalhos, dados, larguras de coluna e estilos diretamente a partir dos seus dados.

### 1.1. Sintaxe no Template

Para inserir uma tabela automática, adicione a seguinte tag no seu arquivo .docx:

`{{:table nome_da_sua_tabela}}`

O nome\_da\_sua\_tabela será a chave principal do objeto JSON que conterá os dados e as configurações da tabela.

### 1.2. Estrutura do objeto JSON

O JSON correspondente deve ter uma chave com o mesmo nome definido na tag.
**Exemplo de JSON Mínimo:**

```json
{
  "data": {
    "nome_da_sua_tabela": {
      "header": ["Produto", "Quantidade", "Preço Unitário"],
      "data": [
        ["Caneta Azul", "10", "R$ 2,50"],
        ["Caderno 96fls", "5", "R$ 15,00"]
      ]
    }
  }
}
```

### 1.3. Parâmetros

A seguir estão todos os parâmetros disponíveis para configurar sua tabela.

| Parâmetro        | Tipo                   | Obrigatório? | Descrição                                                                                                              |
| :--------------- | :--------------------- | :----------: | :--------------------------------------------------------------------------------------------------------------------- |
| `header`         | `Array<String>`        |      Sim     | Define os títulos principais das colunas.                                                                              |
| `data`           | `Array<Array<String>>` |      Sim     | Matriz contendo os dados das linhas. Cada array interno é uma linha.                                                   |
| `subheader`      | `Array<String>`        |      Não     | Define subtítulos para as colunas, exibidos abaixo do `header`.                                                        |
| `totalWidth`     | `String`               |      Não     | Largura total da tabela. Aceita valores em pontos (ex: `"800"`) ou porcentagem (ex: `"100%"`).                         |
| `widths`         | `Array<String>`        |      Não     | Largura individual de cada coluna em porcentagem. A soma deve ser 100. Ex: `["60", "20", "20"]`.                       |
| `height`         | `String`               |      Não     | Define a altura das linhas. Deve ser usado em conjunto com `heightRule`. Ex: `"100"`.                                  |
| `heightRule`     | `String`               |      Não     | Regra de altura. `"exact"` para altura fixa (corta o texto) ou `"atleast"` para altura mínima (expande se necessário). |
| `finalPageBreak` | `Boolean`              |      Não     | Se `true`, insere uma quebra de página após a tabela.                                                                  |
| `style`          | `Object`               |      Não     | Objeto contendo as regras de estilização para `header`, `subheader` e `data`.                                          |

### 1.4. O Objeto style

O objeto style permite customizar a aparência da tabela. Você pode aplicar estilos para as seções `header`, `subheader` e `data`.

| Parâmetro       | Tipo     |                 Aplicação                 | Descrição                                                                                           |
| :-------------- | :------- | :---------------------------------------: | :-------------------------------------------------------------------------------------------------- |
| `header`        | `Object` |                  Sim/Não                  | Objeto com estilos aplicáveis à linha de cabeçalho principal.                                       |
| `subheader`     | `Object` |                  Sim/Não                  | Objeto com estilos aplicáveis à linha de subtítulo, se definida.                                    |
| `data`          | `Object` |                  Sim/Não                  | Objeto com estilos aplicáveis a todas as linhas de dados da tabela.                                 |
| `textAlign`     | `String` | Dentro de `header`, `subheader` ou `data` | Alinhamento horizontal do texto nas células. Valores: `"left"`, `"center"`, `"right"`, `"justify"`. |
| `verticalAlign` | `String` | Dentro de `header`, `subheader` ou `data` | Alinhamento vertical do texto nas células. Valores: `"top"`, `"center"`, `"bottom"`.                |
| `shade`         | `String` | Dentro de `header`, `subheader` ou `data` | Cor de fundo da célula em hexadecimal, **sem o `#`**. Ex: `"C2D69B"`.                               |

### 1.5. Exemplo completo

Este exemplo combina vários parâmetros para criar uma tabela estilizada.

**Template (.docx):** `{{:table relatorio_vendas}}`
**JSON:**

```json
{
  "data": {
    "relatorio_vendas": {
      "header": ["Produto", "Qtd", "Preço", "Total"],
      "subheader": ["Item", "Un", "R$", "R$"],
      "totalWidth": "100%",
      "widths": ["40", "20", "20", "20"],
      "data": [
        ["Lápis Grafite", "100", "0.50", "50.00"],
        ["Borracha Branca", "30", "1.00", "30.00"]
      ],
      "style": {
        "header": { "textAlign": "center", "verticalAlign": "center", "shade": "F47B20" },
        "subheader": { "textAlign": "center", "shade": "FBB784" },
        "data": { "textAlign": "left", "verticalAlign": "center" }
      }
    }
  }
}
```

<br />

# Método 2: Tabelas em Loop

Use este método para preencher uma tabela com estrutura fixa, repetindo as linhas para cada item de um array.

## 2.1. Estrutura no Template

Crie a tabela diretamente no seu arquivo .docx com uma linha de cabeçalho e uma linha de exemplo para os dados. Envolva a linha de dados com as tags de loop.

**Exemplo de estrutura no .docx:**

| Nome                    | Idade       |           Cidade          |
| :---------------------- | :---------- | :-----------------------: |
| `{{#pessoas}} {{Nome}}` | `{{Idade}}` | `{{Cidade}} {{/pessoas}}` |

* `{{#pessoas}}`: Inicia o loop no array chamado pessoas.
* `{{Nome}}, {{Idade}}, {{Cidade}}`: Variáveis que serão preenchidas com os dados de cada objeto do array.
* `{{/pessoas}}`: Fecha o loop.

## 2.2. Estrutura do JSON

O JSON deve conter um array de objetos. O nome do array (pessoas, no exemplo) deve corresponder ao nome usado nas tags de loop.

```json{
  "data": {
    "pessoas": [
      { "Nome": "Paulo Oliveira", "Idade": "29", "Cidade": "Porto Alegre" },
      { "Nome": "Isabela Lima", "Idade": "35", "Cidade": "Curitiba" }
    ]
  }
}
```

O resultado será uma tabela com duas linhas de dados, preenchidas com as informações do array pessoas.

<br />