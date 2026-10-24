import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { PushService } from '@modules/push/push.service';
import { precisaLembrete, resumoDoAviso, type TipoPendencia } from './pendencias';
import { VerificadoresService } from './verificadores.service';

@Injectable()
export class PendenciasService {
  private readonly logger = new Logger(PendenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificadores: VerificadoresService,
    private readonly notificacoes: NotificacoesService,
    private readonly push: PushService,
  ) {}

  /** Empresas com algum marketplace conectado (a rotina passa por todas). */
  async empresasComMarketplace(): Promise<string[]> {
    const r = await this.prisma.integracaoConexao.findMany({
      where: { ativo: true, servico: { in: ['mercadolivre', 'shopee'] } },
      select: { empresaId: true },
      distinct: ['empresaId'],
    });
    return r.map((x) => x.empresaId);
  }

  /**
   * Uma rodada pra uma empresa: confere, grava, resolve o que sumiu e avisa.
   * Canal cuja conferência FALHOU não resolve nada (falha não é "zerou").
   */
  async rodada(
    empresaId: string,
    agora = new Date(),
  ): Promise<{ abertas: number; avisadas: number }> {
    const achados = await this.verificadores.levantar(empresaId);
    for (const [canal, lista] of achados) {
      if (!lista) continue;
      const chaves = new Set<string>();
      for (const p of lista) {
        chaves.add(`${p.tipo}|${p.chave}`);
        const atual = await this.prisma.pendenciaMarketplace.findUnique({
          where: {
            empresaId_canal_tipo_chave: { empresaId, canal, tipo: p.tipo, chave: p.chave },
          },
          select: { id: true, resolvidaEm: true },
        });
        const dados = {
          titulo: p.titulo.slice(0, 200),
          detalhe: p.detalhe?.slice(0, 500) ?? null,
          link: p.link ?? null,
          desde: p.desde ?? null,
          prazo: p.prazo ?? null,
        };
        if (!atual) {
          await this.prisma.pendenciaMarketplace.create({
            data: { empresaId, canal, tipo: p.tipo, chave: p.chave, ...dados },
          });
        } else {
          await this.prisma.pendenciaMarketplace.update({
            where: { id: atual.id },
            // Voltou depois de resolvida (comprador falou de novo): é novidade.
            data: atual.resolvidaEm
              ? { ...dados, resolvidaEm: null, avisadaEm: null, lembreteEm: null }
              : dados,
          });
        }
      }
      const abertas = await this.prisma.pendenciaMarketplace.findMany({
        where: { empresaId, canal, resolvidaEm: null },
        select: { id: true, tipo: true, chave: true },
      });
      const sumiram = abertas.filter((a) => !chaves.has(`${a.tipo}|${a.chave}`)).map((a) => a.id);
      if (sumiram.length) {
        await this.prisma.pendenciaMarketplace.updateMany({
          where: { id: { in: sumiram } },
          data: { resolvidaEm: agora },
        });
      }
    }
    const avisadas = await this.avisar(empresaId, agora);
    const abertas = await this.prisma.pendenciaMarketplace.count({
      where: { empresaId, resolvidaEm: null },
    });
    return { abertas, avisadas };
  }

  /** Push + sininho: 1x por item novo, 1 lembrete com prazo < 24 h. Agrupado. */
  private async avisar(empresaId: string, agora: Date): Promise<number> {
    const abertas = await this.prisma.pendenciaMarketplace.findMany({
      where: { empresaId, resolvidaEm: null },
      select: { id: true, canal: true, tipo: true, prazo: true, avisadaEm: true, lembreteEm: true },
    });
    const novas = abertas.filter((p) => !p.avisadaEm);
    const lembrar = abertas.filter((p) => precisaLembrete(p, agora));
    const avisar = [...novas, ...lembrar];
    if (!avisar.length) return 0;

    const { titulo, corpo } = resumoDoAviso(
      avisar.map((p) => ({ canal: p.canal, tipo: p.tipo as TipoPendencia, prazo: p.prazo })),
      agora,
    );
    const tituloFinal = novas.length ? titulo : `Lembrete: ${titulo}`;
    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['ADMIN', 'DIRECTOR'],
        tipo: 'GENERICO',
        titulo: tituloFinal,
        mensagem: corpo,
        prioridade: lembrar.length ? 'URGENTE' : 'ALTA',
        link: '/pendencias',
        metadata: { origem: 'pendencias-marketplace' },
      })
      .catch(() => 0);
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        status: 'ATIVO',
        role: { in: ['ADMIN', 'DIRECTOR'] },
        empresas: { some: { empresaId } },
      },
      select: { id: true },
    });
    await this.push
      .enviar(
        usuarios.map((u) => u.id),
        { titulo: tituloFinal, corpo, url: '/pendencias', tag: `pendencias-${empresaId}` },
      )
      .catch(() => 0);
    if (novas.length) {
      await this.prisma.pendenciaMarketplace.updateMany({
        where: { id: { in: novas.map((p) => p.id) } },
        data: { avisadaEm: agora },
      });
    }
    if (lembrar.length) {
      await this.prisma.pendenciaMarketplace.updateMany({
        where: { id: { in: lembrar.map((p) => p.id) } },
        data: { lembreteEm: agora },
      });
    }
    this.logger.log(`[pendências] ${empresaId}: avisadas ${avisar.length} — ${corpo}`);
    return avisar.length;
  }

  listarAbertas(empresaId: string) {
    return this.prisma.pendenciaMarketplace.findMany({
      where: { empresaId, resolvidaEm: null },
      orderBy: [{ prazo: { sort: 'asc', nulls: 'last' } }, { desde: 'asc' }],
      take: 500,
    });
  }

  contarAbertas(empresaId: string) {
    return this.prisma.pendenciaMarketplace.count({ where: { empresaId, resolvidaEm: null } });
  }
}
