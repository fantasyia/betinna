---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /envelopes/{envelopeid}/documents/{documentid}/events

<br />

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
    "/envelopes/{envelopeid}/documents/{documentid}/events": {
      "post": {
        "description": "",
        "operationId": "get_envelopes{{envelope_id}}documents{{document_id}}events",
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
                        "id": "174e89a7-58ca-4f4d-a775-4615bded9196",
                        "type": "events",
                        "attributes": {
                          "name": "custom",
                          "data": {
                            "kind": "token_email",
                            "occurred_at": "2025-08-06T15:33:33.303-03:00",
                            "signer_name": "name signer",
                            "signer_email": "email@signer.com"
                          },
                          "created": "2025-10-09T12:39:17.355-03:00"
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
                    "errors": {
                      "type": "array",
                      "items": {
                        "properties": {
                          "code": {
                            "type": "string"
                          },
                          "status": {
                            "type": "integer"
                          },
                          "source": {
                            "type": "object",
                            "properties": {
                              "pointer": {
                                "type": "string"
                              }
                            }
                          },
                          "detail": {
                            "type": "string"
                          }
                        },
                        "type": "object"
                      }
                    }
                  },
                  "required": [
                    "errors"
                  ]
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
                            "pointer": "/data/attributes/data/email"
                          },
                          "detail": "email não está disponível"
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
                    "errors": {
                      "type": "array",
                      "items": {
                        "properties": {
                          "code": {
                            "type": "string"
                          },
                          "status": {
                            "type": "integer"
                          },
                          "source": {
                            "type": "object",
                            "properties": {
                              "pointer": {
                                "type": "string"
                              }
                            }
                          },
                          "detail": {
                            "type": "string"
                          }
                        },
                        "type": "object"
                      }
                    }
                  },
                  "required": [
                    "errors"
                  ]
                },
                "examples": {
                  "Not Found": {
                    "summary": "Not Found",
                    "value": {
                      "errors": [
                        {
                          "title": "Registro não encontrado",
                          "detail": "O registro identificado por d40a965b-9190-4369-96e2-041cefe8e5a0 não pôde ser encontrado",
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
                    "errors": {
                      "type": "array",
                      "items": {
                        "properties": {
                          "code": {
                            "type": "string"
                          },
                          "status": {
                            "type": "integer"
                          },
                          "source": {
                            "type": "object",
                            "properties": {
                              "pointer": {
                                "type": "string"
                              }
                            }
                          },
                          "detail": {
                            "type": "string"
                          }
                        },
                        "type": "object"
                      }
                    }
                  },
                  "required": [
                    "errors"
                  ]
                },
                "examples": {
                  "Unprocessable Entity": {
                    "summary": "Unprocessable Entity",
                    "value": {
                      "errors": [
                        {
                          "title": "inválido",
                          "detail": "signer_email - inválido",
                          "code": "100",
                          "source": {
                            "pointer": "/data/attributes/signer_email"
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
                    "property1": {
                      "type": "string"
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
            "name": "envelopeid",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "ID do Envelope que possui o documento."
          },
          {
            "in": "path",
            "name": "documentid",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "ID do Documento que receberá o evento."
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
            "required": true,
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
                          "events"
                        ],
                        "default": "events"
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "name": {
                            "type": "string",
                            "description": "Determina o tipo de evento.",
                            "default": "custom",
                            "enum": [
                              "custom"
                            ]
                          },
                          "data": {
                            "type": "object",
                            "properties": {
                              "kind": {
                                "type": "string",
                                "description": "Determina se o evento é de token por email ou sms.",
                                "enum": [
                                  "token_email",
                                  "token_sms"
                                ]
                              },
                              "occurred_at": {
                                "type": "string",
                                "description": "Data e hora em que o evento ocorreu"
                              },
                              "signer_name": {
                                "type": "string",
                                "default": "",
                                "description": "Nome do signatário que participou do evento"
                              },
                              "signer_email": {
                                "type": "string",
                                "description": "E-mail do signatário que participou do evento"
                              },
                              "signer_phone_number": {
                                "type": "string",
                                "description": "Telefone do signatário que participou do evento"
                              }
                            },
                            "description": "Dados do evento customizado",
                            "required": [
                              "kind",
                              "occurred_at",
                              "signer_name"
                            ]
                          }
                        },
                        "required": [
                          "name",
                          "data"
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