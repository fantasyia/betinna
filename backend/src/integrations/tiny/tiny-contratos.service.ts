import { Injectable, Logger } from '@nestjs/common';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { TinyV2ClientService } from './tiny-v2-client.service';

/** Quando a cobrança do período vence. Tabela que a doc da v2 não traz inline. */
export type TinyVencimento = 'C' | 'S' | 'P'; // mês Corrente · Seguinte · dois meses (P)

/** Bloco fiscal — só vai quando o tenant liga a emissão de nota. */
export interface NotaDoContratoErp {
  codigoListaServico: string;
  naturezaOperacao: string;
  percentualIss: number;
  servicoNome: string;
  servicoCodigo: string;
}

export interface ContratoParaErp {
  /** Início do ciclo — é a partir daqui que as competências são geradas. */
  inicio: Date;
  descricao: string;
  cliente: { nome: string; cpfCnpj?: string | null };
  valorMensal: number;
  diaVencimento: number;
  prazoMeses: number;
  vencimento?: TinyVencimento;
  observacao?: string;
  nota?: NotaDoContratoErp | null;
}

const dd = (n: number) => String(n).padStart(2, '0');
/**
 * dd/mm/aaaa em UTC — de propósito.
 *
 * O contêiner roda em UTC e as datas do ciclo (`primeiraCobrancaEm`) são
 * calculadas lá; ler com os getters LOCAIS faz a data escorregar um dia na
 * máquina do dev (e a data do contrato é o que define a competência da
 * primeira cobrança).
 */
const brDate = (d: Date) =>
  `${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

/**
 * Contrato de locação no ERP (Tiny), via API v2 — ver `TinyV2ClientService`.
 *
 * O que este serviço NÃO faz, porque a API não deixa:
 *
 * - **Faturar.** O contrato não gera pedido nem nota mensal: gera CONTA A
 *   RECEBER, e só quando alguém roda *Serviços → Cobranças → gerar cobranças do
 *   período* no painel. Não há rota pra isso. Quem lê essas cobranças de volta é
 *   o `ContratoMensalidadeSyncService`.
 * - **Excluir.** Não existe. Contrato errado se ENCERRA (mês/ano de término),
 *   não se apaga.
 */
@Injectable()
export class TinyContratosService {
  private readonly logger = new Logger(TinyContratosService.name);

  constructor(private readonly v2: TinyV2ClientService) {}

  get configurado(): boolean {
    return this.v2.configurado;
  }

  /** Cria o contrato recorrente e devolve o id do ERP. */
  async incluir(dados: ContratoParaErp): Promise<{ id: string }> {
    const r = await this.v2.chamar('contrato.incluir.php', {
      contrato: JSON.stringify({ contrato: this.montar(dados) }),
    });
    const id = this.extrairId(r);
    if (!id) {
      throw new IntegrationException(
        `[tiny v2] contrato criado mas sem id no retorno: ${JSON.stringify(r).slice(0, 300)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    this.logger.log(`[erp] contrato ${id} criado — ${dados.descricao}`);
    return { id };
  }

  /**
   * ALTERA é SUBSTITUIÇÃO: a v2 grava o contrato inteiro que você mandar, então
   * o payload precisa vir completo (medido em 05/09 — mandar só o campo mudado
   * zera o resto).
   */
  async alterar(idErp: string, dados: ContratoParaErp): Promise<void> {
    await this.v2.chamar('contrato.alterar.php', {
      contrato: JSON.stringify({ contrato: { id: idErp, ...this.montar(dados) } }),
    });
    this.logger.log(`[erp] contrato ${idErp} alterado`);
  }

  async obter(idErp: string): Promise<Record<string, unknown> | null> {
    const r = await this.v2.chamar('contrato.obter.php', { id: idErp });
    return ((r.contrato ?? null) as Record<string, unknown> | null) ?? null;
  }

  /** `contratos.pesquisa.php` — plural; o singular dá 404. */
  async pesquisar(filtros: { nomeCliente?: string; situacao?: string } = {}) {
    const r = await this.v2.chamar('contratos.pesquisa.php', {
      ...(filtros.nomeCliente ? { pesquisa: filtros.nomeCliente } : {}),
      ...(filtros.situacao ? { situacao: filtros.situacao } : {}),
    });
    const lista = (r.contratos ?? []) as Array<{ contrato?: Record<string, unknown> }>;
    return lista.map((c) => c.contrato ?? (c as Record<string, unknown>));
  }

  /**
   * Encerra o contrato pelo ÚNICO caminho que a v2 tem: mês/ano de término.
   *
   * `nro_parcelas` NÃO limita nada — medido: estava 3 e o ERP gerou 5 cobranças.
   * Sem término, cobra para sempre.
   */
  private mesAnoTermino(inicio: Date, prazoMeses: number): { mes: string; ano: string } {
    // O mês de início conta como o 1º do prazo: 12 meses a partir de setembro
    // terminam em agosto, não em setembro do ano seguinte.
    const fim = new Date(
      Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + prazoMeses - 1, 1),
    );
    return { mes: dd(fim.getUTCMonth() + 1), ano: String(fim.getUTCFullYear()) };
  }

  private montar(d: ContratoParaErp): Record<string, unknown> {
    const termino = this.mesAnoTermino(d.inicio, d.prazoMeses);
    return {
      data: brDate(d.inicio),
      descricao: d.descricao.slice(0, 120),
      cliente: {
        nome: d.cliente.nome,
        ...(d.cliente.cpfCnpj ? { cpf_cnpj: d.cliente.cpfCnpj } : {}),
      },
      dia_vencimento: d.diaVencimento,
      valor: d.valorMensal.toFixed(2),
      vencimento: d.vencimento ?? 'S',
      periodicidade: 1, // 1 mensal · 2 bimestral · 3 trimestral · 6 semestral · 12 anual
      situacao: 'A',
      mes_termino: termino.mes,
      ano_termino: termino.ano,
      ...(d.observacao ? { obs: d.observacao.slice(0, 500) } : {}),
      // Nota de serviço é OPT-IN do tenant: sem os dados fiscais conferidos pela
      // contabilidade dele, o contrato entra sem emitir nota. Chutar código de
      // lista de serviço ou ISS aqui sairia como imposto errado numa NFS-e real.
      emite_nota: d.nota ? 'S' : 'N',
      ...(d.nota
        ? {
            nota: {
              codigo_lista_servico: d.nota.codigoListaServico,
              natureza_operacao: d.nota.naturezaOperacao,
              percentual_iss: d.nota.percentualIss.toFixed(2),
              descontar_iss: 'N',
              nome_produto_servico: d.nota.servicoNome,
              codigo_produto_servico: d.nota.servicoCodigo,
              periodo_referencia: 'S',
            },
          }
        : {}),
    };
  }

  private extrairId(r: Record<string, unknown>): string | null {
    const registros = r.registros as
      | Array<{ registro?: { id?: string | number; codigo?: string | number } }>
      | undefined;
    const reg = registros?.[0]?.registro;
    const id = reg?.id ?? reg?.codigo;
    return id != null ? String(id) : null;
  }
}
