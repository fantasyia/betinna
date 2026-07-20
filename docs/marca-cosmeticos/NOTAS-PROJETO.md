# Projeto — Marca própria de skincare (fabricação 100% terceirizada)

> Documento vivo. Registra as decisões e ideias discutidas para o projeto de uma marca
> própria de cosméticos. Cada nova conversa deve atualizar este arquivo e o
> [`mapa-mental.html`](./mapa-mental.html).
>
> **Status:** exploração/estratégia — pré-lançamento.

---

## 0. Contexto / perfil do fundador

- Fundador opera um SaaS real (Betinna) — multi-tenant, gestão de marketing/vendas. Pensa
  empresa como sistema (funil, recorrência, dados), tem rigor de identidade visual (brandbook)
  e **constrói o próprio software** (D2C, portal de representante, dashboards) sem depender de agência.
- Isso é um **fosso raro** no mercado de beleza: a maioria das marcas trava em tecnologia/operação/dados.
- Parâmetros do 1º ciclo (definidos pelo fundador):
  - **Aquisição:** afirma ter força nos 3 canais (audiência/conteúdo, tráfego pago, representantes).
  - **Capital:** R$ 80–250 mil para o primeiro ciclo.
  - **Linha de foco:** skincare / dermocosmético.

**Veredito de potencial:** alto e acima do fundador típico — *desde que* troque "catálogo grande de
largada" por **linha herói de 6 SKUs + 1 canal de aquisição liderando + terceirizadora com regulatório
incluso**, e use o caixa de mídia para **provar CAC×LTV antes de escalar estoque**.

---

## 1. Fundação regulatória (ANVISA) — pré-requisito de TODOS os canais

Sem regularização o anúncio é derrubado e a conta penalizada. Fiscalização **apertou em 2026**
(medidas contra itens sem procedência).

| Item | O que é |
|---|---|
| CNPJ | Atividade de comércio/importação de cosméticos |
| AFE | Autorização de Funcionamento na ANVISA (distribuir/importar) |
| Licença Sanitária | Vigilância Sanitária estadual/municipal ("alvará") |
| RT | Responsável Técnico — farmacêutico/químico com CRF ativo |
| Notificação (G1) / Registro (G2) | G1 = risco menor (xampu, hidratante); G2 = maior risco (antiqueda, clareador, **protetor solar**, tintura, alisante) |

- Prazo médio ANVISA: **3–6 meses** (na prática 6–12 para iniciantes) → **gargalo, começar já**.
- **Atalho:** escolher terceirizadora que faça "marca própria com regulatório incluso" (notifica sob a
  responsabilidade dela) — corta meses e tira o farmacêutico do custo fixo.
- Anúncio online deve informar: composição, validade, nº registro/notificação, modo de uso, contraindicações.

---

## 2. Produto / catálogo — linha herói, NÃO catálogo grande

**Decisão-chave:** contestado o instinto de "abrir com catálogo grande". Cada SKU extra custa
1 notificação ANVISA + 1 MOQ (pedido mínimo → capital parado) + 1 design + risco de encalhe +
diluição de marketing.

- **Largar com 6 SKUs** em ritual coerente: limpeza · sérum herói (ex.: vit. C / niacinamida) ·
  hidratante · renovador noturno · máscara/óleo de reforço.
- **Protetor solar fica para a fase 2** — é Grau 2 (registro, não notificação): mais caro, lento, exige teste.
- Catálogo amplo = **fase 2**, financiado pela tração da fase 1 e guiado por dado de recompra.

---

## 3. Canais de venda

### Marketplaces (todos aceitam cosmético **regularizado**)
- **Mercado Livre** — maior generalista; exige nº ANVISA no anúncio; medicamento só via ML Farma.
- **Shopee** — ticket baixo/médio, kits; sem registro correto → removido `[312] Venda Restrita – Saúde`.
- **Amazon Brasil** — beleza em destaque; bom para ticket médio/premium.
- **Magalu** — cadastro único vende também em Netshoes, Zattini e **Época Cosméticos**.
- **Pure players de beleza** — **Beleza na Web** e **Época Cosméticos** (ideais para skincare/premium).
- Prós: tráfego pronto, confiança, logística. Contras: comissão 12–20%+, guerra de preço, pouco controle da marca.

### Site próprio (D2C) — margem, marca, recompra
- **Nuvemshop** (iniciante→intermediário, PT-BR, plano grátis / ~R$69) ou **Tray** (integrações fortes).
- Loja Integrada (começo barato), Shopify (pegada internacional), VTEX (enterprise).
- **Recomendado:** Nuvemshop ou Tray. Aqui o fundador **constrói sozinho** → economia + controle.

### Representantes / revenda / venda direta
| Modelo | Como funciona | Margem/custo |
|---|---|---|
| Representante comercial (PJ) | Vende em nome da empresa, sem estoque | ~10% de comissão |
| Revendedor/consultor por catálogo | Compra e revende ao cliente final | 25–50% (Natura/Avon ~30%, Mary Kay 40–50%) |
| Distribuidor | Compra em volume com desconto | 45–50% off, rentabilidade alta |

