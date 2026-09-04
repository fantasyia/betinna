---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# /envelopes/{id_do_envelope}/documents 

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
    "/envelopes/{id_do_envelope}/documents ": {
      "post": {
        "description": "",
        "operationId": "post_new-endpoint",
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "json": {
                      "type": "string",
                      "format": "json"
                    }
                  }
                },
                "examples": {
                  "Created": {
                    "summary": "Created",
                    "value": {
                      "data": {
                        "id": "7c1e96d7-2b78-49e2-ae8b-7baa0a417d30",
                        "type": "documents",
                        "links": {
                          "self": "...",
                          "files": {
                            "original": "..."
                          }
                        },
                        "attributes": {
                          "status": "draft",
                          "filename": "clicksign.pdf",
                          "template": null,
                          "metadata": {
                            "position_sign_fields": []
                          },
                          "migrated": false,
                          "created": "2025-10-09T13:35:20.468-03:00",
                          "modified": "2025-10-09T13:35:20.556-03:00"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "Bad Request",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "property1": {
                      "type": "string"
                    }
                  }
                },
                "examples": {
                  "Bad Request": {
                    "summary": "Bad Request",
                    "value": {
                      "errors": [
                        {
                          "code": "bad_request",
                          "status": 400,
                          "source": {
                            "pointer": "/data/attributes/duplicate"
                          },
                          "detail": "duplicate deve ser um hash"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Not Found",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "property1": {
                      "type": "string"
                    }
                  }
                },
                "examples": {
                  "Not Found": {
                    "summary": "Not Found",
                    "value": {
                      "errors": [
                        {
                          "code": "bad_request",
                          "status": 400,
                          "source": {
                            "pointer": "/data/attributes/duplicate"
                          },
                          "detail": "duplicate deve ser um hash"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "422": {
            "description": "Unprocessable Entity",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "property1": {
                      "type": "string"
                    }
                  }
                },
                "examples": {
                  "Unprocessable Entity": {
                    "summary": "Unprocessable Entity",
                    "value": {
                      "errors": [
                        {
                          "title": "não pode ficar em branco",
                          "detail": "content - não pode ficar em branco",
                          "code": "100",
                          "source": {
                            "pointer": "/data/attributes/content"
                          },
                          "status": "422"
                        },
                        {
                          "title": "deve ser maior ou igual à 1 byte",
                          "detail": "content - deve ser maior ou igual à 1 byte",
                          "code": "100",
                          "source": {
                            "pointer": "/data/attributes/content"
                          },
                          "status": "422"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "503": {
            "description": "Service Unavailable",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "property1": {
                      "type": "string"
                    }
                  }
                },
                "examples": {
                  "Service Unavailable": {
                    "summary": "Service Unavailable",
                    "value": "// O erro pode estar relacionado a não ativação do envelope em sua conta.\n// Entre em contato com o suporte para ativar ajuda@clicksign.com.\n{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"service_unavailable\",\n\t\t\t\"status\": 503,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"Serviço indisponível\"\n\t\t}\n\t]\n}"
                  }
                }
              }
            }
          }
        },
        "parameters": [
          {
            "in": "header",
            "name": "Authorization",
            "schema": {
              "type": "string"
            },
            "description": "Access Token gerado pelo gestor da conta",
            "required": true
          },
          {
            "in": "header",
            "name": "Content-type",
            "schema": {
              "type": "string",
              "enum": [
                "application/vnd.api+json"
              ]
            },
            "description": "Content-type padrão para todas requisições JSON:API",
            "required": true
          },
          {
            "in": "path",
            "name": "id_do_envelope",
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
                        "enum": [
                          "documents"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "filename": {
                            "type": "string",
                            "description": "Nome do arquivo com extensão do arquivo (.pdf, .docx, .doc, .txt, .png, .jpeg)."
                          },
                          "duplicate": {
                            "type": "object",
                            "properties": {
                              "key": {
                                "type": "string",
                                "description": "Chave UUID do documento que será duplicado"
                              }
                            },
                            "description": "Atributos de duplicação do documento"
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