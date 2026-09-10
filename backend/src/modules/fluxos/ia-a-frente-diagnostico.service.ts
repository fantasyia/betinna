import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  NotFoundException,
  BusinessRuleException,
  ForbiddenException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { iaAFrente, turnoDeIaAberto } from './turno-ia-aberto.util';

/**
 * Põe a conversa no estado que o `iaAFrente` existe pra cobrir, pergunta aos
 * dois sinais, e desfaz.
 *
 * ## Por que isto precisou existir
 *
 * Em 10/09 a flag `FLUXO_IA_A_FRENTE` foi ligada em produção com base numa
 * medição que **não media a flag**. Quatro rodadas por WhatsApp, e nenhuma
 * chegou perto do estado que ela endereça — o setup parkava a execução no nó de
 * IA (`AGUARDANDO`) antes de disparar a rajada, e aí o `turnoDeIaAberto`
 * sozinho já respondia "sim". O segundo sinal nunca foi consultado.
 *
 * ⚠️ **E não era descuido de quem testou: pelo WhatsApp não dá.** O Evolution
 * serializa o envio em 6-8 segundos e a janela da flag é de 1-2 — o intervalo
 * entre mensagens nunca cai dentro dela. Medição impossível pela porta da
 * frente vira medição inventada; esta rota é a porta de serviço.
 *
 * ## O que exatamente separa os dois sinais
 *
 * | | `turnoDeIaAberto` | `iaAFrente` |
 * |---|---|---|
 * | status | `PENDENTE·EM_EXECUCAO·AGUARDANDO` | **só `EM_EXECUCAO`** |
 * | o que procura | execução PARADA no nó de IA (ou com o lock do turno) | execução que ainda **ALCANÇA** um nó de IA |
 *
 * Então a execução sintética daqui nasce **`EM_EXECUCAO`, com
 * `aguardandoNoId` nulo e `processandoTurno` falso**: invisível pro primeiro
 * sinal, visível pro segundo. É o único estado em que a resposta dos dois
 * diverge — e portanto o único em que a flag muda alguma coisa.
 *
 * ## O que esta rota NÃO faz
 *
 * Não executa fluxo, não enfileira job, não manda mensagem, não toca no lead.
 * Ela cria UMA linha, faz duas perguntas de leitura e apaga a linha.
 *
 * ⚠️ O único efeito colateral real, e ele é honesto: durante os milissegundos
 * em que a linha existe, um gatilho proativo de VERDADE pra esse mesmo lead
 * seria adiado pelo guard. É exatamente o comportamento sob teste.
 */
