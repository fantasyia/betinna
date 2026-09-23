# Anexo I — mapa de variáveis do documento único

Fonte: `MODELO DE PROPOSTA TÉCNICA E COMERCIAL_MB IoT - GRUPO TARIFÁRIO A (ANXEO I).docx`
(Leandro, recebido em 23/09/2026).

🔴 **Este é o documento ÚNICO.** Decisão do Léo em 23/09: não é anexo adicional. O
`contrato-variaveis.util.ts` (v4, 12 variáveis) e o `proposta-tecnica-variaveis.util.ts`
(Anexo II) passam a ser **referência histórica**, não base.

---

## 1. O que o app JÁ tem

Conferido contra `schema.prisma` e o util do Anexo II.

| dado do documento | onde já está |
|---|---|
| Razão social, CNPJ, endereço | `Cliente` (relação) |
| Validade da proposta | `Proposta.validoAte` |
| Tag do quadro, tensão, corrente | `PropostaItem.quadroPainel/tensaoV/correnteA` |
| Modelo (MB-xx) | `PropostaItem.produtoNome` + SKU |
| Data Sense / End Point por quadro | sufixo do SKU (`_D.S.` / `_E.P.`) |
| Quantidade, unitário, total por linha | `PropostaItem.quantidade/precoUnitario/total` |
| Prazo de entrega / instalação / software | `Proposta.prazoEntregaDias/prazoInstalacaoDias/prazoSoftwareDias` |
| Vigência, dia de vencimento, carência | `Proposta.prazoMeses/diaVencimento/carenciaDias` |
| Signatário do cliente | `Proposta.signatarioNome/Email/Telefone` |

**A coluna `In` (corrente) do item 06 é ganho novo.** O Anexo II antigo não tinha
corrente na tabela, e o campo `correnteA` foi criado justamente porque é ela que
seleciona o modelo. Agora o documento pede — e o app já guarda.

---

## 2. O que FALTA no app (gera código)

### 2.1 🔴 Dois valores, não um — é o buraco estrutural

O documento diz, com todas as letras (item III):

> "a presente proposta-contrato contém **02 modalidades de negócios jurídicos**:
> a) a prestação de serviços para a implementação do projeto; b) a locação de bens móveis"

E cobra os dois **separadamente**:

- **7.1** → aluguel **mensal** (item III.b)
- **7.2** → instalação + materiais + customização, valor **único**, em 2 parcelas (item III.a)

O app tem **um** `Proposta.valor` e um enum `modalidade` que é `VENDA` **ou** `LOCACAO`.
Este documento é os dois **ao mesmo tempo**, numa proposta só.

**Falta:** um segundo bucket de dinheiro na proposta (serviços de implantação), separado
do total de locação. Sem isso, ou o aluguel mensal sai somado à instalação, ou a
instalação não aparece.

### 2.2 O quarto prazo

O item 08 tem **quatro** prazos, não três:

| inciso | prazo | campo |
|---|---|---|
| III | Entrega dos produtos | `prazoEntregaDias` ✅ |
| IV | Instalação dos produtos | `prazoInstalacaoDias` ✅ |
| V | **Verificação de funcionamento** | ❌ **não existe** |
| VI | Habilitação do software | `prazoSoftwareDias` ✅ |

**Falta:** `Proposta.prazoVerificacaoDias`.

⚠️ E as âncoras de contagem são **diferentes entre si** — III conta da comunicação da
data, IV conta da entrega, V conta do término da obra, VI conta do término das obras.
Não dá pra derivar um do outro.

### 2.3 Os dois códigos PC e PT

O documento usa **dois** números que se referenciam (cabeçalho + item 07), e o app tem
**um** `Proposta.numero` = `PROP-XXXX`.

### 2.4 Valor unitário e quantidade da customização

O 7.2 tem `VALOR UNITÁRIO / QUANTIDADE / VALOR TOTAL` para "Customização" — três campos
que hoje não existem em lugar nenhum.

---

## 3. Mapa de variáveis

Convenção: `{{snake_case}}`, igual ao que o modelo v4 já usa.

### 3.1 Cabeçalho

| no documento | variável |
|---|---|
| `PC-(código da proposta)` | `{{proposta_pc}}` |
| `PT-(código da proposta)` | `{{proposta_pt}}` |
| `(dia) de (mês) de 2026` | `{{data_emissao_extenso}}` |
| `__/__/2026` (validade) | `{{validade}}` |
| `(RAZÃO SOCIAL DO CLIENTE)` | `{{cliente_razao_social}}` |
| `__.___.___/____-__` | `{{cliente_cnpj}}` |
| `(LOGRADOURO), n. (NÚMERO), …` | `{{cliente_endereco}}` (linha composta no código) |

⚠️ **O ano `2026` está CRAVADO no .docx** em três lugares (emissão e validade ×2).
Tem que entrar na variável, senão o documento vira uma bomba-relógio de virada de ano.

### 3.2 Corpo — razão social repetida

`(RAZÃO SOCIAL DO CLIENTE)` aparece **7 vezes** (itens 04, 05, III.d, 08.II, 09, e na
linha de assinatura). Todas são a mesma `{{cliente_razao_social}}` — o ClickSign repete
a mesma variável sem problema.

### 3.3 Item 06 — Relação de Circuitos (N linhas)

Por linha, com `NN` de `01` a `MAX`:

```
{{q_NN_tag}}       Tag do quadro/painel
{{q_NN_corrente}}  (__)A
{{q_NN_tensao}}    (__)V
{{q_NN_modelo}}    MB (__)
{{q_NN_iot}}       S / N
```

