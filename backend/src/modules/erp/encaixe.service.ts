import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type EncaixeStatus } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { EstoqueService } from './estoque.service';
import type { RegrasEncaixeDto } from './fichas.dto';
import {
  LARGURA_PLOTTER_MM,
  type CriarEncaixeDto,
  type FalhaEncaixeDto,
  type ProgressoEncaixeDto,
  type ResultadoEncaixeDto,
  type TipoArquivoEncaixe,
} from './encaixe.dto';

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/** Agente que pegou e sumiu (PC desligado, travou): depois disto o trabalho é dado como falho. */
export const FOLGA_AGENTE_MIN = 15;
/** Sem notícia do agente (progresso) por este tempo também conta como sumido. */
const SILENCIO_MAX_MIN = 10;

const ABERTOS: EncaixeStatus[] = ['PENDENTE', 'RODANDO'];

/** O trabalho rodando sumiu? (passou do tempo + folga, ou ficou mudo demais). PURO. */
export function agenteSumiu(
  job: { tempoMin: number; pegoEm: Date | null; atualizadoEm: Date },
  agora: Date,
): boolean {
  if (!job.pegoEm) return false;
  const limite = job.pegoEm.getTime() + (job.tempoMin + FOLGA_AGENTE_MIN) * 60_000;
  const mudo = agora.getTime() - job.atualizadoEm.getTime() > SILENCIO_MAX_MIN * 60_000;
  return agora.getTime() > limite || mudo;
}

/**
 * Encaixe automático (risco) da OP.
 *
 * O Betinna MONTA o pedido (código do molde, quantas peças de cada tamanho
 * vão no risco, regras da ficha, papel do plotter) e guarda o resultado. Quem
 * ENCAIXA é o agente local na GPU do Léo, que entra por token de escopo
 * `encaixe`: pega UM trabalho por vez (1 job por vez — 2 processos travaram o
 * PC), manda a imagem a cada melhora e, no fim, o .plt pro plotter.
 */
@Injectable()
export class EncaixeService {
  private readonly logger = new Logger(EncaixeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: EstoqueService,
  ) {}

  // ─── Lado da OP (tela) ───────────────────────────────────────────────────

