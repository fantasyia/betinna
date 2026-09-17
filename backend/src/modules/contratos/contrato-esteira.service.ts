import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { posicaoNoFim } from '@modules/kanban/kanban-posicao.util';

/**
 * ESTEIRA PÓS-ASSINATURA — o que o Leandro toca depois que o cliente assina.
 *
 * Desenho do Léo (card de 17/09): contrato assinado abre uma tarefa com os dados
 * do contrato/cliente, e **cada etapa é uma coluna** pra ele acompanhar
 * visualmente em que pé está cada contrato. Ele arrasta conforme anda.
 *
 * 📌 Quadro PRÓPRIO, e não o quadro pessoal dele, por três motivos concretos:
 *
 * 1. o quadro pessoal nasce com `📋 A fazer · 🔨 Fazendo · ✅ Feito` e o espelho
 *    Diretor↔rep casa as colunas **por NOME** — colunas novas ali mexeriam num
 *    mecanismo que não tem nada a ver com contrato;
 * 2. esteira e lista de afazeres são coisas diferentes: misturar faz o contrato
 *    sumir no meio das tarefas do dia;
 * 3. o Leandro **não tem** quadro pessoal hoje (conferido em 17/09) — não há o
 *    que reaproveitar.
 *
 * ⛔ Só entra aqui contrato ASSINADO. Antes disso não há o que produzir, e a
 * esteira existe pra ser a fila de produção, não o funil de venda.
 */
@Injectable()
export class ContratoEsteiraService {
  private readonly logger = new Logger(ContratoEsteiraService.name);

  /**
   * As etapas, na ordem do card. Mudar a ORDEM aqui não remexe quadro que já
   * existe (as colunas ausentes são criadas no fim); mudar um NOME cria coluna
   * nova em vez de renomear a antiga — renomeação é na tela, à mão.
   */
  static readonly ETAPAS = [
    '🔎 Consulta Serasa',
    '🔨 Ordem de produção',
    '🧾 NF de comodato',
    '📦 Envio',
    '🔧 Instalação',
    '✅ Concluído',
  ] as const;

