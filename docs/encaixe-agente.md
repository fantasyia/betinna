# Encaixe automático — protocolo do agente local (GPU)

O Betinna guarda a fila de riscos e os resultados. Quem **encaixa** é o agente
no PC do Léo (RTX 5090, protótipo Python/CuPy). O agente fala com a API do
Betinna por HTTP com um **token de escopo `encaixe`** (Quadros → Tokens de API).
Esse escopo só abre `/erp/encaixe/agente/*` — o resto do ERP fica fechado.

Base: `https://api-production-9426.up.railway.app/api/v1`
Cabeçalho: `Authorization: Bearer <token>`

## Regras

- **Um trabalho por vez.** Com outro RODANDO na empresa, `proximo` não entrega
  nada (a GPU só aguenta um; dois processos travaram o PC).
- **Mande notícia.** Sem `progresso` por **10 min**, ou passado
  `tempoMin + 15 min` desde que pegou, o trabalho vira FALHOU ("agente parou de
  responder"). Mande `progresso` a cada melhora, ou ao menos a cada 2–3 min.
- **Cancelamento.** A tela pode cancelar. A resposta do `progresso` traz
  `status`: se não for `RODANDO`, **pare** e não mande resultado.

## Ciclo

### 1. Pegar trabalho

`POST /erp/encaixe/agente/proximo` (sem corpo)

```json
{ "trabalho": null, "motivo": "Já tem um encaixe rodando" }
```
ou
```json
{
  "trabalho": {
    "id": "cm…",
    "tempoMin": 30,
    "entrada": {
      "versao": 1,
      "op": { "id": "…", "numero": "OP-0003" },
      "modelo": { "id": "…", "nome": "Bermuda Moletom Summer", "codigoMolde": "100" },
      "linha": { "modeloLinhaId": "…", "nome": "Infantil" },
      "composicao": [{ "tamanho": "2", "quantidade": 1 }, { "tamanho": "4", "quantidade": 1 }],
      "regras": {
        "codigoMolde": "100",
        "tecido": "TUBULAR",
        "larguraUtilMm": 1030,
        "espelhar": true,
        "giroCorpo": "GIRA_180",
        "giroForro": "LIVRE",
        "encavalamentoMm": 0,
        "espacamentoMm": 0
      },
      "plotter": { "formato": "HPGL", "escala": 1, "larguraPapelMm": 1850, "unidadesPorMm": 40 },
      "tempoMin": 30
    }
  },
  "motivo": null
}
```

- `codigoMolde` = a pasta em `I:\Meu Drive\Documentos\PCP\Moldes Computadorizados\<código>\`.
- `composicao` = quantas peças de **cada tamanho** vão NO risco (ex.: "1 de cada").
- `linha.nome` diz qual DXF usar (Infantil: 1 DXF por tamanho; Regular/Plus: base + `.RUL`).
- Tubular: o risco leva 1 de cada peça (o par sai do tubo).
- `unidadesPorMm: 40` é o HPGL padrão — **confira** contra um `.plt` real
  (`I:\Meu Drive\Documentos\PCP\Riscos\Moletinho\03.plt` × o comprimento em cm
  no nome do `.ord`) antes do primeiro risco de verdade.

Sem trabalho: espere ~15 s e pergunte de novo.

### 2. Progresso (a cada melhora)

`POST /erp/encaixe/agente/:id/progresso`

```json
{ "comprimentoM": 1.984, "aproveitamento": 85.7, "iteracoes": 120000, "imagemPng": "<base64>" }
```

Tudo opcional. A imagem (PNG em base64, sem `data:`) vira a prévia na tela da
OP. Resposta: `{ "status": "RODANDO" }` — qualquer outro status = pare.

### 3. Entregar

`POST /erp/encaixe/agente/:id/resultado`

```json
{
  "comprimentoM": 1.984,
  "aproveitamento": 85.7,
  "plt": "NE7495,1072; IN; VS32,1..8; WU0; PW0.350,1..8; PU; SP1; PU…; PD…;",
  "imagemPng": "<base64>",
  "dxf": null,
  "detalhes": { "segundos": 1800 }
}
```

- `plt`: HPGL **em texto**, como o TEXWARE PLOTTER V4.1 lê, escala 1:1. A
  **largura** do risco tem que caber no papel útil de **185 cm**.
- O Betinna recusa `.plt` que não começa com comando HPGL (`IN;`/`NE…`).
- Limites: `.plt` e DXF até ~15 MB de texto; imagem até ~10 MB.

### 4. Falhou

`POST /erp/encaixe/agente/:id/falha` → `{ "erro": "molde 116 não encontrado na pasta" }`

### Situação

`GET /erp/encaixe/agente/:id` → `{ "id": "…", "status": "RODANDO" }`

## Na tela

OP → bloco **Encaixe (risco)**: escolhe a grade, as peças de cada tamanho no
risco e o tempo da GPU → "Gerar risco". Mostra a prévia enquanto roda e, pronto,
o comprimento, o aproveitamento, a imagem e o **Baixar .plt**. Regras e código
do molde ficam na ficha técnica do modelo (Regras de encaixe).
