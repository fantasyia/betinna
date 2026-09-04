---
updatedAt: 2026-07-20T13:56:39.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Listar Webhooks

Listar Webhooks

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
    "/webhooks": {
      "get": {
        "description": "Listar Webhooks",
        "operationId": "get_webhooks",
        "responses": {
          "200": {
            "description": "Ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "OK": {
                    "summary": "OK",
                    "value": {
                      "data": [
                        {
                          "id": "76f07907-c192-47a0-bef1-178acfd23d09",
                          "type": "webhooks",
                          "links": {
                            "self": "https://sandbox.clicksign.com/api/v3/webhooks/76f07907-c192-47a0-bef1-178acfd23d09"
                          },
                          "attributes": {
                            "endpoint": "https://webhook.site/802a3dd1-cfeb-40a5-9e2e-abcd7eaf6484",
                            "secret": "9269a619d4688ac77816263eb8d04276",
                            "status": "active",
                            "events": [
                              "add_image",
                              "upload",
                              "add_signer",
                              "remove_signer",
                              "sign",
                              "close",
                              "auto_close",
                              "deadline",
                              "document_closed",
                              "cancel",
                              "update_deadline",
                              "update_auto_close",
                              "update_locale",
                              "custom",
                              "refusal",
                              "acceptance_term_enqueued",
                              "acceptance_term_sent",
                              "acceptance_term_completed",
                              "acceptance_term_refused",
                              "acceptance_term_canceled",
                              "acceptance_term_expired",
                              "acceptance_term_error",
                              "attempts_by_whatsapp_exceeded",
                              "attempts_by_liveness_or_facematch_exceeded",
                              "liveness_refused",
                              "facematch_refused",
                              "documentscopy_refused",
                              "biometric_refused",
                              "ocr_refused",
                              "signature_started"
                            ],
                            "created": "2025-05-29T10:29:05.357-03:00",
                            "modified": "2025-12-04T14:21:47.420-03:00"
                          }
                        },
                        {
                          "id": "e72aab68-358d-43e6-9a93-0aaaa1b8bf05",
                          "type": "webhooks",
                          "links": {
                            "self": "https://sandbox.clicksign.com/api/v3/webhooks/e72aab68-358d-43e6-9a93-0aaaa1b8bf05"
                          },
                          "attributes": {
                            "endpoint": "https://example.com23",
                            "secret": "973d92ca80c2206a0e65b35d2371d595",
                            "status": "inactive",
                            "events": [
                              "add_image",
                              "upload"
                            ],
                            "created": "2025-12-04T09:47:58.012-03:00",
                            "modified": "2025-12-04T09:47:58.012-03:00"
                          }
                        }
                      ],
                      "meta": {
                        "record_count": 2
                      },
                      "links": {
                        "first": "https://sandbox.clicksign.com/api/v3/webhooks?page%5Bnumber%5D=1&page%5Bsize%5D=20",
                        "last": "https://sandbox.clicksign.com/api/v3/webhooks?page%5Bnumber%5D=1&page%5Bsize%5D=20"
                      }
                    }
                  }
                }
              }
            }
          },
          "503": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {}
                },
                "examples": {
                  "Service Unavailable": {
                    "summary": "Service Unavailable",
                    "value": "// O erro pode estar relacionado a não ativação do envelope em sua conta.\n// Entre em contato com o suporte para ativar ajuda@clicksign.com.\n{\n\t\"errors\": [\n\t\t{\n\t\t\t\"code\": \"service_unavailable\",\n\t\t\t\"status\": 503,\n\t\t\t\"title\": \"Verificação\",\n\t\t\t\"detail\": \"Serviço indisponível\"\n\t\t}\n\t]\n}"
                  }
                }
              }
            },
            "description": "Service Unavailable"
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
            "description": "Content-type padrão para todas requisições JSON:API (application/vnd.api+json)."
          }
        ],
        "summary": "Listar Webhooks"
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