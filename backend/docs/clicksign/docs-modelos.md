---
updatedAt: 2026-06-04T10:59:27.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 2.3. Automação com Modelos

# O que são modelos?

Os Modelos (ou Templates) são ferramentas para simplificar e agilizar a criação de documentos de forma padronizada e reutilizável. Eles permitem a definição de um formato padrão para documentos específicos, o que facilita a geração de novos documentos com estrutura similar, economizando tempo e garantindo consistência em todos os seus processos de assinatura.

A funcionalidade de Modelos está disponível nos <a href="https://www.clicksign.com/preco" target="_blank">planos com API disponível</a>

## Crie um modelo

Utilize o endpoint de <Anchor label="Criar Modelo" target="_blank" href="/v3.0/reference/api-criar-modelo">Criar Modelo</Anchor> para iniciar o processo de criação de um novo modelo. Neste endpoint, você poderá definir o nome do modelo, cor de identificação e o arquivo em si.

## Edite um modelo

Se houver necessidade de realizar alterações nas configurações de um modelo existente, utilize o endpoint de <Anchor label="Atualizar Modelo" target="_blank" href="/v3.0/reference/api-editar-modelo">Atualizar Modelo</Anchor>. No entanto, vale destacar que não é possível editar o conteúdo do arquivo do modelo diretamente. Caso precise alterar o conteúdo do documento, será necessário excluir o modelo atual e criar um novo.

A edição se limita a campos como nome, cor de identificação e outras configurações associadas ao modelo, como o uso de variáveis dinâmicas que permitem a personalização do documento em cada uso.

## Exclua um modelo

Se você desejar excluir um modelo, utilize o endpoint de <Anchor label="Excluir Modelo" target="_blank" href="/v3.0/reference/api-excluir-modelo">Excluir Modelo</Anchor>. A exclusão de um modelo pode ser necessária quando ele não for mais útil ou quando precisar ser substituído por um novo. Lembre-se de que, ao excluir um modelo, todas as suas instâncias associadas também serão removidas, e você precisará criar um novo modelo caso queira utilizar um formato semelhante.

## Exemplo de fluxo de uso

Imagine que sua empresa utiliza um contrato de prestação de serviços padrão. Com o modelo, você cria o contrato uma vez, configurando campos como o nome do cliente, o valor do contrato e a data de início. Quando um novo cliente for assinar o contrato, basta preencher esses campos específicos e gerar o documento para assinatura. Isso economiza tempo e evita erros de digitação ou formatação.

<br />

# Assinatura Manuscrita Posicionada

A tag de assinatura manuscrita posicionada permite determinar exatamente o local, onde a assinatura manuscrita de um signatário específico será aplicada no documento final.

## Sintaxe no Template

No seu arquivo Word (.docx), escreva a tag `{{~position_sign_ID}}` no local exato onde deseja que a assinatura apareça.

## Estrutura da Tag

Para que o sistema identifique e processe corretamente o local da assinatura, a tag deve seguir uma estrutura específica e padronizada. Ela é composta por dois elementos fundamentais contidos entre chaves duplas.

### Componentes da Tag

* `~position_sign_` (Prefixo Fixo): É o identificador técnico obrigatório. Ele sinaliza ao sistema que aquele ponto do documento não é um texto comum, mas sim uma coordenada de ancoragem para a imagem da assinatura.
* `ID` (Identificador Único): É o valor definido pelo usuário para diferenciar os signatários.

### Exemplos de Aplicação:

Você pode utilizar números, termos genéricos ou cargos como identificadores:

* `{{~position_sign_1}}`
* `{{~position_sign_signer1}}`
* `{{~position_sign_cliente}}`

## Exemplo prático

Se o seu documento possui um Vendedor e um Comprador, você deve criar duas tags distintas para cada signatário e posicioná-las nos locais em que você deseja que as assinaturas apareçam:

<br />

```
Visualização no Modelo (Template)

TERMO DE COMPROMISSO

Declaro estar de acordo com as cláusulas citadas.

Vendedor: {{~position_sign_vendedor}}

Comprador: {{~position_sign_comprador}}
```

Para saber mais sobre como vincular a tag de assinatura manuscrita posicionada a um signatário via API, consulte aqui: <Anchor label="Requisito de Rubrica" target="_blank" href="https://developers.clicksign.com/docs/adicionar-requisito-de-rubrica">Requisito de Rubrica</Anchor>.

<br />

# Geração de tabelas em Modelos

A funcionalidade de geração de tabelas permite criar documentos .docx com tabelas dinâmicas, preenchidas a partir de dados enviados via JSON. Isso é ideal para gerar contratos com listas de produtos, relatórios com resultados, propostas comerciais detalhadas e qualquer outro documento que necessite de informações estruturadas.
Com este recurso, você pode automatizar a criação de tabelas complexas, garantindo consistência e eliminando a necessidade de manipulação manual de documentos.

## Tabelas automáticas

Este método permite que você defina toda a estrutura da tabela — incluindo cabeçalhos, dados, larguras, altura e estilos visuais (como cores e alinhamento) — diretamente através de um objeto JSON.
É a escolha ideal quando a estrutura da tabela pode variar ou quando você precisa de controle total sobre sua aparência.

➡️<Anchor label=" Veja a documentação técnica para Tabelas Automáticas" target="_blank" href="https://developers.clicksign.com/reference/api-modelos"> Veja a documentação técnica para Tabelas Automáticas</Anchor>

## Tabelas em Loop

Este método é perfeito para cenários mais simples, onde a estrutura da tabela (as colunas) já está definida no seu modelo .docx. Você simplesmente informa um array de dados no JSON, e o sistema cria uma linha na tabela para cada item do array.
É ideal para preencher listas de itens, participantes ou qualquer conjunto de dados com uma estrutura repetitiva.

➡️<Anchor label="Veja a documentação técnica para Tabelas em Loop" target="_blank" href="https://developers.clicksign.com/reference/api-modelos">Veja a documentação técnica para Tabelas em Loop</Anchor>

## Próximos passos

Desenvolvemos um guia passo a passo para realizar requisições utilizando cURL como demonstração:

<Recipe slug="criando-documento-a-partir-de-um-modelo" title="Criando Documento a partir de um Modelo" />

<Footer3 />

<br />