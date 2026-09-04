---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Criar Documento por Upload

Adicionar um Documento ao Envelope a partir do base64 de um arquivo.

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
    "/envelopes/{envelopeid}/documents": {
      "post": {
        "summary": "Criar Documento por Upload",
        "description": "Adicionar um Documento ao Envelope a partir do base64 de um arquivo.",
        "operationId": "api-upload-documentos",
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
            "in": "path",
            "name": "envelopeid",
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
                        "default": "documents",
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
                          "content_base64": {
                            "type": "string",
                            "description": "Base64 do arquivo desejado, consulte os formatos aceitos para [Documentos](https://developers.clicksign.com/docs/documentos) "
                          },
                          "metadata": {
                            "type": "string",
                            "description": "JSON com metadados que são utilizados nos retornos de documentos via webhooks.",
                            "format": "json"
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
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"d3f350f7-498f-465e-89e5-f24cc6d7da2b\",\n\t\t\"type\": \"documents\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/25f4de6c-0938-496a-9ee7-54dd92bf38d5/documents/d3f350f7-498f-465e-89e5-f24cc6d7da2b\",\n\t\t\t\"files\": {\n\t\t\t\t\"original\": \"https://clicksign-sandbox-content.s3.amazonaws.com/2024/03/04/12/29/31/553d80d2-fb18-4017-babf-eee714bafe4d/contrato3-2024-03-04T09%3A25%3A35.784152-03%3A00.pdf?X-Amz-Expires=299&X-Amz-Date=20240304T122932Z&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEHsaCXVzLWVhc3QtMSJGMEQCIHyYg09owqVR4R0zziI%2BXyXsSY681URT8tphZqFkkB5wAiA2Hx5wTJPiXnshGmO1vB6LLbL1lcXiQFFeJIGCy7gyACq6BQh0EAMaDDc0MDY2MjI3ODc5MyIMLTrL0qmZvz1cf%2BoYKpcFSS220xXilGDtFlaeR6tmgsatxkZ266LO5SmY9BO61MSFpQiT9EPiK8Mj46TEP5xQCv2epvHSj2KZh9w12xrygNe%2Bu%2FdYePdP%2Bzmm232l7atFEHOQBN0euo8jFdQQb79%2Bj1hZ46Rp0ZUYoFxIaGVaZQgAUjGRKwediGLhTVy7XH4gIy2ihQSkhm%2BWp7PIZTvuuekp4s4vpY0kx3yxroIA%2F8wiha%2FX2mmaAkzr%2Fh2xZxJtLpCW7XLdBcWLbkPBcekCzSe162HACGqsccvTIdXIMvQAKO1LxhtpOWrvwhNYdgbyj%2FINrwZSYASpm0S9kVIE1aUwoPwpnqRI6dMFOkwPJc0Og4FBX%2F%2BqVVK2PsfSWprRfVAGSqFuzzHXMNL0Qftw2g1A4TlyEQNiNAIHprV29NE54DuaTBKPKVgHSBGDEIJ1JYKCYEDS%2BU8MQJ4jaEgy4YqlbeVw8YOWBmY1rSnPLNYtFBeIy2yofddTV2KkCo2JkGCB05q2%2B67Gl%2BvHbAOe9WNrlUxmVzX%2FNsipr0yvfC8zAigr%2FNVC1U2MPBHnrOVNB9k0pnSUhdGRX7%2Bd7yHLjbFBPdXuXalpVa%2Fa8Df%2BGjsozMu8UQ2bGKxa%2BWUZHGHLT%2BKzpalylu8UeaI0WfSsjN6g2xBkCQkD7gEnsBnnSLA9qZKRcZxR8P6NwIdBdw6ASH%2FIocRgjam8E%2BzTRcpq%2B1qZo8Spd4taWD87ysf%2FYmXR4I9hWSM0NEcksZzzEoNSioOKEiRD0MxJrlimWhegDQKZbdiiOY0xru%2BLg8BthdKFpIX1pFDUrysw6bNTf1p4cMCD%2F4qPggmM57cYI1V6ZhgcWD4e6Vjcqdoqmfo%2Bh5c8INAwIVQHbfJn%2BjPkAaLmcJe9UPkNMOnIlq8GOrIB41pXdu9LiQtlZRcyQaaVRnWEIpVB%2Fm5EAetNmjkBPjGJ0huTDHXyDAVP0C%2BmR0eOXGLlLKUQQz5X7SRUtiHH6Tse6vV3gjHf4gkblS5TmlwNjr8QQFaM9vl8U9gYwWsm17SS6554sUqm42mPq6QrslnHs6DVjbLWCinti1QY%2B%2BCkxY%2FjqZFM6h5hRLi4fwuSB3SDebm7aVuK6tjX6EJks3xaASqEgLiWw0G%2FxOg0CCl9gw%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA2Y4XJPKE2PR5IGHH%2F20240304%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=6f4ac129fc289ed235fcef02a6a6a87e5c75ab04342de8d83e9871ac087c51c4\"\n\t\t\t}\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"status\": \"draft\",\n\t\t\t\"filename\": \"contrato3-2024-03-04T09:25:35.784152-03:00.pdf\",\n\t\t\t\"template\": null,\n      \"metadata\": { \"key\": \"value\": },\n\t\t\t\"created\": \"2024-03-04T09:29:31.435-03:00\",\n\t\t\t\"modified\": \"2024-03-04T09:29:31.453-03:00\"\n\t\t}\n\t}\n}"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/filename\"\n\t\t\t},\n\t\t\t\"detail\": \"filename não está em um formato válido\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/filename"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "filename não está em um formato válido"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por 694ab0e3-1983-4c0b-9ea4-c8c82b73939f não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por 694ab0e3-1983-4c0b-9ea4-c8c82b73939f não pôde ser encontrado"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"não pode ficar em branco\",\n\t\t\t\"detail\": \"content - não pode ficar em branco\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/content\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t},\n\t\t{\n\t\t\t\"title\": \"deve ser maior ou igual à 1 byte\",\n\t\t\t\"detail\": \"content - deve ser maior ou igual à 1 byte\",\n\t\t\t\"code\": \"100\",\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/content\"\n\t\t\t},\n\t\t\t\"status\": \"422\"\n\t\t}\n\t]\n}"
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
                            "example": "content - não pode ficar em branco"
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
                                "example": "/data/attributes/content"
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
        },
        "deprecated": false
      }
    },
    "/envelopes/{envelopeID}/documents": {
      "post": {
        "summary": "Criar Documento por Modelo",
        "description": "Adicionar um Documento ao Envelope a partir de um Modelo/Template.",
        "operationId": "criar-documento-por-modelo",
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
            "in": "path",
            "name": "envelopeID",
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
                        "default": "documents",
                        "enum": [
                          "documents"
                        ]
                      },
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "filename": {
                            "type": "string",
                            "description": "Nome do arquivo com extensão **.docx**."
                          },
                          "template": {
                            "type": "object",
                            "properties": {
                              "key": {
                                "type": "string",
                                "description": "ID do Modelo utilizado para a criação"
                              },
                              "data": {
                                "type": "string",
                                "description": "Hash/JSON com chave e valor dos valores que alimentarão o modelo.",
                                "default": "{}",
                                "format": "json"
                              }
                            }
                          },
                          "metadata": {
                            "type": "string",
                            "description": "JSON com metadados que são utilizados nos retornos de documentos via webhooks.",
                            "format": "json"
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
                    "value": "{\n\t\"data\": {\n\t\t\"id\": \"d3f350f7-498f-465e-89e5-f24cc6d7da2b\",\n\t\t\"type\": \"documents\",\n\t\t\"links\": {\n\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/25f4de6c-0938-496a-9ee7-54dd92bf38d5/documents/d3f350f7-498f-465e-89e5-f24cc6d7da2b\",\n\t\t\t\"files\": {\n\t\t\t\t\"original\": \"https://clicksign-sandbox-content.s3.amazonaws.com/2024/03/04/12/29/31/553d80d2-fb18-4017-babf-eee714bafe4d/contrato3-2024-03-04T09%3A25%3A35.784152-03%3A00.pdf?X-Amz-Expires=299&X-Amz-Date=20240304T122932Z&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEHsaCXVzLWVhc3QtMSJGMEQCIHyYg09owqVR4R0zziI%2BXyXsSY681URT8tphZqFkkB5wAiA2Hx5wTJPiXnshGmO1vB6LLbL1lcXiQFFeJIGCy7gyACq6BQh0EAMaDDc0MDY2MjI3ODc5MyIMLTrL0qmZvz1cf%2BoYKpcFSS220xXilGDtFlaeR6tmgsatxkZ266LO5SmY9BO61MSFpQiT9EPiK8Mj46TEP5xQCv2epvHSj2KZh9w12xrygNe%2Bu%2FdYePdP%2Bzmm232l7atFEHOQBN0euo8jFdQQb79%2Bj1hZ46Rp0ZUYoFxIaGVaZQgAUjGRKwediGLhTVy7XH4gIy2ihQSkhm%2BWp7PIZTvuuekp4s4vpY0kx3yxroIA%2F8wiha%2FX2mmaAkzr%2Fh2xZxJtLpCW7XLdBcWLbkPBcekCzSe162HACGqsccvTIdXIMvQAKO1LxhtpOWrvwhNYdgbyj%2FINrwZSYASpm0S9kVIE1aUwoPwpnqRI6dMFOkwPJc0Og4FBX%2F%2BqVVK2PsfSWprRfVAGSqFuzzHXMNL0Qftw2g1A4TlyEQNiNAIHprV29NE54DuaTBKPKVgHSBGDEIJ1JYKCYEDS%2BU8MQJ4jaEgy4YqlbeVw8YOWBmY1rSnPLNYtFBeIy2yofddTV2KkCo2JkGCB05q2%2B67Gl%2BvHbAOe9WNrlUxmVzX%2FNsipr0yvfC8zAigr%2FNVC1U2MPBHnrOVNB9k0pnSUhdGRX7%2Bd7yHLjbFBPdXuXalpVa%2Fa8Df%2BGjsozMu8UQ2bGKxa%2BWUZHGHLT%2BKzpalylu8UeaI0WfSsjN6g2xBkCQkD7gEnsBnnSLA9qZKRcZxR8P6NwIdBdw6ASH%2FIocRgjam8E%2BzTRcpq%2B1qZo8Spd4taWD87ysf%2FYmXR4I9hWSM0NEcksZzzEoNSioOKEiRD0MxJrlimWhegDQKZbdiiOY0xru%2BLg8BthdKFpIX1pFDUrysw6bNTf1p4cMCD%2F4qPggmM57cYI1V6ZhgcWD4e6Vjcqdoqmfo%2Bh5c8INAwIVQHbfJn%2BjPkAaLmcJe9UPkNMOnIlq8GOrIB41pXdu9LiQtlZRcyQaaVRnWEIpVB%2Fm5EAetNmjkBPjGJ0huTDHXyDAVP0C%2BmR0eOXGLlLKUQQz5X7SRUtiHH6Tse6vV3gjHf4gkblS5TmlwNjr8QQFaM9vl8U9gYwWsm17SS6554sUqm42mPq6QrslnHs6DVjbLWCinti1QY%2B%2BCkxY%2FjqZFM6h5hRLi4fwuSB3SDebm7aVuK6tjX6EJks3xaASqEgLiWw0G%2FxOg0CCl9gw%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA2Y4XJPKE2PR5IGHH%2F20240304%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=6f4ac129fc289ed235fcef02a6a6a87e5c75ab04342de8d83e9871ac087c51c4\"\n\t\t\t}\n\t\t},\n\t\t\"attributes\": {\n\t\t\t\"status\": \"draft\",\n\t\t\t\"filename\": \"contrato3-2024-03-04T09:25:35.784152-03:00.pdf\",\n\t\t\t\"template\": null,\n      \"metadata\": { \"key\": \"value\": },\n\t\t\t\"created\": \"2024-03-04T09:29:31.435-03:00\",\n\t\t\t\"modified\": \"2024-03-04T09:29:31.453-03:00\"\n\t\t}\n\t}\n}"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"bad_request\",\n\t\t\t\"status\": 400,\n\t\t\t\"source\": {\n\t\t\t\t\"pointer\": \"/data/attributes/filename\"\n\t\t\t},\n\t\t\t\"detail\": \"filename não está em um formato válido\"\n\t\t}\n\t]\n}"
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
                                "example": "/data/attributes/filename"
                              }
                            }
                          },
                          "detail": {
                            "type": "string",
                            "example": "filename não está em um formato válido"
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
                    "value": "{\n\t\"errors\": [\n\t\t{\n\t\t\t\"title\": \"Registro não encontrado\",\n\t\t\t\"detail\": \"O registro identificado por 694ab0e3-1983-4c0b-9ea4-c8c82b73939f não pôde ser encontrado\",\n\t\t\t\"code\": \"404\",\n\t\t\t\"status\": \"404\"\n\t\t}\n\t]\n}"
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
                            "example": "O registro identificado por 694ab0e3-1983-4c0b-9ea4-c8c82b73939f não pôde ser encontrado"
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