# Os marcos que movem o lead sozinho

Quatro coisas o app sabe sem ninguém clicar em nada — e cada uma anda com o lead
no funil:

| marco | quando acontece | quem dispara |
|---|---|---|
| `propostaEnviada` | o rep gera o link de aceite (mesmo link do WhatsApp e do e-mail) | `PropostaAceiteService.gerarLink` |
| `propostaAssinada` | o cliente aceita a proposta | `PropostaAceiteService.registrarDecisao` |
| `contratoAssinado` | a ClickSign avisa que o contrato fechou | webhook de assinatura |
| `instalacao` | o ERP emite a NF da primeira mensalidade | sync de pedidos (situação "faturada") |

## Qual etapa é cada marco

Vem da configuração do tenant, não do código:

```json
{ "funilEtapas": {
    "propostaEnviada": "<funilEtapaId>", "propostaAssinada": "<funilEtapaId>",
    "contratoAssinado": "<funilEtapaId>", "instalacao": "<funilEtapaId>" } }
```

`PATCH /api/v1/empresas/config`. Marco sem etapa configurada **não move nada** —
é assim que um tenant que não usa este desenho simplesmente não é afetado.

## Como o move é feito (e os dois atalhos errados)

`LeadEtapaSistemaService.mover` faz os **três passos**, iguais aos do motor de
fluxo (`MOVER_LEAD_ETAPA`): atualiza o lead, registra a transição no histórico e
dispara `LEAD_ETAPA_MUDOU`. Faltar um quebra alguma coisa.

- ⛔ `LeadsService.moverEtapa` exige `AuthenticatedUser` e valida a **carteira**
  do lead. Webhook não tem usuário — e inventar um usuário de sistema só pra
  passar na validação é remendo.
- ⛔ `prisma.lead.update({ funilEtapaId })` muda a coluna e **nenhuma automação
  roda**. O lead aparece na etapa certa na tela e o fluxo que deveria reagir
  nunca acontece: falha silenciosa.

## Regras que o serviço garante

- **Só dispara quando a etapa muda de verdade** — webhook repetido não re-dispara
  e não vira laço entre fluxos.
- **Nunca move pra trás.** Webhook fora de ordem não devolve um lead de
  "Contrato assinado" pra "Proposta assinada".
- **`somenteDe`**: a NF só empurra pra Instalação se o lead estiver em "Contrato
  assinado". É como se distingue a nota da PRIMEIRA mensalidade da do 7º mês —
  senão a mensalidade de um contrato antigo atropelaria uma negociação nova do
  mesmo cliente.
- **`origemMudanca` = `webhook` ou `erp`**, nunca `manual`: o histórico não pode
  dizer que uma pessoa moveu.
- **Best-effort.** O fato (aceite, assinatura, nota) já está gravado; se o move
  falhar, grita no log — não desfaz o fato.
- **`capacidadeMaxima` não é checada** aqui de propósito: segurar um contrato
  assinado porque a etapa está cheia esconderia um fato consumado.
