---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /acceptance_term/whatsapps/{acceptance_term_id}

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
    "/acceptance_term/whatsapps/{acceptance_term_id}": {
      "patch": {
        "description": "",
        "operationId": "patch_acceptance_termwhatsapps{acceptance_term_id}",
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
                      "data": {
                        "id": "4eff5297-4847-4873-a92f-90351300c3b3",
                        "type": "acceptance_term_whatsapps",
                        "attributes": {
                          "sender_phone": null,
                          "signer_phone": "11987654321",
                          "signer_name": "Nome do Signatário",
                          "sender_name_option": "account_name",
                          "sent_at": null,
                          "status": "canceled",
                          "status_flow": "introduction",
                          "title": "teste",
                          "message": "test",
                          "created": "2025-12-04T16:13:01.797-03:00",
                          "modified": "2025-12-04T16:13:17.329-03:00"
                        }
                      }
                    }
                  }
                }
              }
            }
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
                            "pointer": "/data/attributes/status"
                          },
                          "detail": "status deve estar em: canceled"
                        }
                      ]
                    }
                  }
                }
              }
            },
            "description": "Bad Request"
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
                          "detail": "O registro identificado por 4eff5297-4847-4873-a92f-90351300c2b3 não pôde ser encontrado",
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
            "name": "acceptance_term_id",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "ID do aceite via whatsapp"
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
              "type": "string"
            },
            "description": "Content-type padrão para todas requisições JSON:API (application/vnd.api+json).",
            "required": true
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
                      "id": {
                        "type": "string",
                        "description": "ID do aceite a ser alterado"
                      },
                      "type": {
                        "type": "string",
                        "enum": [
                          "acceptance_term_whatsapps"
                        ],
                        "default": "acceptance_term_whatsapps"
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "status": {
                            "type": "string",
                            "description": "Status que deseja alterar no aceite.",
                            "enum": [
                              "canceled"
                            ]
                          }
                        },
                        "required": [
                          "status"
                        ]
                      }
                    },
                    "required": [
                      "id",
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
        }
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