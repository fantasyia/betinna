---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Pastas

Listar Pastas

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
    "/folders": {
      "get": {
        "summary": "Listar Pastas",
        "description": "Listar Pastas",
        "operationId": "api-listar-pastas",
        "parameters": [
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
            "name": "filter[in_root]",
            "schema": {
              "type": "boolean"
            },
            "description": "Informe por boleano se deseja listar apenas pastas na raiz de sua estrutura de pastas."
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Ok": {
                    "value": "{\n\t\"data\": [\n\t\t{\n\t\t\t\"id\": \"da1bd331-93f2-4943-b239-3f3fe486852b\",\n\t\t\t\"type\": \"folders\",\n\t\t\t\"links\": {\n\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/folders/da1bd331-93f2-4943-b239-3f3fe486852b\"\n\t\t\t},\n\t\t\t\"attributes\": {\n\t\t\t\t\"name\": \"Pasta Pessoal\",\n\t\t\t\t\"path\": \"\",\n\t\t\t\t\"in_root\": true,\n\t\t\t\t\"created\": \"2024-12-20T15:49:10.089-03:00\",\n\t\t\t\t\"modified\": \"2024-12-20T15:49:10.093-03:00\"\n\t\t\t}\n\t\t},\n\t\t{\n\t\t\t\"id\": \"e91f5c91-9402-4fb7-87c3-189315db9b4f\",\n\t\t\t\"type\": \"folders\",\n\t\t\t\"links\": {\n\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/folders/e91f5c91-9402-4fb7-87c3-189315db9b4f\"\n\t\t\t},\n\t\t\t\"attributes\": {\n\t\t\t\t\"name\": \"SubPasta Pessoal\",\n\t\t\t\t\"path\": \"/Pasta Pessoal\",\n\t\t\t\t\"in_root\": false,\n\t\t\t\t\"created\": \"2024-12-20T15:49:41.784-03:00\",\n\t\t\t\t\"modified\": \"2024-12-20T15:49:41.787-03:00\"\n\t\t\t}\n\t\t}\n\t],\n\t\"meta\": {\n\t\t\"record_count\": 2\n\t},\n\t\"links\": {\n\t\t\"first\": \"https://sandbox.clicksign.com/api/v3/folders?page%5Bnumber%5D=1&page%5Bsize%5D=20\",\n\t\t\"last\": \"https://sandbox.clicksign.com/api/v3/folders?page%5Bnumber%5D=1&page%5Bsize%5D=20\"\n\t}\n}"
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
                            "example": "da1bd331-93f2-4943-b239-3f3fe486852b"
                          },
                          "type": {
                            "type": "string",
                            "example": "folders"
                          },
                          "links": {
                            "type": "object",
                            "properties": {
                              "self": {
                                "type": "string",
                                "example": "https://sandbox.clicksign.com/api/v3/folders/da1bd331-93f2-4943-b239-3f3fe486852b"
                              }
                            }
                          },
                          "attributes": {
                            "type": "object",
                            "properties": {
                              "name": {
                                "type": "string",
                                "example": "Pasta Pessoal"
                              },
                              "path": {
                                "type": "string",
                                "example": ""
                              },
                              "in_root": {
                                "type": "boolean",
                                "example": true,
                                "default": true
                              },
                              "created": {
                                "type": "string",
                                "example": "2024-12-20T15:49:10.089-03:00"
                              },
                              "modified": {
                                "type": "string",
                                "example": "2024-12-20T15:49:10.093-03:00"
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
                          "example": 2,
                          "default": 0
                        }
                      }
                    },
                    "links": {
                      "type": "object",
                      "properties": {
                        "first": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/folders?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        },
                        "last": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/folders?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Bad Request": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Filtro não permitido\",\n\t\t\t\"detail\": \"name não é permitido\",\n\t\t\t\"code\": \"102\",\n\t\t\t\"status\": \"400\"\n\t\t}\n\t]\n}"
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
                            "example": "Filtro não permitido"
                          },
                          "detail": {
                            "type": "string",
                            "example": "name não é permitido"
                          },
                          "code": {
                            "type": "string",
                            "example": "102"
                          },
                          "status": {
                            "type": "string",
                            "example": "400"
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