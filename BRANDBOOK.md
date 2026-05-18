# Brandbook Betinna.ai

> **DOC VITALÍCIO — NÃO ALTERAR sem autorização do dono.**
> Fonte da verdade pra identidade visual da Betinna.ai.
> Origem: manual de marca oficial feito por designer profissional
> (`G:\Shared drives\MARKETING\Betinna\04 - Vetorial\01 - RGB (Telas)\03 - PDF.zip`).
>
> **Para Claude / IA assistant: leia este arquivo antes de qualquer mudança visual.**
> Cores, fontes, logos e tokens DEVEM seguir exatamente o que está aqui.
> Se precisar criar variante, adicione neste doc primeiro com justificativa.

---

## 1. Paleta oficial

### Cores principais (use estas, não invente)

| Token       | Hex       | Uso                                              |
| ----------- | --------- | ------------------------------------------------ |
| `navy`      | `#201554` | **Primária** — botões, links, headings, brand    |
| `cyan`      | `#2bcae5` | **Secundária** — accents, hover states, gradiente |
| `magenta`   | `#bd1fbf` | **Acento especial** — destaques, dark mode primary |
| `blue`      | `#5C88DA` | Terciária — usado em info/badges                 |

### Variações (hover/light) — derivadas das principais

| Token            | Hex       | Uso                            |
| ---------------- | --------- | ------------------------------ |
| `navyHover`      | `#15093c` | Hover do primary               |
| `navyLight`      | `#ecebf3` | BG sutil para highlights       |
| `cyanHover`      | `#1ba8c0` | Hover do secondary             |
| `cyanLight`      | `#defaff` | BG sutil cyan                  |
| `magentaHover`   | `#a01aa1` | Hover magenta                  |
| `magentaLight`   | `#fae6fa` | BG sutil magenta               |

### Semânticas

| Token      | Hex       | Uso                       |
| ---------- | --------- | ------------------------- |
| `danger`   | `#c43c3c` | Erros, destruir, cancelar |
| `success`  | `#2d8f5e` | Confirmações, ok          |
| `warning`  | `#b07820` | Atenção, pending          |
| `info`     | `#5C88DA` | Notas, dicas              |

### Cores de canal (Inbox / WhatsApp / etc.)

| Canal      | Hex       |
| ---------- | --------- |
| WhatsApp   | `#25d366` |
| Instagram  | `#e1306c` |
| Facebook   | `#1877f2` |
| E-mail     | `#0891b2` |
| Mercado Livre | `#fbbf24` |
| Shopee     | `#ee4d2d` |
| Amazon     | `#ff9900` |
| TikTok     | `#ff0050` |

### Backgrounds (escala de elevação)

**Light theme** (padrão):
- `bg`: `#F8F7F2` — base do app (creme quente)
- `bgAlt`: `#fdfcf8` — variação sutil entre seções
- `surface`: `#ffffff` — card padrão
- `surfaceHover`: `#f4f1e9` — hover de card/linha (bege sutil)
- `surfaceElevated`: `#ffffff` — modal, popover

**Dark theme**:
- `bg`: `#15093c` — base navy escuro
- `bgAlt`: `#1a0c47` — variação
- `surface`: `#201554` — card padrão (navy oficial)
- `primary` (dark): `#bd1fbf` — magenta vira a cor de botão primário
- `primaryHover` (dark): `#d33dd5`

### Borders

- `border`: `#e0dbed` — divisor padrão
- `borderStrong`: `#cdc3e0` — input, botão secundário
- `borderFocus`: `#31137C` — ring de foco (keyboard nav)

### Text

- `text`: `#101820` — principal
- `textSubtle`: `#3a3550` — descrições
- `muted`: `#6b6580` — labels, captions
- `mutedLight`: `#9892a8` — placeholders, hints

---

## 2. Gradiente assinatura

```css
background: linear-gradient(135deg, #201554 0%, #2bcae5 100%);
```

No dark mode, troca pra **magenta → cyan**:
```css
background: linear-gradient(135deg, #bd1fbf 0%, #2bcae5 100%);
```

Uso: header de páginas-chave, CTAs hero, logo wrapper, badges premium.

---

## 3. Tipografia

| Stack          | Fonte primária    | Uso                                        |
| -------------- | ----------------- | ------------------------------------------ |
| `fonts.ui`     | **Cabin**         | Textos de UI (botões, inputs, labels, body) |
| `fonts.display`| **Fira Sans**     | Headings, títulos, números grandes         |
| `fonts.mono`   | **Fira Mono**     | Tabular (R$, CNPJ, IDs, timestamps)        |

