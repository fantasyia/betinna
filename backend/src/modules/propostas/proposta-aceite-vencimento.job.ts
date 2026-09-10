import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { KanbanTarefaService } from '@modules/kanban/kanban-tarefa.service';
import { CronLockService } from '@shared/utils/cron-lock.service';

/** Quantos dias antes do vencimento o rep é avisado. */
const LEMBRETE_DIAS = 2;
/** Teto por empresa por rodada — varredura não pode virar tempestade de cards. */
const LOTE = 50;

export interface ResultadoVarreduraAceite {
  lembretes: number;
  expiradas: number;
  erros: string[];
}

/**
 * O link de aceite MORRE sozinho e ninguém fica sabendo.
 *
 * O token é um JWT com `exp` — quando o prazo passa, `validarToken` recusa e o
 * cliente vê *"Link expirado ou inválido. Peça um novo link ao representante."*
 * Só que **o representante não é avisado de nada**: pra ele a proposta segue
 * `AGUARDANDO_ASSINATURA` no funil, como se o cliente ainda estivesse
 * decidindo. O negócio não é perdido por "não", é perdido por silêncio.
 *
 * ⚠️ A coluna `aceiteExpiraEm` existia desde o começo e **nunca foi lida** —
 * era espelho do `exp` do JWT, gravado e esquecido. É ela que este job usa.
 * Quem for mexer no TTL: o que expira de verdade é o JWT; a coluna precisa
 * continuar sendo escrita junto, senão a varredura passa a mentir.
 *
 * Duas coisas, e as duas são INTERNAS:
 *
 * 1. **T-2 dias:** tarefa pro rep — dá pra ligar antes de o link morrer.
 * 2. **Vencido:** proposta vai pra `EXPIRADA` e o rep ganha tarefa pra decidir
 *    se reenvia. `EXPIRADA → ENVIADA` já é transição válida, então reenviar é
 *    um clique.
 *
 * ⛔ **Este job NÃO fala com o cliente.** Nada de e-mail ou WhatsApp automático
 * de "seu link venceu": mensagem pra fora é decisão do Léo, e o custo de errar
 * é do lado dele, não do nosso. Aqui só se avisa quem trabalha na casa.
 */
@Injectable()
export class PropostaAceiteVencimentoJob {
  private readonly logger = new Logger(PropostaAceiteVencimentoJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly tarefas: KanbanTarefaService,
  ) {}

  /**
   * De hora em hora, e não uma vez por dia, porque "faltam 2 dias" perde a
   * graça se o aviso sai 20 horas depois. A idempotência é do `origemJobId`
   * (`criarCardsDeTarefa` não recria card do mesmo passo), então rodar 24× no
   * dia produz UM card, não 24.
   */
  @Cron('20 * * * *', { name: 'proposta-aceite-vencimento', timeZone: 'UTC' })
  async rodar(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('proposta-aceite-vencimento', 10 * 60))) return;

    const empresas = await this.prisma.empresa.findMany({
      where: { ativo: true },
      select: { id: true },
    });
    for (const { id } of empresas) {
      try {
        await this.varrer(id);
      } catch (err) {
        this.logger.error(
          `Varredura de vencimento de aceite falhou na empresa ${id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async varrer(empresaId: string): Promise<ResultadoVarreduraAceite> {
    const res: ResultadoVarreduraAceite = { lembretes: 0, expiradas: 0, erros: [] };
    const agora = new Date();
    const limiteLembrete = new Date(agora.getTime() + LEMBRETE_DIAS * 86_400_000);

    const abertas = await this.prisma.proposta.findMany({
      where: {
        empresaId,
        status: 'AGUARDANDO_ASSINATURA',
        aceiteExpiraEm: { not: null, lt: limiteLembrete },
      },
      select: {
        id: true,
        numero: true,
        representanteId: true,
        aceiteExpiraEm: true,
        valor: true,
        cliente: { select: { nome: true } },
      },
      take: LOTE,
    });

    for (const p of abertas) {
      const venceu = (p.aceiteExpiraEm as Date) <= agora;
      try {
        if (venceu) {
          await this.expirar(empresaId, p);
          res.expiradas += 1;
        } else {
          await this.lembrar(empresaId, p);
          res.lembretes += 1;
        }
      } catch (err) {
        // Uma proposta não pode derrubar as outras: cada uma é um cliente
        // diferente esperando alguém lembrar dele.
        const msg = `${p.numero}: ${err instanceof Error ? err.message : String(err)}`;
        res.erros.push(msg);
        this.logger.error(`Vencimento de aceite falhou — ${msg}`);
      }
    }
    return res;
  }

  private async lembrar(empresaId: string, p: PropostaPendente): Promise<void> {
    if (!p.representanteId) return;
    await this.tarefas.criarCardsDeTarefa({
      empresaId,
      responsavelId: p.representanteId,
      origemJobId: `proposta-aceite-vencendo:${p.id}`,
      titulo: `⏳ ${p.numero} — o link de aceite de ${p.cliente.nome} vence em ${LEMBRETE_DIAS} dias`,
      descricao:
        `A proposta **${p.numero}** (${p.cliente.nome}, ${formatarReal(Number(p.valor))}) ` +
        `está aguardando assinatura e o link vence em ${formatarData(p.aceiteExpiraEm)}.\n\n` +
        'Depois disso o cliente que clicar vê "link expirado" e **você não fica sabendo** — ' +
        'por isso o aviso vem antes.\n\n' +
        'Se ele ainda está decidindo, vale um toque agora; se já decidiu, o link novo ' +
        'sai num clique.',
      // O card vence junto com o link: passar disso ele não serve mais.
      dataEntrega: p.aceiteExpiraEm ?? undefined,
    });
  }

  private async expirar(empresaId: string, p: PropostaPendente): Promise<void> {
    // O CAS no `where` (status ainda AGUARDANDO_ASSINATURA) evita a corrida com
    // um aceite que chegue no mesmo instante: quem aceitou GANHA, e a varredura
    // simplesmente não encontra a linha.
    const { count } = await this.prisma.proposta.updateMany({
      where: { id: p.id, empresaId, status: 'AGUARDANDO_ASSINATURA' },
      data: { status: 'EXPIRADA' },
    });
    if (count === 0) return;

    this.logger.log(`Proposta ${p.numero} EXPIRADA — link de aceite venceu sem resposta`);
    if (!p.representanteId) return;
    await this.tarefas.criarCardsDeTarefa({
      empresaId,
      responsavelId: p.representanteId,
      origemJobId: `proposta-aceite-expirada:${p.id}`,
      titulo: `⌛ ${p.numero} — ${p.cliente.nome} não assinou; o link venceu`,
      descricao:
        `A proposta **${p.numero}** (${p.cliente.nome}, ${formatarReal(Number(p.valor))}) ` +
        `venceu em ${formatarData(p.aceiteExpiraEm)} sem aceite nem recusa.\n\n` +
        'Ela foi pra **EXPIRADA** — não é "perdida", é que o link morreu. ' +
        'Reenviar gera um link novo (EXPIRADA → ENVIADA é caminho normal).\n\n' +
        '⚠️ Nenhuma mensagem foi mandada pro cliente. Quem fala com ele é você.',
    });
  }
}

interface PropostaPendente {
  id: string;
  numero: string;
  representanteId: string | null;
  aceiteExpiraEm: Date | null;
  valor: unknown;
  cliente: { nome: string };
}

function formatarData(d: Date | null): string {
  return d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'data desconhecida';
}

function formatarReal(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
