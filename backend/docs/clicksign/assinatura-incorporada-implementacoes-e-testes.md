---
updatedAt: 2026-05-27T10:41:18.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Implementações e Testes

Assinatura Incorporada (embedded_signature/tokenless) - API V3

<Callout icon="📘" theme="info">
  **Migração V1 para V3:** A chave utilizada para inicializar o Widget (request_signature_key na V1) agora é a **Chave do Signatário (Key/ID)** na **API V3**.
</Callout>

Bem-vindo ao guia de primeiros passos para integrar a **Assinatura Incorporada (embedded\_signature/tokenless)** utilizando a estrutura da **API V3**.

A versão 3 da **Assinatura Incorporada da Clicksign** oferece uma experiência de assinatura mais moderna e flexível, **sem a necessidade** de um widget em iframe. Esta abordagem dá a você controle total sobre a aparência e o comportamento do processo de assinatura em sua aplicação.

## 1. Exemplo Rápido para Testes

Para uma forma rápida e isolada de **experimentar o Widget com Assinatura Incorporada**, utilize o código em nosso repositório. Você poderá subir e visualizar o widget em funcionamento, ideal para testes iniciais e para entender o fluxo.

### 1. Obter o Repositório:

Clone o seguinte repositório público do [GitHub](https://github.com/clicksign/embedded-test.git):

```shell bash
git clone https://github.com/clicksign/embedded-test.git
# Acessar pasta do exemplo
cd embedded-test/v3/embedded_signature
```

### 2. Abrir página de exemplo:

```shell bash
# para firefox
firefox index.html
# para google-chrome
google-chrome index.html
```

### 2. Exemplo para teste

Disponibilizamos também uma aplicação pronta para testes, [clique aqui](https://clicksign.github.io/embedded-test/v3/embedded_signature/) para acessar um da parte *client-side* com a parte *server-side*.

## 2. Implementação Passo a Passo

### Arquivos

Os seguintes arquivos são fornecidos para a implementação:

### noWidget.js

Este é o coração da implementação. O arquivo `noWidget.js` contém a classe `noWidget`, que gerencia a comunicação com a **Clicksign** para **buscar os documentos** e **realizar a assinatura**. Ele é responsável por:

* Inicializar a assinatura com a chave do signatário.
* Buscar e exibir os links dos documentos a serem assinados.
* Anexar a lógica de assinatura a um botão em sua página.
* Coletar os dados do signatário (nome, CPF, data de nascimento) quando necessário.
* Enviar a requisição de assinatura para a Clicksign.

### style.css

O arquivo `style.css` contém os estilos para a página de exemplo. Ele demonstra como estilizar os elementos da interface de assinatura, como os campos de formulário, botões e a área onde os documentos são exibidos. Você pode (e deve) adaptar este CSS para que a aparência da assinatura se integre perfeitamente ao design da sua aplicação.

### embedded\_signature/index.html

Este é um exemplo completo e funcional de uma página de assinatura. O arquivo `embedded_signature/index.html` utiliza o `noWidget.js` e o `style.css` para criar uma interface onde o usuário pode:

* Configurar a chave do signatário e o ambiente.
* Preencher seus dados (se necessário).
* Visualizar os documentos.
* Realizar a assinatura.

Use este arquivo como ponto de partida para a sua implementação.

## 3. Como Usar

Os arquivos `noWidget.js` e `style.css` foram criados para serem um ponto de partida. A recomendação é que você os utilize como base e os adapte para as necessidades específicas da sua aplicação.

Siga os passos abaixo para implementar a Assinatura Incorporada:

1. **Copie e adapte os arquivos base:**

   Copie o `noWidget.js` e o `style.css` para a estrutura de arquivos do seu projeto. Renomeie-os se fizer sentido para sua organização.

2. **Integre o CSS:**

   Importe ou inclua o `style.css` em sua aplicação e modifique as regras para que a aparência da assinatura se alinhe com a identidade visual do seu produto.

3. **Crie a estrutura HTML:**

   Você precisará de um formulário para os dados do signatário, um container para os documentos e um botão de assinatura, conforme o exemplo em `embedded_signature/index.html`.

   ```html
   <div id="widget"></div>
   <button id="submitButton">Assinar</button>
   ```

4. **Inicialize e utilize o `noWidget.js`:**

   Em um script na sua página, importe e crie uma instância da classe `noWidget`, passando a chave do signatário e o ambiente.

   ```javascript
   const nw = new noWidget('SIGNER_KEY', 'sandbox');
   ```

   Use o método `mount` para indicar onde os documentos devem ser renderizados e o método `attach` para vincular a ação de assinar ao seu botão.

   ```javascript
   nw.mount({ containerId: 'widget' });

   nw.attach('click', 'submitButton', () => {
     const data = { ... }; // Colete os dados do formulário
     nw.sign(data)
       .then(() => console.log('Sucesso!'))
       .catch((error) => console.error('Erro:', error));
   });
   ```

   Sinta-se à vontade para modificar o `noWidget.js` para adicionar lógicas customizadas, tratamentos de erro específicos ou para integrá-lo melhor com o framework que você utiliza.

## Exemplo Completo

Para ver uma implementação funcional, abra o arquivo <Anchor label="embedded_signature/index.html" target="_blank" href="https://github.com/clicksign/embedded-test/blob/main/v3/embedded_signature/index.html">embedded\_signature/index.html</Anchor> em seu navegador.

Analise o código-fonte deste arquivo para entender em detalhes como todos os componentes se conectam.

<Footer3 />