  async criar(user: AuthenticatedUser, opId: string, dto: CriarEncaixeDto) {
    const empresaId = await this.erp.empresaLigada(user);
    const op = await this.prisma.ordemProducao.findFirst({
      where: { id: opId, empresaId },
      select: {
        id: true,
        numero: true,
        status: true,
        modelo: { select: { id: true, nome: true, regrasEncaixe: true } },
      },
    });
    if (!op) throw new NotFoundException('Ordem de produção', opId);
    if (op.status === 'CANCELADA') throw regra('OP cancelada não gera risco');

    const regras = op.modelo.regrasEncaixe as (RegrasEncaixeDto & { codigoMolde?: string }) | null;
    if (!regras) {
      throw regra(
        'Preencha as regras de encaixe na ficha técnica do modelo antes de gerar o risco',
      );
    }
    if (!regras.codigoMolde?.trim()) {
      throw regra(
        'Falta o código do molde (a pasta do Lectra, ex.: 100) nas regras de encaixe da ficha técnica',
      );
    }
    if (regras.larguraUtilMm > LARGURA_PLOTTER_MM) {
      throw regra(
        `A largura útil do tecido (${regras.larguraUtilMm} mm) passa do papel do plotter (${LARGURA_PLOTTER_MM} mm)`,
      );
    }

    const ml = await this.prisma.catalogoModeloLinha.findFirst({
      where: { id: dto.modeloLinhaId, modeloId: op.modelo.id },
      select: {
        id: true,
        linha: { select: { nome: true } },
        tamanhos: { select: { tamanho: { select: { nome: true, ordem: true } } } },
      },
    });
    if (!ml) throw regra('Esta grade não é do modelo da OP');
    const daGrade = new Set(ml.tamanhos.map((t) => t.tamanho.nome));
    const fora = dto.composicao.filter((c) => !daGrade.has(c.tamanho));
    if (fora.length) {
      throw regra(
        `Tamanho fora da grade ${ml.linha.nome}: ${fora.map((f) => f.tamanho).join(', ')}`,
      );
    }

    const aberto = await this.prisma.encaixeJob.findFirst({
      where: { opId, status: { in: ABERTOS } },
      select: { id: true },
    });
    if (aberto) throw regra('Esta OP já tem um risco na fila — espere terminar ou cancele');

    // Ordem da grade (P, M, G… / 2, 4, 6…), não a de quem clicou.
    const ordem = new Map(ml.tamanhos.map((t) => [t.tamanho.nome, t.tamanho.ordem]));
    const composicao = [...dto.composicao].sort(
      (a, b) => (ordem.get(a.tamanho) ?? 0) - (ordem.get(b.tamanho) ?? 0),
    );
    const { observacoes: _obs, ...regrasDoAgente } = regras;
    const entrada = {
      versao: 1,
      op: { id: op.id, numero: op.numero },
      modelo: { id: op.modelo.id, nome: op.modelo.nome, codigoMolde: regras.codigoMolde.trim() },
      linha: { modeloLinhaId: ml.id, nome: ml.linha.nome },
      composicao,
      regras: regrasDoAgente,
      // Plotter da Ribelt (07/10): TEXWARE V4.1, jato de tinta, HPGL em texto,
      // escala 1:1, papel útil de 185 cm. 40 un./mm é o HPGL padrão — o agente
      // confere contra um .plt real antes de mandar pro plotter.
      plotter: {
        formato: 'HPGL',
        escala: 1,
        larguraPapelMm: LARGURA_PLOTTER_MM,
        unidadesPorMm: 40,
      },
      tempoMin: dto.tempoMin,
    };
    const job = await this.prisma.encaixeJob.create({
      data: {
        empresaId,
        opId,
        modeloLinhaId: ml.id,
        tempoMin: dto.tempoMin,
        entrada: entrada as unknown as Prisma.InputJsonValue,
        usuarioId: user.id,
      },
      select: { id: true },
    });
    this.logger.log(
      `[encaixe] ${op.numero}: risco ${ml.linha.nome} (${composicao.map((c) => `${c.quantidade}×${c.tamanho}`).join(' ')}) na fila`,
    );
    return this.paraTela(empresaId, job.id);
  }

  async listarDaOp(user: AuthenticatedUser, opId: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const jobs = await this.prisma.encaixeJob.findMany({
      where: { opId, empresaId },
      orderBy: { criadoEm: 'desc' },
      take: 20,
      select: { id: true },
    });
    return Promise.all(jobs.map((j) => this.paraTela(empresaId, j.id)));
  }

  async cancelar(user: AuthenticatedUser, id: string) {
    const empresaId = await this.erp.empresaLigada(user);
    const r = await this.prisma.encaixeJob.updateMany({
      where: { id, empresaId, status: { in: ABERTOS } },
      data: { status: 'CANCELADO', concluidoEm: new Date() },
    });
    if (r.count === 0) throw regra('Este risco já terminou');
    return this.paraTela(empresaId, id);
  }

  /** Arquivo pra baixar/mostrar (PNG, PLT, PREVIEW, DXF). */
  async arquivo(user: AuthenticatedUser, id: string, tipo: TipoArquivoEncaixe) {
    const empresaId = await this.erp.empresaLigada(user);
    const a = await this.prisma.encaixeArquivo.findFirst({
      where: { tipo, job: { id, empresaId } },
      select: {
        mime: true,
        conteudo: true,
        job: { select: { entrada: true } },
      },
    });
    if (!a) throw new NotFoundException('Arquivo do encaixe', `${id}/${tipo}`);
    const e = a.job.entrada as { op?: { numero?: string }; linha?: { nome?: string } };
    const ext = tipo === 'PLT' ? 'plt' : tipo === 'DXF' ? 'dxf' : 'png';
    const nome = `${e.op?.numero ?? 'OP'}-${(e.linha?.nome ?? 'risco').replace(/\s+/g, '')}.${ext}`;
    return { mime: a.mime, conteudo: Buffer.from(a.conteudo), nome };
  }

