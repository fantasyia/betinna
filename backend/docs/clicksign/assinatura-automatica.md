---
updatedAt: 2026-06-04T10:33:47.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 2.5. Assinatura Automática

### **O que é a Assinatura Automática?**

A funcionalidade de Assinatura Automática é uma nova forma de simplificar e agilizar o processo de assinatura de documentos, permitindo que signatários designados tenham seus documentos automaticamente assinados sem a necessidade de interação manual.

Tradicionalmente, os signatários recebem notificações por e-mail ou WhatsApp para acessar e assinar documentos. A Assinatura Automática elimina essa etapa para signatários específicos. Uma vez que o documento é configurado, os signatários designados para a assinatura automática terão sua assinatura aplicada automaticamente quando chegar sua vez de assinar, tornando o fluxo de trabalho mais rápido e eficiente.

### **Como funciona?**

A Assinatura Automática permite que um signatário aplique sua assinatura em documentos sem precisar interagir manualmente em cada caso.

Para que isso funcione, é necessário que o signatário tenha previamente assinado um Termo de Assinatura Automática junto ao operador (a parte que envia os documentos).
Esse termo é um pré-requisito obrigatório e garante a validade e a conformidade legal da assinatura.

<Callout icon="⚠️" theme="warn">
  Importante: a função está disponível para contas registradas como "pessoa jurídica".
</Callout>

***

### **Etapas do Processo**

#### &#x20;**1. Configuração da conta**

Acesse app.clicksign.com com um usuário **administrador**.
No menu lateral esquerdo, vá em **Configurações > Informações**.
Preencha os dados da empresa:

* **Nome da empresa**
* **CNPJ**
* **Razão social**

Essas informações serão utilizadas automaticamente na geração do termo.

Ainda em **Configurações > API**, defina um **usuário como API.** Esse usuário será utilizado para autenticação e chamadas de integração.

***

#### **2. Solicitação do Termo de Assinatura Automática**

Solicite o termo seguindo os passos descritos na seção <Anchor label="Termo de Assinatura Automática" target="_blank" href="https://developers.clicksign.com/reference/termo-assinatura-automatica#/">Termo de Assinatura Automática</Anchor> da documentação.

O termo será gerado pela plataforma para ser assinado.

***

#### **3. Assinatura do termo**

O termo deve ser assinado por:

* Um usuário administrador da conta, e
* O signatário que será configurado para usar assinatura automática.

Somente após essa etapa o signatário estará habilitado para criação.

***

#### **4. Criação e ativação do envelope via API**

[Crie o envelope](https://developers.clicksign.com/docs/envelope) e configure os documentos normalmente pela API.

Para definir um signatário com assinatura automática, inclua a configuração:

```json
"auth": "auto_signature"
```

Os signatários devem ser criados exatamente conforme signatário criado para usar a assinatura automática no passo 2 desta seção com os seguintes campos obrigatórios **preenchidos**:

* name
* email
* birthday
* documentation

***

#### **5. Validação automática do termo**

A API verifica automaticamente se o signatário possui um Termo de Assinatura Automática válido e assinado no momento do <Anchor label="cadastro do requisito de autenticação do signatário" target="_blank" href="https://developers.clicksign.com/docs/tipos-de-requisitos-de-autenticacao#conhe%C3%A7a-as-autentica%C3%A7%C3%B5es-poss%C3%ADveis">cadastro do requisito de autenticação do signatário</Anchor>.

Caso o termo esteja em vigor, a assinatura do signatário será aplicada de forma **automática** quando chegar sua vez no fluxo de assinatura.

***

Essa funcionalidade é ideal para otimizar processos internos ou para fluxos de trabalho onde a agilidade é crucial e há um acordo prévio com os signatários para esse tipo de procedimento.

<Footer3 />