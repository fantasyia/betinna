import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { LeadEtapaSistemaService } from '@modules/leads/lead-etapa-sistema.service';

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

    await this.avisar(
      contrato.empresaId,
      contrato.representanteId,
      `Contrato da ${contrato.proposta.numero} assinado`,
      `${contrato.cliente.nome} assinou o contrato. Pode seguir pro ERP.`,
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
      proposta: { select: { numero: true } },
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
