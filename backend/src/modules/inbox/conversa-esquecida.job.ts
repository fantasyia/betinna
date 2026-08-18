import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CronLockService } from '@shared/utils/cron-lock.service';
import { frontendOrigin } from '@shared/utils/frontend-origin';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import {
  type AlertaEsquecidaConfig,
  passouDoPrazo,
  resolveAlertaEsquecida,
} from './conversa-esquecida.util';

/**
 * Alerta de CONVERSA ESQUECIDA (card 🔔, item 4).
 *
 * A regra do Léo é que, depois de transferir pra humano, o bot NÃO volta
 * sozinho — quem religa é o atendente. Isso impede o bot de atropelar um
 * atendimento de vários turnos, mas abre um buraco: se o atendente esquecer de
 * religar, a conversa fica MUDA. Nem bot, nem humano. O cliente escreve, ninguém
 * responde, e não existe erro em lugar nenhum pra alguém perceber. Como o
 * próprio card diz: o erro humano "vai acontecer".
 *
 * Esta é a rede de proteção. Regras que importam:
 *
 * • CONTA SÓ HORÁRIO COMERCIAL. 4h corridas a partir das 17h vencem às 21h, e às
 *   21h ninguém esqueceu de nada — o expediente acabou. Alarme que dispara toda
 *   noite e todo fim de semana vira ruído, e ruído todo mundo aprende a ignorar.
 *
 * • A TAREFA VAI PRO ATENDENTE que recebeu a transferência, não pra diretoria.
 *   Alerta que cai sempre na mesma pessoa que não é dona do atendimento tem o
 *   mesmo destino do ruído acima.
 *
 * • CARIMBA `alertaEsquecidaEm` — é o que destaca no Inbox E o que impede a
 *   varredura de reabrir tarefa a cada 15 minutos. O carimbo é limpo quando
 *   alguém responde ou religa o bot.
 */
