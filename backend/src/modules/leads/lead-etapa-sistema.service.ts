import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { registrarTransicaoEtapa } from './lead-etapa-historico.util';

/**
 * Marcos do processo que o app conhece sozinho. O nome é do MARCO, não da
 * etapa: quem decide qual etapa corresponde a cada marco é a configuração do
 * tenant, não o código.
 */
export type MarcoDoFunil =
  | 'propostaEnviada'
  | 'propostaAssinada'
  | 'contratoAssinado'
  | 'instalacao';

export type ResultadoMove =
  | 'movido'
  | 'ja-estava'
  | 'nao-retrocede'
  | 'fora-do-momento'
  | 'sem-lead'
  | 'nao-configurado'
  | 'etapa-invalida';

interface Pedido {
  empresaId: string;
  /** Um dos dois basta — sem leadId, resolve pelo cliente. */
  leadId?: string | null;
  clienteId?: string | null;
  marco: MarcoDoFunil;
  /**
   * Só move se o lead estiver EXATAMENTE nesta etapa. É como se distingue "a
   * nota da primeira mensalidade" de qualquer nota emitida depois: a primeira
   * é a que chega com o lead ainda em "Contrato assinado".
   */
  somenteDe?: MarcoDoFunil;
  /** De onde veio o fato, pro histórico não dizer que alguém moveu na mão. */
  origem: 'webhook' | 'erp';
  /** Uma linha pro log: "contrato CT-123 assinado". */
  motivo: string;
}

/**
 * Move o lead quando quem sabe do fato é o SISTEMA — não uma pessoa na tela.
 *
 * Três marcos hoje: o cliente assinou a proposta, o contrato voltou assinado, o
 * ERP faturou a primeira mensalidade. Nenhum deles tem usuário logado por trás,
 * e é justamente por isso que este serviço existe:
 *
 * - `LeadsService.moverEtapa` exige `AuthenticatedUser` e valida a CARTEIRA do
 *   lead. Webhook não tem usuário, e inventar um usuário de sistema só pra
 *   passar nessa validação é remendo.
 * - `prisma.lead.update({ funilEtapaId })` puro muda a coluna e NENHUMA
 *   automação roda. O lead aparece na etapa certa na tela e o fluxo que
 *   deveria reagir nunca acontece — falha silenciosa, a pior espécie.
 *
 * O caminho certo é o mesmo do motor de fluxo (`MOVER_LEAD_ETAPA`), e são três
 * passos: atualizar o lead, registrar a transição e disparar `LEAD_ETAPA_MUDOU`.
 * Faltar qualquer um quebra alguma coisa.
 *
 * **Nunca move pra trás.** Webhook chega fora de ordem, e devolver um lead de
 * "Contrato assinado" pra "Proposta assinada" seria o sistema mentindo sobre
 * onde o cliente está.
 */
@Injectable()
export class LeadEtapaSistemaService {
  private readonly logger = new Logger(LeadEtapaSistemaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: FluxoEventBusService,
  ) {}

