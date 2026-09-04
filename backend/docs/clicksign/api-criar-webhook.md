---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /webhooks

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
    "/webhooks": {
      "post": {
        "description": "",
        "operationId": "post_webhooks",
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
                }
              }
            }
          },
          "201": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Created": {
                    "summary": "Created",
                    "value": {
                      "data": {
                        "id": "e72aab68-358d-43e6-9a93-0aaaa1b8bf05",
                        "type": "webhooks",
                        "links": {
                          "self": "https://sandbox.clicksign.com/api/v3/webhooks/e72aab68-358d-43e6-9a93-0aaaa1b8bf05"
                        },
                        "attributes": {
                          "endpoint": "https://example.com23",
                          "secret": "973d92ca80c2206a0e65b35d2371d595",
                          "status": "inactive",
                          "events": [
                            "add_image",
                            "upload"
                          ],
                          "created": "2025-12-04T09:47:58.012-03:00",
                          "modified": "2025-12-04T09:47:58.012-03:00"
                        }
                      }
                    }
                  }
                }
              }
            },
            "description": "Created"
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
                            "pointer": "/data/attributes/events"
                          },
                          "detail": "events deve ser informado(a)"
                        }
                      ]
                    }
                  }
                }
              }
            },
            "description": "Bad Request"
          },
          "422": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Unprocessable Entity": {
                    "summary": "Unprocessable Entity",
                    "value": {
                      "errors": [
                        {
                          "title": "já está em uso",
                          "detail": "endpoint - já está em uso",
                          "code": "100",
                          "source": {
                            "pointer": "/data/attributes/endpoint"
                          },
                          "status": "422"
                        }
                      ]
                    }
                  }
                }
              }
            },
            "description": "Unprocessable Entity"
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
            "in": "header",
            "name": "Authorization",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "Access Token gerado pelo gestor da conta"
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
            "description": "Content-type padrão para todas requisições JSON:API"
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
                        "enum": [
                          "webhooks"
                        ],
                        "default": "webhooks",
                        "description": "Tipo de modelo a ser enviado."
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "endpoint": {
                            "type": "string",
                            "description": "Endpoint que receberá os eventos."
                          },
                          "status": {
                            "type": "string",
                            "enum": [
                              "active",
                              "inactive"
                            ]
                          },
                          "events": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            },
                            "description": "Eventos que deseja ser notificado neste endpoint."
                          }
                        },
                        "required": [
                          "endpoint"
                        ]
                      }
                    },
                    "required": [
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