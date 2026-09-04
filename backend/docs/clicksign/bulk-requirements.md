---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criação e Exclusão de Requisitos

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
    "/envelopes/{envelope_id}/bulk_requirements": {
      "post": {
        "summary": "Criação e Exclusão de Requisitos",
        "description": "",
        "operationId": "bulk-requirements",
        "parameters": [
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do Envelope.",
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
          }
        ],
        "requestBody": {
          "content": {
            "application/vnd.api+json": {
              "schema": {
                "type": "object",
                "properties": {
                  "atomic:operations": {
                    "type": "array",
                    "items": {
                      "properties": {
                        "op": {
                          "type": "string",
                          "description": "Operação desejada, se for `add` considere o corpo com `data`, se for `remove` considere o corpo com `ref`.",
                          "default": "add",
                          "enum": [
                            "add",
                            "remove"
                          ]
                        },
                        "ref": {
                          "type": "object",
                          "properties": {
                            "type": {
                              "type": "string",
                              "default": "requirements",
                              "enum": [
                                "requirements"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "description": "Id do requisito que deseja excluir do processo."
                            }
                          }
                        },
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
                                  "description": "Define tipo de requisito a ser criado.",
                                  "default": "agree",
                                  "enum": [
                                    "agree",
                                    "provide_evidence",
                                    "rubricate"
                                  ]
                                },
                                "role": {
                                  "type": "string",
                                  "description": "Preenchido somente em caso de `action`: `agree`."
                                },
                                "auth": {
                                  "type": "string",
                                  "description": "Preenchido somente em caso de `action`: `provide_evidence`."
                                },
                                "pages": {
                                  "type": "string",
                                  "description": "Preenchido somente em caso de `action`: `rubricate`."
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
                      },
                      "type": "object"
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
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
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
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
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