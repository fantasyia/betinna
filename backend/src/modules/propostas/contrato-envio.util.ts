import type { Prisma } from '@prisma/client';
import type { ContratoParaAssinar } from '@integrations/clicksign/clicksign.service';
import { variaveisDoContrato } from './contrato-variaveis.util';

/**
 * O que a proposta precisa ter pra virar um envelope de assinatura.
 *
 * É a MESMA forma nos dois caminhos que mandam contrato: o aceite do cliente
 * (1ª rodada) e o reenvio pelo diretor (cláusula alterada). Existia só no
 * aceite, embutido; foi extraído em 17/09 porque duplicar significaria a versão
 * 2 do contrato sair montada diferente da 1 — nome de signatário, telefone ou
 * variável divergindo sem ninguém pedir, num documento que alguém assina.
 */
export interface PropostaParaEnvio {
  id: string;
  numero: string;
  valor: Prisma.Decimal | number;
  modalidade: string;
  prazoMeses: number | null;
  diaVencimento: number | null;
  signatarioNome: string | null;
  signatarioEmail: string | null;
  signatarioTelefone: string | null;
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

export function montarContratoParaAssinar(
  p: PropostaParaEnvio,
  opcoes?: { criadoEm?: Date; titulo?: string },
): MontagemContrato {
  if (p.modalidade !== 'LOCACAO') {
    return { ok: false, motivo: 'a proposta não é de locação' };
  }
  if (!p.prazoMeses || !p.diaVencimento) {
    return { ok: false, motivo: 'faltam o prazo em meses e/ou o dia de vencimento na proposta' };
  }
  // Signatário é PESSOA. A assinatura eletrônica recusa razão social como nome
  // ("formato inválido"), e o cadastro de Cliente só guarda a empresa — por isso
  // o nome vem da proposta, preenchido por quem montou o negócio.
  const nome = p.signatarioNome?.trim();
  const email = p.signatarioEmail?.trim() || p.cliente.email?.trim();
  if (!nome || !email) {
    return { ok: false, motivo: 'sem signatário definido' };
  }

  return {
    ok: true,
    dados: {
      titulo: opcoes?.titulo ?? `Proposta-Contrato ${p.numero} — ${p.cliente.nome}`,
      cliente: {
        nome,
        email,
        telefone: telefoneDeAssinatura(p.signatarioTelefone, p.cliente.telefone),
      },
      // Volta no webhook de assinatura — rastro que não depende de id.
      metadata: { proposta: p.numero, proposta_id: p.id },
      variaveis: variaveisDoContrato({
        valor: p.valor,
        criadoEm: opcoes?.criadoEm ?? new Date(),
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
      }),
    },
  };
}

/** O `select` do Prisma que produz exatamente a `PropostaParaEnvio`. */
export const SELECT_PROPOSTA_CONTRATO = {
  id: true,
  numero: true,
  valor: true,
  modalidade: true,
  prazoMeses: true,
  diaVencimento: true,
  signatarioNome: true,
  signatarioEmail: true,
  signatarioTelefone: true,
  cliente: {
    select: {
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
