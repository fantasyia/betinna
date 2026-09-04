---
updatedAt: 2026-02-19T01:45:27.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Membros

Relação de Usuário com Conta

**Bem-vindo à página de referência dos endpoints de Membros da Clicksign!**

Abaixo, você encontrará uma lista detalhada de todos os endpoints disponíveis para criar, editar e deletar membros de uma conta usando nossa API. Lembrando que, os endpoints listados abaixo só ficam disponíveis para utilização por contas que possuam o login via **SSO habilitado**. Cada endpoint é acompanhado por uma breve descrição de sua função, permitindo que você integre nossa API em sua aplicação com facilidade.:

## Endpoints Disponíveis

#### 1. Criar membro

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_post" data-testid="http-method">POST</span>
* **Endpoint:`/memberships`**
* **Descrição:** Cadastra um usuário em uma conta
* **URL:** [Página de Referência](/v3.0/reference/api-criar-membro).

#### 2. Editar Membership:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_put" data-testid="http-method">PUT</span>
* **Endpoint:`/memberships/{id}`**
* **Descrição:** Edita informações da relação entre usuário e conta
* **URL:** [Página de Referência](/v3.0/reference/api-editar-membro).

#### 3. Deletar Membership:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_delete" data-testid="http-method">DELETE</span>
* **Endpoint:`/memberships/{id}`**
* **Descrição:** Remove o usuário de uma conta
* **URL:** [Página de Referência](/v3.0/reference/api-deletar-membro).

#### 4. Listar Membros:

* **Método:** <span class="APIMethod APIMethod_fixedWidth APIMethod_get" data-testid="http-method">GET</span>
* **Endpoint:`/memberships`**
* **Descrição:** Lista os membros de uma conta com opção de filtrar pelo ***user\_id***
* **URL:** [Página de Referência](/v3.0/reference/api-listar-membros).

## Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).