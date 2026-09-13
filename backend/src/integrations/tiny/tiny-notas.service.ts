import { Injectable, Logger } from '@nestjs/common';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { TinyV2ClientService } from './tiny-v2-client.service';

export interface NotaGerada {
  id: string;
  numero?: string;
  serie?: string;
}

export interface NotaAutorizada {
  id: string;
  numero?: string;
  chaveAcesso: string;
  dataEmissao?: string;
}

/** Situação 6 = autorizada pela SEFAZ. É a única que vale como "saiu". */
const SITUACAO_AUTORIZADA = '6';
/** Situações terminais de fracasso — parar de pollar e contar o motivo. */
const SITUACOES_MORTAS: Record<string, string> = {
  '3': 'cancelada',
  '4': 'denegada pela SEFAZ',
  '7': 'rejeitada pela SEFAZ',
};

/**
 * Nota fiscal no Tiny — **gerada sempre A PARTIR DO PEDIDO**.
 *
 * ⚠️ Existe `nota.fiscal.incluir.php`, que monta nota avulsa, e ele NÃO é usado
 * aqui por decisão do Léo (12/09): *"não é pra montar nf de remessa avulso,
 * SEMPRE deve ser pelo pedido de venda"*. Nota avulsa nasce solta do pedido que
 * a originou — some o vínculo que o ERP usa pra estoque, financeiro e histórico,
 * e ninguém consegue responder "de qual venda saiu esta remessa".
 *
 * **Por que v2:** a v3 lista, obtém e autoriza nota (`POST /notas/{id}/emitir`),
 * mas **não gera nota a partir de pedido** — esse endpoint só existe na v2
 * (`gerar.nota.fiscal.pedido.php`). Conferido na spec versionada no repo e
 * sondado contra a API.
 *
 * 🔴 **Nada aqui tem desfazer.** Nota rejeitada guarda um snapshot do item
 * (corrigir o produto depois não conserta), não se gera uma segunda nota pro
 * mesmo pedido, e a v2 não apaga. Por isso o serviço só transporta: quem decide
 * SE deve emitir é quem chama, com as guardas de lá.
 */
@Injectable()
export class TinyNotasService {
  private readonly logger = new Logger(TinyNotasService.name);

  constructor(private readonly v2: TinyV2ClientService) {}

  get configurado(): boolean {
    return this.v2.configurado;
  }

  /**
   * Gera a nota (ainda NÃO autorizada) a partir de um pedido do ERP.
   *
   * `natureza_operacao` vai junto quando o tenant configurou: é ela que carrega
   * o CFOP da remessa, porque a API não aceita CFOP nem na nota nem por item.
   * Quando não vai, o Tiny usa a natureza padrão da conta — que é venda, e por
   * isso o chamador exige a configuração antes de chegar aqui.
   */
  async gerarDoPedido(
    idPedido: string,
    opcoes: { naturezaOperacao?: string; idNaturezaOperacao?: number } = {},
  ): Promise<NotaGerada> {
    const r = await this.v2.chamar('gerar.nota.fiscal.pedido.php', {
      id: idPedido,
      modelo: 'NFe',
      ...(opcoes.naturezaOperacao ? { natureza_operacao: opcoes.naturezaOperacao } : {}),
      ...(opcoes.idNaturezaOperacao
        ? { id_natureza_operacao: String(opcoes.idNaturezaOperacao) }
        : {}),
    });
    const nota = (r.registros as { registro?: Record<string, unknown> } | undefined)?.registro ?? r;
    const id = String(
      (nota as Record<string, unknown>).idNotaFiscal ??
        (nota as Record<string, unknown>).id ??
        (nota as Record<string, unknown>).numero ??
        '',
    );
    if (!id) {
      throw new IntegrationException(
        `[tiny v2] nota gerada mas sem id no retorno: ${JSON.stringify(r).slice(0, 300)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const n = nota as Record<string, unknown>;
    this.logger.log(`[erp] nota ${id} gerada a partir do pedido ${idPedido}`);
    return { id, numero: n.numero as string | undefined, serie: n.serie as string | undefined };
  }

  /**
   * Manda autorizar e ESPERA a SEFAZ responder.
   *
   * A emissão é assíncrona: o `emitir` responde OK só dizendo que a fila
   * aceitou. Quem para por aí grava "emitida" e descobre dias depois que a nota
   * foi rejeitada — por isso o polling não é enfeite, é a única forma de saber.
   */
  async emitirEEsperar(idNota: string, tentativas = 12, esperaMs = 5000): Promise<NotaAutorizada> {
    await this.v2.chamar('nota.fiscal.emitir.php', { id: idNota });
    this.logger.log(`[erp] nota ${idNota} mandada pra autorização — aguardando SEFAZ`);

    for (let i = 0; i < tentativas; i++) {
      await new Promise((r) => setTimeout(r, esperaMs));
      const r = await this.v2.chamar('nota.fiscal.obter.php', { id: idNota });
      const nota = ((r.nota_fiscal ?? r.notaFiscal ?? {}) as Record<string, unknown>) ?? {};
      const situacao = String(nota.situacao ?? '');
      const chave = String(nota.chave_acesso ?? '');

      if (situacao === SITUACAO_AUTORIZADA && chave) {
        this.logger.log(`[erp] nota ${idNota} AUTORIZADA — chave ${chave.slice(0, 8)}…`);
        return {
          id: idNota,
          numero: nota.numero as string | undefined,
          chaveAcesso: chave,
          dataEmissao: nota.data_emissao as string | undefined,
        };
      }
      const morta = SITUACOES_MORTAS[situacao];
      if (morta) {
        // Beco sem saída: não existe segunda nota pro mesmo pedido nem endpoint
        // de alterar. O motivo precisa chegar inteiro em quem chamou.
        throw new IntegrationException(
          `[tiny] nota ${idNota} ${morta}${nota.descricao_situacao ? ` — ${String(nota.descricao_situacao)}` : ''}. ` +
            'Não há segunda nota pro mesmo pedido: o conserto é pelo painel.',
          ErrorCode.INTEGRATION_ERROR,
        );
      }
    }

    // Nem autorizada nem morta: a SEFAZ ainda está mastigando. NÃO é erro de
    // emissão, e dizer que falhou faria alguém tentar de novo e duplicar.
    throw new IntegrationException(
      `[tiny] nota ${idNota} ainda não voltou da SEFAZ depois de ${(tentativas * esperaMs) / 1000}s. ` +
        'Ela PODE ter sido autorizada — confira no painel antes de tentar de novo.',
      ErrorCode.INTEGRATION_ERROR,
    );
  }
}
