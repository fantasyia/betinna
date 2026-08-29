import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AppException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { LeadsService } from './leads.service';
import { leadCapturePublicoSchema, type LeadCapturePublicoDto } from './lead-capture.dto';
import {
  type Atribuicao,
  colunasPrimeiroToque,
  normalizarAtribuicao,
  normalizarFormulario,
  normalizarOrigemCadastro,
} from './atribuicao.util';

/** Teto de POSTs por chave por minuto (formulário de site não passa disso). */
const RL_MAX_POR_MIN = 60;
/** Teto diário por chave — 60/min sustentado daria 86 mil leads/dia. */
const RL_MAX_POR_DIA = 2_000;

/**
 * Captura PÚBLICA de leads — formulários do site do tenant POSTam aqui.
 *
 * Modelo de credencial: chave de API por tenant (`blc_<hex>`), enviada no header
 * `x-api-key`. Só o SHA-256 fica no banco; a chave em claro aparece UMA vez ao
 * gerar/rotacionar (estilo Stripe, mesmo padrão do WebhookEntrada).
 *
 * A chave vive no JS público do site — por isso o escopo dela é MÍNIMO (só criar
 * lead), com rate-limit por chave, dedup por telefone (sufixo-8, D18) e rotação.
 *
 * 401 uniforme pra chave inexistente/inativa (sem oráculo de existência).
 */
@Injectable()
export class LeadCaptureService {
  private readonly logger = new Logger(LeadCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly leads: LeadsService,
  ) {}

  // ─── Gestão (DIRECTOR/ADMIN, autenticado) ────────────────────────────

  /** Gera (ou ROTACIONA) a chave da empresa. A chave em claro sai UMA vez. */
  async gerarChave(user: AuthenticatedUser): Promise<{ chave: string; prefixo: string }> {
    const empresaId = this.requireEmpresa(user);
    const chave = `blc_${randomBytes(24).toString('hex')}`;
    const prefixo = `${chave.slice(0, 12)}…`;
    await this.prisma.leadCaptureChave.upsert({
      where: { empresaId },
      update: { chaveHash: this.hash(chave), prefixo, ativo: true, ultimoUsoEm: null },
      create: { empresaId, chaveHash: this.hash(chave), prefixo, ativo: true },
    });
    this.logger.log(`Chave de captura de leads gerada/rotacionada (empresa ${empresaId})`);
    return { chave, prefixo };
  }

  /** Status da chave (sem expor a chave — só prefixo/uso). */
  async status(user: AuthenticatedUser): Promise<{
    configurada: boolean;
    ativo: boolean;
    prefixo: string | null;
    criadoEm: Date | null;
    ultimoUsoEm: Date | null;
  }> {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.leadCaptureChave.findUnique({
      where: { empresaId },
      select: { ativo: true, prefixo: true, criadoEm: true, ultimoUsoEm: true },
    });
    return {
      configurada: !!row,
      ativo: row?.ativo ?? false,
      prefixo: row?.prefixo ?? null,
      criadoEm: row?.criadoEm ?? null,
      ultimoUsoEm: row?.ultimoUsoEm ?? null,
    };
  }

  /** Desativa a chave (formulários param de criar lead até rotacionar/reativar). */
  async desativar(user: AuthenticatedUser): Promise<{ ok: true }> {
    const empresaId = this.requireEmpresa(user);
    await this.prisma.leadCaptureChave.updateMany({
      where: { empresaId },
      data: { ativo: false },
    });
    return { ok: true };
  }

  // ─── Receiver público ────────────────────────────────────────────────