`{{q_NN_iot}}` sai de `S` quando o SKU tem sufixo `_D.S.` ou `_E.P.`, `N` quando é MB puro.
Não precisa de campo novo — é derivável.

### 3.4 Item 07 — texto

`"definido por meio da Proposta Técnica PT-(código)"` → `{{proposta_pt}}`

### 3.5 Item 7.1 — Locação mensal (N linhas)

```
{{loc_NN_item}}      "MB-04 / Data Sense", "MB-04 / End Point", "MB-04"
{{loc_NN_unitario}}  R$ ___,__
{{loc_NN_qtd}}       (__)
{{loc_NN_total}}     (__)
{{locacao_mensal_total}}
```

🔴 **O rótulo da linha tem que ser VARIÁVEL, não fixo.** Hoje o .docx traz
`MB-(__) / Data Sense` na linha 1 e `MB-(__) / End Point` na linha 2, cravados. Isso
assume que toda proposta tem exatamente um Data Sense e um End Point — e não é verdade:
proposta sem acompanhamento não tem nenhum dos dois, e proposta com vários painéis tem
vários End Points de modelos diferentes. Ver apontamento **A5**.

### 3.6 Item 7.2 — Customização

```
{{custom_unitario}}
{{custom_qtd}}
{{custom_total}}
{{servicos_total}}     "Valor Total de Instalação, Materiais e Customização"
```

### 3.7 Item III — Condições de pagamento

```
a) {{servicos_total}} … em 2 parcelas de {{servicos_parcela}}
b) {{locacao_mensal_total}}
```

`{{servicos_parcela}}` = `servicos_total / 2`, derivado. Os prazos "30 e 60 dias" e
"60 meses" / "12 meses" / "48 meses" são texto FIXO no documento — não viram variável.

### 3.8 Item 08 — Prazos

```
{{prazo_entrega}}      III
{{prazo_instalacao}}   IV
{{prazo_verificacao}}  V   ← campo novo
{{prazo_software}}     VI
```

📌 **Uma variável por prazo, contendo `"10 (dez)"` inteiro** — numeral e extenso juntos.
O documento escreve `__ (____) dias`, que são dois buracos. Separar em duas variáveis
cria a chance de saírem dessincronizados (`15 (dez)`) num documento que alguém assina.
O helper de número por extenso já existe no `proposta-tecnica-variaveis.util.ts`.

### 3.9 Item 10

`"Esta proposta tem validade até __/__/2026"` → `{{validade}}` (a mesma do cabeçalho).

---

## 4. Apontamentos para o Leandro

Coisas do TEXTO que precisam de decisão dele, não de código.

**A1 · Relatório mensal ou bimestral?** O item 03 promete
*"Emissão **mensal** de Relatórios Técnicos"*, e a nota de rodapé do mesmo item diz
*"\*Relatórios Analíticos **Bimestrais** — a cada 02 meses"*. São obrigações diferentes
no mesmo item, e é cláusula de entrega.

**A2 · "Valor Total da Locação Mensal (60 meses)".** O rótulo pode ser lido como
*soma dos 60 meses*. Pelo item III.b é o **valor mensal**. Se alguém preencher como total
do período, o contrato sai 60× errado. Sugestão: *"Valor Total da Locação Mensal
(vigência de 60 meses)"*.

**A3 · O asterisco órfão.** O 7.2 tem `QUANTIDADE*` — e não existe nota de rodapé
correspondente.

**A4 · PC e PT no mesmo documento.** O cabeçalho traz *"Proposta n. PC-"* e
*"Proposta Técnica de referência PT-"*, e o item 07 referencia o PT de novo — mas este
documento **é** a proposta técnica e comercial. Ele se referencia a si mesmo.
Sugestão: mesmo número, dois prefixos (`PC-0007` / `PT-0007`), gerados da mesma proposta.

**A5 · A tabela 7.1 assume uma topologia que nem toda proposta tem.** Linha 1 cravada
como *Data Sense*, linha 2 como *End Point*, e três linhas de MB puro. Proposta sem
acompanhamento não tem Data Sense nem End Point; proposta com 4 painéis monitorados tem
1 Data Sense e 3 End Points, possivelmente de modelos diferentes. Sugestão: deixar a
coluna ITEM livre nas 5 linhas.

**A6 · Quantas linhas as tabelas precisam ter?** Modelo do ClickSign **não faz linha
dinâmica** — o número de linhas do .docx é fixo, e as sobrando saem em branco. Hoje são
**5** no item 06 e **5** no 7.1. Um levantamento com 8 quadros não cabe.

**A7 · Parágrafo duplicado.** A descrição do Master Block ("filtro híbrido… 100 kHz")
aparece **duas vezes** no item 2, provavelmente uma caixa de texto sobreposta. Conferir
no Word.

**A8 · Erros de digitação.** `Sotware` (título do 7.2) · `contatados` → `contados`
(item 08, III) · `a a Somatec Blocking` (item 08, III).

---

## 5. Onde a coleta entra no app

Tudo que virou variável precisa sair de algum lugar. Duas telas:

**Levantamento de campo** (`LevantamentoCampoPage`) — já coleta tag, tensão, corrente e
acompanhamento por quadro. **Cobre os itens 06 e 7.1 inteiros.** Nada novo.

**Fechamento da proposta** — é onde entra o que falta:

- os **4 prazos** (hoje são 3 na tela)
- o **valor de serviços** (instalação + materiais + customização): unitário e quantidade
- a **validade** da proposta (já existe em `validoAte`, falta estar na tela)
