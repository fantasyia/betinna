---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Observador da Assinatura

Criar Observador

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
    "/envelopes/{envelope_id}/signature_watchers": {
      "post": {
        "summary": "Criar Observador da Assinatura",
        "description": "Criar Observador",
        "operationId": "api-criar-observadores",
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
            "name": "envelope_id",
            "in": "path",
            "description": "ID do Envelope que receberá o observador",
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
                "properties": {
                  "data": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "default": "signature_watchers",
                        "enum": [
                          "signature_watchers"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "email": {
                            "type": "string",
                            "description": "Email do observador e onde será notificado."
                          },
                          "kind": {
                            "type": "string",
                            "description": "Define se o observador será notificado em todo o processo ou apenas na conclusão.",
                            "enum": [
                              "all_steps",
                              "on_finished"
                            ]
                          },
                          "communicate_events": {
                            "type": "object",
                            "description": "Objeto responsável por comunicar eventos ao observador.",
                            "properties": {
                              "signature_watcher_document_sent": {
                                "type": "string",
                                "description": "Indica como a Clicksign deve comunicar ao observador que ele irá acompanhar a assinatura do documento.",
                                "default": "email"
                              },
                              "signature_watcher_document_signed": {
                                "type": "string",
                                "description": "Indica como a Clicksign deve comunicar ao observador que o documento foi assinado por um dos signatários.",
                                "default": "email"
                              },
                              "signature_watcher_document_deadline": {
                                "type": "string",
                                "description": "Indica como a Clicksign deve comunicar ao observador que o documento está próximo de atingir a data limite de assinatura.",
                                "default": "email"
                              },
                              "signature_watcher_document_canceled": {
                                "type": "string",
                                "description": "Indica como a Clicksign deve comunicar ao observador que o documento foi cancelado.",
                                "default": "email"
                              },
                              "signature_watcher_envelope_closed": {
                                "type": "string",
                                "description": "Indica como a Clicksign deve comunicar ao observador que o documento foi finalizado.",
                                "default": "email"
                              }
                            }
                          },
                          "attach_documents_enabled": {
                            "type": "boolean",
                            "description": "Determina se o observador deve receber os documentos finalizados.",
                            "default": false
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
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"e03fdbdc-dabb-45b4-a2ce-972680643d68\",\n\t\t\"type\": \"signature_watchers\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/a4ecaa4a-1453-4e63-95cf-988422f7003f/signature_watchers/e03fdbdc-dabb-45b4-a2ce-972680643d68\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"email\": \"dev2@example.com\",\n\t\t\t\"kind\": \"all_steps\",\n\t\t\t\"communicate_events\": {\n\t\t\t\t\"signature_watcher_document_sent\": \"email\",\n\t\t\t\t\"signature_watcher_document_signed\": \"email\",\n\t\t\t\t\"signature_watcher_document_deadline\": \"email\",\n\t\t\t\t\"signature_watcher_document_canceled\": \"email\",\n\t\t\t\t\"signature_watcher_envelope_closed\": \"email\"\n       },\n\t\t\t\"attach_documents_enabled\": true,\n\t\t\t\"created\": \"2024-05-08T15:34:09.168-03:00\",\n\t\t\t\"modified\": \"2024-05-08T15:34:09.168-03:00\"\n\t\t}\n\t}\n}"
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
                          "example": "e03fdbdc-dabb-45b4-a2ce-972680643d68"
                        },
                        "type": {
                          "type": "string",
                          "example": "signature_watchers"
                        },
                        "links": {
                          "type": "object",
                          "properties": {
                            "self": {
                              "type": "string",
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/a4ecaa4a-1453-4e63-95cf-988422f7003f/signature_watchers/e03fdbdc-dabb-45b4-a2ce-972680643d68"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "email": {
                              "type": "string",
                              "example": "dev2@example.com"
                            },
                            "kind": {
                              "type": "string",
                              "example": "all_steps"
                            },
                            "communicate_events": {
                              "type": "object",
                              "properties": {
                                "signature_watcher_document_sent": {
                                  "type": "string",
                                  "example": "email"
                                },
                                "signature_watcher_document_signed": {
                                  "type": "string",
                                  "example": "email"
                                },
                                "signature_watcher_document_deadline": {
                                  "type": "string",
                                  "example": "email"
                                },
                                "signature_watcher_document_canceled": {
                                  "type": "string",
                                  "example": "email"
                                },
                                "signature_watcher_envelope_closed": {
                                  "type": "string",
                                  "example": "email"
                                }
                              }
                            },
                            "attach_documents_enabled": {
                              "type": "boolean",
                              "example": true,
                              "default": true
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-05-08T15:34:09.168-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-05-08T15:34:09.168-03:00"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/kind\"\n\t\t\t},\n\t\t\t\"detail\": \"kind deve estar em: all_steps, on_finished\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/kind"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "kind deve estar em: all_steps, on_finished"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por 305b7b99-7669-4b1b-b0a9-7cbf61ffc681 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por 305b7b99-7669-4b1b-b0a9-7cbf61ffc681 não pôde ser encontrado"
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