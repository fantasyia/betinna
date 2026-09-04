---
updatedAt: 2026-06-25T20:35:27.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Envelope

Setup do envelope

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
    "/envelopes": {
      "post": {
        "summary": "Criar Envelope",
        "description": "Setup do envelope",
        "operationId": "api-criar-envelope",
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
                        "default": "envelopes",
                        "enum": [
                          "envelopes"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "name": {
                            "type": "string",
                            "description": "Nome do envelope",
                            "default": "Envelope de Teste"
                          },
                          "deadline_at": {
                            "type": "string",
                            "description": "Data limite para o envelope e seus documentos (formato RFC 3339)"
                          },
                          "locale": {
                            "type": "string",
                            "description": "Idioma utilizado nos e-mails, página de assinatura e log do documento. Valor padrão é pt-BR",
                            "default": "pt-BR",
                            "enum": [
                              "pt-BR",
                              "en-US"
                            ]
                          },
                          "auto_close": {
                            "type": "boolean",
                            "description": "Finalização automática após a assinatura do último signatário. Valor padrão é true",
                            "default": true,
                            "enum": [
                              true,
                              false
                            ]
                          },
                          "remind_interval": {
                            "type": "string",
                            "description": "Determina se o documento terá opção de lembretes automáticos ativada ou desativada (null,1,2,3,7,14).",
                            "default": "3",
                            "enum": [
                              "1",
                              "2",
                              "3",
                              "7",
                              "14",
                              "null"
                            ]
                          },
                          "block_after_refusal": {
                            "type": "boolean",
                            "description": "Determina se o processo de assinatura tem que ser pausado ou não após um signatário ter recusado.",
                            "default": false,
                            "enum": [
                              true,
                              false
                            ]
                          },
                          "default_subject": {
                            "type": "string",
                            "description": "Define o assunto do e-mail que será enviado aos signatários na solicitação de assinatura."
                          },
                          "default_message": {
                            "type": "string",
                            "description": "Define a mensagem padrão que será enviada aos signatários."
                          },
                          "deadline_partial_signature_action": {
                            "type": "string",
                            "enum": [
                              "closed",
                              "canceled"
                            ]
                          },
                          "name1": {
                            "type": "string"
                          }
                        }
                      },
                      "relationships": {
                        "type": "object",
                        "properties": {
                          "folder": {
                            "type": "object",
                            "properties": {
                              "data": {
                                "type": "object",
                                "properties": {
                                  "type": {
                                    "type": "string",
                                    "enum": [
                                      "folders"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "description": "ID da pasta de origem, onde será criada a pasta atual."
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  "name": {
                    "type": "string"
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
                    "value": "{\n   \"data\":{\n      \"id\":\"6bb80fa1-4836-424a-9441-0108a7c54d04\",\n      \"type\":\"envelopes\",\n      \"links\":{\n         \"self\":\"https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04\"\n      },\n      \"attributes\":{\n         \"name\":\"teste\",\n         \"status\":\"draft\",\n         \"deadline_at\":\"2024-03-30T09:17:36.417-03:00\",\n         \"locale\":\"pt-BR\",\n         \"auto_close\":true,\n         \"rubric_enabled\":true,\n         \"remind_interval\":3,\n         \"block_after_refusal\":false,\n         \"default_message\":null,\n         \"created\":\"2024-02-29T09:17:36.418-03:00\",\n         \"modified\":\"2024-02-29T09:17:36.458-03:00\"\n      },\n      \"relationships\":{\n         \"documents\":{\n            \"links\":{\n               \"self\":\"https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/relationships/documents\",\n               \"related\":\"https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/documents\"\n            }\n         },\n         \"signers\":{\n            \"links\":{\n               \"self\":\"https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/relationships/signers\",\n               \"related\":\"https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/signers\"\n            }\n         },\n         \"requirements\":{\n            \"links\":{\n               \"self\":\"https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/relationships/requirements\",\n               \"related\":\"https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/requirements\"\n            }\n         }\n      }\n   }\n}"
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
                          "example": "6bb80fa1-4836-424a-9441-0108a7c54d04"
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
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "name": {
                              "type": "string",
                              "example": "teste"
                            },
                            "status": {
                              "type": "string",
                              "example": "draft"
                            },
                            "deadline_at": {
                              "type": "string",
                              "example": "2024-03-30T09:17:36.417-03:00"
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
                              "example": 3,
                              "default": 0
                            },
                            "block_after_refusal": {
                              "type": "boolean",
                              "example": false,
                              "default": true
                            },
                            "default_message": {},
                            "created": {
                              "type": "string",
                              "example": "2024-02-29T09:17:36.418-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-02-29T09:17:36.458-03:00"
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
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/relationships/documents"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/documents"
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
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/relationships/signers"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/signers"
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
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/relationships/requirements"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/6bb80fa1-4836-424a-9441-0108a7c54d04/requirements"
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
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Bad Request": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/locale\"\n\t\t\t},\n\t\t\t\"detail\": \"locale deve estar em: pt-BR, en-US\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/locale"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "locale deve estar em: pt-BR, en-US"
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
                  "Unprocesasble Entity": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"deve ser maior ou igual a 2024-02-29 09:20:09 -0300\",\n\t\t\t\"detail\": \"deadline_at - deve ser maior ou igual a 2024-02-29 09:20:09 -0300\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/deadline_at\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n}"
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