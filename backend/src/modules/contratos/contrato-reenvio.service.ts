import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ClickSignService } from '@integrations/clicksign/clicksign.service';
import {
  SELECT_PROPOSTA_CONTRATO,
  comSkus,
  montarContratoParaAssinar,
  type PropostaDoBanco,
} from '@modules/propostas/contrato-envio.util';
import {
  ModeloContratoService,
  type ModeloEmUso,
} from '@modules/modelo-contrato/modelo-contrato.service';

/** Uma linha do rastro — o PONTEIRO pro envelope, não o documento. */
export interface EnvioAssinatura {
  envelopeId: string | null;
  documentoId: string | null;
  url: string | null;
  enviadoEm: string | null;
  porUsuarioId: string | null;
  motivo: string | null;
  /** `substituido` = veio uma versão nova depois dele. */
  desfecho: 'enviado' | 'substituido';
  /**
   * Qual versão do MODELO de contrato saiu neste envio (`null` = o padrão do
   * app). É o que responde "qual texto o cliente assinou?" depois que o
   * diretor troca o modelo pela tela. Ausente nos envios anteriores a 24/09.
   */
  modeloVersao?: number | null;
}

/**
 * REENVIO do contrato depois de o cliente pedir alteração de cláusula.
 *
 * O adendo do card de 17/09: o cliente pede mudança, o representante avisa o
 * diretor por fora (é combinado que seja manual), eles alinham, e então só o
 * DIRETOR manda a versão nova pra mesma proposta. O ciclo recomeça — o cliente
 * recebe o contrato novo pela ClickSign e assina.
 *
 * Isto não existia: o envelope só nascia no aceite da proposta, por um método
 * privado. O próprio código admitia o buraco ("o contrato é reenviado depois")
 * sem haver por onde.
 *
 * 🔴 O passo que faz este serviço valer é EXPIRAR O ENVELOPE ANTERIOR. Sem ele o
 * cliente fica com dois links válidos e pode assinar exatamente a versão que
 * pediu pra mudar.
 *
 * ⚠️ O texto novo das cláusulas é editado no MODELO dentro da ClickSign, não
 * aqui (é o desenho do ClickSignService). Este serviço dispara a rodada nova;
 * quem mexe na cláusula é o jurídico, no painel, antes de mandar.
 */
@Injectable()
export class ContratoReenvioService {
  private readonly logger = new Logger(ContratoReenvioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clicksign: ClickSignService,
    private readonly modelos: ModeloContratoService,
  ) {}

