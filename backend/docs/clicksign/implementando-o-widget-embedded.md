---
updatedAt: 2026-05-27T10:41:18.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Implementando o Widget Embedded na sua Aplicação

> 📘 Essa documentação é compatível para API REST versão 3 (Envelope)
>
> Caso esteja utilizando a **API REST versão 1** (Sem Envelope), siga as instruções no link: [Instalação do Widget Embedded v1](https://developers.clicksign.com/v1.0/docs/instalacao-do-widget-embedded)

Este guia detalha os passos para integrar o Widget Embedded da Clicksign na sua aplicação web.

### Pré-requisitos

* Acesso ao código da sua aplicação web.
* Uma conta Clicksign (para obter o id do signatário).

### Implementação

#### 1. Incluir a Biblioteca:

* Adicione a seguinte tag `<script>` dentro da tag `<body>` da sua página HTML onde você deseja exibir o widget:

```html
<script src="https://cdn-public-library.clicksign.com/embedded/embedded.min-2.1.0.js" type="text/javascript"></script>
```

#### 2. Crie um elemento `div` para que o Widget Embedded seja montado dentro dele:

```html
<div id="container"></div>
```

#### 3. Carregar o Widget com JavaScript:

Adicione o seguinte código JavaScript após a inclusão da biblioteca. Certifique-se de substituir `ID_DO_SIGNATARIO` pelo id real do seu signatário na Clicksign. Encontre o atributo `id` no JSON do signatário recebido através da API em [Adicionar novo signatário no Envelope](/v3.0/reference/api-criar-signatario).
Para a utilização de um signatário é necessário que o Envelope esteja com status `running` antes realizar o teste em seu widget, para maiores informações consulte a documentação para [Primeiros Passos](https://developers.clicksign.com/docs/primeiros-passos) .

```javascript
<script type="text/javascript">
  var widget = new Clicksign('ID_DO_SIGNATARIO');

  // Defina o endpoint apropriado (Sandbox ou Produção)
  widget.endpoint = 'https://sandbox.clicksign.com'; // Ou 'https://app.clicksign.com'

  // (Opcional) Defina a URL de origem se estiver usando WebView
  widget.origin = window.origin;

  // Renderize o widget dentro do container
  widget.mount('container');

  // (Opcional) Adicione callbacks para eventos
  widget.on('loaded', function(event) {
    console.log('Widget carregado!');
  });

  widget.on('signed', function(event) {
    console.log('Documento assinado!');
    // Redirecione o usuário ou execute alguma ação
    // window.location.href = '/obrigado';
  });

  widget.on('resized', function(event) {
    console.log('Widget redimensionado:', event.data.height);
    document.getElementById('container').style.height = event.data.height + 'px';
  });
</script>
```

#### 4. Callbacks javascript:

Quando um documento for carregado, estiver nas etapas de credenciamento ou for assinado, a função callback registrada é chamada  (loaded, signed, resized). Através dela você pode manipular a sua aplicação conforme necessário.

> ❗️ Por segurança, confie nas informações recebidas através dos Webhooks.
>
> Os callbacks são javascript rodando no browser do usuário e podem ser manipulados de forma indevida.

#### 5. Para remover o Widget Embedded da DOM, basta executar o código abaixo:

```javascript
widget.unmount();
```

### Exemplo completo:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Simple widget usage</title>
    <script src="https://cdn-public-library.clicksign.com/embedded/embedded.min-2.1.0.js"></script>
  </head>

  <body>
    <input id='request_signature_id' />
    <input type='button' value='Load' onclick='run()'/>
    <div id='container' style='height: 600px'></div>

    <script type='text/javascript'>
      var widget, input = document.getElementById('request_signature_id');

      function run () {
        var request_signature_id = input.value;

        if(widget) { widget.unmount(); }

        widget = new Clicksign(request_signature_id);

        widget.endpoint = 'https://sandbox.clicksign.com';
        widget.origin = window.origin;
        widget.mount('container');

        widget.on('loaded', function(event) { console.log('loaded!'); });
        widget.on('signed', function(event) { console.log('signed!'); });
        widget.on('resized', function(event) {
          console.log('resized!');
          document.getElementById('container').style.height = event.data.height+'px';
        });
      };
    </script>
  </body>
</html>
```

### Boas práticas para o funcionamento

* **Protocolo Seguro:** sempre renderize o Widget através de um servidor, utilizando o protocolo HTTP ou HTTPS no ambiente Sandbox e exclusivamente HTTPS no ambiente de Produção. Isso garante a segurança do Widget e previne erros de autenticação.
* **Uso em Aplicativos:** se o Widget estiver sendo implementado em um aplicativo, recomendamos usar um asterisco (\*) no atributo `widget.origin` para garantir que os callbacks sejam recebidos adequadamente.
* **Recebimento de Callbacks:** para que os callbacks funcionem corretamente, é necessário que seu site ou web app esteja hospedado em um servidor web, seguindo as instruções de Protocolo Seguro.

<Footer3 />