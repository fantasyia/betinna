---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /auto_signature/terms

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
    "/auto_signature/terms": {
      "post": {
        "description": "",
        "operationId": "post_auto_signatureterms",
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "examples": {
                  "Created": {
                    "value": {
                      "data": {
                        "id": "1061ee7b-1248-49e7-8be9-e7e46d4f8eed",
                        "type": "auto_signature_terms",
                        "attributes": {
                          "name": "Signer name",
                          "documentation": "123.456.789-10",
                          "birthday": "1990-01-01",
                          "email": "signer@example.com",
                          "created": "2025-07-31T09:18:48.946-03:00",
                          "modified": "2025-07-31T09:18:48.946-03:00"
                        }
                      }
                    },
                    "summary": "Created"
                  }
                }
              }
            }
          },
          "422": {
            "description": "Unprocessable Entity",
            "content": {
              "application/json": {
                "examples": {
                  "New Example 1": {
                    "value": ""
                  },
                  "Unprocessable Entity": {
                    "value": {
                      "errors": [
                        {
                          "title": "Já existe um termo de assinatura automática para este signatário e operador.",
                          "detail": "Já existe um termo de assinatura automática para este signatário e operador.",
                          "code": "100",
                          "source": {
                            "pointer": "/data"
                          },
                          "status": "422"
                        }
                      ]
                    },
                    "summary": "Unprocessable Entity"
                  }
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Authorization",
            "in": "header",
            "required": true,
            "description": "Access Token gerado pelo gestor da conta",
            "schema": {
              "type": "string",
              "default": ""
            }
          },
          {
            "name": "Content-Type",
            "in": "header",
            "required": true,
            "description": "Content-type padrão para todas requisições JSON:API",
            "schema": {
              "type": "string",
              "default": "application/vnd.api+json"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/vnd.api+json": {
              "schema": {
                "properties": {
                  "data": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "default": "auto_signature_terms"
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "signer": {
                            "type": "object",
                            "properties": {
                              "name": {
                                "type": "string",
                                "default": "Signer Name"
                              },
                              "email": {
                                "type": "string",
                                "default": "signer@example.com"
                              },
                              "documentation": {
                                "type": "string",
                                "default": "123.456.789-10"
                              },
                              "birthday": {
                                "type": "string",
                                "default": "1990-01-01"
                              }
                            },
                            "required": [
                              "name",
                              "email",
                              "documentation",
                              "birthday"
                            ]
                          },
                          "api_email": {
                            "type": "string",
                            "default": "api@example.com"
                          },
                          "admin_email": {
                            "type": "string",
                            "default": "admin@example.com"
                          }
                        },
                        "required": [
                          "signer",
                          "api_email",
                          "admin_email"
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "attributes"
                    ]
                  }
                },
                "type": "object",
                "required": [
                  "data"
                ]
              }
            }
          }
        },
        "x-readme": {}
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