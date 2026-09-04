---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Signatário

Adicionar um Signatário ao Envelope.

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
    "/envelopes/{envelope_id}/signers": {
      "post": {
        "summary": "Criar Signatário",
        "description": "Adicionar um Signatário ao Envelope.",
        "operationId": "api-criar-signatario",
        "parameters": [
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do envelope ao qual será adicionado o signatário",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "Authorization",
            "in": "header",
            "description": "Access Token gerado pelo gestor da conta",
            "schema": {
              "type": "string"
            },
            "required": true
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
            },
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
                      "type": {
                        "type": "string",
                        "default": "signers",
                        "enum": [
                          "signers"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "name": {
                            "type": "string",
                            "description": "O nome do signatário, usado para identificá-lo (é necessário enviar ao menos duas palavras)."
                          },
                          "email": {
                            "type": "string",
                            "description": "Informe o email do signatário (obrigatório quando houver configuração de notificação por email)."
                          },
                          "phone_number": {
                            "type": "string",
                            "description": "Número de telefone do signatário, que deve possuir 10 ou 11 números (obrigatório quando houver configuração de notificação que exija telefone)."
                          },
                          "birthday": {
                            "type": "string",
                            "description": "Data de nascimento do signatário.",
                            "format": "date"
                          },
                          "has_documentation": {
                            "type": "boolean",
                            "description": "Define se o signatário deve informar CPF e Data de nascimento. Valor padrão é true",
                            "default": true,
                            "enum": [
                              true,
                              false
                            ]
                          },
                          "documentation": {
                            "type": "string",
                            "description": "Informe o CPF do signatário formatado (ex: 000.000.000-00)"
                          },
                          "refusable": {
                            "type": "boolean",
                            "description": "Define se o signatário pode recusar a solicitação. Valor padrão é false",
                            "enum": [
                              true,
                              false
                            ],
                            "default": "false"
                          },
                          "group": {
                            "type": "integer",
                            "description": "Determina em qual grupo o signatário deve ser vinculado, conforme ordem de assinatura.",
                            "default": 1,
                            "format": "int32"
                          },
                          "location_required_enabled": {
                            "type": "boolean",
                            "description": "Determina se o signatário deve compartilhar sua localização no momento da assinatura. Valor padrão é false",
                            "default": false,
                            "enum": [
                              true,
                              false
                            ]
                          },
                          "communicate_events": {
                            "type": "object",
                            "description": "Configura notificações ao signatário. Para mais detalhes sobre as opções e cobrança, visite a seção [Notificar Signatários](https://developers.clicksign.com/reference/api-notificacoes)",
                            "properties": {
                              "signature_request": {
                                "type": "string",
                                "description": "Indica como a Clicksign deve comunicar ao signatário a solicitação de assinatura do documento.",
                                "default": "email",
                                "enum": [
                                  "none",
                                  "email",
                                  "whatsapp",
                                  "sms"
                                ]
                              },
                              "signature_reminder": {
                                "type": "string",
                                "description": "Determina como os lembretes serão entregues, conforme intervalo configurado no atributo `remind_interval` na criação do Envelope.",
                                "default": "email",
                                "enum": [
                                  "none",
                                  "email"
                                ]
                              },
                              "document_signed": {
                                "type": "string",
                                "description": "Indica como a Clicksign deve comunicar ao signatário para enviar o documento que foi assinado por todos os signatários.",
                                "default": "email",
                                "enum": [
                                  "email",
                                  "whatsapp"
                                ]
                              }
                            }
                          },
                          "signature_host": {
                            "type": "object",
                            "properties": {
                              "name": {
                                "type": "string",
                                "description": "Nome do anfitrião"
                              },
                              "email": {
                                "type": "string",
                                "description": "Email do anfitrião"
                              },
                              "communicate_events": {
                                "type": "object",
                                "properties": {
                                  "signature_host_signature_request": {
                                    "type": "string",
                                    "enum": [
                                      "none",
                                      "email"
                                    ],
                                    "description": "Tipo de comunicação para solicitação de assinatura"
                                  }
                                },
                                "description": "Configura notificações do anfitrião"
                              }
                            },
                            "description": "Determina os dados de um anfitrião em assinatura presencial"
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
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"3bf8696f-0e81-421e-a2c1-4e9b0b0941a3\",\n\t\t\"type\": \"signers\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers/3bf8696f-0e81-421e-a2c1-4e9b0b0941a3\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"name\": \"Signer Two\",\n\t\t\t\"birthday\": null,\n\t\t\t\"email\": \"signer.two@example.com\",\n\t\t\t\"phone_number\": null,\n\t\t\t\"location_required_enabled\": false,\n\t\t\t\"has_documentation\": true,\n\t\t\t\"documentation\": null,\n\t\t\t\"refusable\": false,\n\t\t\t\"group\": 1,\n\t\t\t\"communicate_events\": {\n\t\t\t\t\"document_signed\": \"email\",\n\t\t\t\t\"signature_request\": \"email\",\n\t\t\t\t\"signature_reminder\": \"email\"\n\t\t\t},\n\t\t\t\"created\": \"2024-03-07T09:15:07.079-03:00\",\n\t\t\t\"modified\": \"2024-03-07T09:15:07.079-03:00\"\n\t\t}\n\t}\n}"
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
                          "example": "3bf8696f-0e81-421e-a2c1-4e9b0b0941a3"
                        },
                        "type": {
                          "type": "string",
                          "example": "signers"
                        },
                        "links": {
                          "type": "object",
                          "properties": {
                            "self": {
                              "type": "string",
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers/3bf8696f-0e81-421e-a2c1-4e9b0b0941a3"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "name": {
                              "type": "string",
                              "example": "Signer Two"
                            },
                            "birthday": {},
                            "email": {
                              "type": "string",
                              "example": "signer.two@example.com"
                            },
                            "phone_number": {},
                            "location_required_enabled": {
                              "type": "boolean",
                              "example": false,
                              "default": true
                            },
                            "has_documentation": {
                              "type": "boolean",
                              "example": true,
                              "default": true
                            },
                            "documentation": {},
                            "refusable": {
                              "type": "boolean",
                              "example": false,
                              "default": true
                            },
                            "group": {
                              "type": "integer",
                              "example": 1,
                              "default": 0
                            },
                            "communicate_events": {
                              "type": "object",
                              "properties": {
                                "document_signed": {
                                  "type": "string",
                                  "example": "email"
                                },
                                "signature_request": {
                                  "type": "string",
                                  "example": "email"
                                },
                                "signature_reminder": {
                                  "type": "string",
                                  "example": "email"
                                }
                              }
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-03-07T09:15:07.079-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-03-07T09:15:07.079-03:00"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/key\"\n\t\t\t},\n\t\t\t\"detail\": \"key não está disponível\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/key"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "key não está disponível"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "404",
            "content": {
              "application/json": {
                "examples": {
                  "Not Found": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por b8239d23-230a-4ab7-82f2-6d68b3fee0f1 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "Registro não encontrado"
                          },
                          "detail": {
                            "type": "string",
                            "example": "O registro identificado por b8239d23-230a-4ab7-82f2-6d68b3fee0f1 não pôde ser encontrado"
                          },
                          "code": {
                            "type": "string",
                            "example": "404"
                          },
                          "status": {
                            "type": "string",
                            "example": "404"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"inválido\",\n\t\t\t\"detail\": \"documentation - inválido\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/documentation\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n  ]\n}"
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
                            "example": "inválido"
                          },
                          "detail": {
                            "type": "string",
                            "example": "documentation - inválido"
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
                                "example": "/data/attributes/documentation"
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