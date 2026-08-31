import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { LeadsService } from '@modules/leads/leads.service';
import { normalizarAtribuicao, type Atribuicao } from '@modules/leads/atribuicao.util';
import { MetaGraphClientService } from './meta-graph-client.service';
import { MetaOAuthService } from './meta-oauth.service';
import type { FacebookCredenciais } from './meta.types';
import {
  META_LEADGEN_QUEUE,
  type MetaLeadgenDados,
  type MetaLeadgenJobData,
} from './meta-leadgen.types';

/**
 * Retry com backoff: a busca do lead na Graph API é a parte frágil do caminho.
 * Token vencido, `leads_retrieval` ainda não aprovada, 5xx do Meta — em todos
 * esses casos o lead JÁ EXISTE do lado do Meta e só falta buscar. Desistir na
 * primeira tentativa perde nome e telefone de um lead que foi pago.
 *
 * 6 tentativas com backoff exponencial de 30s cobrem ~30min de indisponibilidade.
 */
const JOB_OPTS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

/** Campos padrão do formulário do Meta -> campo do lead. */
const NOME = ['full_name', 'nome', 'nome_completo'];
const TELEFONE = ['phone_number', 'telefone', 'whatsapp'];
const EMAIL = ['email', 'e-mail'];
const CIDADE = ['city', 'cidade'];
const UF = ['state', 'province', 'estado', 'uf'];
const EMPRESA = ['company_name', 'empresa', 'nome_da_empresa'];

/**
 * Lead Ads — formulário nativo do Instagram/Facebook.
 *
 * O Meta avisa por webhook mas NÃO manda os dados: o payload traz só
 * `leadgen_id`. Os dados vêm de um `GET /{leadgen_id}` posterior. Daí o desenho:
 * o webhook só enfileira (responde rápido, como o Meta exige) e a fila busca com
 * retry.
 *
 * ⚠️ O `leadgen_id` expira (90 dias no papel; na prática o lead esfria em horas).
 * Sem a fila de retry, uma indisponibilidade momentânea do Graph vira lead
 * fantasma — sem nome e sem telefone, impossível de recuperar depois.
 */
@Injectable()
export class MetaLeadgenService {
  private readonly logger = new Logger(MetaLeadgenService.name);

  constructor(
    @InjectQueue(META_LEADGEN_QUEUE) private readonly queue: Queue<MetaLeadgenJobData>,
    private readonly prisma: PrismaService,
    private readonly oauth: MetaOAuthService,
    private readonly graph: MetaGraphClientService,
    private readonly leads: LeadsService,
  ) {}

  /**
   * Enfileira a busca. NÃO é best-effort de propósito: se a fila está fora, o
   * caller devolve 5xx pro Meta reentregar o webhook. Engolir aqui perderia o
   * lead em silêncio.
   */
  async enfileirar(data: MetaLeadgenJobData): Promise<void> {
    // jobId determinístico → reentrega do MESMO webhook não vira job duplicado.
    // Sem ':' — BullMQ v5 rejeita custom job id com ':'.
    await this.queue.add('buscar', data, { ...JOB_OPTS, jobId: `leadgen_${data.leadgenId}` });
  }

  /** Executa o job (chamado pelo processor). */
  async processar(data: MetaLeadgenJobData): Promise<void> {
    if (await this.jaImportado(data.empresaId, data.leadgenId)) {
      this.logger.log(`Lead Ads ${data.leadgenId} já importado — ignorado`);
      return;
    }

    const resolved = await this.oauth.resolverPorAccount('facebook', data.pageId);
    if (!resolved) {
      // Sem conexão ativa não há token — e isso não muda por retry.
      this.logger.warn(`Lead Ads ${data.leadgenId}: página ${data.pageId} sem conexão — ignorado`);
      return;
    }
    const cred = resolved.credenciais as FacebookCredenciais;

    // Deixa ESTOURAR: é o que faz o BullMQ re-tentar. Token vencido, 5xx do Meta
    // e `leads_retrieval` ainda não aprovada são todos recuperáveis.
    const dados = await this.graph.obterLead(data.leadgenId, cred.pageAccessToken);

    const campos = this.indexarCampos(dados);
    const nome = this.primeiro(campos, NOME) ?? this.nomeComposto(campos);
    const telefone = this.primeiro(campos, TELEFONE);
    const email = this.primeiro(campos, EMAIL);
    if (!nome && !telefone && !email) {
      this.logger.warn(`Lead Ads ${data.leadgenId} sem nome/telefone/e-mail — nada a importar`);
      return;
    }

    const atribuicao = await this.montarAtribuicao(data, cred.pageAccessToken);
    const empresaNome = this.primeiro(campos, EMPRESA);

    const lead = await this.leads.createPublico(resolved.empresaId, {
      // O nome do LEAD é o da empresa quando o formulário pergunta; senão o da
      // pessoa. Mesma convenção da captura do site.
      nome: empresaNome ?? nome ?? telefone ?? email ?? 'Lead do Meta',
      contatoNome: nome,
      contatoTelefone: telefone,
      contatoEmail: email,
      cidade: this.primeiro(campos, CIDADE),
      uf: this.primeiro(campos, UF),
      variaveis: {
        // A idempotência mora aqui: é o que `jaImportado` consulta.
        metaLeadgenId: data.leadgenId,
        metaFormId: data.formId ?? dados.form_id,
        metaPageId: data.pageId,
        ...(data.adId ? { metaAdId: data.adId } : {}),
        ...(data.adgroupId ? { metaAdgroupId: data.adgroupId } : {}),
        // Resposta que não casou com campo estruturado (pergunta customizada do
        // formulário) não pode sumir — é onde vive a qualificação.
        respostasFormulario: campos,
        atribuicao,
      },
      utmSource: atribuicao.primeiro?.utmSource ?? null,
      utmMedium: atribuicao.primeiro?.utmMedium ?? null,
      utmCampaign: atribuicao.primeiro?.utmCampaign ?? null,
      origemCadastro: 'meta_lead_ads',
      formularioOrigem: 'lead_ads',
    });

    this.logger.log(
      `Lead Ads importado: lead=${lead.id} leadgen=${data.leadgenId} empresa=${resolved.empresaId}`,
    );
  }

