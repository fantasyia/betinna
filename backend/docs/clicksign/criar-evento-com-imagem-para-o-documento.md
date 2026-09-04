---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /envelopes/{envelope_id}/documents/{document_id}/events

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
    "/envelopes/{envelope_id}/documents/{document_id}/events": {
      "post": {
        "description": "",
        "operationId": "post_envelopes{envelope_id}documents{document_id}events",
        "responses": {
          "201": {
            "description": "",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "json": {
                      "type": "string",
                      "format": "json"
                    }
                  }
                },
                "examples": {
                  "Created": {
                    "summary": "Created",
                    "value": {
                      "data": {
                        "id": "7ba53dde-72a6-4c7c-9751-d97e6f3602d8",
                        "type": "events",
                        "attributes": {
                          "name": "add_image",
                          "data": {
                            "attachment_id": 287,
                            "title": "name signer",
                            "content_hash": "30cba565f88254a4196af5775b605ba8804d938558ef63acab488504a4ef5d58",
                            "content_name": "09 out 2025, 14-24-13.jpeg",
                            "occurred_at": "2025-08-06T15:33:33.303-03:00"
                          },
                          "created": "2025-10-09T14:24:13.359-03:00"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Bad Request",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "json": {
                      "type": "string",
                      "format": "json"
                    }
                  }
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
                            "pointer": "/data/attributes/data/occurred_at"
                          },
                          "detail": "occurred_at não está em um formato válido"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not Found",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "json": {
                      "type": "string",
                      "format": "json"
                    }
                  }
                },
                "examples": {
                  "Not Found": {
                    "summary": "Not Found",
                    "value": {
                      "errors": [
                        {
                          "title": "Registro não encontrado",
                          "detail": "O registro identificado por d401965b-9190-4369-96e2-041cefe8e5a0 não pôde ser encontrado",
                          "code": "404",
                          "status": "404"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "422": {
            "description": "Unprocessable Entity",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "json": {
                      "type": "string",
                      "format": "json"
                    }
                  }
                },
                "examples": {
                  "Unprocessable Entity": {
                    "summary": "Unprocessable Entity",
                    "value": {
                      "errors": [
                        {
                          "title": "deve ser anterior à data atual",
                          "detail": "occurred_at - deve ser anterior à data atual",
                          "code": "100",
                          "source": {
                            "pointer": "/data/attributes/occurred_at"
                          },
                          "status": "422"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "503": {
            "description": "Service Unavailable",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "json": {
                      "type": "string",
                      "format": "json"
                    }
                  }
                },
                "examples": {
                  "Service Unavailable": {
                    "summary": "Service Unavailable",
                    "value": "// O erro pode estar relacionado a não ativação do envelope em sua conta.\n// Entre em contato com o suporte para ativar ajuda@clicksign.com.\n{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"service_unavailable\",\n\t\t\t\"status\": 503,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"Serviço indisponível\"\n\t\t}\n\t]\n}"
                  }
                }
              }
            }
          }
        },
        "parameters": [
          {
            "in": "path",
            "name": "envelope_id",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "ID do Envelope que possui o documento."
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
              ]
            },
            "description": "Content-type padrão para todas requisições JSON:API",
            "required": true
          },
          {
            "in": "path",
            "name": "document_id",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "ID do Documento que receberá o evento."
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
                        "default": "events",
                        "enum": [
                          "events"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "name": {
                            "type": "string",
                            "default": "add_image",
                            "enum": [
                              "add_image"
                            ]
                          },
                          "content_base64": {
                            "type": "string",
                            "description": "Base64 da imagem a ser anexada com data_uri."
                          },
                          "data": {
                            "type": "object",
                            "properties": {
                              "occurred_at": {
                                "type": "string",
                                "description": "Data e hora em que o evento ocorreu"
                              },
                              "title": {
                                "type": "string",
                                "description": "Título/descrição da imagem anexada"
                              }
                            }
                          }
                        }
                      }
                    }
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