@Injectable()
export class ConversaEsquecidaJob {
  private readonly logger = new Logger(ConversaEsquecidaJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cronLock: CronLockService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  @Cron('*/15 * * * *', { name: 'inbox-conversa-esquecida', timeZone: 'UTC' })
  async varrer(): Promise<void> {
    if (this.env.get('NODE_ENV') === 'test') return;
    if (!(await this.cronLock.acquire('inbox-conversa-esquecida', 14 * 60))) return;

    const agora = new Date();
    let alertadas = 0;
    try {
      const empresas = await this.prisma.empresa.findMany({
        where: { ativo: true },
        select: { id: true, config: true },
      });
      for (const empresa of empresas) {
        const cfg = resolveAlertaEsquecida(
          (empresa.config as { alertaConversaEsquecida?: unknown } | null)?.alertaConversaEsquecida,
        );
        if (!cfg.ativo) continue;
        alertadas += await this.varrerEmpresa(empresa.id, cfg, agora);
      }
    } catch (err) {
      this.logger.warn(
        `Varredura de conversa esquecida falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (alertadas > 0) {
      this.logger.log(`${alertadas} conversa(s) esquecida(s) alertada(s).`);
    }
  }

  private async varrerEmpresa(
    empresaId: string,
    cfg: AlertaEsquecidaConfig,
    agora: Date,
  ): Promise<number> {
    // Pré-filtro barato no banco: horas COMERCIAIS decorridas nunca passam das
    // horas de relógio, então quem não tem nem `horas` de relógio com certeza
    // não venceu — não precisa nem entrar no cálculo fino.
    const candidatas = await this.prisma.conversation.findMany({
      where: {
        empresaId,
        status: 'ABERTA',
        // Bot DESLIGADO nesta conversa especificamente (é o estado que a
        // transferência deixa). `null` = segue o global e o bot responde.
        botLigado: false,
        alertaEsquecidaEm: null,
        ultimaMsgEm: { lt: new Date(agora.getTime() - cfg.horas * 3600_000) },
      },
      select: {
        id: true,
        peerNome: true,
        peerId: true,
        atribuidoId: true,
        clienteId: true,
        ultimaMsgEm: true,
      },
      take: 200,
    });
    if (candidatas.length === 0) return 0;

    let alertadas = 0;
    for (const conv of candidatas) {
      if (!conv.ultimaMsgEm) continue;
      if (!passouDoPrazo(conv.ultimaMsgEm, agora, cfg)) continue;

      // A última mensagem tem que ser DO CLIENTE. Se a última foi nossa, o
      // atendente respondeu e está esperando o cliente — não há esquecimento.
      const ultima = await this.prisma.message.findFirst({
        where: { conversationId: conv.id },
        orderBy: { criadoEm: 'desc' },
        select: { direction: true },
      });
      if (ultima?.direction !== 'INBOUND') continue;

      if (await this.alertar(empresaId, conv, cfg)) alertadas += 1;
    }
    return alertadas;
  }

  private async alertar(
    empresaId: string,
    conv: {
      id: string;
      peerNome: string | null;
      peerId: string;
      atribuidoId: string | null;
      clienteId: string | null;
      ultimaMsgEm: Date | null;
    },
    cfg: AlertaEsquecidaConfig,
  ): Promise<boolean> {
    const quem = conv.peerNome || conv.peerId.split('@')[0] || 'contato';
    const link = `${frontendOrigin()}/inbox?conversa=${conv.id}`;
    const titulo = `Conversa parada com ${quem} — religue o bot ou responda`;
    const mensagem =
      `A conversa com <strong>${quem}</strong> está com o bot DESLIGADO e sem resposta ` +
      `há mais de ${cfg.horas}h de expediente. Enquanto ficar assim, nem o bot nem ninguém ` +
      `responde essa pessoa.<br><br>Abra a conversa e, se o atendimento acabou, use o botão ` +
      `<strong>Religar</strong> no topo — aí o bot volta a atender só nela.`;

    // CARIMBO PRIMEIRO, com guarda de idempotência no próprio WHERE: se duas
    // instâncias do worker rodarem a varredura junto, só uma marca — a outra
    // pega count 0 e não duplica a tarefa.
    const marcou = await this.prisma.conversation.updateMany({
      where: { id: conv.id, alertaEsquecidaEm: null },
      data: { alertaEsquecidaEm: new Date() },
    });
    if (marcou.count === 0) return false;

    // Tarefa PRO ATENDENTE que recebeu a transferência. Sem atendente atribuído
    // não existe destinatário certo — e mandar pra diretoria é exatamente o
    // ruído que o Léo pediu pra evitar. Nesse caso fica só o destaque no Inbox.
    if (conv.atribuidoId) {
      try {
        await this.prisma.agendaItem.create({
          data: {
            empresaId,
            usuarioId: conv.atribuidoId,
            clienteId: conv.clienteId,
            titulo,
            data: new Date(),
            tipo: 'TAREFA',
            // Uma tarefa por alerta desta conversa (o @unique protege o retry).
            origemJobId: `conversa-esquecida:${conv.id}`,
            observacao: `${mensagem.replace(/<[^>]+>/g, '')}\n\n${link}`,
          },
        });
      } catch {
        /* já existia (origemJobId @unique) — o carimbo é o que vale */
      }
      await this.notificacoes.criarParaUsuario({
        empresaId,
        usuarioId: conv.atribuidoId,
        tipo: 'MENSAGEM_INBOX',
        titulo,
        mensagem: mensagem.replace(/<[^>]+>/g, ''),
        link: `/inbox?conversa=${conv.id}`,
        prioridade: 'ALTA',
      });
    } else {
      this.logger.warn(
        `Conversa ${conv.id} esquecida mas SEM atendente atribuído — só o destaque no Inbox.`,
      );
    }
    return true;
  }
}
