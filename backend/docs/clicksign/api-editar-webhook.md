---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /webhooks/{webhookid}

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
    "/webhooks/{webhookid}": {
      "patch": {
        "description": "",
        "operationId": "patch_webhooks{webhookid}",
        "responses": {
          "200": {
            "description": "",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "name": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "name"
                  ]
                },
                "examples": {
                  "OK": {
                    "summary": "OK",
                    "value": {
                      "data": {
                        "id": "28579e01-3951-4b25-b480-d8d8e77d159a",
                        "type": "webhooks",
                        "links": {
                          "self": "https://sandbox.clicksign.com/api/v3/webhooks/28579e01-3951-4b25-b480-d8d8e77d159a"
                        },
                        "attributes": {
                          "endpoint": "https://example.com2333",
                          "secret": "091928f2f946ce3368b9f209873e268c",
                          "status": "active",
                          "events": [
                            "add_image",
                            "upload"
                          ],
                          "created": "2025-12-05T10:52:14.921-03:00",
                          "modified": "2025-12-05T10:52:14.921-03:00"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Bad Request": {
                    "summary": "Bad Request",
                    "value": {
                      "errors": [
                        {
                          "code": "bad_request",
                          "status": 400,
                          "source": {
                            "pointer": "/data/type"
                          },
                          "detail": "type deve ser igual a webhooks"
                        }
                      ]
                    }
                  }
                }
              }
            },
            "description": "Bad Request"
          },
          "404": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Not Found": {
                    "summary": "Not Found",
                    "value": {
                      "errors": [
                        {
                          "title": "Registro não encontrado",
                          "detail": "O registro identificado por 1108816e-a8da-41ed-b9e9-8d5111eb1f02 não pôde ser encontrado",
                          "code": "404",
                          "status": "404"
                        }
                      ]
                    }
                  }
                }
              }
            },
            "description": "Not Found"
          },
          "503": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Service Unavailable": {
                    "summary": "Service Unavailable",
                    "value": "// O erro pode estar relacionado a não ativação do envelope em sua conta.\n// Entre em contato com o suporte para ativar ajuda@clicksign.com.\n{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"service_unavailable\",\n\t\t\t\"status\": 503,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"Serviço indisponível\"\n\t\t}\n\t]\n}"
                  }
                }
              }
            },
            "description": "Service Unavailable"
          }
        },
        "parameters": [
          {
            "in": "path",
            "name": "webhookid",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "ID do webhook a ser atualizado"
          },
          {
            "in": "header",
            "name": "Authorization",
            "schema": {
              "type": "string"
            },
            "description": "Access Token gerado pelo gestor da conta",
            "required": true
          },
          {
            "in": "header",
            "name": "Content-type",
            "schema": {
              "type": "string",
              "enum": [
                "application/vnd.api+json"
              ],
              "default": "application/vnd.api+json"
            },
            "description": "Content-type padrão para todas requisições JSON:API",
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
                        "description": "ID do webhook a ser editado"
                      },
                      "type": {
                        "type": "string",
                        "enum": [
                          "webhooks"
                        ],
                        "default": "webhooks"
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "endpoint": {
                            "type": "string",
                            "description": "Endpoint a ser atualizado."
                          },
                          "status": {
                            "type": "string",
                            "enum": [
                              "active",
                              "inactive"
                            ],
                            "description": "Status a ser atualizado."
                          },
                          "events": {
                            "type": "string",
                            "description": "Eventos que deseja configurar no webhook."
                          }
                        }
                      }
                    },
                    "required": [
                      "id",
                      "type",
                      "attributes"
                    ]
                  }
                },
                "required": [
                  "data"
                ]
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