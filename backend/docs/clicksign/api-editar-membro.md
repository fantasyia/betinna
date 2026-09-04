---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Editar Membro

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
    "/memberships/{membership_id}": {
      "put": {
        "summary": "Editar Membro",
        "description": "",
        "operationId": "api-editar-membro",
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
            "name": "membership_id",
            "in": "path",
            "description": "ID do Membro que deseja atualizar",
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
                "required": [
                  "data"
                ],
                "properties": {
                  "data": {
                    "type": "object",
                    "required": [
                      "id",
                      "type"
                    ],
                    "properties": {
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "role": {
                            "type": "string",
                            "description": "Define nível de acesso do usuário.",
                            "default": "global",
                            "enum": [
                              "admin",
                              "global",
                              "observer",
                              "downloader",
                              "financial",
                              "manager"
                            ]
                          },
                          "consumption_accessible": {
                            "type": "boolean",
                            "description": "Usuários com acesso à página de cobrança",
                            "default": false
                          },
                          "tracking_accessible": {
                            "type": "boolean",
                            "description": "Acesso à página de e-mails enviados",
                            "default": false
                          },
                          "folder_management_accessible": {
                            "type": "boolean",
                            "default": "true"
                          }
                        }
                      },
                      "id": {
                        "type": "string",
                        "description": "Identificador do membro (mesmo da URL)"
                      },
                      "type": {
                        "type": "string",
                        "description": "memberships",
                        "default": "memberships"
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
                  "Ok": {
                    "value": {
                      "data": {
                        "id": "4b4051ed-575c-41ec-8485-318d73869db7",
                        "type": "memberships",
                        "links": {
                          "self": "https://sandbox.clicksign.com/api/v3/memberships/4b4051ed-575c-41ec-8485-318d73869db7"
                        },
                        "attributes": {
                          "role": "admin",
                          "consumption_accessible": false,
                          "tracking_accessible": false,
                          "folder_management_accessible": true,
                          "created": "2024-12-06T14:51:29.163-03:00",
                          "modified": "2024-12-06T14:51:29.163-03:00"
                        }
                      }
                    }
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
                          "example": "4b4051ed-575c-41ec-8485-318d73869db7"
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
                              "example": "https://sandbox.clicksign.com/api/v3/memberships/4b4051ed-575c-41ec-8485-318d73869db7"
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
                              "type": "boolean",
                              "default": "true"
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-12-06T14:51:29.163-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-12-06T14:51:29.163-03:00"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/role\"\n\t\t\t},\n\t\t\t\"detail\": \"role deve estar em: admin, global, observer, downloader, member, guest\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/role"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "role deve estar em: admin, global, observer, downloader, member, guest"
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
          "422": {
            "description": "422",
            "content": {
              "application/json": {
                "examples": {
                  "Unprocessable Entity": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"já está em uso\",\n\t\t\t\"detail\": \"user_id - já está em uso\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/user_id\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n\t]\n}"
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
                            "example": "já está em uso"
                          },
                          "detail": {
                            "type": "string",
                            "example": "user_id - já está em uso"
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
                                "example": "/data/attributes/user_id"
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