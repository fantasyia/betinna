---
updatedAt: 2025-10-09T17:56:22.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Fluxo da Assinatura Presencial

Resumo do Fluxo Completo da Assinatura Presencial

O presente guia detalha o processo de utilização da **API v3 da Clicksign** para configurar um **Envelope com Assinatura Presencial**.

O objetivo principal deste fluxo é garantir que a assinatura de um signatário seja validada através de um **Token Presencial**, o que exige a criação de um **Requisito de Evidência Presencial** no documento. Essa modalidade é intrinsecamente ligada à figura do **Anfitrião de Assinatura (signature\_host)**, que é o responsável por supervisionar o ato físico da assinatura.

A sequência de passos apresentada a seguir orienta sobre como criar o envelope, o documento, o signatário com o anfitrião, e como adicionar os requisitos necessários para disparar esse processo de autenticação diferenciado.

## Sequência de Endpoints

1. **POST /envelopes:** [Criação do Envelope](/reference/api-criar-envelope).
2. **POST /envelopes/:envelope\_id/documents**: [Adição do Documento ao Envelope](/reference/api-upload-documentos).
3. **POST /envelopes/:envelope\_id/signers**: [Criação do Signatário](/reference/api-criar-signatario), obrigando a inclusão do objeto signature\_host.
4. **POST /envelopes/:envelope\_id/requirements**: [Criação do Requisito de Qualificação](/reference/criar-requisito-qualificacao) (action: "agree", role: "sign").
5. **POST /envelopes/:envelope\_id/requirements**: [Criação do Requisito de Evidência Presencial](/reference/criar-requisito-de-autenticacao) (action: "provide\_evidence", auth: "presential").
6. **PATCH /envelopes/:envelope\_id:** [Ativação do Envelope](/reference/api-editar-envelope) (status: "running").
7. **POST /envelopes/:envelope\_id/notifications:** [Envio da Notificação](/reference/api-notificar-envelope) (que aciona a geração do token e notifica as partes interessadas).

<Recipe slug="assinatura-presencial" title="Assinatura presencial" />

<br />

<Callout icon="🚧">
  **Atenção**

  A assinatura presencial requer obrigatoriamente um `signature_host` (anfitrião) configurado no signatário. O anfitrião será responsável por supervisionar fisicamente a assinatura e receberá o token presencial por email.
</Callout>

## Fluxo Completo de Criação

### 1. Criar o Envelope

