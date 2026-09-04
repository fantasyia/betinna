---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Usuários

Listar e consultar usuários

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
    "/users": {
      "get": {
        "summary": "Listar Usuários",
        "description": "Listar e consultar usuários",
        "operationId": "api-listar-usuarios",
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
            "name": "filter[email]",
            "in": "query",
            "description": "Informe um email caso deseje filtrar",
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
                  "Result": {
                    "value": "{\n\t\"data\": [\n  \t{\n\t\t\t\"id\": \"0c010fc6-c5a2-4561-9631-ea8a5d7e2096\",\n\t\t\t\"type\": \"users\",\n\t\t\t\"links\": {\n\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/users/0c010fc6-c5a2-4561-9631-ea8a5d7e2096\"\n\t\t\t},\n\t\t\t\"attributes\": {\n\t\t\t\t\"name\": \"John Doe\",\n\t\t\t\t\"email\": \"john.doe@example.com\",\n\t\t\t\t\"phone_number\": \"11666999666\",\n\t\t\t\t\"created\": \"2024-11-01T11:03:30.590-03:00\",\n\t\t\t\t\"modified\": \"2024-11-01T11:03:30.597-03:00\"\n\t\t\t}\n\t\t}\n  ],\n\t\"meta\": {\n\t\t\"record_count\": 1\n\t},\n\t\"links\": {\n\t\t\"first\": \"https://sandbox.clicksign.com/api/v3/users?page%5Bnumber%5D=1&page%5Bsize%5D=20\",\n\t\t\"last\": \"https://sandbox.clicksign.com/api/v3/users?page%5Bnumber%5D=1&page%5Bsize%5D=20\"\n\t}\n}"
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
                            "example": "0c010fc6-c5a2-4561-9631-ea8a5d7e2096"
                          },
                          "type": {
                            "type": "string",
                            "example": "users"
                          },
                          "links": {
                            "type": "object",
                            "properties": {
                              "self": {
                                "type": "string",
                                "example": "https://sandbox.clicksign.com/api/v3/users/0c010fc6-c5a2-4561-9631-ea8a5d7e2096"
                              }
                            }
                          },
                          "attributes": {
                            "type": "object",
                            "properties": {
                              "name": {
                                "type": "string",
                                "example": "John Doe"
                              },
                              "email": {
                                "type": "string",
                                "example": "john.doe@example.com"
                              },
                              "phone_number": {
                                "type": "string",
                                "example": "11666999666"
                              },
                              "created": {
                                "type": "string",
                                "example": "2024-11-01T11:03:30.590-03:00"
                              },
                              "modified": {
                                "type": "string",
                                "example": "2024-11-01T11:03:30.597-03:00"
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
                          "example": "https://sandbox.clicksign.com/api/v3/users?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        },
                        "last": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/users?page%5Bnumber%5D=1&page%5Bsize%5D=20"
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