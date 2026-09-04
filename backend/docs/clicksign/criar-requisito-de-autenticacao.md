---
updatedAt: 2026-05-28T20:30:36.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Requisito de Autenticação

Criar Requisito de Autenticação, relacionando um signatário a um documento.<br>Em caso de falhas consulte a <Anchor target="_blank" href="https://developers.clicksign.com/docs/veja-como-funciona-na-pr%C3%A1tica">documentação teórica informando o passo a passo.</Anchor><br>Ainda ficou com dúvidas? <Anchor target="_blank" href="https://www.clicksign.com/suporte">Entre em contato com o suporte.</Anchor>

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
    "/envelopes/{envelopeid}/requirements": {
      "post": {
        "summary": "Criar Requisito de Autenticação",
        "description": "Criar Requisito de Autenticação, relacionando um signatário a um documento.<br>Em caso de falhas consulte a <Anchor target=\"_blank\" href=\"https://developers.clicksign.com/docs/veja-como-funciona-na-pr%C3%A1tica\">documentação teórica informando o passo a passo.</Anchor><br>Ainda ficou com dúvidas? <Anchor target=\"_blank\" href=\"https://www.clicksign.com/suporte\">Entre em contato com o suporte.</Anchor>",
        "operationId": "criar-requisito-de-autenticacao",
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
            "name": "envelopeid",
            "in": "path",
            "description": "ID do Envelope que receberá o requisito.",
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
                            "default": "provide_evidence",
                            "enum": [
                              "provide_evidence"
                            ]
                          },
                          "auth": {
                            "type": "string",
                            "description": "Determina a Autenticação desejada para  assinar. Veja todas as opções na seção de [Requisitos de Autenticação](/v3.0/docs/tipos-de-requisitos-de-autenticacao).",
                            "enum": [
                              "email",
                              "sms",
                              "whatsapp",
                              "pix",
                              "icp_brasil",
                              "handwritten",
                              "selfie",
                              "official_document",
                              "address_proof",
                              "liveness",
                              "facial_biometrics",
                              "identity_biometrics",
                              "auto_signature",
                              "presential",
                              "embedded_signature",
                              "biometric",
                              "documentscopy"
                            ]
                          }
                        },
                        "required": [
                          "action",
                          "auth"
                        ]
                      },
                      "relationships": {
                        "type": "object",
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
                                  "type",
                                  "id"
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
                                  "type",
                                  "id"
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
                      "relationships",
                      "attributes"
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
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"620221cd-f08b-44ee-a128-b892c89d1c7e\",\n\t\t\"type\": \"requirements\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/5900df2b-2677-43cd-8379-07b42688245f/requirements/620221cd-f08b-44ee-a128-b892c89d1c7e\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"action\": \"provide_evidence\",\n\t\t\t\"auth\": \"email\",\n\t\t\t\"created\": \"2024-03-21T10:19:07.799-03:00\",\n\t\t\t\"modified\": \"2024-03-21T10:19:07.799-03:00\"\n\t\t}\n\t}\n}"
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
                          "example": "620221cd-f08b-44ee-a128-b892c89d1c7e"
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
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/5900df2b-2677-43cd-8379-07b42688245f/requirements/620221cd-f08b-44ee-a128-b892c89d1c7e"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "action": {
                              "type": "string",
                              "example": "provide_evidence"
                            },
                            "auth": {
                              "type": "string",
                              "example": "email"
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-03-21T10:19:07.799-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-03-21T10:19:07.799-03:00"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/auth2\"\n\t\t\t},\n\t\t\t\"detail\": \"auth2 não está disponível\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/auth2"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "auth2 não está disponível"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/relationships/document\"\n\t\t\t},\n\t\t\t\"detail\": \"Documento 063acaa0-916c-4262-b8c3-4cefcaf42bc3 não encontrado no envelope\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/relationships/document"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "Documento 063acaa0-916c-4262-b8c3-4cefcaf42bc3 não encontrado no envelope"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"já está em uso\",\n\t\t\t\"detail\": \"action - já está em uso\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/action\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n\t]\n}"
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
                            "example": "já está em uso"
                          },
                          "detail": {
                            "type": "string",
                            "example": "action - já está em uso"
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
                                "example": "/data/attributes/action"
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
        }
      }
    },
    "/envelopes/{envelopeID}/requirements": {
      "post": {
        "summary": "Criar Requisito de Rubrica",
        "description": "Criar Requisito de Rubrica, relacionando um signatário a um documento.<br>Em caso de falhas consulte a <Anchor target=\"_blank\" href=\"https://developers.clicksign.com/docs/veja-como-funciona-na-pr%C3%A1tica\">documentação teórica informando o passo a passo.</Anchor><br>Ainda ficou com dúvidas? <Anchor target=\"_blank\" href=\"https://www.clicksign.com/suporte\">Entre em contato com o suporte.</Anchor>",
        "operationId": "criar-requisito-de-rubrica",
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
            "name": "envelopeID",
            "in": "path",
            "description": "ID do Envelope que receberá o requisito.",
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
                            "default": "rubricate",
                            "enum": [
                              "rubricate"
                            ]
                          },
                          "pages": {
                            "type": "string",
                            "description": "Informe as páginas que receberão as iniciais do signatário separadas por vírgula. Caso a rubrica seja para todas as páginas, utilize a opção all"
                          },
                          "kind": {
                            "type": "string",
                            "description": "Informe qual será o tipo da rubrica",
                            "enum": [
                              "initials",
                              "manuscript"
                            ]
                          },
                          "rubric_field": {
                            "type": "string",
                            "description": "Tag de assinatura posicionada que será vinculada ao signatário"
                          }
                        }
                      },
                      "relationships": {
                        "type": "object",
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
                                }
                              }
                            }
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
        "responses": {
          "201": {
            "description": "201",
            "content": {
              "application/json": {
                "examples": {
                  "Created": {
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"f63bddd4-ec62-4151-a903-dc0f89776433\",\n\t\t\"type\": \"requirements\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/2d6f6312-7aab-4015-b614-9f42da3ca9f0/requirements/f63bddd4-ec62-4151-a903-dc0f89776433\"\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"action\": \"rubricate\",\n\t\t\t\"pages\": \"1, 2, 3\",\n\t\t\t\"created\": \"2024-03-21T19:13:50.097-03:00\",\n\t\t\t\"modified\": \"2024-03-21T19:13:50.097-03:00\"\n\t\t}\n\t}\n}"
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
                          "example": "f63bddd4-ec62-4151-a903-dc0f89776433"
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
                              "example": "https://sandbox.clicksign.com/api/v3/envelopes/2d6f6312-7aab-4015-b614-9f42da3ca9f0/requirements/f63bddd4-ec62-4151-a903-dc0f89776433"
                            }
                          }
                        },
                        "attributes": {
                          "type": "object",
                          "properties": {
                            "action": {
                              "type": "string",
                              "example": "rubricate"
                            },
                            "pages": {
                              "type": "string",
                              "example": "1, 2, 3"
                            },
                            "created": {
                              "type": "string",
                              "example": "2024-03-21T19:13:50.097-03:00"
                            },
                            "modified": {
                              "type": "string",
                              "example": "2024-03-21T19:13:50.097-03:00"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"não pode ficar em branco\",\n\t\t\t\"detail\": \"pages - não pode ficar em branco\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/pages\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t},\n\t\t{\n\t\t\t\"title\": \"já está em uso\",\n\t\t\t\"detail\": \"action - já está em uso\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/action\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n\t]\n}"
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
                            "example": "não pode ficar em branco"
                          },
                          "detail": {
                            "type": "string",
                            "example": "pages - não pode ficar em branco"
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
                                "example": "/data/attributes/pages"
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
          "404": {
            "description": "404",
            "content": {
              "application/json": {
                "examples": {
                  "Not Found": {
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/relationships/document\"\n\t\t\t},\n\t\t\t\"detail\": \"Documento 063acaa0-916c-4262-b8c3-4cefcaf42bc3 não encontrado no envelope\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/relationships/document"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "Documento 063acaa0-916c-4262-b8c3-4cefcaf42bc3 não encontrado no envelope"
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
                    "value": {
                      "errors": [
                        {
                          "title": "já está em uso",
                          "detail": "action - já está em uso",
                          "code": "100",
                          "source": {
                            "pointer": "/data/attributes/action"
                          },
                          "status": "422"
                        },
                        {
                          "code": "unprocessable_entity",
                          "status": 422,
                          "detail": "As coordenadas da manuscrita posicionada ainda estão sendo processadas. Aguarde e tente  novamente"
                        },
                        {
                          "title": "já está em uso",
                          "detail": "rubric_field - já está em uso",
                          "code": "100",
                          "source": {
                            "pointer": "/data/attributes/rubric_field"
                          },
                          "status": "422"
                        },
                        {
                          "errors": [
                            {
                              "title": "Deve informar 'pages' ou 'rubric_field'",
                              "detail": "Deve informar 'pages' ou 'rubric_field'",
                              "code": "100",
                              "source": {
                                "pointer": "/data"
                              },
                              "status": "422"
                            }
                          ]
                        }
                      ]
                    }
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
                            "example": "já está em uso"
                          },
                          "detail": {
                            "type": "string",
                            "example": "action - já está em uso"
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
                                "example": "/data/attributes/action"
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