---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Ativação performática: alta escala e assincronismo

<Callout icon="❗️" theme="error">
  Ativação em alta escala está em desenvolvimento.
</Callout>

Se você quer mais performance, eficiência e economizar recursos, o método de ativação padrão via `PATCH` pode não ser o mais eficiente.

Para garantir que sua aplicação nunca sofra com *timeouts* (tempo de espera esgotado) e que sua fila de processamento flua sem interrupções, a API v3 oferece a **Ativação Assíncrona**.

***

## 🔄 Como funciona o fluxo assíncrono?

Diferente do fluxo comum, onde você espera a Clicksign processar tudo antes de te dar uma resposta, aqui o processo é dividido:

1. **Solicitação:** Você envia um `POST` para o endpoint de ativação dedicada.
2. **Confirmação Imediata:** A Clicksign responde com **202 Accepted**. Isso significa: "Recebi seu pedido e ele é válido. Vou processar agora em segundo plano."
3. **Processamento:** Nossos servidores realizam a ativação, geram os logs e salvam o novo estado.
4. **Notificação Final:** Assim que terminamos, avisamos seu sistema através de um **Webhook**.

***

## 📍 O endpoint de ativação

Diferente da atualização de rascunho, este endpoint é uma **ação de execução**.

| Método | URL (Produção)                                                  |
| :----- | :-------------------------------------------------------------- |
| `POST` | `https://sandbox.clicksign.com/api/v3/envelopes/{key}/activate` |

> **Documentação Técnica:** Confira os detalhes de parâmetros na [Referência da API: Ativar Envelope](https://developers.clicksign.com/reference/api-ativar-envelope).

### Exemplo de Requisição (cURL)

```bash
curl --request POST \
  --url [https://app.clicksign.com/api/v3/envelopes/SUA_CHAVE_DO_ENVELOPE/activate](https://app.clicksign.com/api/v3/envelopes/SUA_CHAVE_DO_ENVELOPE/activate) \
  --header 'Accept: application/vnd.api+json' \
  --header 'Authorization: Bearer SEU_TOKEN_AQUI' \
  --header 'Content-Type: application/vnd.api+json'
```

# ✅ Entendendo a resposta 202 Accepted

Ao utilizar este endpoint, você receberá uma resposta com o corpo vazio e o código HTTP 202.

**Vantagem:** Sua aplicação é liberada em milissegundos. Você não precisa manter uma conexão aberta esperando os processamentos pesados.

**Atenção:** O status 202 não garante que o envelope foi ativado com sucesso, apenas que a solicitação foi aceita para processamento.

## 🔔 O papel obrigatório do webhook

Neste modelo, o seu sistema precisa "ouvir" a Clicksign para saber o resultado final. Certifique-se de que sua URL de Webhook está configurada para receber:

* **envelope\_activated:** O sinal verde. O envelope está ativo e os signatários já podem assinar.
* **envelope\_activation\_failed:** Algo deu errado. O corpo do Webhook trará os detalhes para sua correção.

## 💡 Quando usar este método?

* **Sistemas de Missão Crítica:** Onde você não pode permitir que sua thread de execução fique "travada" aguardando resposta de terceiros.
* **Automação de Lote:** Quando você ativa muitos de envelopes de uma só vez ou eles possuem muitos documentos.

## Próximos Passos ➡️

Precisa consultar o que aconteceu com um envelope específico após a ativação?

<Anchor label="Gerenciamento e Consultas de Envelopes" target="_blank" href="/docs/gerenciamento-consultas-envelope">Gerenciamento e Consultas de Envelopes</Anchor> .

<br />