- Referência de renda do revendedor: 10 clientes ≈ R$300–800/mês; 30+ ≈ R$800–2.000/mês.
- **Sinergia com o SaaS:** portal/app do representante (pedido, comissão, acompanhamento).
- **Prospecção de representantes via betinna.ai** — a venda por representantes usa a **betinna.ai** para
  prospectar/recrutar e nutrir a rede, **no mesmo formato usado pela Somatec**. É um canal confirmado do
  projeto (não "fase futura"): betinna.ai gera/qualifica os representantes e o portal cuida de pedido/comissão.

### Canal profissional / B2B (salões) — para premium/reconstrução — **fase 2**
- Linhas profissionais de tratamento/reconstrução vendem via distribuidor/representação a salões.
- Costuma exigir **CNPJ do ramo de beleza** do comprador (protege preço/posicionamento).
- Estratégia: linha **profissional (salão)** separada da linha **home care (varejo)** da mesma marca.

---

## 4. Aquisição — escolher UM motor

- "Forte nos 3" é risco de dispersão. No ciclo 1, **um lidera**:
  - **Tráfego pago = motor** (mensurável, escala com caixa, casa com perfil de dado/SaaS).
  - **Conteúdo/audiência** reduz CAC.
  - **Representantes** entram na **fase 2** (com produto já validado; SaaS vira o portal de comissão).
- **Validar CAC×LTV com R$ 5–10k antes de comprar estoque grande.**

---

## 5. Capital — R$ 80–250k (referência ~R$150k)

| Bloco | Faixa | Nota |
|---|---|---|
| Estoque inicial (MOQ ~1–3k un × 6 SKUs) | ~40–50% | Maior consumo de caixa; negociar MOQ menor no piloto |
| Regulatório (AFE + RT + notificações) | baixo–médio | Terceirizadora com regulatório incluso reduz |
| Marca, embalagem, foto/vídeo | médio | Ponto forte do fundador — não terceirizar a direção |
| **Mídia / aquisição** | **25–35%** | O que gira o estoque; não gastar tudo em estoque |
| Site próprio | ~zero | Construído internamente |

**Próximo entregável sugerido:** planilha de *unit economics* do ciclo 1 (MOQ, custo/SKU, preço,
margem, CAC-alvo, ponto de equilíbrio).

---

## 6. Comunidade / tribo (transformar marca em tribo)

Ideias-semente (não destrinchadas): nome da tribo · manifesto · ritual assinatura · grupo fechado
(só compradores) · diário de pele · lives recorrentes · **co-criação** (votar próximo SKU) · beta-testers ·
níveis (bronze→ouro) · membro do mês · kit de boas-vindas · **indique e ganhe** · **UGC como moeda** ·
embaixadoras · encontro recorrente · **drops exclusivos**.

- **Edge do SaaS:** níveis, pontos, recompra, indicação e painel de embaixadora são **features** →
  vira máquina de retenção medível, não "comunidade bonitinha".
- Público **mãe** = tribo mais engajada → conecta direto com a pediatra.

---

## 7. Cashback — "moeda da marca" (fechado, em R$)

**Decisão:** cashback como **moeda de sistema fechado** — nome/ícone próprios, **lastro fixo em R$**,
só gasta na loja, não saca, **expira** — construída **dentro do SaaS**.

- **Cripto própria e token lastreado em stablecoin: DESCARTADOS** para cashback.
  - Vira produto financeiro regulado (Banco Central/CVM — Lei 14.478/2022), custódia + resgate + reservas.
  - Lastro em stablecoin **trava capital 1:1** e reintroduz volatilidade cambial (se USD).
  - Só faria sentido se o token fosse sacável/negociável/interoperável = **outro negócio**, fase futura,
    com advogado de cripto antes de emitir.

---

## 8. Parceria com pediatra (oportunidade concreta)

- Conexão **quente**: esposa do Leandro (dono da Somatec) é pediatra.
- **Valor:** (a) abre **linha Baby/Kids** — categoria grande, recompra alta, pais pagam premium por segurança;
  (b) vira **selo de confiança** da marca inteira (pele sensível, gestante, pós-parto);
  (c) **voz/guardiã do discurso seguro** (evita alegação médica proibida pela ANVISA);
  (d) melhor **isca de comunidade** para o público mãe.
- **Estrutura (leve → casada):** embaixadora/consultoria (cachê + %) · royalty sobre a linha dela ·
  sócia (equity). **Recomendado começar leve** (embaixadora + royalty) com teste 6–12 meses → equity depois.
- **Piloto:** linha baby de **2–3 SKUs** (hidratante, banho, proteção de barreira/assadura) — baixo risco.
- **Cuidados:** contrato/papéis/saída no papel desde o início (sociedade com conhecidos); checar regras do
  conselho dela sobre associar nome a produto; linha infantil tem regulatório um pouco mais rígido.

---

## 9. Roadmap resumido