  /**
   * Cria o lead a partir do formulário do site.
   * Dedup: telefone (sufixo-8, D18) OU e-mail igual em lead ABERTO da empresa →
   * retorna o existente com `duplicado: true` (form reenviado não duplica funil).
   */
  async capturar(
    chaveApresentada: string | undefined,
    dto: LeadCapturePublicoDto,
    rawBody?: Buffer,
  ): Promise<{ ok: true; leadId: string; duplicado: boolean }> {
    const empresaId = await this.autenticarChave(chaveApresentada);
    dto = this.corrigirEncoding(dto, rawBody);

    // marca uso (best-effort, não bloqueia o caminho feliz)
    void this.prisma.leadCaptureChave
      .updateMany({ where: { empresaId }, data: { ultimoUsoEm: new Date() } })
      .catch(() => undefined);

    // Atribuição normalizada/sanitizada UMA vez (usada nos dois caminhos).
    const atribuicao = normalizarAtribuicao(dto.atribuicao);
    const origemCadastro = normalizarOrigemCadastro(dto.origemCadastro); // ausente → "site"

    const duplicado = await this.acharLeadAberto(empresaId, dto.telefone, dto.email);
    if (duplicado) {
      // Lead já existe: ÚLTIMO toque sempre atualiza; 1º toque só se estava vazio.
      await this.aplicarAtribuicaoEmLeadExistente(duplicado, atribuicao);
      // Tags também no reenvio: quem volta pelo formulário marcando OUTRO setor
      // precisa receber a etiqueta nova (o upsert cobre a repetida).
      await this.aplicarTagsDoSite(empresaId, duplicado, dto.tags);
      return { ok: true, leadId: duplicado, duplicado: true };
    }

    const colunas = colunasPrimeiroToque(atribuicao);
    const lead = await this.leads.createPublico(empresaId, {
      nome: dto.nome,
      contatoNome: dto.contatoNome,
      contatoTelefone: dto.telefone,
      contatoEmail: dto.email,
      cidade: dto.cidade,
      uf: dto.uf,
      segmento: dto.segmento,
      // Só a mensagem livre vai pra observações; o resto vira campo estruturado.
      observacoes: dto.mensagem?.trim() || undefined,
      funilId: dto.funilId,
      funilEtapaId: dto.funilEtapaId,
      variaveis: this.montarVariaveis(dto, atribuicao),
      utmSource: colunas.utmSource,
      utmMedium: colunas.utmMedium,
      utmCampaign: colunas.utmCampaign,
      origemCadastro,
      formularioOrigem: normalizarFormulario(dto.formulario) ?? null,
    });
    await this.aplicarTagsDoSite(empresaId, lead.id, dto.tags);
    this.logger.log(`Lead capturado do site: ${lead.id} (empresa ${empresaId})`);
    return { ok: true, leadId: lead.id, duplicado: false };
  }

