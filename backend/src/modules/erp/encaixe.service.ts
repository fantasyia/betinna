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
  type MaterialEncaixe,
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

/**
 * Nome das grades do risco: "Regular", ou "Infantil + Regular + Plus Size" no
 * mesclado (a linha de cada item, na ordem em que aparecem). PURO.
 */
export function rotuloLinhas(entrada: unknown): string {
  const e = entrada as {
    linha?: { nome?: string };
    composicao?: Array<{ linha?: string }>;
  } | null;
  const dosItens = [...new Set((e?.composicao ?? []).map((c) => c.linha).filter(Boolean))];
  return dosItens.length ? dosItens.join(' + ') : (e?.linha?.nome ?? '');
}

/** Material do trabalho (entrada sem `material` = tecido, como os de antes de 14/10). PURO. */
export function materialDe(entrada: unknown): MaterialEncaixe {
  return (entrada as { material?: unknown } | null)?.material === 'RIBANA' ? 'RIBANA' : 'TECIDO';
}

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
    // Ribana (14/10): risco próprio, com o tecido e a largura DELA.
    const material: MaterialEncaixe = dto.material ?? 'TECIDO';
    const rib = regras.ribana ?? null;
    if (material === 'RIBANA' && !rib) {
      throw regra(
        'Este produto não tem ribana nas regras de encaixe da ficha técnica — preencha o bloco "Ribana"',
      );
    }
    const largura = material === 'RIBANA' ? rib!.larguraUtilMm : regras.larguraUtilMm;
    if (largura > LARGURA_PLOTTER_MM) {
      throw regra(
        `A largura útil ${material === 'RIBANA' ? 'da ribana' : 'do tecido'} (${largura} mm) passa do papel do plotter (${LARGURA_PLOTTER_MM} mm)`,
      );
    }

    // Grades do risco: a do pedido + as que vierem nos itens (risco mesclado).
    const linhaDe = (c: { modeloLinhaId?: string }) => c.modeloLinhaId ?? dto.modeloLinhaId;
    const idsLinha = [...new Set([dto.modeloLinhaId, ...dto.composicao.map(linhaDe)])];
    const mls = await this.prisma.catalogoModeloLinha.findMany({
      where: { id: { in: idsLinha }, modeloId: op.modelo.id },
      select: {
        id: true,
        linha: { select: { nome: true, ordem: true } },
        tamanhos: { select: { tamanho: { select: { nome: true, ordem: true } } } },
      },
    });
    if (mls.length !== idsLinha.length) throw regra('Esta grade não é do modelo da OP');
    const porId = new Map(mls.map((m) => [m.id, m]));
    const ml = porId.get(dto.modeloLinhaId)!;
    const vistos = new Set<string>();
    for (const c of dto.composicao) {
      const g = porId.get(linhaDe(c))!;
      if (!g.tamanhos.some((t) => t.tamanho.nome === c.tamanho)) {
        throw regra(`Tamanho fora da grade ${g.linha.nome}: ${c.tamanho}`);
      }
      const chave = `${g.id}|${c.tamanho}`;
      if (vistos.has(chave)) throw regra(`Tamanho repetido na grade ${g.linha.nome}: ${c.tamanho}`);
      vistos.add(chave);
    }
    const mesclado = idsLinha.length > 1;

    // Um aberto por OP E por material: tecido e ribana podem estar na fila juntos
    // (no PC do Léo rodam um depois do outro — o agente faz um por vez).
    const abertos = await this.prisma.encaixeJob.findMany({
      where: { opId, status: { in: ABERTOS } },
      select: { entrada: true },
    });
    if (abertos.some((j) => materialDe(j.entrada) === material)) {
      throw regra(
        `Esta OP já tem um risco ${material === 'RIBANA' ? 'da ribana ' : ''}na fila — espere terminar ou cancele`,
      );
    }

    // Ordem da grade (Infantil, Regular, Plus… e P, M, G… / 2, 4, 6…), não a de quem clicou.
    const ordemDe = (c: { modeloLinhaId?: string; tamanho: string }) => {
      const g = porId.get(linhaDe(c))!;
      const t = g.tamanhos.find((x) => x.tamanho.nome === c.tamanho)!;
      return g.linha.ordem * 10_000 + t.tamanho.ordem;
    };
    // Mesclado: cada item leva a linha (o agente acha a pasta do molde por ela).
    // De uma grade só: como sempre, sem linha no item.
    const composicao = [...dto.composicao]
      .sort((a, b) => ordemDe(a) - ordemDe(b))
      .map((c) =>
        mesclado
          ? {
              linha: porId.get(linhaDe(c))!.linha.nome,
              tamanho: c.tamanho,
              quantidade: c.quantidade,
            }
          : { tamanho: c.tamanho, quantidade: c.quantidade },
      );
    const { observacoes: _obs, ribana: _rib, ...base } = regras;
    // O agente recebe UM conjunto de regras: na ribana, o tecido e a largura dela.
    const regrasDoAgente =
      material === 'RIBANA'
        ? { ...base, tecido: rib!.tecido, larguraUtilMm: rib!.larguraUtilMm }
        : base;
    const entrada = {
      versao: 1,
      // TECIDO = as peças do tecido principal; RIBANA = só gola/punho/barra (.002).
      material,
      op: { id: op.id, numero: op.numero },
      modelo: { id: op.modelo.id, nome: op.modelo.nome, codigoMolde: regras.codigoMolde.trim() },
      linha: { modeloLinhaId: ml.id, nome: ml.linha.nome },
      mesclado,
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
      `[encaixe] ${op.numero}: risco ${material === 'RIBANA' ? 'da RIBANA ' : ''}${rotuloLinhas(entrada)} (${composicao.map((c) => `${c.quantidade}×${c.tamanho}`).join(' ')}) na fila`,
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
    const sufixo = materialDe(a.job.entrada) === 'RIBANA' ? '-ribana' : '';
    const nome = `${e.op?.numero ?? 'OP'}-${(e.linha?.nome ?? 'risco').replace(/\s+/g, '')}${sufixo}.${ext}`;
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
      composicao?: Array<{ linha?: string; tamanho: string; quantidade: number }>;
      modelo?: { codigoMolde?: string };
    };
    return {
      ...resto,
      material: materialDe(entrada),
      linha: rotuloLinhas(entrada) || null,
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
