---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Detalhes do Requisito

Visualizar estado atual do Requisito.

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
    "/envelopes/{envelope_id}/requirements/{requirement_id}": {
      "get": {
        "summary": "Detalhes do Requisito",
        "description": "Visualizar estado atual do Requisito.",
        "operationId": "detalhes-do-requisito",
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
            "description": "ID do Envelope que possui os requisitos",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "requirement_id",
            "in": "path",
            "description": "ID do Requisito que deseja visualizar",
            "schema": {
              "type": "string"
            },
            "required": true
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"cc13fa02-c4f1-45ba-9136-ea0d751a5ec1\",\n\t\t\"type\": \"requirements\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/d94c0347-e1e7-42d6-af99-f5f4c68392df/requirements/cc13fa02-c4f1-45ba-9136-ea0d751a5ec1\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"action\": \"agree\",\n\t\t\t\"role\": \"party\",\n\t\t\t\"rubric_pages\": null,\n\t\t\t\"created\": \"2024-03-20T14:36:47.865-03:00\",\n\t\t\t\"modified\": \"2024-03-20T14:36:47.865-03:00\"\n\t\t}\n\t}\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "example": "cc13fa02-c4f1-45ba-9136-ea0d751a5ec1"
                        },
                        "type": {
                          "type": "string",
                          "example": "requirements"
                        },
                        "links": {
                          "type": "object",
                          "properties": {
                            "self": {
                              "type": "string",
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/d94c0347-e1e7-42d6-af99-f5f4c68392df/requirements/cc13fa02-c4f1-45ba-9136-ea0d751a5ec1"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "action": {
                              "type": "string",
                              "example": "agree"
                            },
                            "role": {
                              "type": "string",
                              "example": "party"
                            },
                            "rubric_pages": {},
                            "created": {
                              "type": "string",
                              "example": "2024-03-20T14:36:47.865-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-03-20T14:36:47.865-03:00"
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
          "404": {
            "description": "404",
            "content": {
              "application/json": {
                "examples": {
                  "Not Found": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por 305b7b99-7669-4b1b-b0a9-7cbf61ffc681 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por 305b7b99-7669-4b1b-b0a9-7cbf61ffc681 não pôde ser encontrado"
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