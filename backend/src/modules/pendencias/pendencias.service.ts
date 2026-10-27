import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { PushService } from '@modules/push/push.service';
import {
  precisaLembrete,
  resumoDoAviso,
  statusDa,
  type StatusPendencia,
  type TipoPendencia,
} from './pendencias';

export interface FiltroPendencias {
  busca?: string;
  canal?: string;
  tipo?: string;
  status?: StatusPendencia;
  de?: string;
  ate?: string;
}
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

  /**
   * Alguém da equipe (não a IA) escreveu na conversa depois que a IA passou o
   * caso? Pendência sem conversa (devolução só no painel) conta como sim: lá o
   * marketplace é quem diz que acabou.
   */
  private async equipeRespondeu(pendenciaId: string): Promise<boolean> {
    const ia = await this.prisma.pendenciaRespostaIa.findFirst({
      where: { pendenciaId, acao: 'humano' },
      orderBy: { criadoEm: 'desc' },
      select: { conversationId: true, criadoEm: true },
    });
    if (!ia?.conversationId) return true;
    const n = await this.prisma.message.count({
      where: {
        conversationId: ia.conversationId,
        direction: 'OUTBOUND',
        enviadaPorBot: false,
        status: { not: 'FAILED' },
        criadoEm: { gt: ia.criadoEm },
      },
    });
    return n > 0;
  }

  /** "Resolvido" na tela: fecha a pendência (a equipe já cuidou). */
  async resolver(empresaId: string, id: string) {
    const r = await this.prisma.pendenciaMarketplace.updateMany({
      where: { id, empresaId, resolvidaEm: null },
      data: { resolvidaEm: new Date() },
    });
    return { resolvida: r.count > 0 };
  }

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
          comprador: p.comprador?.slice(0, 120) ?? null,
          pedido: p.pedido?.slice(0, 60) ?? null,
          anuncio: p.anuncio?.slice(0, 80) ?? null,
        };
        if (!atual) {
          await this.prisma.pendenciaMarketplace.create({
            data: { empresaId, canal, tipo: p.tipo, chave: p.chave, ...dados },
          });
        } else {
          await this.prisma.pendenciaMarketplace.update({
            where: { id: atual.id },
            // Voltou depois de resolvida (comprador falou de novo): é novidade — e a
            // IA pode responder de novo (estado volta a pendente).
            data: atual.resolvidaEm
              ? { ...dados, resolvidaEm: null, avisadaEm: null, lembreteEm: null, estado: null }
              : dados,
          });
        }
      }
      const abertas = await this.prisma.pendenciaMarketplace.findMany({
        where: { empresaId, canal, resolvidaEm: null },
        select: { id: true, tipo: true, chave: true, estado: true },
      });
      const sumiram: string[] = [];
      for (const a of abertas) {
        if (chaves.has(`${a.tipo}|${a.chave}`)) continue;
        // A IA passou pra equipe (26/10): a mensagem de espera dela faz o chat
        // sair da lista do marketplace, mas o caso NÃO foi resolvido. Só fecha
        // quando alguém da equipe responde de verdade, ou no botão "Resolvido".
        if (a.estado === 'AGUARDANDO_HUMANO' && !(await this.equipeRespondeu(a.id))) continue;
        sumiram.push(a.id);
      }
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

  /**
   * Aba única (24/10): filtros de busca, canal, tipo, status e período, e a
   * contagem por status (com os MESMOS filtros, menos o de status). Abertas
   * saem por urgência (prazo mais curto primeiro); encerradas, as mais novas.
   */
  async listar(empresaId: string, f: FiltroPendencias = {}) {
    const base: Prisma.PendenciaMarketplaceWhereInput = { empresaId };
    const e: Prisma.PendenciaMarketplaceWhereInput[] = [];
    if (f.canal) base.canal = f.canal;
    if (f.tipo) base.tipo = f.tipo;
    const busca = f.busca?.trim().slice(0, 100);
    if (busca) {
      const c = { contains: busca, mode: 'insensitive' as const };
      e.push({
        OR: [
          { titulo: c },
          { detalhe: c },
          { comprador: c },
          { pedido: c },
          { anuncio: c },
          { chave: c },
        ],
      });
    }
    const de = f.de ? new Date(f.de) : null;
    const ate = f.ate ? new Date(f.ate) : null;
    if ((de && !isNaN(+de)) || (ate && !isNaN(+ate))) {
      const faixa = {
        ...(de && !isNaN(+de) ? { gte: de } : {}),
        ...(ate && !isNaN(+ate) ? { lte: ate } : {}),
      };
      e.push({ OR: [{ desde: faixa }, { desde: null, criadoEm: faixa }] });
    }
    if (e.length) base.AND = e;

    const status = f.status ?? 'ABERTAS';
    const porStatus: Record<StatusPendencia, Prisma.PendenciaMarketplaceWhereInput> = {
      ABERTAS: { resolvidaEm: null, NOT: { estado: 'RESPONDIDA_IA' } },
      PENDENTE: { resolvidaEm: null, estado: null },
      AGUARDANDO_HUMANO: { resolvidaEm: null, estado: 'AGUARDANDO_HUMANO' },
      RESPONDIDA_IA: { estado: 'RESPONDIDA_IA' },
      ENCERRADA: { resolvidaEm: { not: null }, NOT: { estado: 'RESPONDIDA_IA' } },
    };
    const [data, ...contas] = await Promise.all([
      this.prisma.pendenciaMarketplace.findMany({
        where: { ...base, ...porStatus[status] },
        orderBy:
          status === 'ENCERRADA' || status === 'RESPONDIDA_IA'
            ? [{ resolvidaEm: { sort: 'desc', nulls: 'first' } }, { atualizadoEm: 'desc' }]
            : [{ prazo: { sort: 'asc', nulls: 'last' } }, { desde: 'asc' }],
        take: 500,
      }),
      ...(['PENDENTE', 'AGUARDANDO_HUMANO', 'RESPONDIDA_IA', 'ENCERRADA'] as const).map((s) =>
        this.prisma.pendenciaMarketplace.count({ where: { ...base, ...porStatus[s] } }),
      ),
    ]);
    const [PENDENTE, AGUARDANDO_HUMANO, RESPONDIDA_IA, ENCERRADA] = contas;
    // Última coisa que a IA fez em cada uma (pra revisar na tela).
    const ia = data.length
      ? await this.prisma.pendenciaRespostaIa.findMany({
          where: { empresaId, pendenciaId: { in: data.map((p) => p.id) } },
          orderBy: { criadoEm: 'desc' },
          select: {
            pendenciaId: true,
            acao: true,
            resposta: true,
            motivo: true,
            enviada: true,
            erro: true,
            criadoEm: true,
          },
        })
      : [];
    const ultimaIa = new Map<string, (typeof ia)[number]>();
    for (const r of ia) if (!ultimaIa.has(r.pendenciaId)) ultimaIa.set(r.pendenciaId, r);
    // "Abrir no app" leva direto pra conversa (chat da Shopee, pós-venda do ML).
    const peers = data
      .map((p) => (p.chave.startsWith('inc:') ? `claim:${p.chave.slice(4)}` : p.chave))
      .filter((c) => /^(conv|pack|q|claim):/.test(c));
    const convs = peers.length
      ? await this.prisma.conversation.findMany({
          where: { empresaId, peerId: { in: peers } },
          select: { id: true, peerId: true },
        })
      : [];
    const convDe = new Map(convs.map((c) => [c.peerId, c.id]));
    return {
      data: data.map((p) => {
        const conv = convDe.get(p.chave.startsWith('inc:') ? `claim:${p.chave.slice(4)}` : p.chave);
        return {
          ...p,
          link: conv ? `/inbox?conv=${conv}` : p.link,
          status: statusDa(p),
          ia: ultimaIa.get(p.id) ?? null,
        };
      }),
      contagem: { PENDENTE, AGUARDANDO_HUMANO, RESPONDIDA_IA, ENCERRADA },
    };
  }

  /** Liga/desliga a IA (merge no Empresa.config — não mexe no resto). */
  async salvarConfigIa(empresaId: string, dto: { ativo: boolean; desligados: string[] }) {
    await this.prisma.$executeRaw`
      update "Empresa" set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('pendenciasIa', ${JSON.stringify(dto)}::jsonb)
      where id = ${empresaId}`;
    return dto;
  }

  contarAbertas(empresaId: string) {
    return this.prisma.pendenciaMarketplace.count({ where: { empresaId, resolvidaEm: null } });
  }
}
