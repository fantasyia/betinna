---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Notificar um Signatário

Notificar um Signatário do Envelope.

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
    "/envelopes/{envelope_id}/signers/{signer_id}/notifications": {
      "post": {
        "summary": "Notificar um Signatário",
        "description": "Notificar um Signatário do Envelope.",
        "operationId": "api-notificar-signatario",
        "parameters": [
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do envelope que possui o signatário",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "signer_id",
            "in": "path",
            "description": "ID do signatário no envelope",
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
                        "default": "notifications",
                        "enum": [
                          "notifications"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "message": {
                            "type": "string",
                            "description": "Mensagem que deve ser enviada ao signatário, se o campo não for preenchido a mensagem enviada será a configurada no `envelope#default_message`.",
                            "default": "null",
                            "format": "json"
                          },
                          "email_customization": {
                            "type": "object",
                            "properties": {
                              "subject": {
                                "type": "string",
                                "description": "Determina assunto do email. (Máx: 998 chars)."
                              },
                              "head": {
                                "type": "string",
                                "description": "Determina o cabeçalho da notificação, presente no corpo do email. (Máx: 998 chars)."
                              },
                              "greeting": {
                                "type": "string",
                                "description": "Determina a saudação da notificação, presente no corpo do email. (Máx: 3000 chars)."
                              },
                              "principal": {
                                "type": "string",
                                "description": "Determina a mensagem principal da notificação, presente no corpo do email. (Máx: 3000 chars)."
                              },
                              "button": {
                                "type": "string",
                                "description": "Determina o texto no botão que direciona o signatário à assinatura. (Máx: 50 chars)."
                              },
                              "final": {
                                "type": "string",
                                "description": "Determina a mensagem final após o botão, presente no corpo do email. (Máx: 3000 chars)."
                              },
                              "align": {
                                "type": "string",
                                "description": "Determina o alinhamento dos elementos do email.",
                                "default": "",
                                "enum": [
                                  "left",
                                  "center",
                                  "right",
                                  "justify"
                                ]
                              },
                              "show_token": {
                                "type": "boolean",
                                "description": "Determina se o Token é exibido no corpo do email (quando existir autenticação por token)",
                                "default": ""
                              },
                              "show_qrcode": {
                                "type": "boolean",
                                "description": "Determina se é adicionado um QR Code ao corpo do email, o conteúdo do QR Code é o link para assinatura.",
                                "default": ""
                              },
                              "show_details": {
                                "type": "boolean",
                                "description": "Determina se devem ser exibidos detalhes do processo de assinatura, impresso após todas as mensagens",
                                "default": ""
                              }
                            },
                            "description": "Determina atributos que customizam a notificação por email"
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
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"02ca5952-54c9-4bde-9615-f927a4fbc4e0\",\n\t\t\"type\": \"notifications\",\n\t\t\"attributes\": {\n\t\t\t\"message\": \"Mensagem configurada por envelope#default_message\",\n\t\t\t\"summary\": [\n\t\t\t\t{\n\t\t\t\t\t\"signer_id\": \"9375c7c3-ffda-48f5-9f24-c640b40a2498\",\n\t\t\t\t\t\"notified\": true\n\t\t\t\t}\n\t\t\t],\n\t\t\t\"created\": \"2024-03-07T15:02:26.604-03:00\"\n\t\t}\n\t}\n}"
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
                          "example": "02ca5952-54c9-4bde-9615-f927a4fbc4e0"
                        },
                        "type": {
                          "type": "string",
                          "example": "notifications"
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "message": {
                              "type": "string",
                              "example": "Mensagem configurada por envelope#default_message"
                            },
                            "summary": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "properties": {
                                  "signer_id": {
                                    "type": "string",
                                    "example": "9375c7c3-ffda-48f5-9f24-c640b40a2498"
                                  },
                                  "notified": {
                                    "type": "boolean",
                                    "example": true,
                                    "default": true
                                  }
                                }
                              }
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-03-07T15:02:26.604-03:00"
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
          "404": {
            "description": "404",
            "content": {
              "application/json": {
                "examples": {
                  "Not Found": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por bab47d5b-033c-42e1-8140-65d8b7d96231 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por bab47d5b-033c-42e1-8140-65d8b7d96231 não pôde ser encontrado"
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