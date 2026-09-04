---
updatedAt: 2026-05-27T10:41:18.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Exemplo Prático com Docker

Esta página fornece uma maneira rápida de testar o Widget Embedded da Clicksign utilizando um ambiente Docker pré-configurado.

### Pré-requisitos:

* Instalação do `git`em sua máquina.
* Instalação do `Docker` e `Docker compose` na sua máquina.

### Implementação

#### 1. Obter o Repositório:

Clone o seguinte repositório público do [GitHub](https://github.com/clicksign/embedded-test.git):

```Text bash
git clone https://github.com/clicksign/embedded-test.git
cd embedded-test
```

#### 2. Executar com Docker Compose:

Para subir apenas a aplicação para envelopes, execute o seguinte comando (garanta que seu docker foi iniciado):

```Text bash
docker compose up envelope
```

#### 3. Acessar o Teste:

Após a execução do container, acesse o endereço fornecido (<http://localhost:5174>) no seu navegador para interagir com a página de teste do Widget Embedded.

#### 4. Observações:

* Certifique-se de usar um id de signatário válido para o ambiente.
* O repositório de exemplo conterá um código HTML e JavaScript básico com o Widget Embedded integrado.

<Footer3 />