  /**
   * Manda a versão nova pra assinatura.
   *
   * ⛔ Recusa contrato JÁ ASSINADO. Depois da assinatura o documento vincula, e
   * "mandar outro" não é reenvio — é aditivo, que é outro assunto e outra
   * decisão. Recusar alto aqui é melhor que existirem dois contratos assinados
   * pro mesmo cliente sem ninguém notar.
   */
  async reenviar(params: {
    empresaId: string;
    contratoId: string;
    usuarioId: string;
    motivo?: string;
  }): Promise<{
    envelopeId: string;
    documentoId: string;
    rodada: number;
    anteriorExpirado: boolean;
  }> {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: params.contratoId, empresaId: params.empresaId },
      select: {
        id: true,
        status: true,
        assinaturaId: true,
        assinaturaDocumentoId: true,
        assinaturaUrl: true,
        assinadoEm: true,
        enviosAssinatura: true,
        proposta: { select: SELECT_PROPOSTA_CONTRATO },
      },
    });
    if (!contrato) {
      throw new NotFoundException('Contrato não encontrado', ErrorCode.NOT_FOUND);
    }
    // Duas checagens de propósito: o status é a intenção registrada, o
    // `assinadoEm` é o fato. Um contrato assinado cujo status ficou pra trás
    // (webhook em voo, ajuste manual) ainda é um contrato assinado.
    if (contrato.assinadoEm || contrato.status === 'ASSINADO' || contrato.status === 'ATIVO') {
      throw new BusinessRuleException(
        'Contrato já assinado — a versão nova seria um ADITIVO, não um reenvio. ' +
          'Assinado, o documento vincula: mandar outro por esta porta criaria dois contratos ' +
          'válidos pro mesmo cliente.',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (contrato.status === 'ENCERRADO' || contrato.status === 'CANCELADO') {
      throw new BusinessRuleException(
        `Contrato ${contrato.status.toLowerCase()} — reabrir é decisão comercial, não reenvio.`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // Mesma montagem do aceite — util compartilhado de propósito, pra versão 2
    // não sair diferente da 1 em nada que ninguém pediu.
    // O modelo EM USO agora — versão ativa ilegível estoura em vez de cair pro
    // padrão (mandaria um texto diferente do que o diretor ativou).
    let modelo: ModeloEmUso;
    try {
      modelo = await this.modelos.emUso(params.empresaId);
    } catch (err) {
      throw new BusinessRuleException(
        `Contrato não pode ser reenviado: o modelo de contrato ativo não pôde ser lido (${
          err instanceof Error ? err.message : String(err)
        }).`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const montagem = montarContratoParaAssinar(
      await comSkus(this.prisma, contrato.proposta as PropostaDoBanco),
      { modelo: modelo.arquivo },
    );
    if (!montagem.ok) {
      throw new BusinessRuleException(
        `Contrato não pode ser reenviado: ${montagem.motivo}.`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // ── 1. mata o anterior ANTES de criar o novo ──
    //
    // Nesta ordem de propósito: entre expirar e enviar existe uma janela em que
    // o cliente não tem link nenhum, e ela é muito melhor que a oposta — dois
    // links válidos, em que ele pode assinar o documento errado.
    let anteriorExpirado = false;
    if (contrato.assinaturaId) {
      anteriorExpirado = await this.clicksign.expirarEnvelope(
        params.empresaId,
        contrato.assinaturaId,
      );
    }

    // ── 2. a versão nova ──
    const envelope = await this.clicksign.enviarParaAssinatura(params.empresaId, montagem.dados);

    // ── 3. rastro: o anterior vira `substituido`, o novo entra como `enviado` ──
    const anteriores = this.lerRastro(contrato.enviosAssinatura).map((e) => ({
      ...e,
      desfecho: 'substituido' as const,
    }));
    // A 1ª rodada nasceu no aceite, antes deste serviço existir, e não está no
    // rastro. Sem isto ela sumiria do histórico e o contrato pareceria ter
    // nascido já na versão 2.
    if (anteriores.length === 0 && contrato.assinaturaId) {
      anteriores.push({
        envelopeId: contrato.assinaturaId,
        documentoId: contrato.assinaturaDocumentoId,
        url: contrato.assinaturaUrl,
        enviadoEm: null,
        porUsuarioId: null,
        motivo: null,
        desfecho: 'substituido',
      });
    }
    const rastro: EnvioAssinatura[] = [
      ...anteriores,
      {
        envelopeId: envelope.envelopeId,
        documentoId: envelope.documentoId,
        url: null,
        enviadoEm: new Date().toISOString(),
        porUsuarioId: params.usuarioId,
        motivo: params.motivo?.trim() || null,
        desfecho: 'enviado',
        modeloVersao: modelo.versao,
      },
    ];

    await this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        status: 'AGUARDANDO_ASSINATURA',
        assinaturaId: envelope.envelopeId,
        assinaturaDocumentoId: envelope.documentoId,
        // O link antigo apontava pro documento SUBSTITUÍDO. Ele já está no
        // rastro; deixá-lo aqui faria a tela do contrato oferecer justamente a
        // versão que o cliente pediu pra mudar.
        assinaturaUrl: null,
        enviosAssinatura: rastro as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Contrato ${contrato.id} (${contrato.proposta.numero}) reenviado pra assinatura — ` +
        `rodada ${rastro.length}, envelope ${envelope.envelopeId}` +
        (anteriorExpirado ? '' : ' ⚠️ envelope anterior NÃO expirou'),
    );
    return {
      envelopeId: envelope.envelopeId,
      documentoId: envelope.documentoId,
      rodada: rastro.length,
      anteriorExpirado,
    };
  }

  /** O rastro como a tela precisa dele: mais recente primeiro. */
  async historico(empresaId: string, contratoId: string): Promise<EnvioAssinatura[]> {
    const c = await this.prisma.contrato.findFirst({
      where: { id: contratoId, empresaId },
      select: { enviosAssinatura: true },
    });
    if (!c) throw new NotFoundException('Contrato não encontrado', ErrorCode.NOT_FOUND);
    return this.lerRastro(c.enviosAssinatura).reverse();
  }

  /** Tolerante a lixo — JSON de banco não tem tipo garantido. */
  private lerRastro(bruto: unknown): EnvioAssinatura[] {
    if (!Array.isArray(bruto)) return [];
    return bruto.filter((e): e is EnvioAssinatura => !!e && typeof e === 'object');
  }
}