  /**
   * **Best-effort por desenho.** O fato que disparou isto (proposta aceita,
   * contrato assinado, nota emitida) já aconteceu e já está gravado; se o move
   * falhar, o certo é gritar no log, não desfazer o fato.
   */
  async mover(p: Pedido): Promise<ResultadoMove> {
    try {
      return await this.executar(p);
    } catch (err) {
      this.logger.error(
        `Falha movendo etapa (${p.marco}, ${p.motivo}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 'sem-lead';
    }
  }

  private async executar(p: Pedido): Promise<ResultadoMove> {
    const etapaId = await this.etapaConfigurada(p.empresaId, p.marco);
    if (!etapaId) {
      // Tenant que não mapeou o marco simplesmente não usa este automatismo.
      this.logger.debug(`Marco ${p.marco} sem etapa configurada na empresa ${p.empresaId}`);
      return 'nao-configurado';
    }

    const leadId =
      p.leadId ?? (p.clienteId ? await this.leadDoCliente(p.empresaId, p.clienteId) : null);
    if (!leadId) {
      this.logger.warn(`${p.motivo}: sem lead correspondente — etapa não movida`);
      return 'sem-lead';
    }

    const etapa = await this.prisma.funilEtapa.findFirst({
      where: { id: etapaId, funil: { empresaId: p.empresaId } },
      select: { id: true, funilId: true, tipo: true, ordem: true },
    });
    if (!etapa) {
      // Config apontando pra etapa apagada/de outro tenant. Ruído silencioso
      // seria pior: alguém configurou e nada acontece.
      this.logger.error(
        `Marco ${p.marco} aponta pra etapa ${etapaId}, que não existe na empresa ${p.empresaId}`,
      );
      return 'etapa-invalida';
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId: p.empresaId },
      select: {
        funilEtapaId: true,
        funilEtapa: { select: { funilId: true, ordem: true } },
      },
    });
    if (!lead) return 'sem-lead';
    if (lead.funilEtapaId === etapa.id) return 'ja-estava';
    if (p.somenteDe) {
      const exigida = await this.etapaConfigurada(p.empresaId, p.somenteDe);
      if (!exigida || lead.funilEtapaId !== exigida) {
        this.logger.debug(`${p.motivo}: lead ${leadId} não está em ${p.somenteDe} — não move`);
        return 'fora-do-momento';
      }
    }
    // Só compara ordem dentro do MESMO funil — entre funis diferentes o número
    // não quer dizer nada.
    if (
      lead.funilEtapa &&
      lead.funilEtapa.funilId === etapa.funilId &&
      lead.funilEtapa.ordem > etapa.ordem
    ) {
      this.logger.log(`${p.motivo}: lead ${leadId} já está adiante de ${p.marco} — não retrocede`);
      return 'nao-retrocede';
    }

    // O enum legado acompanha o TIPO da etapa (fonte da verdade = funil), igual
    // ao que o motor de fluxo faz.
    const enumEtapa =
      etapa.tipo === 'GANHO' ? 'GANHO' : etapa.tipo === 'PERDIDO' ? 'PERDIDO' : 'QUALIFICANDO';
    // `capacidadeMaxima` NÃO é checada aqui de propósito: ela é anti-sobrecarga
    // de prospecção. Segurar um contrato assinado porque a etapa está cheia
    // esconderia um fato consumado.
    await this.prisma.lead.updateMany({
      where: { id: leadId, empresaId: p.empresaId },
      data: {
        funilEtapaId: etapa.id,
        funilId: etapa.funilId,
        etapa: enumEtapa,
        etapaDesde: new Date(),
      },
    });

    await registrarTransicaoEtapa(this.prisma, this.logger, {
      empresaId: p.empresaId,
      leadId,
      funilId: etapa.funilId,
      etapaOrigem: lead.funilEtapaId,
      etapaDestino: etapa.id,
      quem: null,
      origemMudanca: p.origem,
    });

    // Só aqui, e só porque a etapa mudou de verdade: é esta comparação que
    // impede re-disparo em webhook repetido e laço entre fluxos.
    await this.bus.disparar(p.empresaId, 'LEAD_ETAPA_MUDOU', {
      leadId,
      funilId: etapa.funilId,
      deFunilEtapaId: lead.funilEtapaId ?? undefined,
      paraFunilEtapaId: etapa.id,
    });
    this.logger.log(`${p.motivo}: lead ${leadId} → ${p.marco}`);
    return 'movido';
  }

  /** `Empresa.config.funilEtapas[marco]` — o mapa marco → etapa é do tenant. */
  private async etapaConfigurada(empresaId: string, marco: MarcoDoFunil): Promise<string | null> {
    const emp = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const cfg = (emp?.config as Record<string, unknown> | null) ?? {};
    const etapas = (cfg.funilEtapas as Record<string, unknown> | undefined) ?? {};
    const id = etapas[marco];
    return typeof id === 'string' && id ? id : null;
  }

  /**
   * Mesma regra do motor de fluxo (`leadDoCliente`): com mais de um lead pro
   * cliente, ganha o da conversa mais recente no WhatsApp da empresa; sem
   * conversa, o mais novo.
   */
  private async leadDoCliente(empresaId: string, clienteId: string): Promise<string | null> {
    const leads = await this.prisma.lead.findMany({
      where: { empresaId, clienteId },
      orderBy: { criadoEm: 'desc' },
      select: { id: true },
    });
    if (leads.length <= 1) return leads[0]?.id ?? null;
    const conversa = await this.prisma.conversation.findFirst({
      where: {
        empresaId,
        canal: 'WHATSAPP',
        proprietarioId: null,
        leadId: { in: leads.map((l) => l.id) },
      },
      orderBy: { ultimaMsgEm: 'desc' },
      select: { leadId: true },
    });
    return conversa?.leadId ?? leads[0].id;
  }
}