**Fase 1 (0–12 meses):** regularizar (ANVISA/terceirizadora) · lançar **HOG Rosto + HOG Cabelo + HOG Baby**
(~15 SKUs no core) · site próprio D2C + 2–3 marketplaces · tráfego pago como motor · validar CAC×LTV ·
semear comunidade · cashback fechado no SaaS.

**Fase 2:** ampliar por dado de recompra · protetor solar (G2) · reativar galho Corpo · representantes/embaixadoras
(portal no SaaS) · canal profissional B2B (salão) · níveis de comunidade maduros.

**Fase 3:** Banho · HOG Baby Kids · Profissional salão maduro.

---

## 10. Arquitetura de produtos — árvore genealógica HOG

**Decisões-raiz travadas:**
- **Marca-mãe única: HOG** + **HOG Baby** (linha endossada, mesmo DNA, selo da pediatra).
- **DNA / posicionamento:** *"seguro para um bebê, eficaz para você"* — pele & fio **sensível + respaldo técnico**,
  para a família toda. A pediatra/HOG Baby é o **núcleo genético** (prova de confiança que Rosto e Cabelo herdam),
  não um nicho lateral.
- **Escopo enxuto:** largura por **galhos**, não por profundidade.

**Regras da árvore (governança de SKU):**
1. **Teto de 3–4 SKUs por linha (galho).** Passou disso: poda um antigo ou cria galho novo — nunca engorda o galho.
2. Todo SKU novo precisa de um **porquê de negócio** (herói · gateway de entrada · reposição de recompra).
3. **O DNA tem que aparecer** no produto (sensível + respaldo). Se não carrega, é órfão — corta ou repensa.

**Árvore (v3):**

```
RAIZ — HOG · "seguro para um bebê, eficaz para você"
│
├── 🌳 ROSTO — HOG                                              [Fase 1]
│   ├── Limpeza & Preparo    gel de limpeza · água micelar                        (2)
│   ├── Tratamento (herói)   sérum assinatura · hidratante · renovador noturno    (3)
│   └── Proteção             protetor solar facial            ⏳ fase 2 · Grau 2   (1)
│
├── 🌳 CABELO — HOG                                             [Fase 1]
│   ├── Cuidado diário             shampoo · condicionador                        (2)
│   └── Tratamento / Reconstrução  máscara · leave-in ou óleo · ampola            (3)
│
└── 🌳 BABY — HOG Baby (selo da pediatra)                       [Fase 1 · piloto]
    └── Baby essenciais      hidratante · banho/sabonete · proteção de barreira   (3)

   · · · galhos dormentes (na genética, fase futura) · · ·
   CORPO · BANHO · KIDS (HOG Baby) · PROFISSIONAL salão (HOG)
```

**Contagem:** 3 troncos ativos · 6 galhos · ~15 SKUs no core; nenhum galho acima de 3–4.

**Pendências de produto a fechar depois:** ativo(s)/fragrância assinatura que materializam o DNA · nomes das
linhas · definição exata dos SKUs herói de cada galho · estrutura comercial da parceria com a pediatra (HOG Baby).

---

## Fontes principais

- ANVISA: [registro de cosméticos](https://www.gov.br/anvisa/pt-br/acessoainformacao/perguntasfrequentes/cosmeticos/registro-de-cosmeticos) · [isentos de registro](https://www.gov.br/anvisa/pt-br/acessoainformacao/perguntasfrequentes/cosmeticos/cosmeticos-isentos-de-registro)
- Exigências regulatórias (AFE/RT/licença): [NOVATRADE](https://novatradebrasil.com/pt/anvisa-quais-sao-as-exigencias-regulatorias-para-produtos-de-higiene-pessoal-cosmeticos-e-perfumes-no-brasil/) · [Setty](http://www.setty.com.br/atuacao/cosmeticos)
- Marketplaces: [Mercado Livre — normas ANVISA](https://vendedores.mercadolivre.com.br/nota/como-cumprir-as-normas-da-anvisa-e-evitar-o-cancelamento-do-seu-anuncio) · [Shopee — regulamentação ANVISA](https://seller.br.shopee.cn/edu/article/11602) · [Época Cosméticos / Beleza na Web (grupo Magalu)](https://www.belezanaweb.com.br/)
- Plataformas D2C: [Nuvemshop vs Tray vs Shopify](https://www.nuvemshop.com.br/blog/tray-ou-shopify/)
- Revenda/comissão: [Serasa](https://www.serasa.com.br/renda-extra/revenda-de-cosmeticos/) · [RediRedi — comissão por segmento](https://rediredi.com/br/blog/quanto-pagar-de-comissao-para-revendedores-um-guia-por-segmento/)
- Canal profissional: [Truss Professional](https://www.trussprofessional.com.br/) · [Sebrae — tratamentos capilares](https://sebrae.com.br/sites/PortalSebrae/artigos/dicas-para-vender-tratamentos-capilares-no-salao-de-beleza,11ce8bb0fed47810VgnVCM1000001b00320aRCRD)
- Cripto/regulação: Lei 14.478/2022 (Marco Legal dos Ativos Virtuais) — supervisão do Banco Central.
