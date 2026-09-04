---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Documentos

# O que são documentos?

Documentos são os arquivos que serão assinados dentro de um envelope. Podem ser contratos, termos, formulários, ou qualquer arquivo que precise de assinatura digital.

# Visão geral

A adição de documentos a um envelope é uma etapa fundamental no processo de preparação para assinatura digital. Nesta página, você encontrará todas as informações necessárias para adicionar documentos a um envelope utilizando a Clicksign API.

Ao adicionar um documento a um envelope, você está incorporando esse documento ao conjunto de arquivos que serão enviados para assinatura digital. Isso permite que os signatários visualizem e assinem o documento como parte do processo de assinatura.

Existem três formas principais de adicionar documentos a um envelope: **upload de arquivos**,**uso de modelos (templates)** ou **duplicação de documento**. Ambas as opções oferecem flexibilidade para atender diferentes necessidades e cenários.

# Upload do arquivo (Base64)

Uma forma de adicionar documentos a um envelope é fornecendo o conteúdo do arquivo em formato base64. Esse método permite que você inclua arquivos diretamente na requisição, sem necessidade de armazená-los separadamente.

Esse processo é simples e eficiente, ideal para quando você deseja integrar diretamente os arquivos ao fluxo de criação do envelope. Após criar o envelope, basta adicionar o(s) documento(s) que farão parte do processo de assinatura.

Conteúdo do arquivo em formato Base64 que está sendo enviado para a Clicksign.

Esse atributo é composto por quatro partes: um prefixo (data:), um MIME TYPE indicando o tipo de dados, um token Base64 e os dados em si:

data:\<mimetype>;base64,\<data>

MIME TYPES suportados:

* text/plain
* image/png
* image/jpeg
* application/pdf
* application/msword
* application/vnd.openxmlformats-officedocument.wordprocessingml.documen

Utilize <Anchor label="esse site" target="_blank" href="https://base64.pi7.org/pdf-to-base64">esse site</Anchor> para transformar um arquivo em Base64.

Para mais informações sobre como realizar esse procedimento, consulte a página de referência para a requisição de <Anchor label="Criar Documento por Upload" target="_blank" href="/v3.0/reference/api-upload-documentos">Criar Documento por Upload</Anchor>.

Veja mais detalhes na página de <Anchor label="Referência da API" target="_blank" href="/v3.0/reference/editar-documento">Referência da API</Anchor>.

# Utilização de um modelo (template)

Outra forma de adicionar documentos a um envelope é através do uso de modelos (templates) previamente configurados. Os templates permitem que você crie documentos de forma padronizada, otimizando o processo de criação e garantindo consistência nos documentos gerados.

Ao utilizar um modelo, você pode optar por personalizar variáveis dentro do documento ou reutilizar modelos existentes, agilizando o processo. Se necessário, também é possível modificar o nome do arquivo, desde que a extensão seja `.docx`.

Para mais informações sobre como criar documentos a partir de um modelo, consulte a seção de [Modelos](/v3.0/docs/docs-modelos) ou a página de referência para a requisição de [Criar Documento por Modelo](/v3.0/reference/criar-documento-por-modelo).

Veja mais detalhes na página de [Referência da API](/v3.0/reference/editar-documento).

# Duplicação de documentos

Uma terceira forma de adicionar documentos a um envelope é através da duplicação de documentos existentes. Esse método permite que você reutilize documentos que já foram processados e finalizados, criando uma nova versão não assinada a partir do conteúdo original.

Esse processo é particularmente útil quando você precisa criar múltiplos envelopes com o mesmo documento base, ou quando deseja reaproveitar um documento já finalizado em um novo fluxo de assinatura.

A duplicação captura o conteúdo não assinado do documento original, garantindo que o novo documento esteja pronto para receber novas assinaturas.

### Como funciona a duplicação

Ao duplicar um documento, você referencia um documento existente através de sua chave única (key). O sistema então extrai o conteúdo não assinado do documento original e cria uma nova cópia dentro do envelope de destino.

Isso mantém a integridade do documento original enquanto permite que você trabalhe com uma versão independente. Para duplicar um documento, você precisa fornecer:

**filename**: Nome do arquivo que será criado (pode ser diferente do original)

**duplicate.key:** Chave UUID do documento que será duplicado

Veja mais detalhes na página de [Referência da API](https://developers.clicksign.com/update/reference/api-duplicar-documento#/).

# Atualização de documentos

A plataforma Clicksign também oferece funcionalidades para atualizar documentos dentro de um envelope, permitindo alterações no status do documento conforme o andamento do processo de assinatura.

O principal ajuste possível é a alteração do status de um documento para "cancelado" (canceled) ou "finalizado" (closed), quando necessário. Isso proporciona flexibilidade no gerenciamento de documentos em andamento, garantindo que o processo se adapte às necessidades do fluxo de trabalho.

É importante lembrar que a alteração de status só pode ser feita quando o documento se encontra com o status "em andamento" (running). A modificação do status está restrita a essa função, mantendo a integridade do processo de assinatura.

# Próximos passos

Desenvolvemos um guia passo a passo para realizar requisições utilizando cURL como demonstração:

<Recipe slug="adicionar-documento-ao-envelope" title="Adicionar Documento ao Envelope" />

<Footer3 />