**Não usar** outras fontes (Inter, Roboto, Arial, etc.) — sempre Cabin/Fira.

### Escala (px)

```
xs: 11   sm: 12   base: 13   md: 14   lg: 15
xl: 17   2xl: 20  3xl: 24    4xl: 30
```

---

## 4. Logos

Localização: `frontend/public/`

| Arquivo                   | Uso                                          |
| ------------------------- | -------------------------------------------- |
| `betinna-symbol.svg`      | Símbolo só (B em quadrado) — favicons, headers compactos |
| `betinna-horizontal.svg`  | Logo horizontal (símbolo + wordmark)         |
| `betinna-logo.svg`        | Variação alternativa                         |

**Regras:**
- Sempre usar SVG (nunca PNG/JPG no app)
- Não recolorir o logo — use as cores oficiais do SVG
- Espaçamento mínimo ao redor: 1× altura do símbolo
- Não distorcer aspect-ratio
- No header, símbolo = 28px alt × 28px width

---

## 5. Border radius, shadows, motion

### Radius

```
sm: 4    md: 6    lg: 10 (padrão Betinna)    xl: 12    full: 999
```

Padrão Betinna é **10px** em cards e botões — não usar 8px ou 12px.

### Shadows (sutis, light theme)

```
sm:  0 1px 2px 0 rgba(49, 19, 124, 0.06)
md:  0 2px 6px -1px rgba(49, 19, 124, 0.08), 0 1px 3px -1px rgba(49, 19, 124, 0.05)
lg:  0 8px 24px -4px rgba(49, 19, 124, 0.12), 0 2px 6px -2px rgba(49, 19, 124, 0.06)
xl:  0 24px 48px -8px rgba(49, 19, 124, 0.18), 0 8px 16px -4px rgba(49, 19, 124, 0.1)
focusRing: 0 0 0 3px rgba(49, 19, 124, 0.15)
```

### Motion

```
fast: 120ms cubic-bezier(0.4, 0, 0.2, 1)
base: 180ms cubic-bezier(0.4, 0, 0.2, 1)
slow: 280ms cubic-bezier(0.16, 1, 0.3, 1)
```

---

## 6. Spacing scale (4px base)

```
xs: 4    sm: 8    md: 12    lg: 16    xl: 24    xxl: 32    xxxl: 48
```

---

## 7. Onde vivem os tokens

| Arquivo                                | Conteúdo                                       |
| -------------------------------------- | ---------------------------------------------- |
| `frontend/src/components/styles.ts`    | Tokens TS — `colors`, `spacing`, `radius`, `fonts` |
| `frontend/src/index.css`               | CSS vars `--*` para light + `html.dark` overrides |
| `frontend/tailwind.config.ts`          | Mapeamento Tailwind (`bg-primary`, `text-magenta`, etc.) |
| `frontend/src/hooks/useTheme.ts`       | Hook + bootstrap do light/dark toggle          |

**Regra**: ao adicionar cor nova, atualizar os **três** lugares (styles.ts, index.css vars, tailwind.config) — senão fica inconsistente entre componentes legacy e novos.

---

## 8. Don'ts (erros já cometidos — não repetir)

- ❌ `#31137C` (roxo errado — não é a primary)
- ❌ `#4AC9E3` (cyan próximo mas errado)
- ❌ `#BB29BB` (magenta próximo mas errado)
- ❌ Inter, Roboto, system-ui como font principal
- ❌ Border radius 8px (use 10px — padrão Betinna)
- ❌ Roxo `#7c3aed` (Tailwind violet — não é nossa)
- ❌ PNG/JPG do logo dentro do app
- ❌ Trocar paleta sem atualizar `styles.ts` + `index.css` + `tailwind.config.ts` juntos

---

## 9. Manual de marca original

PDFs vetoriais oficiais (não versionados no git, ficam no Drive):
- `G:\Shared drives\MARKETING\Betinna\04 - Vetorial\01 - RGB (Telas)\03 - PDF.zip`
- Fontes originais: `C:\Users\Dell\Desktop\New folder.zip`

Se houver conflito entre este doc e o PDF original, **o PDF vence** — atualize este arquivo.

---

_Última atualização: 2026-05-18 — commit que introduziu o brandbook oficial._
