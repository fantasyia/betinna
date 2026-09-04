---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Signatários

Listar Signatários de um Envelope

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
      "get": {
        "summary": "Listar Signatários",
        "description": "Listar Signatários de um Envelope",
        "operationId": "api-listar-signatarios",
        "parameters": [
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do envelope ao qual deseja listar os signatários",
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
            }
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": [\n\t\t{\n\t\t\t\"id\": \"305b7b99-7669-4b1b-b0a9-7cbf61ffc680\",\n\t\t\t\"type\": \"signers\",\n\t\t\t\"links\": {\n\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers/305b7b99-7669-4b1b-b0a9-7cbf61ffc680\"\n\t\t\t},\n\t\t\t\"attributes\": {\n\t\t\t\t\"name\": \"Signer One\",\n\t\t\t\t\"birthday\": null,\n\t\t\t\t\"email\": \"signer.one@example.com\",\n\t\t\t\t\"phone_number\": null,\n\t\t\t\t\"location_required_enabled\": false,\n\t\t\t\t\"has_documentation\": true,\n\t\t\t\t\"documentation\": null,\n\t\t\t\t\"refusable\": false,\n\t\t\t\t\"group\": 1,\n\t\t\t\t\"communicate_events\": {\n\t\t\t\t\t\"document_signed\": \"email\",\n\t\t\t\t\t\"signature_request\": \"email\",\n\t\t\t\t\t\"signature_reminder\": \"email\"\n\t\t\t\t},\n\t\t\t\t\"created\": \"2024-03-07T09:15:01.530-03:00\",\n\t\t\t\t\"modified\": \"2024-03-07T09:15:01.530-03:00\"\n\t\t\t}\n\t\t},\n\t\t{\n\t\t\t\"id\": \"3bf8696f-0e81-421e-a2c1-4e9b0b0941a3\",\n\t\t\t\"type\": \"signers\",\n\t\t\t\"links\": {\n\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers/3bf8696f-0e81-421e-a2c1-4e9b0b0941a3\"\n\t\t\t},\n\t\t\t\"attributes\": {\n\t\t\t\t\"name\": \"Signer Two\",\n\t\t\t\t\"birthday\": null,\n\t\t\t\t\"email\": \"signer.two@example.com\",\n\t\t\t\t\"phone_number\": null,\n\t\t\t\t\"location_required_enabled\": false,\n\t\t\t\t\"has_documentation\": true,\n\t\t\t\t\"documentation\": null,\n\t\t\t\t\"refusable\": false,\n\t\t\t\t\"group\": 1,\n\t\t\t\t\"communicate_events\": {\n\t\t\t\t\t\"document_signed\": \"email\",\n\t\t\t\t\t\"signature_request\": \"email\",\n\t\t\t\t\t\"signature_reminder\": \"email\"\n\t\t\t\t},\n\t\t\t\t\"created\": \"2024-03-07T09:15:07.079-03:00\",\n\t\t\t\t\"modified\": \"2024-03-07T09:15:07.079-03:00\"\n\t\t\t}\n\t\t}\n\t],\n\t\"meta\": {\n\t\t\"record_count\": 2\n\t},\n\t\"links\": {\n\t\t\"first\": \"https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers?page%5Bnumber%5D=1&page%5Bsize%5D=20\",\n\t\t\"last\": \"https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers?page%5Bnumber%5D=1&page%5Bsize%5D=20\"\n\t}\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "example": "305b7b99-7669-4b1b-b0a9-7cbf61ffc680"
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
                                "example": "https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers/305b7b99-7669-4b1b-b0a9-7cbf61ffc680"
                              }
                            }
                          },
                          "attributes": {
                            "type": "object",
                            "properties": {
                              "name": {
                                "type": "string",
                                "example": "Signer One"
                              },
                              "birthday": {},
                              "email": {
                                "type": "string",
                                "example": "signer.one@example.com"
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
                                "example": "2024-03-07T09:15:01.530-03:00"
                              },
                              "modified": {
                                "type": "string",
                                "example": "2024-03-07T09:15:01.530-03:00"
                              }
                            }
                          }
                        }
                      }
                    },
                    "meta": {
                      "type": "object",
                      "properties": {
                        "record_count": {
                          "type": "integer",
                          "example": 2,
                          "default": 0
                        }
                      }
                    },
                    "links": {
                      "type": "object",
                      "properties": {
                        "first": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        },
                        "last": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/envelopes/b8239d23-230a-4ab7-82f2-6d68b3fee0fd/signers?page%5Bnumber%5D=1&page%5Bsize%5D=20"
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