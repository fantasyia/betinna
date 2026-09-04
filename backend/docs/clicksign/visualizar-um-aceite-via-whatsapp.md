---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /acceptance_term/whatsapps/{aceite_id}

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
    "/acceptance_term/whatsapps/{aceite_id}": {
      "get": {
        "description": "",
        "operationId": "get_acceptance_termwhatsapps{aceite_id}",
        "responses": {
          "200": {
            "description": "Ok",
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
                      "data": {
                        "id": "8ef24002-f0f7-4142-b6b3-89067377fb2f",
                        "type": "acceptance_term_whatsapps",
                        "attributes": {
                          "sender_phone": null,
                          "signer_phone": "11987654321",
                          "signer_name": "Nome do Signatário",
                          "sender_name_option": "account_name",
                          "sent_at": null,
                          "status": "enqueued",
                          "status_flow": "introduction",
                          "title": "teste",
                          "message": "test",
                          "created": "2025-12-04T14:27:23.668-03:00",
                          "modified": "2025-12-04T14:27:23.668-03:00"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Not Found": {
                    "summary": "Not Found",
                    "value": {
                      "errors": [
                        {
                          "title": "Registro não encontrado",
                          "detail": "O registro identificado por 8ef24002-f0f7-4142-b6b3-89067377fb1f não pôde ser encontrado",
                          "code": "404",
                          "status": "404"
                        }
                      ]
                    }
                  }
                }
              }
            },
            "description": "Not Found"
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
            "in": "path",
            "name": "aceite_id",
            "schema": {
              "type": "string"
            },
            "required": true
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
            "description": "Access Token gerado pelo gestor da conta",
            "required": true
          },
          {
            "in": "header",
            "name": "Content-type",
            "schema": {
              "type": "string",
              "default": "application/vnd.api+json",
              "enum": [
                "application/vnd.api+json"
              ]
            },
            "description": "Content-type padrão para todas requisições JSON:API application/vnd.api+json"
          }
        ]
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