  // ─── Internos ────────────────────────────────────────────────────────

  /**
   * O Meta REENTREGA webhook, e o job pode voltar depois de o `removeOnComplete`
   * ter descartado o jobId. A guarda durável é o próprio lead: se já existe um
   * com esse `leadgen_id` gravado, o trabalho já foi feito.
   */
  private async jaImportado(empresaId: string, leadgenId: string): Promise<boolean> {
    const existente = await this.prisma.lead.findFirst({
      where: {
        empresaId,
        variaveis: { path: ['metaLeadgenId'], equals: leadgenId } as Prisma.JsonFilter,
      },
      select: { id: true },
    });
    return Boolean(existente);
  }

  /**
   * Atribuição. Diferente do CTWA, aqui NÃO existe a incógnita do `ctwaClid`: o
   * webhook já traz `ad_id`, então dá pra resolver o nome da campanha.
   *
   * Best-effort de propósito: `ads_read` é permissão SEPARADA de
   * `leads_retrieval`. Sem ela dá pra ter o lead e não ter a campanha — e lead
   * sem atribuição vale muito mais que nenhum lead.
   */
  private async montarAtribuicao(
    data: MetaLeadgenJobData,
    accessToken: string,
  ): Promise<Atribuicao> {
    let campanha: string | undefined;
    let anuncio: string | undefined;
    if (data.adId) {
      try {
        const ad = await this.graph.obterAnuncio(data.adId, accessToken);
        campanha = ad.campaign?.name;
        anuncio = ad.name;
      } catch (err) {
        this.logger.warn(
          `Lead Ads ${data.leadgenId}: não resolveu ad_id=${data.adId} (falta ads_read?) — ` +
            `lead entra sem nome de campanha: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const bloco = {
      utmSource: 'meta',
      utmMedium: 'lead_ads',
      // Nome da campanha = utm_campaign = slug do conteúdo (mesma regra dos
      // outros canais). Sem `ads_read` o ad_id serve de identificador cru — é
      // rastreável na mão, ao contrário de campo vazio.
      utmCampaign: campanha ?? data.adId,
      utmContent: anuncio ?? data.adId,
      utmTerm: data.adgroupId,
      capturadoEm: data.createdTime
        ? new Date(data.createdTime * 1000).toISOString()
        : new Date().toISOString(),
    };
    // 1º toque = último toque: o Lead Ads É a porta de entrada, não existe
    // navegação antes dele.
    // `normalizarAtribuicao` devolve undefined quando os dois blocos ficam
    // vazios — o que aqui não acontece (utmSource/utmMedium são fixos), mas o
    // tipo obriga o fallback.
    return normalizarAtribuicao({ primeiro: bloco, ultimo: bloco }) ?? {};
  }

  /** `field_data` → mapa nome→primeiro valor (o Meta manda array por campo). */
  private indexarCampos(dados: MetaLeadgenDados): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of dados.field_data ?? []) {
      const v = f.values?.find((x) => typeof x === 'string' && x.trim().length > 0);
      if (f.name && v) out[f.name.toLowerCase()] = v.trim();
    }
    return out;
  }

  private primeiro(campos: Record<string, string>, nomes: string[]): string | undefined {
    for (const n of nomes) if (campos[n]) return campos[n];
    return undefined;
  }

  /** Formulário que pergunta nome e sobrenome separados não tem `full_name`. */
  private nomeComposto(campos: Record<string, string>): string | undefined {
    const partes = [campos.first_name, campos.last_name].filter(Boolean);
    return partes.length ? partes.join(' ') : undefined;
  }
}
