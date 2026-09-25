import { lerSku, TERMOS_DO_CONTRATO } from './contrato-documento.util';
import { formatarCnpj } from './contrato-variaveis.util';
import type { PropostaParaEnvio } from './contrato-envio.util';

/**
 * O que o CLIENTE vê da proposta — a página de aceite e o e-mail (Léo, 25/09:
 * "já precisa ficar tudo no formato de como o cliente vai receber").
 *
 * Um resumo só, montado aqui, pros dois lugares: se a página disser uma coisa e
 * o e-mail outra, o cliente aprova a que leu. E os termos da locação saem de
 * `TERMOS_DO_CONTRATO` — os mesmos que o contrato imprime e o ERP cobra.
 *
 * ⛔ Sem nome de produto nem de tenant escrito aqui: o modelo sai do SKU do
 * catálogo, e a marca é da página/e-mail que usam este resumo.
 */
export interface ResumoProposta {
  numero: string;
  criadaEm: string;
  validoAte: string | null;
  cliente: { razaoSocial: string; cnpj: string | null; endereco: string };
  signatarioNome: string | null;
  quadros: Array<{
    quadro: string;
    /** Leva o concentrador (o quadro principal da instalação). */
    principal: boolean;
    tensaoV: number | null;
    correnteA: number | null;
    modelo: string;
    aluguelMensal: number;
  }>;
  aluguelMensalTotal: number;
  condicoes: {
    vigenciaMeses: number;
    diaVencimento: number;
    primeiroAluguelNoMes: number;
    garantiaMeses: number;
  };
  servicos: {
    customizacao: { quantidade: number; unitario: number; total: number } | null;
    total: number | null;
    parcelas: number;
    valorParcela: number | null;
  };
  prazos: {
    entregaDias: number | null;
    instalacaoDias: number | null;
    verificacaoDias: number | null;
    softwareDias: number | null;
  };
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function enderecoCurto(c: PropostaParaEnvio['cliente'] & { cep?: string | null }): string {
  const rua = [c.endereco?.trim(), c.numero?.trim()].filter(Boolean).join(', ');
  const cidade = [c.cidade?.trim(), c.uf?.trim().toUpperCase()].filter(Boolean).join('/');
  const cep = c.cep?.replace(/\D/g, '');
  return [
    [rua, c.complemento?.trim()].filter(Boolean).join(', '),
    c.bairro?.trim(),
    cidade,
    cep && cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Master Block MB-04" → o nome do modelo como o CATÁLOGO o chama, mais o acompanhamento. */
function descricaoDoModelo(sku: string | null, nomeDoProduto: string | null): string {
  const { modelo, acompanhamento } = lerSku(sku);
  const base = nomeDoProduto?.split(/\s+\+\s+/)[0]?.trim() || modelo || '—';
  return acompanhamento ? `${base} + ${acompanhamento}` : base;
}

export function resumoDaProposta(
  p: PropostaParaEnvio & {
    cliente: PropostaParaEnvio['cliente'] & { cep?: string | null };
    itens: Array<PropostaParaEnvio['itens'][number] & { produtoNome?: string | null }>;
  },
  criadaEm: Date,
): ResumoProposta {
  const quadros = p.itens.map((i) => ({
    quadro: i.quadroPainel?.trim() || '—',
    principal: (i.sku ?? '').endsWith('_D.S.'),
    tensaoV: i.tensaoV,
    correnteA: i.correnteA,
    modelo: descricaoDoModelo(i.sku, i.produtoNome ?? null),
    aluguelMensal: Number(i.total),
  }));
  const unit = num(p.customizacaoUnitario);
  const qtd = p.customizacaoQuantidade;
  const total = num(p.servicosTotal);
  return {
    numero: p.numero,
    criadaEm: criadaEm.toISOString(),
    validoAte: p.validoAte ? p.validoAte.toISOString() : null,
    cliente: {
      razaoSocial: p.cliente.nome,
      cnpj: p.cliente.cnpj ? formatarCnpj(p.cliente.cnpj.replace(/\D/g, '')) : null,
      endereco: enderecoCurto(p.cliente),
    },
    signatarioNome: p.signatarioNome?.trim() || null,
    quadros,
    aluguelMensalTotal: Math.round(quadros.reduce((s, q) => s + q.aluguelMensal, 0) * 100) / 100,
    condicoes: {
      vigenciaMeses: TERMOS_DO_CONTRATO.prazoMeses,
      diaVencimento: TERMOS_DO_CONTRATO.diaVencimento,
      primeiroAluguelNoMes: TERMOS_DO_CONTRATO.primeiroAluguelNoMes,
      garantiaMeses: TERMOS_DO_CONTRATO.garantiaMeses,
    },
    servicos: {
      customizacao:
        unit != null && qtd != null ? { quantidade: qtd, unitario: unit, total: unit * qtd } : null,
      total,
      parcelas: 2,
      valorParcela: total != null ? Math.round(total * 50) / 100 : null,
    },
    prazos: {
      entregaDias: p.prazoEntregaDias,
      instalacaoDias: p.prazoInstalacaoDias,
      verificacaoDias: p.prazoVerificacaoDias,
      softwareDias: p.prazoSoftwareDias,
    },
  };
}
