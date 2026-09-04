---
updatedAt: 2026-05-28T20:25:31.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Requisito de Qualificação

Criar Requisito de Qualificação, relacionando um signatário a um documento.<br>Em caso de falhas consulte a <Anchor target="_blank" href="https://developers.clicksign.com/docs/veja-como-funciona-na-pr%C3%A1tica">documentação teórica informando o passo a passo.</Anchor><br>Ainda ficou com dúvidas? <Anchor target="_blank" href="https://www.clicksign.com/suporte">Entre em contato com o suporte.</Anchor>

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
    "/envelopes/{envelope_id}/requirements": {
      "post": {
        "summary": "Criar Requisito de Qualificação",
        "description": "Criar Requisito de Qualificação, relacionando um signatário a um documento.<br>Em caso de falhas consulte a <Anchor target=\"_blank\" href=\"https://developers.clicksign.com/docs/veja-como-funciona-na-pr%C3%A1tica\">documentação teórica informando o passo a passo.</Anchor><br>Ainda ficou com dúvidas? <Anchor target=\"_blank\" href=\"https://www.clicksign.com/suporte\">Entre em contato com o suporte.</Anchor>",
        "operationId": "criar-requisito-qualificacao",
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
          },
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do Envelope que receberá o requisito",
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
                        "default": "requirements",
                        "enum": [
                          "requirements"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "action": {
                            "type": "string",
                            "description": "Determina o tipo de requisito como de Qualificação.",
                            "default": "agree",
                            "enum": [
                              "agree"
                            ]
                          },
                          "role": {
                            "type": "string",
                            "description": "Determina a Qualificação desejada para aceitar as assinaturas. Veja todas as opções na seção de [Requisitos de Qualificação](/v3.0/docs/adicionar-requisito-de-qualificacao).",
                            "enum": [
                              "sign",
                              "party",
                              "contractor"
                            ]
                          }
                        }
                      },
                      "relationships": {
                        "type": "object",
                        "description": "Determina a relação entre signatário e documento.",
                        "properties": {
                          "document": {
                            "type": "object",
                            "properties": {
                              "data": {
                                "type": "object",
                                "properties": {
                                  "type": {
                                    "type": "string",
                                    "default": "documents",
                                    "enum": [
                                      "documents"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "description": "ID do documento que receberá o requisito."
                                  }
                                },
                                "required": [
                                  "id",
                                  "type"
                                ]
                              }
                            },
                            "required": [
                              "data"
                            ]
                          },
                          "signer": {
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
                                  "id": {
                                    "type": "string",
                                    "description": "ID do signatário que receberá o requisito."
                                  }
                                },
                                "required": [
                                  "id",
                                  "type"
                                ]
                              }
                            },
                            "required": [
                              "data"
                            ]
                          }
                        },
                        "required": [
                          "document",
                          "signer"
                        ]
                      }
                    },
                    "required": [
                      "relationships"
                    ]
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
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"0cac29fb-f0b0-49cb-a476-f3ea0b28d9aa\",\n\t\t\"type\": \"requirements\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/658ab351-0b30-4482-9126-2a12fed5bdba/requirements/0cac29fb-f0b0-49cb-a476-f3ea0b28d9aa\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"action\": \"agree\",\n\t\t\t\"role\": \"sign\",\n\t\t\t\"rubric_pages\": null,\n\t\t\t\"created\": \"2024-03-20T14:48:26.016-03:00\",\n\t\t\t\"modified\": \"2024-03-20T14:48:26.016-03:00\"\n\t\t}\n\t}\n}"
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
                          "example": "0cac29fb-f0b0-49cb-a476-f3ea0b28d9aa"
                        },
                        "type": {
                          "type": "string",
                          "example": "requirements"
                        },
                        "links": {
                          "type": "object",
                          "properties": {
                            "self": {
                              "type": "string",
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/658ab351-0b30-4482-9126-2a12fed5bdba/requirements/0cac29fb-f0b0-49cb-a476-f3ea0b28d9aa"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "action": {
                              "type": "string",
                              "example": "agree"
                            },
                            "role": {
                              "type": "string",
                              "example": "sign"
                            },
                            "rubric_pages": {},
                            "created": {
                              "type": "string",
                              "example": "2024-03-20T14:48:26.016-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-03-20T14:48:26.016-03:00"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data\"\n\t\t\t},\n\t\t\t\"detail\": \"data deve ser informado(a)\"\n\t\t}\n\t]\n}\n"
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
                                "example": "/data"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "data deve ser informado(a)"
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