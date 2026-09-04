---
updatedAt: 2026-06-17T20:30:40.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Eventos de um Documento

Listar eventos de um Documento do Envelope

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
    "/envelopes/{envelope_id}/documents/{document_id}/events": {
      "get": {
        "summary": "Eventos de um Documento",
        "description": "Listar eventos de um Documento do Envelope",
        "operationId": "eventos-de-um-documento",
        "parameters": [
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do envelope ao qual o documento pertence para consultar eventos",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "document_id",
            "in": "path",
            "description": "ID do Documento que deseja listar os eventos",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "Authorization",
            "in": "header",
            "description": "Access Token gerado pelo gestor da conta",
            "schema": {
              "type": "string"
            }
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
            "in": "query",
            "name": "filter[name]",
            "schema": {
              "type": "string"
            },
            "description": "Parametro utilizado para filtrar eventos por nome. Informe um dos status listados aqui https://developers.clicksign.com/docs/eventos"
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": [\n    {\n\t\t\t\"id\": \"9f1fefdb-bb5c-4c84-9419-baecf6aff610\",\n\t\t\t\"type\": \"events\",\n\t\t\t\"attributes\": {\n\t\t\t\t\"name\": \"upload\",\n\t\t\t\t\"data\": {\n\t\t\t\t\t\"user\": {\n\t\t\t\t\t\t\"email\": \"example@example.com\",\n\t\t\t\t\t\t\"name\": \"Signer Name\"\n\t\t\t\t\t},\n\t\t\t\t\t\"account\": {\n\t\t\t\t\t\t\"key\": \"c710d54e-38df-4945-b750-2887da0a6aa2\"\n\t\t\t\t\t},\n\t\t\t\t\t\"deadline_at\": \"2024-04-18T15:18:52.599-03:00\",\n\t\t\t\t\t\"auto_close\": true,\n\t\t\t\t\t\"locale\": \"pt-BR\"\n\t\t\t\t},\n\t\t\t\t\"created\": \"2024-03-18T15:18:52.743-03:00\"\n\t\t\t}\n\t\t}\n\t],\n\t\"meta\": {\n\t\t\"record_count\": 1\n\t},\n\t\"links\": {\n\t\t\"first\": \"https://sandbox.clicksign.dev/api/v3/events?page%5Bnumber%5D=1&page%5Bsize%5D=20\",\n\t\t\"last\": \"https://sandbox.clicksign.dev/api/v3/events?page%5Bnumber%5D=1&page%5Bsize%5D=20\"\n\t}\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "example": "9f1fefdb-bb5c-4c84-9419-baecf6aff610"
                          },
                          "type": {
                            "type": "string",
                            "example": "events"
                          },
                          "attributes": {
                            "type": "object",
                            "properties": {
                              "name": {
                                "type": "string",
                                "example": "upload"
                              },
                              "data": {
                                "type": "object",
                                "properties": {
                                  "user": {
                                    "type": "object",
                                    "properties": {
                                      "email": {
                                        "type": "string",
                                        "example": "example@example.com"
                                      },
                                      "name": {
                                        "type": "string",
                                        "example": "Signer Name"
                                      }
                                    }
                                  },
                                  "account": {
                                    "type": "object",
                                    "properties": {
                                      "key": {
                                        "type": "string",
                                        "example": "c710d54e-38df-4945-b750-2887da0a6aa2"
                                      }
                                    }
                                  },
                                  "deadline_at": {
                                    "type": "string",
                                    "example": "2024-04-18T15:18:52.599-03:00"
                                  },
                                  "auto_close": {
                                    "type": "boolean",
                                    "example": true,
                                    "default": true
                                  },
                                  "locale": {
                                    "type": "string",
                                    "example": "pt-BR"
                                  }
                                }
                              },
                              "created": {
                                "type": "string",
                                "example": "2024-03-18T15:18:52.743-03:00"
                              }
                            }
                          }
                        }
                      }
                    },
                    "meta": {
                      "type": "object",
                      "properties": {
                        "record_count": {
                          "type": "integer",
                          "example": 1,
                          "default": 0
                        }
                      }
                    },
                    "links": {
                      "type": "object",
                      "properties": {
                        "first": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.dev/api/v3/events?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        },
                        "last": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.dev/api/v3/events?page%5Bnumber%5D=1&page%5Bsize%5D=20"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por 1108816e-a8da-41ed-b9e9-8d5111eb1f02 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por 1108816e-a8da-41ed-b9e9-8d5111eb1f02 não pôde ser encontrado"
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