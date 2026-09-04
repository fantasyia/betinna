---
updatedAt: 2026-05-28T19:03:46.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Envelopes

Listar e consultar envelopes

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
    "/envelopes": {
      "get": {
        "summary": "Listar Envelopes",
        "description": "Listar e consultar envelopes",
        "operationId": "api-listar-envelopes",
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
            },
            "required": false
          },
          {
            "name": "filter[status]",
            "in": "query",
            "description": "Informe um status caso deseje filtrar: draft, running, closed, canceled",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "filter[name]",
            "in": "query",
            "description": "Informe o nome completo do envelope a ser consultado",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "filter[created]",
            "in": "query",
            "description": "Informe os intervalos de datas de criação no padrão da especificação",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "filter[modified]",
            "in": "query",
            "description": "Informe os intervalos de datas de atualização no padrão da especificação",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "filter[deadline_at]",
            "in": "query",
            "description": "Informe os intervalos de datas de deadline conforme [padrão da especificação](https://jsonapi.org/recommendations/#filtering) (ISO 8601 e separadas por vírgula)",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "sort",
            "in": "query",
            "description": "Ordene por nome do envelope (name crescente e -name para decrescente)",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": [],\n\t\"meta\": {\n\t\t\"record_count\": 0\n\t},\n\t\"links\": {\n\t\t\"first\": \"https://sandbox.clicksign.com/api/v3/envelopes?page%5Bnumber%5D=1&page%5Bsize%5D=20\",\n\t\t\"last\": \"https://sandbox.clicksign.com/api/v3/envelopes?page%5Bnumber%5D=1&page%5Bsize%5D=20\"\n\t}\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array"
                    },
                    "meta": {
                      "type": "object",
                      "properties": {
                        "record_count": {
                          "type": "integer",
                          "example": 0,
                          "default": 0
                        }
                      }
                    },
                    "links": {
                      "type": "object",
                      "properties": {
                        "first": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/envelopes?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        },
                        "last": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/envelopes?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "401",
            "content": {
              "application/json": {
                "examples": {
                  "Unauthorized": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"unauthorized\",\n\t\t\t\"status\": 401,\n\t\t\t\"title\": \"Não autorizado\",\n\t\t\t\"detail\": \"Access Token inválido\"\n\t\t}\n\t]\n}"
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
                            "example": "unauthorized"
                          },
                          "status": {
                            "type": "integer",
                            "example": 401,
                            "default": 0
                          },
                          "title": {
                            "type": "string",
                            "example": "Não autorizado"
                          },
                          "detail": {
                            "type": "string",
                            "example": "Access Token inválido"
                          }
                        }
                      }
                    }
                  }
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"forbidden\",\n\t\t\t\"status\": 403,\n\t\t\t\"title\": \"Verificação de conta\",\n\t\t\t\"detail\": \"Conta bloqueada, entre em contato com ajuda@clicksign.com\"\n\t\t}\n\t]\n}"
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
                            "example": "Verificação de conta"
                          },
                          "detail": {
                            "type": "string",
                            "example": "Conta bloqueada, entre em contato com ajuda@clicksign.com"
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