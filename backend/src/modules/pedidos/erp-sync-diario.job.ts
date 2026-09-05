import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { TinyProdutosSyncService } from '@integrations/tiny/tiny-produtos-sync.service';
import { TinyRepsSyncService } from '@integrations/tiny/tiny-reps-sync.service';
import { TinyClientesSyncService } from '@integrations/tiny/tiny-clientes-sync.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { ComissaoBaixaSyncService } from '@modules/comissoes/comissao-baixa-sync.service';
import { ContratoComissaoErpService } from '@modules/comissoes/contrato-comissao-erp.service';
import { ErpCancelamentosService } from './erp-cancelamentos.service';
import { PedidoErpSyncService } from './pedido-erp-sync.service';

/**
 * A ÚNICA automação diária do ERP — catálogo e pedidos na mesma rodada.
 *
 * Decisão do Léo (28/08): uma automação por dia, não uma por recurso. O ganho
 * não é de máquina, é de gente — quando algo não aparece no app, existe **um**
 * horário e **um** log pra olhar, em vez de descobrir qual dos crons falhou.
 *
 * Ordem importa: produtos primeiro. O pedido do ERP casa os itens por SKU, e um
 * SKU criado ontem no Tiny só existe aqui depois do sync de catálogo — invertido,
 * o pedido entraria sem os itens e ninguém veria motivo.
 *
 * 06:00 UTC = 03:00 no Brasil: o dia comercial já fechou lá e ninguém está
 * mexendo no ERP. Quem tem pressa usa o botão "Sincronizar do ERP" na tela.
 */
@Injectable()
export class ErpSyncDiarioJob {
  private readonly logger = new Logger(ErpSyncDiarioJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly produtos: TinyProdutosSyncService,
    private readonly reps: TinyRepsSyncService,
    private readonly clientes: TinyClientesSyncService,
    private readonly pedidos: PedidoErpSyncService,
    private readonly cancelamentos: ErpCancelamentosService,
    private readonly baixas: ComissaoBaixaSyncService,
    private readonly locacao: ContratoComissaoErpService,
  ) {}

  @Cron('0 6 * * *', { name: 'erp-sync-diario', timeZone: 'UTC' })
  async sincronizar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    // TTL 1h: a rodada é minutos, e o lock só impede api e worker de puxarem o
    // mesmo catálogo em paralelo (o que dobraria chamada à API do Tiny à toa).
    if (!(await this.cronLock.acquire('erp-sync-diario', 3600))) return;

    const conexoes = await this.prisma.integracaoConexao.findMany({
      where: { servico: 'tiny', ativo: true },
      select: { empresaId: true },
    });
    if (conexoes.length === 0) return;

    for (const { empresaId } of conexoes) {
      try {
        const cat = await this.produtos.sync(empresaId, { modo: 'incremental' });
        const ped = await this.pedidos.sincronizar(empresaId);
        // Reps novos viram contato no ERP na MESMA rodada — é o que permite
        // marcá-los como vendedor lá e o pedido voltar pro dono certo aqui.
        const reps = await this.reps.sincronizar(empresaId);
        // Situação do cliente (bloqueado no ERP) — o campo existia desde sempre
        // e ninguém alimentava: todo cliente era ATIVO aqui, mesmo o barrado lá.
        const cli = await this.clientes.sincronizar(empresaId);
        // Depois do sync (que traz o cancelamento feito no ERP pra cá): nota
        // fiscal pra estornar, pedido de venda ainda aberto lá, comissão viva.
        const canc = await this.cancelamentos.varrer(empresaId);
        // Locação: mensalidade já registrada como recebida vira conta a pagar.
        // Antes das baixas, para que uma conta criada agora já possa ser
        // conferida na mesma rodada se o financeiro tiver baixado no mesmo dia.
        const loc = await this.locacao.provisionar(empresaId);
        // Comissão que o financeiro já baixou no ERP vira "paga" na tela do rep.
        // Sem esta leitura, quem recebeu via o mesmo "a pagar" de quem não recebeu.
        const baixas = await this.baixas.varrer(empresaId);
        this.logger.log(
          `[erp] rodada diária empresa=${empresaId}: ` +
            `produtos ${cat.criados}+${cat.atualizados}, pedidos ${ped.criados}+${ped.atualizados}, ` +
            `reps ${reps.criados} novo(s), comissões baixadas ${baixas.baixadas}/${baixas.conferidas}, ` +
            (loc.criadas ? `locação ${loc.criadas} conta(s) provisionada(s), ` : '') +
            `clientes ${cli.atualizados} com status novo` +
            (cli.bloqueados ? ` (${cli.bloqueados} bloqueado(s))` : '') +
            (reps.semDocumento ? `, ${reps.semDocumento} sem CPF/CNPJ` : '') +
            `, cancelamentos ${canc.conferidos} conferido(s)` +
            (canc.notasParaEstornar.length
              ? ` (${canc.notasParaEstornar.length} NF p/ estorno)`
              : '') +
            (ped.avisos.length ? ` — ${ped.avisos.length} aviso(s)` : ''),
        );
        for (const aviso of ped.avisos) this.logger.warn(`[erp] ${aviso}`);
        for (const aviso of canc.avisos) this.logger.warn(`[erp] ${aviso}`);
      } catch (err) {
        // Isolamento por empresa: um tenant com token vencido não pode impedir
        // o sync dos outros.
        this.logger.error(
          `[erp] rodada diária falhou pra empresa=${empresaId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
