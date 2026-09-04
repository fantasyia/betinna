---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Documentos

Listar Documentos de um Envelope

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
    "/envelopes/{envelope_id}/documents": {
      "get": {
        "summary": "Listar Documentos",
        "description": "Listar Documentos de um Envelope",
        "operationId": "api-listar-documentos",
        "parameters": [
          {
            "name": "envelope_id",
            "in": "path",
            "description": "ID do envelope ao qual deseja listar os documentos",
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
            },
            "required": true
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "OK": {
                    "value": "{\n\t\"data\": [\n\t\t{\n\t\t\t\"id\": \"b0cedde9-0ad7-4417-8d94-300709c00d1b\",\n\t\t\t\"type\": \"documents\",\n\t\t\t\"links\": {\n\t\t\t\t\"self\": \"https://sandbox.clicksign.com/api/v3/envelopes/694ab0e3-1983-4c0b-9ea4-c8c82b73939a/documents/b0cedde9-0ad7-4417-8d94-300709c00d1b\",\n\t\t\t\t\"files\": {\n\t\t\t\t\t\"original\": \"https://clicksign-sandbox-content.s3.amazonaws.com/2024/03/01/02/54/19/f51f3531-c248-481a-9694-c6b9ed7b78be/arquivo.pdf?X-Amz-Expires=299&X-Amz-Date=20240304T122700Z&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEHsaCXVzLWVhc3QtMSJGMEQCIHyYg09owqVR4R0zziI%2BXyXsSY681URT8tphZqFkkB5wAiA2Hx5wTJPiXnshGmO1vB6LLbL1lcXiQFFeJIGCy7gyACq6BQh0EAMaDDc0MDY2MjI3ODc5MyIMLTrL0qmZvz1cf%2BoYKpcFSS220xXilGDtFlaeR6tmgsatxkZ266LO5SmY9BO61MSFpQiT9EPiK8Mj46TEP5xQCv2epvHSj2KZh9w12xrygNe%2Bu%2FdYePdP%2Bzmm232l7atFEHOQBN0euo8jFdQQb79%2Bj1hZ46Rp0ZUYoFxIaGVaZQgAUjGRKwediGLhTVy7XH4gIy2ihQSkhm%2BWp7PIZTvuuekp4s4vpY0kx3yxroIA%2F8wiha%2FX2mmaAkzr%2Fh2xZxJtLpCW7XLdBcWLbkPBcekCzSe162HACGqsccvTIdXIMvQAKO1LxhtpOWrvwhNYdgbyj%2FINrwZSYASpm0S9kVIE1aUwoPwpnqRI6dMFOkwPJc0Og4FBX%2F%2BqVVK2PsfSWprRfVAGSqFuzzHXMNL0Qftw2g1A4TlyEQNiNAIHprV29NE54DuaTBKPKVgHSBGDEIJ1JYKCYEDS%2BU8MQJ4jaEgy4YqlbeVw8YOWBmY1rSnPLNYtFBeIy2yofddTV2KkCo2JkGCB05q2%2B67Gl%2BvHbAOe9WNrlUxmVzX%2FNsipr0yvfC8zAigr%2FNVC1U2MPBHnrOVNB9k0pnSUhdGRX7%2Bd7yHLjbFBPdXuXalpVa%2Fa8Df%2BGjsozMu8UQ2bGKxa%2BWUZHGHLT%2BKzpalylu8UeaI0WfSsjN6g2xBkCQkD7gEnsBnnSLA9qZKRcZxR8P6NwIdBdw6ASH%2FIocRgjam8E%2BzTRcpq%2B1qZo8Spd4taWD87ysf%2FYmXR4I9hWSM0NEcksZzzEoNSioOKEiRD0MxJrlimWhegDQKZbdiiOY0xru%2BLg8BthdKFpIX1pFDUrysw6bNTf1p4cMCD%2F4qPggmM57cYI1V6ZhgcWD4e6Vjcqdoqmfo%2Bh5c8INAwIVQHbfJn%2BjPkAaLmcJe9UPkNMOnIlq8GOrIB41pXdu9LiQtlZRcyQaaVRnWEIpVB%2Fm5EAetNmjkBPjGJ0huTDHXyDAVP0C%2BmR0eOXGLlLKUQQz5X7SRUtiHH6Tse6vV3gjHf4gkblS5TmlwNjr8QQFaM9vl8U9gYwWsm17SS6554sUqm42mPq6QrslnHs6DVjbLWCinti1QY%2B%2BCkxY%2FjqZFM6h5hRLi4fwuSB3SDebm7aVuK6tjX6EJks3xaASqEgLiWw0G%2FxOg0CCl9gw%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA2Y4XJPKE2PR5IGHH%2F20240304%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=f5104b365e3805792bccfa981d473c0dd98caab1c79526386a2e63c90ee26164\"\n\t\t\t\t}\n\t\t\t},\n\t\t\t\"attributes\": {\n\t\t\t\t\"status\": \"running\",\n\t\t\t\t\"filename\": \"arquivo.pdf\",\n\t\t\t\t\"template\": null,\n\t\t\t\t\"created\": \"2024-02-29T23:54:19.576-03:00\",\n\t\t\t\t\"modified\": \"2024-02-29T23:56:45.462-03:00\"\n\t\t\t}\n\t\t}\n\t],\n\t\"meta\": {\n\t\t\"record_count\": 1\n\t},\n\t\"links\": {\n\t\t\"first\": \"https://sandbox.clicksign.com/api/v3/envelopes/694ab0e3-1983-4c0b-9ea4-c8c82b73939a/documents?page%5Bnumber%5D=1&page%5Bsize%5D=20\",\n\t\t\"last\": \"https://sandbox.clicksign.com/api/v3/envelopes/694ab0e3-1983-4c0b-9ea4-c8c82b73939a/documents?page%5Bnumber%5D=1&page%5Bsize%5D=20\"\n\t}\n}"
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
                            "example": "b0cedde9-0ad7-4417-8d94-300709c00d1b"
                          },
                          "type": {
                            "type": "string",
                            "example": "documents"
                          },
                          "links": {
                            "type": "object",
                            "properties": {
                              "self": {
                                "type": "string",
                                "example": "https://sandbox.clicksign.com/api/v3/envelopes/694ab0e3-1983-4c0b-9ea4-c8c82b73939a/documents/b0cedde9-0ad7-4417-8d94-300709c00d1b"
                              },
                              "files": {
                                "type": "object",
                                "properties": {
                                  "original": {
                                    "type": "string",
                                    "example": "https://clicksign-sandbox-content.s3.amazonaws.com/2024/03/01/02/54/19/f51f3531-c248-481a-9694-c6b9ed7b78be/arquivo.pdf?X-Amz-Expires=299&X-Amz-Date=20240304T122700Z&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEHsaCXVzLWVhc3QtMSJGMEQCIHyYg09owqVR4R0zziI%2BXyXsSY681URT8tphZqFkkB5wAiA2Hx5wTJPiXnshGmO1vB6LLbL1lcXiQFFeJIGCy7gyACq6BQh0EAMaDDc0MDY2MjI3ODc5MyIMLTrL0qmZvz1cf%2BoYKpcFSS220xXilGDtFlaeR6tmgsatxkZ266LO5SmY9BO61MSFpQiT9EPiK8Mj46TEP5xQCv2epvHSj2KZh9w12xrygNe%2Bu%2FdYePdP%2Bzmm232l7atFEHOQBN0euo8jFdQQb79%2Bj1hZ46Rp0ZUYoFxIaGVaZQgAUjGRKwediGLhTVy7XH4gIy2ihQSkhm%2BWp7PIZTvuuekp4s4vpY0kx3yxroIA%2F8wiha%2FX2mmaAkzr%2Fh2xZxJtLpCW7XLdBcWLbkPBcekCzSe162HACGqsccvTIdXIMvQAKO1LxhtpOWrvwhNYdgbyj%2FINrwZSYASpm0S9kVIE1aUwoPwpnqRI6dMFOkwPJc0Og4FBX%2F%2BqVVK2PsfSWprRfVAGSqFuzzHXMNL0Qftw2g1A4TlyEQNiNAIHprV29NE54DuaTBKPKVgHSBGDEIJ1JYKCYEDS%2BU8MQJ4jaEgy4YqlbeVw8YOWBmY1rSnPLNYtFBeIy2yofddTV2KkCo2JkGCB05q2%2B67Gl%2BvHbAOe9WNrlUxmVzX%2FNsipr0yvfC8zAigr%2FNVC1U2MPBHnrOVNB9k0pnSUhdGRX7%2Bd7yHLjbFBPdXuXalpVa%2Fa8Df%2BGjsozMu8UQ2bGKxa%2BWUZHGHLT%2BKzpalylu8UeaI0WfSsjN6g2xBkCQkD7gEnsBnnSLA9qZKRcZxR8P6NwIdBdw6ASH%2FIocRgjam8E%2BzTRcpq%2B1qZo8Spd4taWD87ysf%2FYmXR4I9hWSM0NEcksZzzEoNSioOKEiRD0MxJrlimWhegDQKZbdiiOY0xru%2BLg8BthdKFpIX1pFDUrysw6bNTf1p4cMCD%2F4qPggmM57cYI1V6ZhgcWD4e6Vjcqdoqmfo%2Bh5c8INAwIVQHbfJn%2BjPkAaLmcJe9UPkNMOnIlq8GOrIB41pXdu9LiQtlZRcyQaaVRnWEIpVB%2Fm5EAetNmjkBPjGJ0huTDHXyDAVP0C%2BmR0eOXGLlLKUQQz5X7SRUtiHH6Tse6vV3gjHf4gkblS5TmlwNjr8QQFaM9vl8U9gYwWsm17SS6554sUqm42mPq6QrslnHs6DVjbLWCinti1QY%2B%2BCkxY%2FjqZFM6h5hRLi4fwuSB3SDebm7aVuK6tjX6EJks3xaASqEgLiWw0G%2FxOg0CCl9gw%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA2Y4XJPKE2PR5IGHH%2F20240304%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=f5104b365e3805792bccfa981d473c0dd98caab1c79526386a2e63c90ee26164"
                                  }
                                }
                              }
                            }
                          },
                          "attributes": {
                            "type": "object",
                            "properties": {
                              "status": {
                                "type": "string",
                                "example": "running"
                              },
                              "filename": {
                                "type": "string",
                                "example": "arquivo.pdf"
                              },
                              "template": {
                                "type": "string"
                              },
                              "created": {
                                "type": "string",
                                "example": "2024-02-29T23:54:19.576-03:00"
                              },
                              "modified": {
                                "type": "string",
                                "example": "2024-02-29T23:56:45.462-03:00"
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
                          "example": 1,
                          "default": 0
                        }
                      }
                    },
                    "links": {
                      "type": "object",
                      "properties": {
                        "first": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/envelopes/694ab0e3-1983-4c0b-9ea4-c8c82b73939a/documents?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                        },
                        "last": {
                          "type": "string",
                          "example": "https://sandbox.clicksign.com/api/v3/envelopes/694ab0e3-1983-4c0b-9ea4-c8c82b73939a/documents?page%5Bnumber%5D=1&page%5Bsize%5D=20"
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