# API do Tiny (Olist) — especificação oficial

**Antes de afirmar que a API do Tiny "não faz X", procure aqui.** Este diretório
existe porque o contrário já custou trabalho manual ao cliente: eu disse duas
vezes que uma operação não existia depois de testar UMA rota no chute, e nas
duas vezes ela existia e estava documentada.

## Arquivos

| Arquivo | O que é |
|---|---|
| `openapi.json` | A especificação OpenAPI **oficial e completa** (202 operações). |
| `endpoints.txt` | Índice `MÉTODO /rota — resumo`, ordenado por rota. É o arquivo pra `grep`. |

## Como usar

```bash
# "existe jeito de apagar anexo de produto?"
grep -i anexo backend/docs/tiny/endpoints.txt

# corpo e parâmetros exatos de uma operação
node -e "console.log(JSON.stringify(require('./backend/docs/tiny/openapi.json').paths['/produtos/{idProduto}/anexos'], null, 2))"
```

## Como atualizar

```bash
curl -s -L -o backend/docs/tiny/openapi.json \
  https://erp.tiny.com.br/public-api/v3/swagger/swagger.json
node backend/docs/tiny/gerar-indice.js
```

A UI de referência do mesmo arquivo:
<https://erp.tiny.com.br/public-api/v3/swagger/index.html>

## Armadilhas já confirmadas na prática

Coisas que a spec **não** diz e que só apareceram batendo na API de verdade:

- **`DELETE /produtos/{id}/anexos` leva o id no CORPO, não na URL.**
  `DELETE /produtos/{id}/anexos/{idAnexo}` devolve 404 — foi o 404 que me fez
  concluir errado que não dava pra apagar. O certo é corpo
  `{ "id": <idAnexo>, "externo": false }` → **204**. Um anexo por chamada.
- **`POST /produtos/{id}/anexos` EMPILHA** — não substitui. Trocar imagem sem
  apagar a anterior deixa duas.
- **`PUT /produtos/{id}/anexos` substitui a lista inteira**, mas **estoura 500
  com lista vazia** — pra zerar, use o DELETE, um a um.
- **O Tiny BAIXA a imagem** da URL enviada (`externo: false`) e guarda cópia
  própria no S3 dele. Reescrever o arquivo na origem não muda nada no ERP.
- **Lista de preços não tem DELETE da lista** — só
  `DELETE /listas-precos/{idLista}/produtos/{idProduto}`, que esvazia. Apagar a
  lista em si é só pelo painel. (Aqui o "não dá" está certo — mas por checagem,
  não por chute.)
- **Produto: `DELETE` é lógico** (`situacao: 'E'`), e o SKU volta a ficar livre.
- **Campo que a API não reconhece é ignorado em silêncio** — responde 200/204
  como se tivesse gravado. Confira lendo de volta.
- **Rate limit é agressivo (429).** Toda varredura precisa de pausa + retry;
  sem isso o 429 se disfarça de "não existe" / "sem anexo".