  private async paraTela(empresaId: string, id: string) {
    const j = await this.prisma.encaixeJob.findFirst({
      where: { id, empresaId },
      select: {
        id: true,
        status: true,
        tempoMin: true,
        entrada: true,
        progresso: true,
        resultado: true,
        erro: true,
        agente: true,
        pegoEm: true,
        concluidoEm: true,
        criadoEm: true,
        atualizadoEm: true,
        arquivos: { select: { tipo: true, tamanho: true, criadoEm: true } },
      },
    });
    if (!j) throw new NotFoundException('Encaixe', id);
    const { entrada, ...resto } = j;
    const e = entrada as {
      linha?: { nome?: string };
      composicao?: Array<{ tamanho: string; quantidade: number }>;
      modelo?: { codigoMolde?: string };
    };
    return {
      ...resto,
      linha: e.linha?.nome ?? null,
      composicao: e.composicao ?? [],
      codigoMolde: e.modelo?.codigoMolde ?? null,
      // Só o que existe — a tela mostra o botão de baixar quando tem.
      arquivos: j.arquivos.map((a) => ({ tipo: a.tipo, tamanho: a.tamanho, em: a.criadoEm })),
    };
  }

  // ─── Lado do agente (token de escopo `encaixe`) ──────────────────────────

  private empresaDoAgente(user: AuthenticatedUser): string {
    const empresaId = user.empresaIdAtiva;
    if (!empresaId) throw regra('Token sem empresa');
    return empresaId;
  }

  /**
   * O agente pede trabalho. UM por vez na empresa: com outro RODANDO, nada
   * (a GPU só aguenta um). Trabalho cujo agente sumiu vira FALHOU antes.
   * Pega o mais antigo PENDENTE por CAS — dois agentes não pegam o mesmo.
   */
  async proximo(user: AuthenticatedUser, agente: string) {
    const empresaId = this.empresaDoAgente(user);
    const agora = new Date();
    const rodando = await this.prisma.encaixeJob.findMany({
      where: { empresaId, status: 'RODANDO' },
      select: { id: true, tempoMin: true, pegoEm: true, atualizadoEm: true },
    });
    for (const r of rodando) {
      if (agenteSumiu(r, agora)) {
        await this.prisma.encaixeJob.updateMany({
          where: { id: r.id, status: 'RODANDO' },
          data: {
            status: 'FALHOU',
            erro: 'O agente parou de responder (PC desligado ou travado?) — gere o risco de novo',
            concluidoEm: agora,
          },
        });
      }
    }
    const ocupado = await this.prisma.encaixeJob.count({ where: { empresaId, status: 'RODANDO' } });
    if (ocupado > 0) return { trabalho: null, motivo: 'Já tem um encaixe rodando' };

    const fila = await this.prisma.encaixeJob.findMany({
      where: { empresaId, status: 'PENDENTE' },
      orderBy: { criadoEm: 'asc' },
      take: 5,
      select: { id: true },
    });
    for (const f of fila) {
      const r = await this.prisma.encaixeJob.updateMany({
        where: { id: f.id, status: 'PENDENTE' },
        data: { status: 'RODANDO', agente: agente.slice(0, 100), pegoEm: agora },
      });
      if (r.count === 1) {
        const j = await this.prisma.encaixeJob.findUniqueOrThrow({
          where: { id: f.id },
          select: { id: true, tempoMin: true, entrada: true },
        });
        this.logger.log(`[encaixe] ${f.id} pego por "${agente}"`);
        return { trabalho: j, motivo: null };
      }
    }
    return { trabalho: null, motivo: null };
  }

  /** Situação do trabalho — o agente consulta pra saber se foi cancelado. */
  async situacao(user: AuthenticatedUser, id: string) {
    const empresaId = this.empresaDoAgente(user);
    const j = await this.prisma.encaixeJob.findFirst({
      where: { id, empresaId },
      select: { id: true, status: true },
    });
    if (!j) throw new NotFoundException('Encaixe', id);
    return j;
  }

  private async rodandoDoAgente(empresaId: string, id: string) {
    const j = await this.prisma.encaixeJob.findFirst({
      where: { id, empresaId },
      select: { id: true, status: true, progresso: true },
    });
    if (!j) throw new NotFoundException('Encaixe', id);
    return j;
  }

