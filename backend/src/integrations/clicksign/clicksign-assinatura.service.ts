import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ContratoComissoesService } from '@modules/comissoes/contrato-comissoes.service';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { LeadEtapaSistemaService } from '@modules/leads/lead-etapa-sistema.service';
import { PropostaErpService } from '@modules/propostas/proposta-erp.service';

/** O recorte do payload que interessa. O resto do documento a gente ignora. */
interface DocumentoWebhook {
  key?: string;
  status?: string;
  finished_at?: string;
  metadata?: Record<string, string> | null;
  downloads?: { signed_file_url?: string; original_file_url?: string } | null;
}
interface PayloadWebhook {
  event?: { name?: string; occurred_at?: string };
  document?: DocumentoWebhook | DocumentoWebhook[];
}

const BUCKET = 'contratos-assinados';

/**
 * O que fazer quando a ClickSign avisa que o contrato mudou de estado.
 *
 * Roda **fora** do ciclo de resposta do webhook: a ClickSign quer 200 rápido, e
 * baixar um PDF e subir pro Storage não cabe nesse tempo.
 *
 * Guardar o PDF assinado aqui não é redundância: o link que a ClickSign manda é
 * de download temporário, e o contrato assinado é o documento que sustenta a
 * cobrança. Ele precisa existir num lugar nosso.
 */
