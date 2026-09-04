---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Detalhes do Documento

Visualizar estado atual do Documento

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
    "/envelopes/{envelope_id}/documents/{document_id}": {
      "get": {
        "summary": "Detalhes do Documento",
        "description": "Visualizar estado atual do Documento",
        "operationId": "detalhes-do-documento",
        "parameters": [
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
            }
          },
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do Envelope que possui o documento",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "in": "path",
            "name": "document_id",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "ID do documento"
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"1108816e-a8da-41ed-b9e9-8d5111eb1f0d\",\n\t\t\"type\": \"envelopes\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"name\": \"Envelope de Teste\",\n\t\t\t\"status\": \"closed\",\n\t\t\t\"deadline_at\": \"2023-11-11T10:05:35.406-03:00\",\n\t\t\t\"locale\": \"pt-BR\",\n\t\t\t\"auto_close\": true,\n\t\t\t\"rubric_enabled\": true,\n\t\t\t\"remind_interval\": 1,\n\t\t\t\"block_after_refusal\": false,\n\t\t\t\"default_message\": \"mensagem customizada\",\n\t\t\t\"created\": \"2023-09-14T11:22:07.128-03:00\",\n\t\t\t\"modified\": \"2023-09-14T11:25:33.411-03:00\"\n\t\t},\n\t\t\"relationships\": {\n\t\t\t\"documents\": {\n\t\t\t\t\"links\": {\n\t\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/relationships/documents\",\n\t\t\t\t\t\"related\": \"https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/documents\"\n\t\t\t\t}\n\t\t\t},\n\t\t\t\"signers\": {\n\t\t\t\t\"links\": {\n\t\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/relationships/signers\",\n\t\t\t\t\t\"related\": \"https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/signers\"\n\t\t\t\t}\n\t\t\t},\n\t\t\t\"requirements\": {\n\t\t\t\t\"links\": {\n\t\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/relationships/requirements\",\n\t\t\t\t\t\"related\": \"https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/requirements\"\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}"
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
                          "example": "1108816e-a8da-41ed-b9e9-8d5111eb1f0d"
                        },
                        "type": {
                          "type": "string",
                          "example": "envelopes"
                        },
                        "links": {
                          "type": "object",
                          "properties": {
                            "self": {
                              "type": "string",
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "name": {
                              "type": "string",
                              "example": "Envelope de Teste"
                            },
                            "status": {
                              "type": "string",
                              "example": "closed"
                            },
                            "deadline_at": {
                              "type": "string",
                              "example": "2023-11-11T10:05:35.406-03:00"
                            },
                            "locale": {
                              "type": "string",
                              "example": "pt-BR"
                            },
                            "auto_close": {
                              "type": "boolean",
                              "example": true,
                              "default": true
                            },
                            "rubric_enabled": {
                              "type": "boolean",
                              "example": true,
                              "default": true
                            },
                            "remind_interval": {
                              "type": "integer",
                              "example": 1,
                              "default": 0
                            },
                            "block_after_refusal": {
                              "type": "boolean",
                              "example": false,
                              "default": true
                            },
                            "default_message": {
                              "type": "string",
                              "example": "mensagem customizada"
                            },
                            "created": {
                              "type": "string",
                              "example": "2023-09-14T11:22:07.128-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2023-09-14T11:25:33.411-03:00"
                            }
                          }
                        },
                        "relationships": {
                          "type": "object",
                          "properties": {
                            "documents": {
                              "type": "object",
                              "properties": {
                                "links": {
                                  "type": "object",
                                  "properties": {
                                    "self": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/relationships/documents"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/documents"
                                    }
                                  }
                                }
                              }
                            },
                            "signers": {
                              "type": "object",
                              "properties": {
                                "links": {
                                  "type": "object",
                                  "properties": {
                                    "self": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/relationships/signers"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/signers"
                                    }
                                  }
                                }
                              }
                            },
                            "requirements": {
                              "type": "object",
                              "properties": {
                                "links": {
                                  "type": "object",
                                  "properties": {
                                    "self": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/relationships/requirements"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/1108816e-a8da-41ed-b9e9-8d5111eb1f0d/requirements"
                                    }
                                  }
                                }
                              }
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por 1108816e-a8da-41ed-b9e9-8d5111eb1f02 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por 1108816e-a8da-41ed-b9e9-8d5111eb1f02 não pôde ser encontrado"
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