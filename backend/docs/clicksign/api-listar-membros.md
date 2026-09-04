---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Membros da Conta

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
    "/memberships": {
      "get": {
        "summary": "Listar Membros da Conta",
        "description": "",
        "operationId": "api-listar-membros",
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
            "name": "filter[user.id]",
            "in": "query",
            "description": "Identificador do usuário",
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
                  "Ok": {
                    "value": {
                      "data": [
                        {
                          "id": "e1d1f7ad-f59a-4018-b190-3ee9d2778bc9",
                          "type": "memberships",
                          "links": {
                            "self": "https://sandbox.clicksign.com/api/v3/memberships/e1d1f7ad-f59a-4018-b190-3ee9d2778bc9"
                          },
                          "attributes": {
                            "role": "admin",
                            "consumption_accessible": false,
                            "tracking_accessible": false,
                            "folder_management_accessible": true,
                            "created": "2024-12-06T14:38:42.819-03:00",
                            "modified": "2024-12-06T14:38:42.819-03:00"
                          }
                        }
                      ],
                      "meta": {
                        "record_count": 1
                      },
                      "links": {
                        "first": "http://127.0.0.1:3000/api/v3/memberships?filter%5Buser.id%5D=f90194de-e75d-4d44-b255-6af631e7a2b6&page%5Bnumber%5D=1&page%5Bsize%5D=20",
                        "last": "http://127.0.0.1:3000/api/v3/memberships?filter%5Buser.id%5D=f90194de-e75d-4d44-b255-6af631e7a2b6&page%5Bnumber%5D=1&page%5Bsize%5D=20"
                      }
                    }
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
                            "example": "e1d1f7ad-f59a-4018-b190-3ee9d2778bc9"
                          },
                          "type": {
                            "type": "string",
                            "example": "memberships"
                          },
                          "links": {
                            "type": "object",
                            "properties": {
                              "self": {
                                "type": "string",
                                "example": "https://sandbox.clicksign.com/api/v3/memberships/e1d1f7ad-f59a-4018-b190-3ee9d2778bc9"
                              }
                            }
                          },
                          "attributes": {
                            "type": "object",
                            "properties": {
                              "role": {
                                "type": "string",
                                "example": "admin"
                              },
                              "consumption_accessible": {
                                "type": "boolean",
                                "example": false,
                                "default": true
                              },
                              "tracking_accessible": {
                                "type": "boolean",
                                "example": false,
                                "default": true
                              },
                              "folder_management_accessible": {
                                "type": "boolean"
                              },
                              "created": {
                                "type": "string",
                                "example": "2024-12-06T14:38:42.819-03:00"
                              },
                              "modified": {
                                "type": "string",
                                "example": "2024-12-06T14:38:42.819-03:00"
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
                          "example": "http://127.0.0.1:3000/api/v3/memberships?filter%5Buser.id%5D=f90194de-e75d-4d44-b255-6af631e7a2b6&page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        },
                        "last": {
                          "type": "string",
                          "example": "http://127.0.0.1:3000/api/v3/memberships?filter%5Buser.id%5D=f90194de-e75d-4d44-b255-6af631e7a2b6&page%5Bnumber%5D=1&page%5Bsize%5D=20"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"forbidden\",\n\t\t\t\"status\": 403,\n\t\t\t\"title\": \"Não autorizado\",\n\t\t\t\"detail\": \"O domínio do usuário a ser criado precisa ser o mesmo da conta solicitante.\"\n\t\t}\n\t]\n}"
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
                            "example": "Não autorizado"
                          },
                          "detail": {
                            "type": "string",
                            "example": "O domínio do usuário a ser criado precisa ser o mesmo da conta solicitante."
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