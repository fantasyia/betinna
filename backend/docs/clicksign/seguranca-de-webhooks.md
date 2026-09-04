---
updatedAt: 2026-08-06T20:45:59.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Segurança de Webhooks

# Protegendo o seu endpoint

Para a Clicksign se comunicar com a sua aplicação, você precisará de uma URL pública acessível. Sugerimos que a URL seja protegida para que requisições maliciosas não possam manipular seus dados.

**Requisições HTTPS**
Para garantir que os dados sejam criptografados, sugerimos **fortemente** a utilização de `HTTPS` na URL do seu *webhook*.

**Autenticação básica HTTP**
Servidores web podem ser configurados para utilizarem autenticação básica HTTP requerendo usuário e senha para acessar uma URL. Você pode configurar a URL do seu *webhook* passando usuário e senha através da URL. Exemplo:  `https://username:password@www.example.com/webhook`.

**Restrição de IPs via firewall**
Se você estiver utilizando firewall, poderá configurá-lo para aceitar apenas requisições dos IPs dos *webhooks* da Clicksign:

| Ambiente | IP Fixo para disparo dos webhooks |
| :------- | :-------------------------------- |
| Produção | 34.204.113.69                     |
| Sandbox  | 3.232.199.65                      |

# HMAC

## Introdução ao HMAC

HMAC é uma forma de verificar a integridade das informações transmitidas em um meio não confiável, i.e. a Internet, através de uma chave secreta compartilhada entre as partes para validar as informações transmitidas.

<Image src="https://files.readme.io/46d2d1d-buildingweb9_5.jpg" alt="444" align="center" width="80%" caption="Fonte: gendo o seu endpoint" />

Quando um novo *webhook* é cadastrado, automaticamente é gerado um código **HMAC SHA256 Secret**. O objetivo dele é permitir que se tenha certeza de que o *webhook* foi enviado pela Clicksign e que os dados não foram comprometidos.

A cada disparado de *webhook*, a Clicksign calcula o Hash SHA256 da soma do Body da requisição com o Secret e adiciona essa informação ao cabeçalho.  Exemplo: `Content-Hmac: sha256=20dbdb06a522fb5046722c671bcf31f12be45485c425b6652c940546c397ea53`.

O servidor que receber a requisição deve fazer o mesmo cálculo de Hash para verificar se a requisição de fato veio da Clicksign e de que os dados não foram comprometidos. Para isso, basta calcular o Hash SHA256 da soma do Body da requisição recebida com o Secret já conhecido. O valor deve ser igual ao enviado no cabeçalho da requisição.

## Validador online de HMAC

<a href="https://www.devglan.com/online-tools/hmac-sha256-online" target="_blank">[https://www.devglan.com/online-tools/hmac-sha256-online](https://www.devglan.com/online-tools/hmac-sha256-online "https://www.devglan.com/online-tools/hmac-sha256-online")</a>

Utilize esta ferramenta informando o `Body` da requisição e o Secret. O resultado deverá ser o valor recebido no cabeçalho da requisição. Atenção: não formate o JSON antes do cálculo.

## Exemplos de códigos

* <a href="http://php.net/manual/en/function.hash-hmac.php" target="_blank">PHP</a>
* <a href="https://msdn.microsoft.com/en-us/library/system.security.cryptography.hmacsha256(v=vs.110).aspx" target="_blank">C#</a>
* <a href="https://nodejs.org/api/crypto.html#crypto_class_hmac" target="_blank">Node.js</a>
* <a href="https://ruby-doc.org/stdlib-2.4.0/libdoc/openssl/rdoc/OpenSSL/HMAC.html" target="_blank">Ruby</a>
* <a href="https://stackoverflow.com/a/11804805" target="_blank">Java</a>

## Mais informações sobre HMAC

* <a href="https://tools.ietf.org/html/rfc2104" target="_blank">RFC 2104 - IETF</a>
* <a href="https://pt.wikipedia.org/wiki/HMAC" target="_blank">Wikipédia</a>
* <a href="https://pt.stackoverflow.com/questions/190008/o-que-é-o-hmac" target="_blank">Stack Overflow</a>

<Footer3 />