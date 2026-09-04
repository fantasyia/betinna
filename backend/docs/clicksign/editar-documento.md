---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Editar Documento

Cancelar ou Finalizar um Documento.

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
    "/envelopes/{envelope_id}/documents/{document_id}": {
      "patch": {
        "summary": "Editar Documento",
        "description": "Cancelar ou Finalizar um Documento.",
        "operationId": "editar-documento",
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
            "required": true
          },
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do Envelope que possui o documento",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "document_id",
            "in": "path",
            "description": "ID do documento que deseja atualizar",
            "schema": {
              "type": "string"
            },
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
                        "description": "ID do documento que deseja atualizar"
                      },
                      "type": {
                        "type": "string",
                        "default": "documents",
                        "enum": [
                          "documents"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "status": {
                            "type": "string",
                            "description": "Só é possível alterar status de documentos `running` (em progresso/ativados).",
                            "enum": [
                              "canceled",
                              "closed"
                            ]
                          },
                          "metadata": {
                            "type": "string",
                            "description": "JSON com metadados que são utilizados nos retornos de documentos via webhooks.",
                            "format": "json"
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
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"a727c09e-0410-4019-8252-b9f8f5e7e3a9\",\n\t\t\"type\": \"documents\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://8.clicksign.dev/api/v3/envelopes/2313cf46-0ad9-4c08-944d-99e6843cc26b/documents/a727c09e-0410-4019-8252-b9f8f5e7e3a9\",\n\t\t\t\"files\": {\n\t\t\t\t\"original\": \"https://tavola-staging.s3.amazonaws.com/2024/03/04/18/32/41/9d5aa039-7d4b-4eef-8968-8bdf7ebe856a/contrato3-2024-03-04T15%3A32%3A40.462564-03%3A00.pdf?X-Amz-Expires=299&X-Amz-Date=20240304T183335Z&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEIL%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCID8fkCVNCYl5QfdGBjYaMX%2BH0mbWxcopIylUr0LUQ9kUAiEApI1YY%2FCHblU3zJH9xrE79ynIP%2BjJQu5ExGU3DYLjQa4qsgUIexAAGgw2NzU3NDQ0MTM1NjkiDK4QlPm2ZNvAtkpPHSqPBWodjRT%2FcJfL0QJ7rB2YKRFLfb%2F%2Fg394IlH3A80MGWrQA10iMFMi%2B8DKHSye8Yv2SnOY6ro5yd%2BS144PQjHOxwSOUuZbNlCK5eIRQOPDBGwrhrxOPb3nTGu6H4Jll4nk04OrJVA%2B4nJY%2BIA1sLg0pIliO9BhVL1TWbxUulzaiVaWa8Sd12ICgg5NZpU8n17V2KrMrLegQGIrijPu9A3%2B0dcbdyuxUxARTLSsD%2FgnvICyosnZGklB8cPIfsc5fTi%2B%2BAA4DRfJ7wKNFV4QkyiIf%2FV%2FujRE7K9%2BXSjKjhnS%2BWq4bPlvC0B%2F%2B8JZh685yhXcNSzSazG1ZlQcMFnu3k8lp9kOSk%2FzfDWEnRp1HpQYjdilpCz8jPZlJKZQv40u%2BnoLtkPA%2Bm5TalKzTnBVgCSdVcjOsvrD8WE4poah5kncXmYv3WPrfDrLnDkaDJxTeUy6kdTa9e08OlmtIgG%2BM6sAtHeHucY9gSDgCCK6HdAr2uCUrTSPzUhRLLx1vrbQfyNdws3QD5gFwBgpNMh4ADxkSkMNZjJQCTezdIzkGPokIQ3epmMOzwe7mNrYTJxCgHd%2Baltf%2FfMumkLqwdU5eiYUVjiV0oslg3jlVKLOVnyHo66P3xPoMAXZq7H25nhXHJWVht%2BC1GJQ9zukkjm4AU03joCLNav5J6Fq35r3MAE%2BLSNahG311NvyaJLRQDrD0IEhi%2BNrrRCeWH5Y3wbXR0nTPatjJvaxy%2FXl8MRnH9T1liFrs5oHOjS1T%2FcFicwgs2yHzpxhNi%2BJKLrP2QvYasdIjlwwNUdAi%2BY%2BIO1Sia0iU%2FKY87X7PAPkvB8tdvZ48Q4uireclX2orxJ40i7ag8029vPJ0HaXhyeT15DEddaJzuow3ZWYrwY6sQGw7Hz9Deh3S0heyVlla9jT0XNkEBYjVSpi1BoTpXxaLNYLb2cxfOW%2Fqofdp6n4O%2F48iWMCimWKaq5IYPEVjo4aq71HZNUxYcyj23tViuBUUA6ckbCYh0UpP2aGdLsIxOjF8m5EwGwlcLrJgKyDyQ%2FZRE3qTYMI37HN%2Bv90bFrbCozO0Y78aHz61MP3w1mUtUgetLOeUyW5YztzHbegWLxoSjbCjGInGjfObSkGA1NX3Z4%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIAZ2VMBO6AQQ4A57YY%2F20240304%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=fd0f0ac7b976de3cefbc0ae48f7fbd049fdc900b9b4b4f2ad58984ec8249eb1a\"\n\t\t\t}\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"status\": \"canceled\",\n\t\t\t\"filename\": \"contrato3-2024-03-04T15:32:40.462564-03:00.pdf\",\n\t\t\t\"template\": null,\n      \"metadata\": { \"key\": \"value\": },\n\t\t\t\"created\": \"2024-03-04T15:32:41.297-03:00\",\n\t\t\t\"modified\": \"2024-03-04T15:33:34.806-03:00\"\n\t\t}\n\t}\n}"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/auto_close\"\n\t\t\t},\n\t\t\t\"detail\": \"auto_close não está disponível\"\n\t\t}\n\t]\n}"
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
                            "example": "bad_request"
                          },
                          "status": {
                            "type": "integer",
                            "example": 400,
                            "default": 0
                          },
                          "source": {
                            "type": "object",
                            "properties": {
                              "pointer": {
                                "type": "string",
                                "example": "/data/attributes/auto_close"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "auto_close não está disponível"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por b6248c0c-431d-48b7-b30d-8f47c62c440d não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por b6248c0c-431d-48b7-b30d-8f47c62c440d não pôde ser encontrado"
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
          "422": {
            "description": "422",
            "content": {
              "application/json": {
                "examples": {
                  "Unprocessable Entity": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"documento não pode ser cancelado\",\n\t\t\t\"detail\": \"status - documento não pode ser cancelado\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/status\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n\t]\n}"
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
                            "example": "documento não pode ser cancelado"
                          },
                          "detail": {
                            "type": "string",
                            "example": "status - documento não pode ser cancelado"
                          },
                          "code": {
                            "type": "string",
                            "example": "100"
                          },
                          "source": {
                            "type": "object",
                            "properties": {
                              "pointer": {
                                "type": "string",
                                "example": "/data/attributes/status"
                              }
                            }
                          },
                          "status": {
                            "type": "string",
                            "example": "422"
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