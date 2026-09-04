---
updatedAt: 2026-05-27T10:41:18.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Renovação do Certificado SAML

O SSO (Single Sign-On) via SAML utiliza certificados digitais para garantir a segurança da comunicação entre o seu Provedor de Identidade (IdP) e a Clicksign.

<br />

# 🛠️ Guia Técnico: Renovação de Certificados SAML (SSO)

O SSO da Clicksign utiliza o protocolo SAML para autenticação e depende da validade dos certificados digitais contidos nos metadados XML.

Se o certificado expirar, a relação de confiança entre o **IdP** (Identity Provider) e a **Clicksign** falhará, resultando em erros de autenticação para todos os usuários.

### 🔴 O Impacto da Expiração

Diferente de uma falha de software, a expiração de um certificado SAML causa uma **interrupção total e imediata**

* **Erro comum:** `SAML Response signature validation failed`.
* **Consequência:** `HTTP 401` ou `403` no callback de autenticação.

***

### 🔄 Fluxo de Atualização

A atualização na Clicksign é simples, mas deve ser coordenada para evitar falhas no login

#### 1. Obter o novo arquivo XML de metadados no seu IdP

O primeiro passo deve ser realizado dentro do painel de administração do provedor que a sua empresa utiliza.

* Acesse o painel de administração do seu Provedor de Identidade (IdP)  (ex: Console de Administração do Google, Portal Azure/Entra ID, Painel Okta).
* Localize a aplicação da Clicksign configurada para o SSO.
* Procure pela seção de **Certificados SAML** ou **SAML Signing Certificate**.
* Gere um novo certificado ou, se o seu IdP já o renovou automaticamente, localize a opção para baixar o Arquivo de **Metadados XML** (Federation Metadata XML).
  * Nota: Guarde este arquivo no seu computador, garantindo que a extensão é .xml.

#### 2. Atualizar o arquivo XML na Clicksign

Com o novo arquivo XML em mãos, a atualização na plataforma Clicksign é simples e imediata.

* Faça login na **Clicksign** como **Administrador**.
* No menu lateral, clique em **Configurações** e, em seguida, na aba **Segurança**.
* Localize a seção dedicada ao **Single Sign-On (SSO)**.
* Clique no botão para atualizar ou substituir o **Arquivo de Metadados/XML**..
* Clique em Enviar arquivo.

<br />

<Footer3 />

<br />