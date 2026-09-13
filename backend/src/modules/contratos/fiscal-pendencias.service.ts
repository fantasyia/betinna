import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyClientService } from '@integrations/tiny/tiny-client.service';

/** Um bloqueio que impede uma emissão — com o nome do campo e onde ele mora. */
export interface Pendencia {
  campo: string;
  onde: string;
  porque: string;
}

export interface ProdutoPendente {
  sku: string;
  nome: string;
}

export interface PendenciasFiscais {
  /** `true` quando NADA impede: as duas emissões podem sair. */
  pronto: boolean;
  nfseMensal: {
    pronto: boolean;
    ligado: boolean;
    faltando: Pendencia[];
  };
  comodato: {
    pronto: boolean;
    ligado: boolean;
    faltando: Pendencia[];
    /** Produtos de locação sem o valor do BEM (≠ mensalidade). */
    semValorBem: ProdutoPendente[];
    /**
     * Produtos sem NCM no ERP. `null` = não deu pra conferir agora (o Tiny não
     * respondeu) — que é diferente de "conferi e está tudo certo".
     */
    semNcm: ProdutoPendente[] | null;
  };
}

/** Campos que a NFS-e mensal do contrato exige, e por quê cada um. */
const CAMPOS_NFSE: Array<[string, string]> = [
  ['codigoListaServico', 'código da lista de serviço (LC 116) — define a tributação do ISS'],
  ['naturezaOperacao', 'natureza da operação que sai escrita na nota'],
  ['percentualIss', 'alíquota de ISS do município'],
  ['servicoCodigo', 'código do serviço cadastrado no ERP'],
  ['servicoNome', 'nome do serviço que o cliente lê na nota'],
];

/**
 * ⚠️ Natureza, não CFOP: `nota.fiscal.incluir.php` não aceita CFOP (nem na nota,
 * nem por item). O CFOP mora na natureza cadastrada no painel do Tiny. São
 * duas porque dentro do estado e interestadual têm CFOPs diferentes.
 */
const CAMPOS_COMODATO: Array<[string, string]> = [
  [
    'naturezaMesmaUf',
    'natureza de operação cadastrada no Tiny pra remessa na MESMA UF (é ela que carrega o CFOP)',
  ],
  [
    'naturezaOutraUf',
    'natureza de operação pra remessa INTERESTADUAL (CFOP diferente da anterior)',
  ],
];

/** Teto de produtos conferidos no ERP: diagnóstico não pode virar varredura. */
const MAX_PRODUTOS_CONFERIDOS = 25;

/**
 * O que falta pra operação de locação emitir nota — perguntável ANTES de tentar.
 *
 * **Por que existe:** até 12/09 a única forma de saber que o contrato ia subir
 * sem emissão de nota era subir e ler um `warn` no log do worker. O contrato
 * 340265142 entrou assim — Ativo, cobrando, e com `emite_nota = N` — e ninguém
 * ficou sabendo até alguém consultar a API do Tiny à mão. Pendência fiscal
 * silenciosa é a pior espécie: ela só aparece no mês em que a nota não sai.
 *
 * ⚠️ Este serviço **não decide nada fiscal**. Ele lista o que está vazio e diz
 * quem preenche. Inventar CFOP, NCM ou alíquota sairia numa nota real, e nota
 * rejeitada não tem conserto pela API do Tiny (snapshot do item, sem segunda
 * nota pro mesmo pedido, sem endpoint de alterar — só o painel).
 */
@Injectable()
export class FiscalPendenciasService {
  private readonly logger = new Logger(FiscalPendenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiny: TinyClientService,
  ) {}

  async verificar(empresaId: string): Promise<PendenciasFiscais> {
    const cfg = await this.configErp(empresaId);
    const contrato = (cfg.contratoLocacao ?? {}) as Record<string, unknown>;
    const comodato = (cfg.comodato ?? {}) as Record<string, unknown>;

    const nfseFaltando = this.faltando(contrato, CAMPOS_NFSE, 'erp.contratoLocacao');
    const comodatoFaltando = this.faltando(comodato, CAMPOS_COMODATO, 'erp.comodato');

    const alugaveis = await this.prisma.produto.findMany({
      where: { empresaId, precoLocacaoMensal: { not: null } },
      select: { sku: true, nome: true, valorBem: true },
      orderBy: { sku: 'asc' },
    });
    const semValorBem = alugaveis
      .filter((p) => p.valorBem === null)
      .map((p) => ({ sku: p.sku ?? '(sem SKU)', nome: p.nome }));
    const semNcm = await this.semNcmNoErp(empresaId, alugaveis);

    // "Ligado" e "pronto" são coisas diferentes de propósito: quem não ligou a
    // emissão não tem pendência — tem uma escolha. Misturar os dois faria o
    // diagnóstico gritar por um tenant que decidiu não emitir nota nenhuma.
    const nfseLigado = contrato.emiteNota === true;
    const comodatoLigado = comodato.emiteNota === true;
    const nfsePronto = nfseFaltando.length === 0;
    const comodatoPronto =
      comodatoFaltando.length === 0 && semValorBem.length === 0 && (semNcm?.length ?? 0) === 0;

    return {
      pronto: nfsePronto && comodatoPronto,
      nfseMensal: { pronto: nfsePronto, ligado: nfseLigado, faltando: nfseFaltando },
      comodato: {
        pronto: comodatoPronto,
        ligado: comodatoLigado,
        faltando: comodatoFaltando,
        semValorBem,
        semNcm,
      },
    };
  }

  private async configErp(empresaId: string): Promise<Record<string, unknown>> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const config = (empresa?.config ?? {}) as Record<string, unknown>;
    return (config.erp ?? {}) as Record<string, unknown>;
  }

  private faltando(
    valores: Record<string, unknown>,
    campos: Array<[string, string]>,
    onde: string,
  ): Pendencia[] {
    return campos
      .filter(([campo]) => {
        const v = valores[campo];
        return v === undefined || v === null || v === '';
      })
      .map(([campo, porque]) => ({ campo, onde, porque }));
  }

  /**
   * ⚠️ O NCM **não é espelhado no app** de propósito: dado fiscal tem uma fonte
   * só, e ela é o ERP. Então a conferência é uma consulta, e ela pode falhar —
   * daí o `null`, que significa "não sei", nunca "está tudo certo".
   */
  private async semNcmNoErp(
    empresaId: string,
    produtos: Array<{ sku: string | null; nome: string }>,
  ): Promise<ProdutoPendente[] | null> {
    const comSku = produtos.filter((p) => p.sku).slice(0, MAX_PRODUTOS_CONFERIDOS);
    if (comSku.length === 0) return [];
    try {
      const sem: ProdutoPendente[] = [];
      for (const p of comSku) {
        const r = await this.tiny.get<{ itens?: Array<{ sku?: string; ncm?: string }> }>(
          empresaId,
          '/produtos',
          { codigo: p.sku as string, limit: 5 },
        );
        // `codigo` é busca, não igualdade — a conferência exata é aqui.
        const achado = (r.itens ?? []).find((i) => (i.sku ?? '').trim() === p.sku);
        if (achado && !String(achado.ncm ?? '').trim()) {
          sem.push({ sku: p.sku as string, nome: p.nome });
        }
      }
      return sem;
    } catch (err) {
      this.logger.warn(
        `Não consegui conferir NCM no ERP (${err instanceof Error ? err.message : String(err)}) — ` +
          'o diagnóstico devolve "não sei" em vez de "está tudo certo".',
      );
      return null;
    }
  }
}
