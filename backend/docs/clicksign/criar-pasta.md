---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Pasta

Criar Pastas

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
      "post": {
        "summary": "Criar Pasta",
        "description": "Criar Pastas",
        "operationId": "criar-pasta",
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
                        "default": "folders",
                        "enum": [
                          "folders"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "name": {
                            "type": "string",
                            "description": "Nome da Pasta a ser criada",
                            "default": "Pasta 1"
                          }
                        }
                      },
                      "relationships": {
                        "type": "object",
                        "properties": {
                          "folder": {
                            "type": "object",
                            "properties": {
                              "data": {
                                "type": "object",
                                "properties": {
                                  "type": {
                                    "type": "string",
                                    "enum": [
                                      "folders"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "description": "ID da pasta de origem, onde será criada a pasta atual."
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
          }
        },
        "responses": {
          "201": {
            "description": "201",
            "content": {
              "application/json": {
                "examples": {
                  "Created": {
                    "value": "{\n  \"data\": {\n    \"id\": \"2e600d78-cf8a-4856-9b9a-3d90ae44563c\",\n    \"type\": \"folders\",\n    \"links\": {\n      \"self\": \"https://sandbox.clicksign.com/api/v3/folders/2e600d78-cf8a-4856-9b9a-3d90ae44563c\"\n    },\n    \"attributes\": {\n      \"name\": \"Pasta 1\",\n      \"path\": \"\",\n      \"in_root\": true,\n      \"created\": \"2024-06-28T17:56:22.910-03:00\",\n      \"modified\": \"2024-06-28T17:56:22.915-03:00\"\n    }\n  }\n}"
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
                          "example": "2e600d78-cf8a-4856-9b9a-3d90ae44563c"
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
                              "example": "https://sandbox.clicksign.com/api/v3/folders/2e600d78-cf8a-4856-9b9a-3d90ae44563c"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "name": {
                              "type": "string",
                              "example": "Pasta 1"
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
                              "example": "2024-06-28T17:56:22.910-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-06-28T17:56:22.915-03:00"
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
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Bad Request": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/name\"\n\t\t\t},\n\t\t\t\"detail\": \"name deve ser informado(a)\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/name"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "name deve ser informado(a)"
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