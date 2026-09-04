# API do ClickSign — documentação oficial, local

**Antes de tentar rota no chute, procure aqui.** As 138 páginas da documentação
oficial estão neste diretório em markdown, e 56 delas trazem o OpenAPI embutido.

| arquivo | o que é |
|---|---|
| `_endpoints.txt` | Índice `MÉTODO /rota — resumo [página]`. É o arquivo pra `grep`. |
| `_indice-oficial.txt` | O `llms.txt` da ClickSign — índice de todas as páginas. |
| `*.md` | As páginas, uma a uma, como a ClickSign publica. |

```bash
# "como crio um webhook?"
grep -i webhook backend/docs/clicksign/_endpoints.txt
# aí lê a página que o índice apontou
cat backend/docs/clicksign/api-criar-webhook.md
```

## Como atualizar

```bash
curl -s -L -o backend/docs/clicksign/_indice-oficial.txt https://developers.clicksign.com/llms.txt
# baixar cada URL .md do índice pro diretório e regerar _endpoints.txt
```

Qualquer página da documentação vira markdown acrescentando `.md` na URL — é
assim que este diretório foi montado.

## O que a documentação NÃO conta

As armadilhas que só apareceram batendo na API estão em
[`../clicksign.md`](../clicksign.md), junto da configuração por ambiente. Vale
ler antes de mexer no fluxo de assinatura — várias delas falham **em silêncio**,
que é o pior jeito de descobrir.

## Autenticação

A referência mostra o token no header `Authorization`; o nosso client manda em
`?access_token=`. As duas formas funcionam — a segunda é a que os guias usam.
