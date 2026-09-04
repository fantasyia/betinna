---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Excluir Envelope

Excluir envelopes que estejam com estado em rascunho (draft)

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
    "/envelopes/{envelope_id}": {
      "delete": {
        "summary": "Excluir Envelope",
        "description": "Excluir envelopes que estejam com estado em rascunho (draft)",
        "operationId": "api-excluir-envelope",
        "parameters": [
          {
            "name": "Authorization",
            "in": "header",
            "description": "Access Token gerado pelo gestor da conta",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "Content-type",
            "in": "header",
            "description": "Content-type padrão para todas requisições JSON:API",
            "schema": {
              "type": "string",
              "enum": [
                "application/vnd.api+json"
              ],
              "default": "application/vnd.api+json"
            }
          },
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do Envelope que deseja atualizar",
            "schema": {
              "type": "string"
            },
            "required": true
          }
        ],
        "responses": {
          "204": {
            "description": "204",
            "content": {
              "application/json": {
                "examples": {
                  "No Content": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          },
          "403": {
            "description": "403",
            "content": {
              "application/json": {
                "examples": {
                  "Forbidden": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"forbidden\",\n\t\t\t\"status\": 403,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"envelope não está com status draft\"\n\t\t}\n\t]\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "errors": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "code": {
                            "type": "string",
                            "example": "forbidden"
                          },
                          "status": {
                            "type": "integer",
                            "example": 403,
                            "default": 0
                          },
                          "title": {
                            "type": "string",
                            "example": "Verificação"
                          },
                          "detail": {
                            "type": "string",
                            "example": "envelope não está com status draft"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "404",
            "content": {
              "application/json": {
                "examples": {
                  "Not Found": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por a3976371-2ed9-4898-8ce7-0c6ede832a95 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "errors": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "title": {
                            "type": "string",
                            "example": "Registro não encontrado"
                          },
                          "detail": {
                            "type": "string",
                            "example": "O registro identificado por a3976371-2ed9-4898-8ce7-0c6ede832a95 não pôde ser encontrado"
                          },
                          "code": {
                            "type": "string",
                            "example": "404"
                          },
                          "status": {
                            "type": "string",
                            "example": "404"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "503": {
            "description": "503",
            "content": {
              "application/json": {
                "examples": {
                  "Service Unavailable": {
                    "value": "// O erro pode estar relacionado a não ativação do envelope em sua conta.\n// Entre em contato com o suporte para ativar ajuda@clicksign.com.\n{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"service_unavailable\",\n\t\t\t\"status\": 503,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"Serviço indisponível\"\n\t\t}\n\t]\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "errors": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "code": {
                            "type": "string",
                            "example": "service_unavailable"
                          },
                          "status": {
                            "type": "integer",
                            "example": 503,
                            "default": 0
                          },
                          "title": {
                            "type": "string",
                            "example": "Verificação"
                          },
                          "detail": {
                            "type": "string",
                            "example": "Serviço indisponível"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "deprecated": false
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