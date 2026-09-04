---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Modelo

Referência para criação de modelos.

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
    "/templates": {
      "post": {
        "summary": "Criar Modelo",
        "description": "Referência para criação de modelos.",
        "operationId": "api-criar-modelo",
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
                        "default": "templates",
                        "enum": [
                          "templates"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "name": {
                            "type": "string",
                            "description": "Define o nome do Modelo para facilitar consultas futuras."
                          },
                          "content_base64": {
                            "type": "string",
                            "description": "Conteúdo do arquivo em formato base 64 que está sendo enviado para a Clicksign."
                          },
                          "color": {
                            "type": "string",
                            "description": "A cor de identificação do template.",
                            "default": "#1474f5",
                            "enum": [
                              "#1474f5",
                              "#15d3c9",
                              "#05c412",
                              "#fccf00",
                              "#f77c04",
                              "#cf2e58",
                              "#ff86d5",
                              "#8726d9",
                              "#577b8d"
                            ]
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
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"6f600792-46c3-4760-8f85-0b4f88608583\",\n\t\t\"type\": \"templates\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/templates/6f600792-46c3-4760-8f85-0b4f88608583\",\n\t\t\t\"files\": {\n\t\t\t\t\"original\": \"https://sandbox.clicksign.com/media/W1siZiIsIjIwMjQvMDMvMjEvMTQvNTUvMzkvMGM5YjdkMTgtNThiNi00YWM0LWE1NDUtNzFkZDlhYzQyODA1L2ZpbGUuZG9jIl1d/file.doc?sha=dfd8f507688ddfff\"\n\t\t\t}\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"name\": \"Template Review 2\",\n\t\t\t\"color\": \"#577b8d\",\n\t\t\t\"created\": \"2024-03-21T11:55:39.500-03:00\",\n\t\t\t\"modified\": \"2024-03-21T11:55:39.500-03:00\"\n\t\t}\n\t}\n}"
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
                          "example": "6f600792-46c3-4760-8f85-0b4f88608583"
                        },
                        "type": {
                          "type": "string",
                          "example": "templates"
                        },
                        "links": {
                          "type": "object",
                          "properties": {
                            "self": {
                              "type": "string",
                              "example": "https://sandbox.clicksign.com/api/v3/templates/6f600792-46c3-4760-8f85-0b4f88608583"
                            },
                            "files": {
                              "type": "object",
                              "properties": {
                                "original": {
                                  "type": "string",
                                  "example": "https://sandbox.clicksign.com/media/W1siZiIsIjIwMjQvMDMvMjEvMTQvNTUvMzkvMGM5YjdkMTgtNThiNi00YWM0LWE1NDUtNzFkZDlhYzQyODA1L2ZpbGUuZG9jIl1d/file.doc?sha=dfd8f507688ddfff"
                                }
                              }
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "name": {
                              "type": "string",
                              "example": "Template Review 2"
                            },
                            "color": {
                              "type": "string",
                              "example": "#577b8d"
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-03-21T11:55:39.500-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-03-21T11:55:39.500-03:00"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/content_base64\"\n\t\t\t},\n\t\t\t\"detail\": \"content_base64 deve ser informado(a)\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/content_base64"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "content_base64 deve ser informado(a)"
                          }
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"forbidden\",\n\t\t\t\"status\": 403,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"A conta não possui acesso a essa funcionalidade\"\n\t\t}\n\t]\n}"
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
                            "example": "A conta não possui acesso a essa funcionalidade"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"não está incluído na lista\",\n\t\t\t\"detail\": \"color - não está incluído na lista\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/color\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n\t]\n}"
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
                            "example": "não está incluído na lista"
                          },
                          "detail": {
                            "type": "string",
                            "example": "color - não está incluído na lista"
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
                                "example": "/data/attributes/color"
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