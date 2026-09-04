---
updatedAt: 2026-06-04T10:38:31.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 4.5. Aceite via WhatsApp

O **Aceite via WhatsApp** é uma solução da Clicksign desenhada para formalizar acordos de forma instantânea e conversacional.

Diferente de uma assinatura eletrônica tradicional que exige a manipulação de arquivos PDF, o Aceite foca na **manifestação de vontade simplificada**. Você envia um texto (termo) diretamente para o celular do cliente, e ele aceita com apenas dois cliques.

***

## Por que escolher o Aceite via WhatsApp?

Diferente do fluxo tradicional de documentos, o Aceite via WhatsApp funciona como um "termo digital". Ele é ideal para situações que exigem rapidez, como:

* Renovação de planos e serviços.
* Aprovação de orçamentos.
* Aceite de termos de uso ou políticas de privacidade.
* Confirmação de entrega ou recebimento.

***

## Validade Jurídica e Segurança

Muitos se perguntam: *"Um aceite via WhatsApp tem o mesmo valor que uma assinatura?"*. **Sim.**

Para cada aceite realizado, a Clicksign gera um **Log de Evidências**, um documento digital que reúne provas técnicas da operação.

***

## A Jornada do Usuário

Para entender como a mágica acontece, veja as quatro etapas do processo:

1. **A Requisição:** Seu sistema envia os dados (nome, telefone e o texto do termo) para a nossa API.
2. **A Mensagem:** O cliente recebe uma notificação oficial da Clicksign no WhatsApp com um link seguro.
3. **A Visualização:** Ao clicar, ele abre uma página otimizada para mobile onde lê o termo completo.
4. **O Aceite:** O cliente clica em "Aceitar" e, instantaneamente, seu sistema é avisado via Webhook

<Image align="center" border={true} width="500px" src="https://files.readme.io/b115854b8cbced0b2d410b3351e48fb921a47f8e5e28e05d03384f0c1d3f2132-image.png" className="border" />

***

## Aceite vs. Documento (Envelope): Qual usar?

Não sabe se deve usar o **Aceite via WhatsApp** ou a **Assinatura de Envelopes**? Use a tabela abaixo para decidir:

| Característica     | Aceite via WhatsApp                                         | Assinatura de Envelopes                            |
| :----------------- | :---------------------------------------------------------- | :------------------------------------------------- |
| **Formato**        | Texto puro ou HTML simples                                  | Arquivo PDF estruturado                            |
| **Complexidade**   | Baixa (Termos rápidos)                                      | Alta (Documentos complexos)                        |
| **Foco**           | Velocidade e Adesão                                         | Formalidade e Detalhe                              |
| **Exemplo de Uso** | Termos de uso, autorização de exames, aceite de orçamentos. | Contratos de aluguel, compra e venda, procurações. |

***

## 🛠️ O que eu preciso para começar?

Para implementar o Aceite via WhatsApp, você precisará de:

1. Um **AccessToken** de API ativo.
2. O **Número do Celular** do cliente (com DDI e DDD).
3. Contratação de um dos planos com a funcionalidade.

***

### Próximo Passo ➡️

Agora que você já entende o conceito, vamos colocar a mão na massa?\
[**Aprenda como Criar o seu primeiro Aceite**](/docs/criação-do-aceite-via-whatsapp)

<Footer3 />