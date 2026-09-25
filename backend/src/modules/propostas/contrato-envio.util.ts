import type { Prisma } from '@prisma/client';
import type { ContratoParaAssinar } from '@integrations/clicksign/clicksign.service';
import {
  carregarModelo,
  dadosDoDocumento,
  renderizarDocumento,
  type LinhaLevantamento,
} from './contrato-documento.util';

/**
 * O que a proposta precisa ter pra virar um envelope de assinatura.
 *
 * É a MESMA forma nos dois caminhos que mandam contrato: o aceite do cliente
 * (1ª rodada) e o reenvio pelo diretor (cláusula alterada). Existia só no
 * aceite, embutido; foi extraído em 17/09 porque duplicar significaria a versão
 * 2 do contrato sair montada diferente da 1 — nome de signatário, telefone ou
 * variável divergindo sem ninguém pedir, num documento que alguém assina.
 *
 * 📌 Desde 24/09 o contrato é o DOCUMENTO ÚNICO do Anexo I (proposta técnica +
 * comercial + condições), montado pelo app com a tabela do tamanho do
 * levantamento — ver `contrato-documento.util`. O Modelo v4 da ClickSign (só o
 * contrato de locação, 12 variáveis) deixou de ser usado.
 */
export interface PropostaParaEnvio {
  id: string;
  numero: string;
  valor: Prisma.Decimal | number;
  modalidade: string;
  signatarioNome: string | null;
  signatarioEmail: string | null;
  signatarioTelefone: string | null;
  validoAte: Date | null;
  prazoEntregaDias: number | null;
  prazoInstalacaoDias: number | null;
  prazoVerificacaoDias: number | null;
  prazoSoftwareDias: number | null;
  servicosTotal: Prisma.Decimal | number | null;
  customizacaoUnitario: Prisma.Decimal | number | null;
  customizacaoQuantidade: number | null;
  /** O levantamento: um item por quadro. `sku` vem do produto (ver `comSkus`). */
  itens: Array<{
    quadroPainel: string | null;
    tensaoV: number | null;
    correnteA: number | null;
    quantidade: number;
    total: Prisma.Decimal | number;
    sku: string | null;
    /** Nome gravado no item — o resumo do cliente usa (opcional nos testes antigos). */
    produtoNome?: string | null;
  }>;
  cliente: {
    nome: string;
    email: string | null;
    cnpj: string | null;
    telefone: string | null;
    endereco: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep?: string | null;
  };
}

/**
 * Ou o payload pronto, ou o MOTIVO de não dar — nunca um contrato pela metade.
 *
 * Recusar explicitamente é o ponto: prazo e dia de vencimento são termo
 * comercial, e um default aqui sairia impresso num documento que alguém assina
 * sem ninguém saber que o número veio do sistema.
 */
export type MontagemContrato =
  | { ok: true; dados: ContratoParaAssinar }
  | { ok: false; motivo: string };

/**
 * Telefone da autenticação: só dígitos, com DDI. Sem um válido, a assinatura
 * cai pro token por e-mail — que funciona, então isto não bloqueia o envio.
 */
export function telefoneDeAssinatura(
  ...candidatos: Array<string | null | undefined>
): string | undefined {
  const bruto = candidatos.map((c) => c?.trim()).find((c) => c) ?? '';
  const so = bruto.replace(/\D/g, '');
  if (so.length >= 12) return so;
  if (so.length >= 10) return `55${so}`;
  return undefined;
}

const num = (v: Prisma.Decimal | number | null): number | null => (v == null ? null : Number(v));

/** A proposta como o documento a lê. */
function entradaDoDocumento(p: PropostaParaEnvio, criadoEm: Date) {
  const linhas: LinhaLevantamento[] = p.itens.map((i) => ({
    quadroPainel: i.quadroPainel,
    tensaoV: i.tensaoV,
    correnteA: i.correnteA,
    sku: i.sku,
    quantidade: i.quantidade,
    total: Number(i.total),
  }));
  return {
    numero: p.numero,
    emitidaEm: criadoEm,
    validoAte: p.validoAte,
    clienteNome: p.cliente.nome,
    cnpj: p.cliente.cnpj,
    endereco: {
      logradouro: p.cliente.endereco,
      numero: p.cliente.numero,
      complemento: p.cliente.complemento,
      bairro: p.cliente.bairro,
      cidade: p.cliente.cidade,
      uf: p.cliente.uf,
    },
    linhas,
    customUnitario: num(p.customizacaoUnitario),
    customQuantidade: p.customizacaoQuantidade,
    servicosTotal: num(p.servicosTotal),
    prazoEntregaDias: p.prazoEntregaDias,
    prazoInstalacaoDias: p.prazoInstalacaoDias,
    prazoVerificacaoDias: p.prazoVerificacaoDias,
    prazoSoftwareDias: p.prazoSoftwareDias,
  };
}

/**
 * TUDO que falta pra proposta virar contrato — a lista inteira, de uma vez.
 * Vazia = pronta.
 *
 * É A checagem, e mora num lugar só (Léo, 25/09): o link de aceite a usa ANTES
 * de a proposta ir pro cliente, e a montagem a usa DEPOIS do aceite. Antes o
 * link só conferia o projeto anexado, e o resto era descoberto no aceite — o
 * cliente aceitava e o contrato não saía. Duas listas divergiriam em silêncio.
 *
 * Signatário é PESSOA. A assinatura eletrônica recusa razão social como nome
 * ("formato inválido"), e o cadastro de Cliente só guarda a empresa — por isso
 * nome, e-mail e CELULAR vêm da proposta. O celular é de quem ASSINA: o do
 * cadastro do cliente é o da empresa, e a autenticação vai pra pessoa.
 */
