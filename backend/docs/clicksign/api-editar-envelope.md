---
updatedAt: 2026-05-28T19:04:45.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Ativar e Editar Envelope

Ativar ou atualizar configurações de um envelope. <br> Para ativar um envelope na plataforma, cada signatário deve possuir pelo menos um critério de autenticação configurado.  Em caso de dúvidas recomendamos a leitura do <Anchor target="_blank" href="https://developers.clicksign.com/docs/guia-de-criacao-o-passo-a-passo-padrao">Guia de criação</Anchor>

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
    "/envelopes/{envelope_id}": {
      "patch": {
        "summary": "Ativar e Editar Envelope",
        "description": "Ativar ou atualizar configurações de um envelope. <br> Para ativar um envelope na plataforma, cada signatário deve possuir pelo menos um critério de autenticação configurado.  Em caso de dúvidas recomendamos a leitura do <Anchor target=\"_blank\" href=\"https://developers.clicksign.com/docs/guia-de-criacao-o-passo-a-passo-padrao\">Guia de criação</Anchor>",
        "operationId": "api-editar-envelope",
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
            "description": "ID do Envelope que deseja atualizar",
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
                      "id": {
                        "type": "string",
                        "description": "ID do Envelope que deseja atualizar"
                      },
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
                          "status": {
                            "type": "string",
                            "description": "O status do envelope deve ser `running` para ativá-lo e não é possível retornar ao `draft`.",
                            "enum": [
                              "draft",
                              "running"
                            ]
                          },
                          "name": {
                            "type": "string",
                            "description": "Nome do envelope"
                          },
                          "deadline_at": {
                            "type": "string",
                            "description": "Data limite para o envelope e seus documentos (formato RFC 3339)"
                          },
                          "locale": {
                            "type": "string",
                            "description": "Idioma utilizado nos e-mails, página de assinatura e log do documento.",
                            "enum": [
                              "pt-BR",
                              "en-US"
                            ]
                          },
                          "auto_close": {
                            "type": "boolean",
                            "description": "Finalização automática após a assinatura do último signatário",
                            "enum": [
                              true,
                              false
                            ]
                          },
                          "remind_interval": {
                            "type": "string",
                            "description": "Determina se o documento terá opção de lembretes automáticos ativada ou desativada.",
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
                            "enum": [
                              true,
                              false
                            ]
                          },
                          "default_subject": {
                            "type": "string",
                            "description": "Define o assunto do e-mail que será enviado aos signatários na solicitação de assinatura. <br/>Disponível apenas quando estado é `draft`."
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
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"030f3922-68da-47df-bbe4-068c8f9ae432\",\n\t\t\"type\": \"envelopes\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"name\": \"Envelope de Teste\",\n\t\t\t\"status\": \"running\",\n\t\t\t\"deadline_at\": \"2024-03-16T09:50:35.755-03:00\",\n\t\t\t\"locale\": \"pt-BR\",\n\t\t\t\"auto_close\": true,\n\t\t\t\"rubric_enabled\": true,\n\t\t\t\"remind_interval\": 3,\n\t\t\t\"block_after_refusal\": false,\n\t\t\t\"default_message\": \"Mensagem de envelope\\n- com quebra\\n- de linhas\",\n\t\t\t\"created\": \"2024-02-15T09:50:35.757-03:00\",\n\t\t\t\"modified\": \"2024-02-15T09:50:37.662-03:00\"\n\t\t},\n\t\t\"relationships\": {\n\t\t\t\"documents\": {\n\t\t\t\t\"links\": {\n\t\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/relationships/documents\",\n\t\t\t\t\t\"related\": \"https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/documents\"\n\t\t\t\t}\n\t\t\t},\n\t\t\t\"signers\": {\n\t\t\t\t\"links\": {\n\t\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/relationships/signers\",\n\t\t\t\t\t\"related\": \"https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/signers\"\n\t\t\t\t}\n\t\t\t},\n\t\t\t\"requirements\": {\n\t\t\t\t\"links\": {\n\t\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/relationships/requirements\",\n\t\t\t\t\t\"related\": \"https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/requirements\"\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}"
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
                          "example": "030f3922-68da-47df-bbe4-068c8f9ae432"
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
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432"
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
                              "example": "running"
                            },
                            "deadline_at": {
                              "type": "string",
                              "example": "2024-03-16T09:50:35.755-03:00"
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
                            "default_message": {
                              "type": "string",
                              "example": "Mensagem de envelope\n- com quebra\n- de linhas"
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-02-15T09:50:35.757-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-02-15T09:50:37.662-03:00"
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
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/relationships/documents"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/documents"
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
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/relationships/signers"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/signers"
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
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/relationships/requirements"
                                    },
                                    "related": {
                                      "type": "string",
                                      "example": "https://sandbox.clicksign.com/api/v3/envelopes/030f3922-68da-47df-bbe4-068c8f9ae432/requirements"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/deadline_a2t\"\n\t\t\t},\n\t\t\t\"detail\": \"deadline_a2t não está disponível\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/deadline_a2t"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "deadline_a2t não está disponível"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por 6f3200ae-a89d-4c86-81bf-685ccb71a8d2 não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por 6f3200ae-a89d-4c86-81bf-685ccb71a8d2 não pôde ser encontrado"
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