@Injectable()
export class IaAFrenteDiagnosticoService {
  private readonly logger = new Logger(IaAFrenteDiagnosticoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  async medir(
    user: AuthenticatedUser,
    dto: { fluxoId: string; noId?: string; leadId?: string; conversationId?: string },
  ): Promise<ResultadoDiagnostico> {
    // Mesmo gate do resto do módulo: sem empresa ativa não há tenant a medir, e
    // os dois guards filtram por `empresaId`.
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const empresaId = user.empresaIdAtiva;
    if (!dto.leadId && !dto.conversationId) {
      throw new BusinessRuleException(
        'Informe leadId e/ou conversationId — os dois guards buscam por um deles, ' +
          'e sem alvo os dois respondem "não" e a medição não diz nada.',
      );
    }

    const fluxo = await this.prisma.fluxo.findFirst({
      where: { id: dto.fluxoId, empresaId },
      select: { id: true, nome: true },
    });
    if (!fluxo) throw new NotFoundException('Fluxo', dto.fluxoId);

    const posicao = await this.resolverPosicao(fluxo.id, dto.noId);
    const alvo = { conversationId: dto.conversationId, leadId: dto.leadId };
    const flagLigada = Boolean(this.env.get('FLUXO_IA_A_FRENTE'));

    const antes = await this.perguntar(empresaId, alvo);

    let execucaoId: string | null = null;
    let durante: Sinais;
    try {
      execucaoId = await this.criarExecucaoCaminhando(fluxo.id, empresaId, dto, posicao.noId);
      durante = await this.perguntar(empresaId, alvo);
    } finally {
      if (execucaoId) {
        // O `delete` leva os logs junto (cascade no schema). Best-effort com
        // grito: linha sintética esquecida no banco vira execução fantasma
        // barrando proativo de verdade — e ninguém saberia de onde veio.
        await this.prisma.fluxoExecucao.delete({ where: { id: execucaoId } }).catch((err) => {
          this.logger.error(
            `DIAGNÓSTICO iaAFrente: NÃO consegui apagar a execução sintética ` +
              `${execucaoId} — apague à mão: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    }

    return {
      fluxo: { id: fluxo.id, nome: fluxo.nome },
      posicao,
      flagLigada,
      antes,
      durante,
      veredito: this.veredito(antes, durante, posicao, flagLigada),
    };
  }

  /**
   * A posição da execução é o `noId` do último log dela — ou, sem log nenhum, o
   * TRIGGER do fluxo. Aqui a posição é escolhida, então o log é escrito de
   * propósito.
   *
   * ⚠️ E a posição só serve se dela ainda der pra ALCANÇAR um nó de IA — é isso
   * que o `iaAFrente` pergunta. Posição depois do nó de IA responde "não", e com
   * razão: aquela execução não vai mais falar. Por isso a checagem entra no
   * resultado em vez de ficar implícita: teste montado num ponto sem alcance
   * mede "não" e parece que a flag não funciona.
   */
  private async resolverPosicao(fluxoId: string, noId?: string): Promise<Posicao> {
    const no = noId
      ? await this.prisma.fluxoNo.findFirst({
          where: { id: noId, fluxoId },
          select: { id: true, titulo: true },
        })
      : await this.prisma.fluxoNo.findFirst({
          where: { fluxoId, tipo: 'TRIGGER' },
          select: { id: true, titulo: true },
        });
    if (!no) {
      throw new NotFoundException('Nó do fluxo', noId ?? `${fluxoId} (TRIGGER)`);
    }
    return {
      noId: no.id,
      noTitulo: no.titulo ?? '(sem título)',
      alcancaNoDeIa: await this.alcancaNoDeIa(fluxoId, no.id),
    };
  }

  /** Mesma travessia do `iaAFrente`, isolada pra poder ser reportada. */
  private async alcancaNoDeIa(fluxoId: string, noId: string): Promise<boolean> {
    const achados = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE alcance AS (
        SELECT ${noId}::text AS "noId", 0 AS nivel
        UNION ALL
        SELECT ed."targetNoId", a.nivel + 1
        FROM alcance a
        JOIN "FluxoEdge" ed ON ed."sourceNoId" = a."noId" AND ed."fluxoId" = ${fluxoId}
        WHERE a.nivel < 40
      )
      SELECT DISTINCT n.id
      FROM alcance a
      JOIN "FluxoNo" n ON n.id = a."noId"
      WHERE n."acaoTipo" = 'CONVERSAR_IA'
      LIMIT 1`;
    return achados.length > 0;
  }

  /**
   * A execução sintética. Cada campo aqui é uma decisão:
   *
   * - `status: EM_EXECUCAO` — é o único status que o `iaAFrente` olha;
   * - `aguardandoNoId: null` e `processandoTurno: false` — o que a torna
   *   INVISÍVEL pro `turnoDeIaAberto`. Sem isso os dois sinais responderiam
   *   "sim" e a medição não distinguiria um do outro (foi o que aconteceu no
   *   teste por WhatsApp);
   * - `iniciouEm: agora` — o `iaAFrente` tem janela de 30s (`JANELA_A_FRENTE_MS`);
   * - `teste: true` — pra não sujar a taxa de sucesso do fluxo;
   * - `_diagnostico` no contexto — pra quem topar com a linha num log saber
   *   o que ela é.
   */
  private async criarExecucaoCaminhando(
    fluxoId: string,
    empresaId: string,
    dto: { leadId?: string; conversationId?: string },
    noId: string,
  ): Promise<string> {
    const execucao = await this.prisma.fluxoExecucao.create({
      data: {
        fluxoId,
        empresaId,
        status: 'EM_EXECUCAO',
        teste: true,
        iniciouEm: new Date(),
        contexto: {
          ...(dto.leadId ? { leadId: dto.leadId } : {}),
          ...(dto.conversationId ? { conversationId: dto.conversationId } : {}),
          _diagnostico: 'ia-a-frente',
        },
        logs: {
          create: {
            noId,
            noTitulo: '(diagnóstico) posição forçada',
            status: 'CONCLUIDO',
            terminadoEm: new Date(),
          },
        },
      },
      select: { id: true },
    });
    return execucao.id;
  }

  private async perguntar(
    empresaId: string,
    alvo: { conversationId?: string; leadId?: string },
  ): Promise<Sinais> {
    // Os dois SEMPRE são consultados aqui, independente da flag. É o que
    // responde "o que a flag faria?" sem precisar mexer na variável de
    // produção — que era o custo que travava esta medição.
    const [aberto, aFrente] = await Promise.all([
      turnoDeIaAberto(this.prisma, empresaId, alvo),
      iaAFrente(this.prisma, empresaId, alvo),
    ]);
    return {
      turnoDeIaAberto: aberto,
      iaAFrente: aFrente,
      guardSemFlag: aberto,
      guardComFlag: aberto || aFrente,
    };
  }

  private veredito(antes: Sinais, durante: Sinais, posicao: Posicao, flagLigada: boolean): string {
    if (!posicao.alcancaNoDeIa) {
      return (
        `INCONCLUSIVO: de "${posicao.noTitulo}" não se alcança nenhum nó CONVERSAR_IA, ` +
        'então o iaAFrente responde "não" por construção. Escolha um nó ANTES do nó de IA.'
      );
    }
    if (antes.guardComFlag) {
      return (
        'INCONCLUSIVO: já havia turno de IA aberto nesta conversa ANTES da execução ' +
        'sintética, então os dois sinais respondem "sim" de qualquer jeito. Meça com ' +
        'a conversa parada — é a diferença entre os dois que interessa.'
      );
    }
    if (durante.guardComFlag && !durante.guardSemFlag) {
      return (
        `A FLAG FAZ DIFERENÇA NESTE ESTADO: com ela o gatilho proativo seria barrado; ` +
        `sem ela passaria e falaria por cima. Flag está ${flagLigada ? 'LIGADA' : 'DESLIGADA'}.`
      );
    }
    if (!durante.guardComFlag) {
      return (
        'A FLAG NÃO PEGOU: mesmo com a execução caminhando e alcançando o nó de IA, ' +
        'o iaAFrente respondeu "não". Isto é achado — vale investigar a janela de 30s ' +
        '(JANELA_A_FRENTE_MS) e o alvo (leadId/conversationId batem com o contexto?).'
      );
    }
    return 'Os dois sinais respondem igual: a flag não muda nada neste estado.';
  }
}

interface Sinais {
  turnoDeIaAberto: boolean;
  iaAFrente: boolean;
  /** O que o guard responderia com a flag DESLIGADA. */
  guardSemFlag: boolean;
  /** O que o guard responderia com a flag LIGADA. */
  guardComFlag: boolean;
}

interface Posicao {
  noId: string;
  noTitulo: string;
  alcancaNoDeIa: boolean;
}

export interface ResultadoDiagnostico {
  fluxo: { id: string; nome: string };
  posicao: Posicao;
  flagLigada: boolean;
  /** Antes de criar a execução sintética — a linha de base da conversa. */
  antes: Sinais;
  /** Com a execução caminhando rumo ao nó de IA. */
  durante: Sinais;
  veredito: string;
}