export function pendenciasDoContrato(p: PropostaParaEnvio, criadoEm = new Date()): string[] {
  const falta: string[] = [];
  if (!p.signatarioNome?.trim()) falta.push('nome de quem assina pelo cliente (a pessoa)');
  if (!(p.signatarioEmail?.trim() || p.cliente.email?.trim())) falta.push('e-mail de quem assina');
  if (!telefoneDeAssinatura(p.signatarioTelefone)) {
    falta.push('celular de quem assina (DDD + número)');
  }
  const documento = dadosDoDocumento(entradaDoDocumento(p, criadoEm));
  if (!documento.ok) falta.push(...documento.faltando);
  return falta;
}

export function montarContratoParaAssinar(
  p: PropostaParaEnvio,
  opcoes?: { criadoEm?: Date; titulo?: string; modelo?: Buffer },
): MontagemContrato {
  if (p.modalidade !== 'LOCACAO') {
    return { ok: false, motivo: 'a proposta não é de locação' };
  }
  const criadoEm = opcoes?.criadoEm ?? new Date();
  const falta = pendenciasDoContrato(p, criadoEm);
  if (falta.length) return { ok: false, motivo: `falta na proposta: ${falta.join('; ')}` };

  const nome = p.signatarioNome!.trim();
  const email = (p.signatarioEmail?.trim() || p.cliente.email?.trim())!;
  const documento = dadosDoDocumento(entradaDoDocumento(p, criadoEm));
  if (!documento.ok) {
    return { ok: false, motivo: `falta na proposta: ${documento.faltando.join('; ')}` };
  }

  let arquivo: Buffer;
  try {
    arquivo = renderizarDocumento(opcoes?.modelo ?? carregarModelo(), documento.dados);
  } catch (err) {
    // Erro do MODELO (arquivo ausente, variável que os dados não têm), não da
    // proposta. Vira motivo pra quem é avisado não ficar sem saber por quê.
    return {
      ok: false,
      motivo: `o modelo do contrato não pôde ser preenchido (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  return {
    ok: true,
    dados: {
      titulo: opcoes?.titulo ?? `Proposta-Contrato ${p.numero} — ${p.cliente.nome}`,
      cliente: {
        nome,
        email,
        telefone: telefoneDeAssinatura(p.signatarioTelefone),
      },
      // Volta no webhook de assinatura — rastro que não depende de id.
      metadata: { proposta: p.numero, proposta_id: p.id },
      documento: { arquivo, nome: `${p.numero}.docx` },
    },
  };
}

/** O `select` do Prisma pra montar a `PropostaParaEnvio` (menos o `sku`, ver `comSkus`). */
export const SELECT_PROPOSTA_CONTRATO = {
  id: true,
  numero: true,
  valor: true,
  modalidade: true,
  signatarioNome: true,
  signatarioEmail: true,
  signatarioTelefone: true,
  validoAte: true,
  prazoEntregaDias: true,
  prazoInstalacaoDias: true,
  prazoVerificacaoDias: true,
  prazoSoftwareDias: true,
  servicosTotal: true,
  customizacaoUnitario: true,
  customizacaoQuantidade: true,
  itens: {
    select: {
      produtoId: true,
      quadroPainel: true,
      tensaoV: true,
      correnteA: true,
      quantidade: true,
      total: true,
      produtoNome: true,
    },
  },
  cliente: {
    select: {
      cep: true,
      nome: true,
      email: true,
      cnpj: true,
      telefone: true,
      endereco: true,
      numero: true,
      complemento: true,
      bairro: true,
      cidade: true,
      uf: true,
    },
  },
} as const;

/** A proposta como o `SELECT_PROPOSTA_CONTRATO` a devolve. */
export type PropostaDoBanco = Omit<PropostaParaEnvio, 'itens'> & {
  itens: Array<Omit<PropostaParaEnvio['itens'][number], 'sku'> & { produtoId: string }>;
};

/**
 * Completa o `sku` de cada item. O `PropostaItem` guarda só o `produtoId` (sem
 * relação no schema), e é o SKU que diz o modelo e se o quadro tem
 * acompanhamento (`_D.S.` / `_E.P.`) — sem ele a tabela do item 06 sai errada.
 */
export async function comSkus(
  prisma: {
    produto: {
      findMany: (a: {
        where: { id: { in: string[] } };
        select: { id: true; sku: true };
      }) => Promise<Array<{ id: string; sku: string | null }>>;
    };
  },
  p: PropostaDoBanco,
): Promise<PropostaParaEnvio> {
  const ids = [...new Set(p.itens.map((i) => i.produtoId))];
  const produtos = ids.length
    ? await prisma.produto.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true } })
    : [];
  const sku = new Map(produtos.map((x) => [x.id, x.sku]));
  return {
    ...p,
    itens: p.itens.map(({ produtoId, ...i }) => ({ ...i, sku: sku.get(produtoId) ?? null })),
  };
}
