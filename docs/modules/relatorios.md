# Relatórios & KPIs

Dashboard executivo unificado com 7 áreas + visão geral.

## Filtros globais

Todo endpoint aceita `?de=2026-01-01&ate=2026-01-31`. Default: últimos 30 dias.

`periodoAnterior(de, ate)` calcula janela equivalente imediatamente anterior pra cálculo de **variação %**.

## Endpoints

| Endpoint | Foco |
|---|---|
| `GET /relatorios/dashboard` | Visão executiva consolidada (KPIs macro de cada área) |
| `GET /relatorios/vendas` | Faturamento, ticket médio, por status, por rep |
| `GET /relatorios/funil` | Pipeline ponderado, taxa conversão, aging |
| `GET /relatorios/comissoes` | Total pago/a pagar, por rep, por tipo (REP/GERENTE) |
| `GET /relatorios/sac` | Volume, SLA, TMR, por severidade/tipo |
| `GET /relatorios/campanhas` | Performance: envio, leitura, por canal |
| `GET /relatorios/amostras` | Enviadas, convertidas, taxa, valor convertido |
| `GET /relatorios/fidelidade` | Pontos credit/resgat/expir, taxa de uso, top clientes |

## Acesso (`RequirePermissions { module: 'relatorios', action: 'view' }`)

| Papel | Vê |
|---|---|
| ADMIN/DIRECTOR | Tudo, todos os reps |
| GERENTE | Só agregação dos REPs subordinados |
| SAC | Só SAC + Inbox |
| REP | Só os próprios números |

Filtragem por `RepScopeService` aplicada em queries que cruzam reps (vendas, funil, comissoes, amostras).

## Estrutura padrão das responses

```typescript
{
  periodo: { de, ate },
  // KPI principal com variação vs período anterior
  faturamento: { atual: 50000, anterior: 45000, variacao: 11 },
  // Breakdowns
  porStatus: [{ status, count, total }, ...],
  porRep: [{ repId, repNome, ... }, ...]
}
```

## Frontend (`RelatoriosPage`)

Página com **8 abas**:

1. **Overview** — KPI cards macro de todas as áreas (link rápido)
2. **Vendas** — Faturamento + KPICard variação + BarChart por rep + Donut por status
3. **Funil** — Funnel visual + KPIs (criados, ganhos, taxa)
4. **Comissões** — Tabela paginada por rep, total pago vs a pagar
5. **SAC** — KPIs + Donut severidade + BarChart por tipo
6. **Amostras** — KPIs + Donut (convertidas/não/expiradas/pendentes)
7. **Fidelidade** — KPIs programa + creditados/resgatados + BarChart top clientes
8. **Campanhas** — KPIs taxa envio/leitura + BarChart por canal

Componentes reutilizáveis em `@/components/charts`:
- `KPICard` — number + delta colorido + hint
- `BarChart` — barras horizontais simples (SVG inline)
- `Funnel` — funil de etapas
- `Donut` — pizza

## Fluxos típicos

### A. DIRECTOR confere mês

1. DIRECTOR em `/relatorios` aba "Overview" — vê 6 KPI cards macro
2. Vendas: faturamento +18% vs mês anterior ✅
3. SAC: TMR 36h (acima do esperado 24h) ⚠️
4. Clica aba SAC → vê quais severidades estão estourando
5. Identifica: ocorrências `ALTA` demoram demais → ação: realocar equipe

### B. GERENTE acompanha REPs subordinados

1. GERENTE em `/relatorios` aba "Vendas"
2. BarChart "Por rep" mostra apenas os 3 reps subordinados
3. Rep B está em queda — clica no nome
4. Drill-down (futuro) ou contato direto via WhatsApp pra entender

### C. REP confere comissão

1. REP em `/relatorios` aba "Comissões"
2. Tabela mostra apenas linha dele
3. Confere: 12 pedidos no mês, R$ 48k vendido, R$ 1.440 comissão (3%)
4. Status: "A pagar" (DIRECTOR ainda não marcou como pago)