  private static readonly TIPO = 'contratos_esteira';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Põe o contrato assinado na primeira etapa.
   *
   * ⚠️ BEST-EFFORT por construção: quem chama é o handler de assinatura, e lá o
   * contrato JÁ está assinado e o PDF guardado. Falhar em criar um card não pode
   * desfazer isso nem derrubar o webhook — a ClickSign reentregaria e o efeito
   * colateral seria pior que a ausência do card.
   *
   * Idempotente pelo `origemJobId` = id do contrato: a ClickSign reentrega, e
   * reentrega é o comportamento certo dela. Sem isto, o mesmo contrato viraria
   * dois cards e o Leandro trabalharia duas vezes.
   */
  async entrarNaEsteira(contratoId: string): Promise<'criado' | 'repetido' | 'pulado'> {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: {
        id: true,
        empresaId: true,
        valorMensal: true,
        prazoMeses: true,
        assinadoEm: true,
        cliente: { select: { nome: true, cnpj: true, cidade: true, uf: true } },
        proposta: { select: { numero: true } },
        representante: { select: { nome: true } },
      },
    });
    if (!contrato) return 'pulado';

    const jaExiste = await this.prisma.kanbanCard.findFirst({
      where: { origemJobId: this.chave(contrato.id) },
      select: { id: true },
    });
    if (jaExiste) return 'repetido';

    const quadro = await this.garantirQuadro(contrato.empresaId);
    if (!quadro) return 'pulado';
    const primeira = quadro.listas.get(ContratoEsteiraService.ETAPAS[0]);
    if (!primeira) return 'pulado';

    const ultimo = await this.prisma.kanbanCard.findFirst({
      where: { listaId: primeira },
      orderBy: { posicao: 'desc' },
      select: { posicao: true },
    });

    await this.prisma.kanbanCard.create({
      data: {
        listaId: primeira,
        titulo: `${contrato.cliente.nome} — contrato ${contrato.proposta.numero}`,
        descricao: this.descricao(contrato),
        posicao: posicaoNoFim(ultimo?.posicao),
        origemJobId: this.chave(contrato.id),
      },
      select: { id: true },
    });

    this.logger.log(
      `Contrato da proposta ${contrato.proposta.numero} entrou na esteira pós-assinatura ` +
        `(${contrato.cliente.nome})`,
    );
    return 'criado';
  }

  /** Chave de idempotência — um card por contrato, pra sempre. */
  private chave(contratoId: string): string {
    return `contrato-esteira:${contratoId}`;
  }

  /**
   * O texto do card. Carrega o que o Leandro precisa pra AGIR sem abrir o app:
   * quem é o cliente, qual o CNPJ (a consulta Serasa é a primeira etapa), o que
   * foi contratado e quem vendeu.
   */
  private descricao(c: {
    valorMensal: unknown;
    prazoMeses: number;
    assinadoEm: Date | null;
    cliente: { nome: string; cnpj: string | null; cidade: string | null; uf: string | null };
    proposta: { numero: string };
    representante: { nome: string } | null;
  }): string {
    const local = [c.cliente.cidade, c.cliente.uf].filter(Boolean).join('/');
    return [
      `**Cliente:** ${c.cliente.nome}`,
      `**CNPJ:** ${c.cliente.cnpj ?? '— (não cadastrado)'}`,
      local ? `**Local:** ${local}` : null,
      `**Proposta:** ${c.proposta.numero}`,
      `**Locação:** R$ ${String(c.valorMensal)}/mês por ${c.prazoMeses} meses`,
      `**Representante:** ${c.representante?.nome ?? '—'}`,
      c.assinadoEm ? `**Assinado em:** ${c.assinadoEm.toLocaleDateString('pt-BR')}` : null,
      '',
      'Arraste o card conforme a etapa avança. O contrato assinado está no app, na proposta.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Um quadro de esteira por EMPRESA. Reaproveita o que já existe (marcado por
   * `tipoSistema`), e garante as colunas — mesmo padrão dos quadros de rep e do
   * Diretor, pra quem mexer num entender os outros.
   */
  private async garantirQuadro(
    empresaId: string,
  ): Promise<{ boardId: string; listas: Map<string, string> } | null> {
    const existente = await this.prisma.kanbanBoard.findFirst({
      where: { empresaId, tipoSistema: ContratoEsteiraService.TIPO, arquivado: false },
      select: { id: true },
    });
    if (existente) {
      return { boardId: existente.id, listas: await this.garantirColunas(existente.id) };
    }

    // Dono = o DIRETOR, que é quem opera a esteira. ADMIN é o fallback (empresa
    // sem diretor cadastrado ainda). Mesmo contrato do `garantirQuadroDiretor`:
    // ordem explícita, porque `findFirst` sem `orderBy` é a ordem física do heap
    // — "primeiro" por acidente, não por regra.
    const dono = await this.prisma.usuario.findFirst({
      where: {
        empresas: { some: { empresaId } },
        role: { in: ['DIRECTOR', 'ADMIN'] },
        status: 'ATIVO',
      },
      select: { id: true },
      orderBy: [{ role: 'desc' }, { criadoEm: 'asc' }],
    });
    if (!dono) {
      this.logger.warn(
        `Empresa ${empresaId} sem DIRECTOR/ADMIN ativo — esteira de contratos não criada`,
      );
      return null;
    }

    const board = await this.prisma.kanbanBoard.create({
      data: {
        nome: 'Contratos — pós-assinatura',
        descricao:
          'Esteira do que acontece DEPOIS que o cliente assina: Serasa, produção, NF de ' +
          'comodato, envio e instalação. Um card por contrato; arraste conforme a etapa avança.',
        empresaId,
        criadoPorId: dono.id,
        tipoSistema: ContratoEsteiraService.TIPO,
        membros: { create: { usuarioId: dono.id, papel: 'dono' } },
      },
      select: { id: true },
    });
    return { boardId: board.id, listas: await this.garantirColunas(board.id) };
  }

  /** Cria só o que falta — quadro já em uso não é remexido. */
  private async garantirColunas(boardId: string): Promise<Map<string, string>> {
    const atuais = await this.prisma.kanbanLista.findMany({
      where: { boardId },
      select: { id: true, nome: true, posicao: true },
    });
    const porNome = new Map(atuais.map((l) => [l.nome, l.id]));
    let posicao = atuais.reduce((max, l) => Math.max(max, l.posicao), 0);

    for (const nome of ContratoEsteiraService.ETAPAS) {
      if (porNome.has(nome)) continue;
      posicao = posicaoNoFim(posicao);
      const lista = await this.prisma.kanbanLista.create({
        data: { boardId, nome, posicao },
        select: { id: true },
      });
      porNome.set(nome, lista.id);
    }
    return porNome;
  }
}
