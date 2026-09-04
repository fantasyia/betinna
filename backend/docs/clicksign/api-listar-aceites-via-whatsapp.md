---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Aceites via Whastapp

# OpenAPI definition

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "api-v3",
    "version": "2.1"
  },
  "servers": [
    {
      "url": "https://sandbox.clicksign.com/api/v3/"
    }
  ],
  "components": {
    "securitySchemes": {
      "Authorization": {
        "type": "apiKey",
        "in": "header",
        "name": "Authorization"
      }
    }
  },
  "security": [
    {
      "Authorization": []
    }
  ],
  "paths": {
    "/acceptance_term/whatsapps": {
      "get": {
        "description": "",
        "operationId": "get_acceptance_termwhatsapps",
        "responses": {
          "200": {
            "description": "",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "name": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "name"
                  ]
                },
                "examples": {
                  "OK": {
                    "summary": "OK",
                    "value": {
                      "data": [
                        {
                          "id": "35fdeba5-0b49-4ea9-b5ba-8d1ab6adeeca",
                          "type": "acceptance_term_whatsapps",
                          "attributes": {
                            "sender_phone": "(85) 98888-8888",
                            "signer_phone": "85999999999",
                            "signer_name": "Alan Mathison Turing",
                            "sender_name_option": "account_name",
                            "sent_at": "2025-11-11T10:56:03.335-03:00",
                            "status": "expired",
                            "status_flow": "introduction",
                            "title": "123456789",
                            "message": "asdbcasdasd",
                            "created": "2025-11-11T10:54:59.560-03:00",
                            "modified": "2025-11-12T10:56:04.640-03:00"
                          }
                        },
                        {
                          "id": "7e2ad7f7-a99e-4024-9230-536f6767e10d",
                          "type": "acceptance_term_whatsapps",
                          "attributes": {
                            "sender_phone": null,
                            "signer_phone": "11987654321",
                            "signer_name": "Nome do Signatário",
                            "sender_name_option": "account_name",
                            "sent_at": "2025-12-04T14:22:47.518-03:00",
                            "status": "error",
                            "status_flow": "introduction",
                            "title": "teste",
                            "message": "test",
                            "created": "2025-12-04T14:21:46.075-03:00",
                            "modified": "2025-12-04T14:23:20.265-03:00"
                          }
                        },
                        {
                          "id": "8ef24002-f0f7-4142-b6b3-89067377fb2f",
                          "type": "acceptance_term_whatsapps",
                          "attributes": {
                            "sender_phone": null,
                            "signer_phone": "11987654321",
                            "signer_name": "Nome do Signatário",
                            "sender_name_option": "account_name",
                            "sent_at": "2025-12-04T14:28:03.315-03:00",
                            "status": "canceled",
                            "status_flow": "introduction",
                            "title": "teste",
                            "message": "test",
                            "created": "2025-12-04T14:27:23.668-03:00",
                            "modified": "2025-12-04T14:28:25.516-03:00"
                          }
                        },
                        {
                          "id": "f44f6750-fb12-43c9-9b74-c1c18dcca7a3",
                          "type": "acceptance_term_whatsapps",
                          "attributes": {
                            "sender_phone": "",
                            "signer_phone": "85999999999",
                            "signer_name": "Alan Mathison Turing",
                            "sender_name_option": "account_name",
                            "sent_at": "2025-11-11T10:54:32.834-03:00",
                            "status": "canceled",
                            "status_flow": "introduction",
                            "title": "teste",
                            "message": "teste",
                            "created": "2025-11-11T10:54:04.578-03:00",
                            "modified": "2025-11-11T10:55:08.122-03:00"
                          }
                        }
                      ],
                      "meta": {
                        "record_count": 4
                      },
                      "links": {
                        "first": "https://sandbox.clicksign.com/api/v3/acceptance_term/acceptance_term_whatsapps?page%5Bnumber%5D=1&page%5Bsize%5D=20",
                        "last": "https://sandbox.clicksign.com/api/v3/acceptance_term/acceptance_term_whatsapps?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                      }
                    }
                  }
                }
              }
            }
          },
          "503": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Service Unavailable": {
                    "summary": "Service Unavailable",
                    "value": "// O erro pode estar relacionado a não ativação do envelope em sua conta.\n// Entre em contato com o suporte para ativar ajuda@clicksign.com.\n{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"service_unavailable\",\n\t\t\t\"status\": 503,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"Serviço indisponível\"\n\t\t}\n\t]\n}"
                  }
                }
              }
            },
            "description": "Service Unavailable"
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "filter[status]",
            "schema": {
              "type": "string",
              "enum": [
                "enqueued",
                "sent",
                "completed",
                "canceled",
                "refused",
                "expired",
                "error",
                "pending"
              ]
            },
            "description": "Informe o status a ser filtrado"
          },
          {
            "name": "include",
            "in": "query",
            "description": "Informe os relacionamentos que deseja incluir na resposta.",
            "schema": {
              "type": "string",
              "enum": [
                "messages"
              ]
            }
          },
          {
            "in": "header",
            "name": "Authorization",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "Content-type padrão para todas requisições JSON:API"
          }
        ],
        "summary": "Listar Aceites via Whastapp"
      }
    }
  },
  "x-readme": {
    "headers": [],
    "explorer-enabled": true,
    "proxy-enabled": true
  },
  "x-readme-fauxas": true
}
```