  /**
   * Aplica as etiquetas que o site mandou (ex: `publico:comercio`,
   * `setor:cadeia-do-frio`). Cada tag dispara LEAD_RECEBEU_TAG — é ela que
   * ROTEIA o fluxo de nutrição. Usa `aplicarTagExistentePorNome`, que só aplica
   * etiqueta JÁ existente na empresa (nunca cria) e é idempotente, então reenvio
   * não duplica.
   *
   * Esta é a ÚNICA etiqueta que a captura aplica. A de ORIGEM foi removida em
   * 21/08 — a origem vive no campo `origemCadastro`, que a tela agora mostra e
   * filtra; ver o guarda em lead-capture.service.spec.ts.
   *
   * Best-effort POR TAG: falhar uma etiqueta não pode derrubar a captura (perder
   * o lead é pior que perder a etiqueta), mas a falha é LOGADA — senão o lead
   * entraria sem roteamento e ninguém ficaria sabendo.
   */
  private async aplicarTagsDoSite(
    empresaId: string,
    leadId: string,
    tags: string[] | undefined,
  ): Promise<void> {
    if (!tags?.length) return;
    // Dedup + normaliza: o site pode repetir a mesma etiqueta em campos diferentes.
    const nomes = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    for (const nome of nomes) {
      try {
        // SÓ etiqueta que já existe na empresa. A chave de captura vive no JS
        // público do site: criar tag de nome livre por aqui deixava qualquer
        // visitante poluir a base (reprise das 620 tags) e — pior — inventar
        // uma etiqueta que casa fluxo de nutrição real, fazendo o WhatsApp da
        // empresa disparar pro número que ele mesmo informou.
        const aplicou = await this.leads.aplicarTagExistentePorNome(
          empresaId,
          leadId,
          nome,
          'usuario',
        );
        if (!aplicou) {
          this.logger.warn(
            `Tag "${nome}" veio da captura pública mas NÃO existe na empresa ${empresaId} — ` +
              `ignorada (crie a etiqueta no CRM antes de usá-la no site).`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Falha aplicando tag "${nome}" no lead ${leadId} (empresa ${empresaId}): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Reenvio de formulário / lead que volta por OUTRA campanha (regra "preservar"
   * — é onde a atribuição costuma quebrar). ÚLTIMO toque SEMPRE sobrescreve; 1º
   * toque é IMUTÁVEL (só grava se as colunas ainda estão vazias). Não toca em mais
   * nada do lead (etapa, dono…). Best-effort: falha aqui não quebra o "duplicado".
   */
  private async aplicarAtribuicaoEmLeadExistente(
    leadId: string,
    atribuicao?: Atribuicao,
  ): Promise<void> {
    if (!atribuicao) return;
    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { utmCampaign: true, utmSource: true, utmMedium: true, variaveis: true },
      });
      if (!lead) return;

      const vars =
        lead.variaveis && typeof lead.variaveis === 'object' && !Array.isArray(lead.variaveis)
          ? { ...(lead.variaveis as Record<string, unknown>) }
          : {};
      const atrAtual = (vars.atribuicao ?? {}) as Atribuicao;

      // 1º toque vazio? (nenhuma coluna nem primeiro no JSON) → este vira o 1º toque.
      const semPrimeiroToque =
        !lead.utmCampaign && !lead.utmSource && !lead.utmMedium && !atrAtual.primeiro;
      const primeiro = semPrimeiroToque
        ? (atribuicao.primeiro ?? atrAtual.primeiro)
        : atrAtual.primeiro;
      // Último toque = o que veio agora (ou o primeiro, se só veio um bloco).
      const ultimo = atribuicao.ultimo ?? atribuicao.primeiro ?? atrAtual.ultimo;

      const novaAtrib: Atribuicao = {};
      if (primeiro) novaAtrib.primeiro = primeiro;
      if (ultimo) novaAtrib.ultimo = ultimo;
      vars.atribuicao = novaAtrib;

      const colunas = semPrimeiroToque ? colunasPrimeiroToque({ primeiro }) : null;
      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          variaveis: vars as Prisma.InputJsonValue,
          ...(colunas
            ? {
                utmSource: colunas.utmSource,
                utmMedium: colunas.utmMedium,
                utmCampaign: colunas.utmCampaign,
              }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`Falha ao atualizar atribuição do lead ${leadId}: ${String(err)}`);
    }
  }

  /**
   * Lista os funis (com etapas) do tenant da chave — pro dev do site descobrir
   * funilId/funilEtapaId programaticamente. Mesma auth (x-api-key) da captura.
   */
  async listarFunis(
    chaveApresentada: string | undefined,
  ): Promise<Array<{ id: string; nome: string; etapas: Array<{ id: string; nome: string }> }>> {
    const empresaId = await this.autenticarChave(chaveApresentada);
    return this.prisma.funil.findMany({
      where: { empresaId, ativo: true },
      orderBy: { ordem: 'asc' },
      select: {
        id: true,
        nome: true,
        etapas: { orderBy: { ordem: 'asc' }, select: { id: true, nome: true } },
      },
    });
  }

  // ─── internos ────────────────────────────────────────────────────────

  /**
   * Conserta acentuação quando o site envia o corpo em latin1/windows-1252 (não
   * UTF-8): aí "Integração" chega como "Integra��o". O body-parser já decodificou
   * (perdendo os acentos), MAS o corpo CRU (rawBody, preservado pro HMAC) ainda
   * tem os bytes originais — então re-decodificamos deles.
   *
   * Estratégia CORRETA: só re-decodifica quando o corpo CRU NÃO é UTF-8 VÁLIDO
   * (aí é latin1 de verdade). O `TextDecoder(fatal)` só lança quando há byte que
   * não forma sequência UTF-8 válida.
   *
   * ⚠️ NÃO usar "tem � no dto" como sinal (era o bug): um corpo UTF-8 válido pode
   * conter � LEGITIMAMENTE (quando o dado já veio corrompido da origem). Re-lê-lo
   * como latin1 nesse caso CORROMPE os acentos bons — "Formulário" (C3A1) virava
   * "FormulÃ¡rio", "·" virava "Â·". Confiar no UTF-8 válido preserva os literais.
   */
  private corrigirEncoding(dto: LeadCapturePublicoDto, rawBody?: Buffer): LeadCapturePublicoDto {
    if (!rawBody?.length) return dto;

    try {
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
      return dto; // corpo é UTF-8 válido → confia no parse do body-parser
    } catch {
      // não é UTF-8 válido → provável latin1/windows-1252 → re-decodifica dos bytes
      try {
        const corrigido = leadCapturePublicoSchema.parse(JSON.parse(rawBody.toString('latin1')));
        this.logger.warn(
          'Captura de lead: corpo não-UTF-8 (provável latin1) — acentos re-decodificados a partir do rawBody.',
        );
        return corrigido;
      } catch {
        return dto;
      }
    }
  }

  /**
   * Valida a chave x-api-key (formato + rate-limit + lookup) → empresaId.
   * 401 uniforme pra chave inexistente/inativa (sem oráculo de existência).
   */
  /**
   * Público porque o receptor de PEDIDOS do site usa a MESMA chave.
   *
   * Duas autenticações para o mesmo site significariam duas chaves pra girar, e
   * a que ninguém lembrasse de girar viraria a porta esquecida aberta.
   */
  async autenticarChave(chaveApresentada: string | undefined): Promise<string> {
    const chave = (chaveApresentada ?? '').trim();
    if (!chave.startsWith('blc_') || chave.length < 20) {
      throw new UnauthorizedException('Chave de API inválida');
    }
    if (!(await this.dentroDoLimite(chave))) {
      throw new AppException(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Muitas requisições',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const row = await this.prisma.leadCaptureChave.findUnique({
      where: { chaveHash: this.hash(chave) },
      select: { empresaId: true, ativo: true },
    });
    if (!row || !row.ativo) {
      throw new UnauthorizedException('Chave de API inválida');
    }
    return row.empresaId;
  }

  /**
   * Monta o JSON `Lead.variaveis` com os campos estruturados da captura (só os
   * enviados). Ficam legíveis nos fluxos como {{custom.<chave>}} e na tela do lead.
   */
  private montarVariaveis(
    dto: LeadCapturePublicoDto,
    atribuicao?: Atribuicao,
  ): Record<string, unknown> {
    const v: Record<string, unknown> = {};
    if (dto.origem?.trim()) v.origem = dto.origem.trim();
    if (dto.empresa?.trim()) v.empresa = dto.empresa.trim();
    if (dto.cargo?.trim()) v.cargo = dto.cargo.trim();
    if (dto.regiao?.trim()) v.regiao = dto.regiao.trim();
    if (dto.experiencia?.trim()) v.experiencia = dto.experiencia.trim();
    if (dto.paginaOrigem?.trim()) v.paginaOrigem = dto.paginaOrigem.trim();
    if (dto.consentimentoLgpd) v.consentimentoLgpd = dto.consentimentoLgpd;
    if (dto.metadados) v.metadados = dto.metadados;
    // Atribuição completa (1º toque não-indexado + ÚLTIMO toque inteiro) no JSON.
    // As colunas indexáveis do 1º toque vão à parte, em createPublico.
    if (atribuicao) v.atribuicao = atribuicao;
    return v;
  }

  /**
   * Lead ABERTO da empresa com o mesmo telefone (sufixo-8, D18 — NUNCA
   * `contains`: quebra com telefone formatado) ou mesmo e-mail.
   */
  private async acharLeadAberto(
    empresaId: string,
    telefone?: string,
    email?: string,
  ): Promise<string | null> {
    const digitos = (telefone ?? '').replace(/\D/g, '');
    if (digitos.length >= 8) {
      const sufixo = digitos.slice(-8);
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Lead"
        WHERE "empresaId" = ${empresaId}
          AND etapa NOT IN ('GANHO', 'PERDIDO')
          AND "contatoTelefone" IS NOT NULL
          AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${sufixo}
        ORDER BY "criadoEm" DESC
        LIMIT 1
      `;
      if (rows[0]) return rows[0].id;
    }
    if (email) {
      // SEM o filtro de etapa aqui (diferente do match por telefone): existe um
      // índice ÚNICO parcial por (empresa, lower(email)) no banco, que proíbe um
      // segundo lead com o mesmo e-mail INDEPENDENTE da etapa. Ignorando leads
      // GANHO/PERDIDO, a captura tentava criar o segundo, estourava P2002 e o
      // formulário do site devolvia 500 — o lead ia embora. Deduplicar por
      // e-mail em qualquer etapa só alinha o código com a constraint.
      const porEmail = await this.prisma.lead.findFirst({
        where: {
          empresaId,
          contatoEmail: { equals: email, mode: 'insensitive' },
        },
        orderBy: { criadoEm: 'desc' },
        select: { id: true },
      });
      if (porEmail) return porEmail.id;
    }
    return null;
  }

  /**
   * Rate-limit por chave: janela de 1min E teto DIÁRIO.
   *
   * AUDITORIA (média): o `catch { return true }` era fail-open puro. A chave de
   * captura vive no JS do site (qualquer visitante extrai), então com o Redis
   * oscilando dava pra martelar o endereço público SEM LIMITE NENHUM, aplicando
   * etiquetas que roteiam fluxos de nutrição reais. E mesmo com Redis de pé, 60
   * por minuto sustentados = 86 mil leads/dia, o que também não é limite.
   *
   * Agora: (a) contador DIÁRIO além do por-minuto; (b) o fail-open vira
   * fail-open COM TETO — em vez de liberar geral quando o Redis some, um
   * contador em memória do processo segura a rajada. Não é distribuído (cada
   * réplica tem o seu), mas transforma "ilimitado" em "limitado por réplica",
   * que é a diferença entre um incidente e um arranhão.
   */
  private async dentroDoLimite(chave: string): Promise<boolean> {
    const agora = Date.now();
    const bucket = Math.floor(agora / 60_000);
    const hash = this.hash(chave).slice(0, 16);
    try {
      const n = await this.redis.incr(`leadcap:rl:${hash}:${bucket}`);
      if (n === 1) await this.redis.client.expire(`leadcap:rl:${hash}:${bucket}`, 90);
      if (n > RL_MAX_POR_MIN) return false;

      const dia = new Date(agora).toISOString().slice(0, 10);
      const nd = await this.redis.incr(`leadcap:rl:dia:${hash}:${dia}`);
      if (nd === 1) await this.redis.client.expire(`leadcap:rl:dia:${hash}:${dia}`, 172_800);
      if (nd > RL_MAX_POR_DIA) {
        this.logger.warn(`Captura pública: teto DIÁRIO estourado (${nd}) pra chave ${hash}`);
        return false;
      }
      return true;
    } catch {
      // Redis fora: degrada pra um balde em memória, NÃO pra "pode tudo".
      const janela = this.rlMemoria.get(hash);
      if (!janela || janela.bucket !== bucket) {
        this.rlMemoria.set(hash, { bucket, n: 1 });
        // Evita crescer sem fim se muitas chaves distintas baterem.
        if (this.rlMemoria.size > 5_000) this.rlMemoria.clear();
        return true;
      }
      janela.n += 1;
      if (janela.n > RL_MAX_POR_MIN) {
        this.logger.warn(`Captura pública: Redis fora e limite em memória estourado (${hash})`);
        return false;
      }
      return true;
    }
  }

  /** Fallback do rate-limit quando o Redis está fora (por processo). */
  private readonly rlMemoria = new Map<string, { bucket: number; n: number }>();

  private hash(chave: string): string {
    return createHash('sha256').update(chave).digest('hex');
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Usuário sem empresa ativa',
        HttpStatus.BAD_REQUEST,
      );
    }
    return user.empresaIdAtiva;
  }
}