Para mais detalhes sobre os parâmetros e opções disponíveis durante a criação de um envelope, consulte a [referência completa de envelope.](/reference/envelope-campos-e-regras-de-negocio#/)

| Atributo             | Descrição                       | Exemplo               |
| -------------------- | ------------------------------- | --------------------- |
| `name` *Obrigatório* | Nome identificador do envelope. | Meu Primeiro Envelope |

**Endpoint:** `POST /api/v3/envelopes`

```bash
curl --request POST \
  --url https://sandbox.clicksign.com/api/v3/envelopes \
  --header 'Authorization: {{token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
  "data": {
    "type": "envelopes",
    "attributes": {
      "name": "Meu Primeiro Envelope"
    }
  }
}'
```

### 2. Adicionar Documento ao Envelope

| Atributo                       | Descrição                                             | Exemplo                                 |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------- |
| `filename` *Obrigatório*       | Nome do arquivo do documento.                         | ContratoPresentencial.pdf               |
| `content_base64` *Obrigatório* | Conteúdo do documento em base64 com prefixo data URI. | data:application/pdf;base64,JVBERi0x... |

**Endpoint:** `POST /api/v3/envelopes/:envelope_id/documents`

```bash
curl --request POST \
  --url https://sandbox.clicksign.com/api/v3/envelopes/{{envelope_id}}/documents \
  --header 'Authorization: {{token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
  "data": {
    "type": "documents",
    "attributes": {
      "filename": "ContratoPresenticial.pdf",
      "content_base64": "data:application/pdf;base64,JVBERi0xLjcNCiXi48/TDQo0..."
    }
  }
}'
```

### 3. Criar Signatário com Anfitrião

Para mais detalhes sobre os parâmetros e opções disponíveis durante a criação de um Signatário com Anfitrião, consulte a [referência completa de Signatário.](/reference/signatario-campos-e-regras-de-negocio)

| Atributo                             | Descrição                                                  | Exemplo                         |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------- |
| `name` *Obrigatório*                 | Nome completo do signatário.                               | João Silva Santos               |
| `email` *Obrigatório*                | Email do signatário.                                       | <joao.santos@example.com>       |
| `signature_host` *Obrigatório*       | Dados do anfitrião responsável pela supervisão presencial. | Ver estrutura abaixo            |
| `signature_host.name` *Obrigatório*  | Nome completo do anfitrião.                                | Maria Supervisora               |
| `signature_host.email` *Obrigatório* | Email do anfitrião que receberá o token presencial.        | <maria.supervisora@example.com> |
| `signature_host.communicate_events`  | Configuração de comunicação com o anfitrião.               | Ver estrutura abaixo            |
| `communicate_events`                 | Configuração de comunicação com o signatário.              | Ver estrutura abaixo            |

**Endpoint:** `POST /api/v3/envelopes/:envelope_id/signers`

```bash
curl --request POST \
  --url https://sandbox.clicksign.com/api/v3/envelopes/{{envelope_id}}/signers \
  --header 'Authorization: {{token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
    "data": {
        "type": "signers",
        "attributes": {
            "name": "João Silva Santos",
            "email": "joao.santos@example.com",
            "signature_host": {
                "name": "Maria Supervisora",
                "email": "maria.supervisora@example.com",
                "communicate_events": {
                    "signature_host_signature_request": "email"
                }
            },
            "communicate_events": {
                "document_signed": "email",
                "signature_request": "email",
                "signature_reminder": "email"
            }
        }
    }
}'
```

### 4. Criar Requisitos de Assinatura

Para mais detalhes sobre os parâmetros e opções disponíveis durante a criação de um Requisitos, consulte a [referência completa de requisitos.](/reference/api-requisitos)

| Atributo                               | Descrição                                             | Exemplo              |
| -------------------------------------- | ----------------------------------------------------- | -------------------- |
| `action` *Obrigatório*                 | Ação requerida. Para assinatura deve ser "agree".     | agree                |
| `role` *Obrigatório*                   | Papel do signatário. Para assinatura deve ser "sign". | sign                 |
| `relationships.document` *Obrigatório* | Referência ao documento criado anteriormente.         | Ver estrutura abaixo |
| `relationships.signer` *Obrigatório*   | Referência ao signatário criado anteriormente.        | Ver estrutura abaixo |

**Endpoint:** `POST /api/v3/envelopes/:envelope_id/requirements`

```bash
curl --request POST \
  --url https://sandbox.clicksign.com/api/v3/envelopes/{{envelope_id}}/requirements \
  --header 'Authorization: {{token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
  "data": {
    "type": "requirements",
    "attributes": {
        "action": "agree",
        "role": "sign"
    },
    "relationships": {
        "document":{
            "data": { "type": "documents", "id": "{{document_id}}"}
        },
        "signer":{
            "data": { "type": "signers", "id": "{{signer_id}}"}
      }
    }
  }
}'
```

### 5. Criar Requisitos de Evidência Presencial

Para mais detalhes sobre os parâmetros e opções disponíveis durante a criação de um Requisitos, consulte a [referência completa de requisitos.](https://developers.clicksign.com/reference/api-requisitos)

> 🚧 Atenção
>
> Não é permitido usar assinatura presencial com biometria facial em conjunto ao Widget Embedded nesta versão.

# Atributos para cadastrar a assinatura presencial de signatários

Para mais detalhes sobre os parâmetros e opções disponíveis durante a criação de um signatário, consulte a [referência completa de signatário.](https://developers.clicksign.com/reference/api-criar-signatario#/)

| Atributo                               | Descrição                                                               | Exemplo              |
| -------------------------------------- | ----------------------------------------------------------------------- | -------------------- |
| `action` *Obrigatório*                 | Ação requerida. Para evidência presencial deve ser "provide\_evidence". | provide\_evidence    |
| `auth` *Obrigatório*                   | Tipo de autenticação. Para assinatura presencial deve ser "presential". | presential           |
| `relationships.document` *Obrigatório* | Referência ao documento (mesmo do requirement anterior).                | Ver estrutura abaixo |
| `relationships.signer` *Obrigatório*   | Referência ao signatário (mesmo do requirement anterior).               | Ver estrutura abaixo |

**Endpoint:** `POST /api/v3/envelopes/:envelope_id/requirements`

```bash
curl --request POST \
  --url https://sandbox.clicksign.com/api/v3/envelopes/{{envelope_id}}/requirements \
  --header 'Authorization: {{token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
  "data": {
    "type": "requirements",
    "attributes": {
        "action": "provide_evidence",
        "auth": "presential"
    },
    "relationships": {
        "document":{
            "data": { "type": "documents", "id": "{{document_id}}"} 
        },
        "signer":{
            "data": { "type": "signers", "id": "{{signer_id}}"}
      }
    }
  }
}'
```

### 6. Ativar o Envelope

| Atributo               | Descrição                                           | Exemplo |
| ---------------------- | --------------------------------------------------- | ------- |
| `status` *Obrigatório* | Status do envelope. Para ativar deve ser "running". | running |

**Endpoint:** `PATCH /api/v3/envelopes/:envelope_id`

```bash
curl --request PATCH \
  --url https://sandbox.clicksign.com/api/v3/envelopes/{{envelope_id}} \
  --header 'Authorization: {{token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
  "data": {
    "id": "{{envelope_id}}",
    "type": "envelopes",
    "attributes": {
        "status": "running"
    }
  }
}'
```

### 7. Enviar Notificações

Para mais detalhes sobre os parâmetros e opções disponíveis durante a criação de uma Notificação, consulte a [referência completa de Notificações.](https://developers.clicksign.com/reference/api-notificacoes)

| Atributo  | Descrição                                                        | Exemplo |
| --------- | ---------------------------------------------------------------- | ------- |
| `message` | Mensagem personalizada (opcional). Se null, usa mensagem padrão. | null    |

**Endpoint:** `POST /api/v3/envelopes/:envelope_id/notifications`

```bash
curl --request POST \
  --url https://sandbox.clicksign.com/api/v3/envelopes/{{envelope_id}}/notifications \
  --header 'Authorization: {{token}}' \
  --header 'Content-Type: application/vnd.api+json' \
  --data '{
  "data": {
    "type": "notifications",
    "attributes": {
      "message": null
    }
  }
}'
```

## Como Funciona o Processo de Assinatura Presencial

1. **Criação do Token**: Após ativar o envelope, o sistema gera automaticamente um token presencial de 6 caracteres alfanuméricos
2. **Notificação do Anfitrião**: O anfitrião recebe email com o token presencial
3. **Supervisão Presencial**: O anfitrião deve estar fisicamente presente durante a assinatura
4. **Validação do Token**: O signatário insere o token no momento da assinatura
5. **Assinatura Validada**: Após validação do token, a assinatura é processada e registrada como evidência presencial

## Aspectos Técnicos

### Token Presencial

* **Formato**: 6 caracteres alfanuméricos (gerado automaticamente).
* **Validade**: 24 horas.
* **Uso único**: Cada token só pode ser usado uma vez.
* **Expiração**: Tokens expirados não podem ser utilizados.

### Validações do Sistema

* Verificação obrigatória de `signature_host` no signatário.
* Validação de que o requirement de evidência presencial está associado a um signer com signature\_host.
* Controle de expiração e uso único do token.

### Estados do Envelope

* **draft**: Estado inicial, permite modificações
* **running**: Envelope ativo, notifications enviadas, tokens gerados
* **closed**: Todas as assinaturas concluídas

<Callout icon="❗️">
  **Se alguma requisição falhar**

  Sempre verifique o **BODY** da resposta. O retorno da requisição mostrará o motivo pelo qual a requisição não foi aceita pelos servidores da Clicksign.
</Callout>

<br />