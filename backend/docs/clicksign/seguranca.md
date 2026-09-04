---
updatedAt: 2026-05-27T10:43:21.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Segurança

Protocolos e cifras aceitos pela Clicksign

# Protocolos de Segurança da Clicksign

A segurança é um dos pilares fundamentais da Clicksign, e por isso nos comprometemos a aplicar as melhores práticas do mercado.

## Protocolos TLS

Toda comunicação entre cliente e servidor é realizada através do protocolo HTTPS (HTTP sobre TLS). Requisições em HTTP são redirecionadas automaticamente para HTTPS. A plataforma Clicksign é compatível apenas com o protocolo **TLS 1.2**. *Foram encontradas falhas de segurança nas versões TLS 1.0 e TLS 1.1 e SSL, o que motivou o<a href="https://blog.pcisecuritystandards.org/migrating-from-ssl-and-early-tls" target="_blank">conselho de segurança PCI</a> a emitir uma regra descontinuando o suporte a estas versões.*

## Cifras TLS

A Clicksign suporta exclusivamente as seguintes cifras TLS:

```
ECDHE-ECDSA-AES128-GCM-SHA256
ECDHE-RSA-AES128-GCM-SHA256
ECDHE-ECDSA-AES128-SHA256
ECDHE-RSA-AES128-SHA256
ECDHE-ECDSA-AES256-GCM-SHA384
ECDHE-RSA-AES256-GCM-SHA384
ECDHE-ECDSA-AES256-SHA384
ECDHE-RSA-AES256-SHA384
AES128-GCM-SHA256
AES128-SHA256
AES256-GCM-SHA384
AES256-SHA256
```

Recomendamos utilizar o site <a href="https://www.ssllabs.com/ssltest/analyze.html?d=app.clicksign.com" target="_blank">Qualys SSL Labs</a> para realizar uma varredura nos protocolos e conexões da plataforma Clicksign.

## Compatibilidade

Se você encontrar algum erro de conexão, verifique se não está utilizando um protocolo TLS diferente de 1.2. Todos os *frameworks* e linguagens de programação modernos suportam o TLS 1.2 sem necessidade de configurações adicionais.

As seguintes linguagens de programação e bibliotecas requerem ação obrigatória:

<details>
  <summary><b>Servidores Linux / Unix</b></summary>

  <p style={{ paddingTop: "10px" }}>
    É necessário que o <b>OpenSSL</b> seja <b>igual ou superior às versões 1.0.1 e 10.1</b> para ambientes <b>FreeBSD</b>.
  </p>
</details>

<details>
  <summary><b>Java 6u45 / 7u45</b></summary>

  <p style={{ paddingTop: "10px" }}>
    Versões não compatíveis com o protocolo TLS 1.2.
  </p>
</details>

<details>
  <summary><b>Servidores Windows</b></summary>

  <p style={{ paddingTop: "10px" }}>
    É necessário seguir as recomendações <a href="https://support.microsoft.com/pt-br/kb/245030" target="_blank">deste artigo</a>.

    <br />

    <br />

    .NET framework versão menor que 4.5 (não suporta TLS 1.2)

    <br />

    .NET framework versão 4.5 (necessário habilitar opção explícita para suportar TLS 1.2). Verifique <a href="https://msdn.microsoft.com/en-us/library/system.security.authentication.sslprotocols(v=vs.110).aspx" target="_blank">este artigo</a>.

    <br />

    <br />

    Para criação de um canal seguro, acrescentar as linhas abaixo:

    <br />
  </p>

```csharp
ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
ServicePointManager.ServerCertificateValidationCallback += (sender, cert, chain, sslPolicyErrors) => true;
```

</details>

<br />

Se a sua integração utilizar alguma das tecnologias acima, por favor efetue a atualização do seu ambiente o mais rápido possível.

<Footer3 />

<br />