@Injectable()
export class ClickSignAssinaturaService implements OnModuleInit {
  private readonly logger = new Logger(ClickSignAssinaturaService.name);
  private readonly storage: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly notificacoes: NotificacoesService,
    private readonly etapa: LeadEtapaSistemaService,
    private readonly propostaErp: PropostaErpService,
    private readonly comissoesContrato: ContratoComissoesService,
  ) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  /** Fire-and-forget: bucket que falta não pode travar o boot da API. */
  onModuleInit(): void {
    void this.garantirBucket();
  }

  /**
   * Documento finalizado: contrato ASSINADO, PDF guardado, rep avisado.
   *
   * Idempotente porque a ClickSign reentrega — e reentrega é o comportamento
   * certo dela, não um defeito.
   */
  async registrarAssinado(cru: Buffer): Promise<'aplicado' | 'repetido' | 'sem-contrato'> {
    const doc = this.documentoDo(cru);
    if (!doc) return 'sem-contrato';
    const contrato = await this.acharContrato(doc);
    if (!contrato) {
      // Não é erro: a conta ClickSign pode ter documento que não nasceu aqui.
      this.logger.warn(`Assinatura de documento ${doc.key ?? '?'} sem contrato correspondente`);
      return 'sem-contrato';
    }
    if (contrato.status === 'ASSINADO' && contrato.documentoUrl) return 'repetido';

    const assinadoEm = doc.finished_at ? new Date(doc.finished_at) : new Date();
    const link = this.urlAbsoluta(doc.downloads?.signed_file_url);
    const caminho = link ? await this.guardarPdf(contrato.empresaId, contrato.id, link) : null;

    await this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        status: 'ASSINADO',
        assinadoEm,
        assinaturaUrl: link ?? contrato.assinaturaUrl,
        ...(caminho ? { documentoUrl: caminho } : {}),
      },
    });
    this.logger.log(
      `Contrato ${contrato.id} (proposta ${contrato.proposta.numero}) ASSINADO` +
        (caminho ? ' — PDF guardado' : ' — sem PDF'),
    );

    // Cronograma de comissão do rep: uma linha por MÊS do contrato (locação
    // paga todo mês, não uma vez). Nasce aqui, na assinatura, pra o rep já ver
    // o que vem — cada mês só vira dinheiro quando a mensalidade daquele mês
    // entrar. Best-effort por dentro: não derruba a assinatura.
    await this.comissoesContrato.recalcular(contrato.id);

    // A etapa anda por conta do FATO, não do que vem depois dele. Se o envio
    // pro ERP falhar, o contrato continua assinado — condicionar o move ao
    // sucesso do ERP esconderia um contrato assinado e ninguém ficaria sabendo.
    await this.etapa.mover({
      empresaId: contrato.empresaId,
      clienteId: contrato.clienteId,
      marco: 'contratoAssinado',
      origem: 'webhook',
      motivo: `Contrato da ${contrato.proposta.numero} assinado`,
    });

    // O pedido que nasceu do aceite TRAVA aqui. Enquanto o contrato não existia,
    // ele era um rascunho que o rep podia editar e mandar pro ERP por conta —
    // agora existe documento assinado, e quem libera é o Leandro, no ERP.
    await this.travarPedido(contrato.empresaId, contrato.proposta.numero);

    // E o contrato assinado sobe pro ERP como PROPOSTA (orçamento): é ali que o
    // Leandro revisa, põe o rep como vendedor e transforma em pedido de venda.
    await this.subirParaErp(contrato.empresaId, contrato.proposta, contrato.representanteId);

    await this.avisar(
      contrato.empresaId,
      contrato.representanteId,
      `Contrato da ${contrato.proposta.numero} assinado`,
      `${contrato.cliente.nome} assinou o contrato. O pedido ficou travado até a liberação no ERP.`,
    );
    return 'aplicado';
  }

  /**
   * Recusa: o contrato não vai sair, e quem vendeu precisa saber hoje — não na
   * semana que vem, quando alguém reparar que a cobrança não começou.
   */
  async registrarRecusa(cru: Buffer): Promise<'aplicado' | 'sem-contrato'> {
    const doc = this.documentoDo(cru);
    if (!doc) return 'sem-contrato';
    const contrato = await this.acharContrato(doc);
    if (!contrato || contrato.status === 'ASSINADO') return 'sem-contrato';

    await this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        status: 'CANCELADO',
        encerradoEm: new Date(),
        motivoEncerramento: 'Assinatura recusada pelo signatário',
      },
    });
    this.logger.warn(`Contrato ${contrato.id} recusado na assinatura`);
    await this.avisar(
      contrato.empresaId,
      contrato.representanteId,
      `Contrato da ${contrato.proposta.numero} foi RECUSADO`,
      `${contrato.cliente.nome} recusou assinar o contrato. Vale ligar antes de refazer a proposta.`,
    );
    return 'aplicado';
  }

  /**
   * Pedido em RASCUNHO da proposta assinada → `AGUARDANDO_LIBERACAO`.
   *
   * Só mexe em rascunho: pedido que já andou (foi pro ERP, foi entregue) não
   * volta pra fila de liberação por causa de um webhook repetido.
   */
  private async travarPedido(empresaId: string, propostaNumero: string): Promise<void> {
    const r = await this.prisma.pedido.updateMany({
      where: { empresaId, propostaNumero, status: 'RASCUNHO' },
      data: { status: 'AGUARDANDO_LIBERACAO' },
    });
    if (r.count > 0) {
      this.logger.log(`Pedido da ${propostaNumero} travado aguardando liberação no ERP`);
    }
  }

  /**
   * Sobe a proposta pro ERP como ORÇAMENTO, agora que o contrato está assinado.
   *
   * **Best-effort, e de propósito.** A assinatura é fato consumado: se o ERP
   * estiver fora do ar, segurar o resto (a etapa, o aviso, o PDF guardado)
   * esconderia um contrato assinado. A falha vira aviso pro responsável, com o
   * que fazer — e o botão "enviar pro ERP" da proposta continua existindo.
   *
   * Não anexa o PDF lá: a API do Tiny só tem anexo em PRODUTO (conferido em
   * `docs/tiny/endpoints.txt`). O contrato assinado fica no app, em /contratos.
   */
  private async subirParaErp(
    empresaId: string,
    proposta: { id: string; numero: string; orcamentoErpId: string | null },
    representanteId: string | null,
  ): Promise<void> {
    if (proposta.orcamentoErpId) return; // já subiu — reenviar criaria orçamento duplicado
    try {
      const r = await this.propostaErp.enviar(proposta.id, empresaId);
      this.logger.log(`Proposta ${proposta.numero} → ERP como orçamento ${r.orcamentoErpId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Contrato da ${proposta.numero} assinado, mas não subiu pro ERP: ${msg}`);
      await this.avisar(
        empresaId,
        representanteId,
        `Contrato da ${proposta.numero} assinado — mas não subiu pro ERP`,
        `O contrato está assinado e guardado. O envio pro ERP falhou (${msg.slice(0, 160)}). ` +
          'Dá pra reenviar pela própria proposta.',
      );
    }
  }

  /**
   * O campo `document` chega ora como objeto, ora como lista — a documentação
   * mostra as duas formas em eventos diferentes.
   */
  private documentoDo(cru: Buffer): DocumentoWebhook | null {
    let payload: PayloadWebhook;
    try {
      payload = JSON.parse(cru.toString('utf8')) as PayloadWebhook;
    } catch {
      this.logger.error('Webhook do ClickSign com corpo que não é JSON');
      return null;
    }
    const d = payload.document;
    const doc = Array.isArray(d) ? d[0] : d;
    return doc ?? null;
  }

  /**
   * Três caminhos até o contrato, do mais direto ao mais tolerante: o id do
   * documento, o `metadata` que carimbamos no envio, e o número da proposta. O
   * carimbo existe justamente porque id é da ClickSign — o número da proposta é
   * nosso, e sobrevive a qualquer mudança de formato do lado deles.
   */
  private async acharContrato(doc: DocumentoWebhook) {
    const include = {
      proposta: { select: { id: true, numero: true, orcamentoErpId: true } },
      cliente: { select: { nome: true } },
    };
    if (doc.key) {
      const porDoc = await this.prisma.contrato.findFirst({
        where: { OR: [{ assinaturaDocumentoId: doc.key }, { assinaturaId: doc.key }] },
        include,
      });
      if (porDoc) return porDoc;
    }
    const meta = doc.metadata ?? {};
    if (meta.proposta_id) {
      const porId = await this.prisma.contrato.findFirst({
        where: { propostaId: meta.proposta_id },
        include,
      });
      if (porId) return porId;
    }
    if (meta.proposta) {
      return this.prisma.contrato.findFirst({
        where: { proposta: { numero: meta.proposta } },
        include,
      });
    }
    return null;
  }

  /**
   * A documentação mostra `signed_file_url` como caminho (`/2023/03/13/...`) e
   * a API devolve URL completa em outros pontos. Aceitar as duas formas é mais
   * barato que descobrir em produção qual delas veio.
   */
  private urlAbsoluta(url?: string): string | null {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    const base = (this.env.get('CLICKSIGN_API_URL') ?? 'https://app.clicksign.com').replace(
      /\/$/,
      '',
    );
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  /**
   * Baixa o PDF assinado e guarda no Storage. **Best-effort**: contrato
   * assinado sem cópia local ainda é contrato assinado — falhar aqui não pode
   * impedir de marcar a assinatura.
   */
  private async guardarPdf(
    empresaId: string,
    contratoId: string,
    url: string,
  ): Promise<string | null> {
    const caminho = `${empresaId}/${contratoId}.pdf`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`download ${r.status}`);
      const bytes = Buffer.from(await r.arrayBuffer());
      const { error } = await this.storage.storage
        .from(BUCKET)
        .upload(caminho, bytes, { contentType: 'application/pdf', upsert: true });
      if (error) throw new Error(error.message);
      return caminho;
    } catch (err) {
      this.logger.error(
        `Contrato ${contratoId}: PDF assinado não foi guardado (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
      return null;
    }
  }

  private async avisar(
    empresaId: string,
    usuarioId: string | null,
    titulo: string,
    mensagem: string,
  ): Promise<void> {
    if (!usuarioId) return;
    await this.notificacoes
      .criarParaUsuario({
        empresaId,
        usuarioId,
        tipo: 'GENERICO',
        prioridade: 'ALTA',
        titulo,
        mensagem,
        link: '/propostas',
      })
      .catch(() => null);
  }

  private async garantirBucket(): Promise<void> {
    try {
      const { data: buckets } = await this.storage.storage.listBuckets();
      if (buckets?.some((b) => b.name === BUCKET)) return;
      const { error } = await this.storage.storage.createBucket(BUCKET, { public: false });
      if (error && !error.message.includes('already exists')) {
        this.logger.error(`Falha ao criar bucket ${BUCKET}: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(
        `Bucket ${BUCKET} indisponível: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