  private async guardarArquivo(
    jobId: string,
    tipo: TipoArquivoEncaixe,
    mime: string,
    dado: Buffer,
  ) {
    await this.prisma.encaixeArquivo.upsert({
      where: { jobId_tipo: { jobId, tipo } },
      create: { jobId, tipo, mime, tamanho: dado.length, conteudo: Uint8Array.from(dado) },
      update: { mime, tamanho: dado.length, conteudo: Uint8Array.from(dado), criadoEm: new Date() },
    });
  }

  /** Melhorou: números e a imagem do melhor até agora. Devolve o status (cancelado = pare). */
  async progresso(user: AuthenticatedUser, id: string, dto: ProgressoEncaixeDto) {
    const empresaId = this.empresaDoAgente(user);
    const j = await this.rodandoDoAgente(empresaId, id);
    if (j.status !== 'RODANDO') return { status: j.status };
    const anterior = (j.progresso ?? {}) as Record<string, unknown>;
    await this.prisma.encaixeJob.updateMany({
      where: { id, status: 'RODANDO' },
      data: {
        progresso: {
          ...anterior,
          ...(dto.comprimentoM != null ? { comprimentoM: dto.comprimentoM } : {}),
          ...(dto.aproveitamento != null ? { aproveitamento: dto.aproveitamento } : {}),
          ...(dto.iteracoes != null ? { iteracoes: dto.iteracoes } : {}),
          em: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    if (dto.imagemPng) {
      await this.guardarArquivo(id, 'PREVIEW', 'image/png', Buffer.from(dto.imagemPng, 'base64'));
    }
    return { status: 'RODANDO' as const };
  }

  /** Entregou: .plt (HPGL), imagem e números. Cancelado no meio do caminho não vira concluído. */
  async concluir(user: AuthenticatedUser, id: string, dto: ResultadoEncaixeDto) {
    const empresaId = this.empresaDoAgente(user);
    const j = await this.rodandoDoAgente(empresaId, id);
    if (j.status !== 'RODANDO') {
      throw regra(`Este encaixe está ${j.status} — o resultado não foi guardado`);
    }
    // HPGL em texto: comandos de 2 letras separados por ";". Um .plt binário
    // ou um arquivo errado não chega no plotter da Ribelt.
    const inicio = dto.plt.trimStart().slice(0, 200).toUpperCase();
    if (!/^(NE|IN|BP|PS|DF|ESC|\x1B)/.test(inicio) || !inicio.includes(';')) {
      throw regra('O .plt não parece HPGL em texto (esperava começar com IN;/NE…)');
    }
    await this.guardarArquivo(id, 'PLT', 'application/vnd.hp-hpgl', Buffer.from(dto.plt, 'utf8'));
    if (dto.imagemPng) {
      await this.guardarArquivo(id, 'PNG', 'image/png', Buffer.from(dto.imagemPng, 'base64'));
    }
    if (dto.dxf) {
      await this.guardarArquivo(id, 'DXF', 'application/dxf', Buffer.from(dto.dxf, 'utf8'));
    }
    const r = await this.prisma.encaixeJob.updateMany({
      where: { id, status: 'RODANDO' },
      data: {
        status: 'CONCLUIDO',
        concluidoEm: new Date(),
        resultado: {
          comprimentoM: dto.comprimentoM,
          aproveitamento: dto.aproveitamento,
          ...(dto.detalhes ? { detalhes: dto.detalhes } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    if (r.count === 0) throw regra('Este encaixe foi cancelado enquanto entregava');
    this.logger.log(
      `[encaixe] ${id} concluído: ${dto.comprimentoM.toFixed(3)} m, ${dto.aproveitamento.toFixed(1)}%`,
    );
    return { status: 'CONCLUIDO' as const };
  }

  async falhar(user: AuthenticatedUser, id: string, dto: FalhaEncaixeDto) {
    const empresaId = this.empresaDoAgente(user);
    await this.rodandoDoAgente(empresaId, id);
    await this.prisma.encaixeJob.updateMany({
      where: { id, status: 'RODANDO' },
      data: { status: 'FALHOU', erro: dto.erro, concluidoEm: new Date() },
    });
    return { status: 'FALHOU' as const };
  }
}
