---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Copy of Copy of 

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
      "post": {
        "description": "",
        "operationId": "post_acceptance_termwhatsapps",
        "responses": {
          "201": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Created": {
                    "summary": "Created",
                    "value": {
                      "data": {
                        "id": "7e2ad7f7-a99e-4024-9230-536f6767e10d",
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
                          "created": "2025-12-04T14:21:46.075-03:00",
                          "modified": "2025-12-04T14:21:46.075-03:00"
                        }
                      }
                    }
                  }
                }
              }
            },
            "description": "Created"
          },
          "400": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Bad Request": {
                    "summary": "Bad Request",
                    "value": {
                      "errors": [
                        {
                          "code": "bad_request",
                          "status": 400,
                          "source": {
                            "pointer": "/data/attributes/sender_name_option"
                          },
                          "detail": "sender_name_option deve ser informado(a)"
                        }
                      ]
                    }
                  }
                }
              }
            },
            "description": "Bad Request"
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
            "in": "header",
            "name": "Authorization",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "Access Token gerado pelo gestor da conta.\n\n"
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
            "description": "Content-type padrão para todas requisições JSON:API"
          }
        ],
        "requestBody": {
          "content": {
            "application/vnd.api+json": {
              "schema": {
                "type": "object",
                "properties": {
                  "data": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "default": "acceptance_term_whatsapps"
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "title": {
                            "type": "string"
                          },
                          "sender_name_option": {
                            "type": "string",
                            "enum": [
                              "user_name",
                              "account_name",
                              "user_and_account_name"
                            ]
                          },
                          "message": {
                            "type": "string"
                          },
                          "signer_phone": {
                            "type": "string"
                          },
                          "signer_name": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "title",
                          "sender_name_option",
                          "message",
                          "signer_phone",
                          "signer_name"
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "attributes"
                    ]
                  }
                },
                "required": [
                  "data"
                ]
              }
            }
          }
        },
        "summary": "Copy of Copy of "
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