import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ShopeeClientService } from '@integrations/shopee/shopee-client.service';
import { MullerBotService } from '@modules/mullerbot/mullerbot.service';
import { VitrineFotosService } from '@modules/vitrine/vitrine-fotos.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  PROMPT_TRIAGEM,
  SCHEMA_TRIAGEM,
  candidata,
  chaveModelo,
  coresDaVariacao,
  lerTriagem,
  modeloDoAnuncio,
} from './avaliacoes';

/** Teto de avaliações NOVAS por rodada (custo da IA e das fotos). */
const NOVAS_POR_RODADA = 30;
const FOTOS_POR_AVALIACAO = 3;
const MAX_ITENS = 500;

interface ComentarioShopee {
  comment_id: number;
  comment?: string;
  buyer_username?: string;
  rating_star?: number;
  model_id_list?: number[];
  hidden?: boolean;
  media?: { image_url_list?: string[] };
}

/**
 * Avaliações da Shopee na vitrine (Léo, 23–25/10; card cmvleo3tv). Importa as
 * de 5 estrelas COM foto, das cores que o site tem, com texto limpo; copia as
 * fotos pro nosso bucket (webp) e a IA olha a 1ª foto (embalagem/logo = fora).
 * Só APROVADA aparece no site. O Léo revisa na tela (vale a palavra dele).
 */
@Injectable()
export class AvaliacoesService {
  private readonly logger = new Logger(AvaliacoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fotos: VitrineFotosService,
    @Optional() private readonly shopee?: ShopeeClientService,
    @Optional() private readonly bot?: MullerBotService,
  ) {}

  private empresa(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin revisa as avaliações');
    }
    return user.empresaIdAtiva;
  }

  // ─── Importação ─────────────────────────────────────────────────────────

  async importarShopee(empresaId: string): Promise<{ novas: number; aprovadas: number }> {
    if (!this.shopee) return { novas: 0, aprovadas: 0 };
    const modelos = await this.prisma.catalogoModelo.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, cores: { select: { cor: { select: { nome: true } } } } },
    });
    const porChave = new Map(modelos.map((m) => [chaveModelo(m.nome), m]));
    const itens = await this.anuncios(empresaId);
    const existentes = await this.prisma.avaliacaoVitrine.findMany({
      where: { empresaId, origem: 'shopee' },
      select: { id: true, externoId: true, autor: true },
    });
    const ja = new Set(existentes.map((a) => a.externoId));
    // Antigas sem nome (antes de 26/10) ganham o nome na próxima passada.
    const semAutor = new Map(existentes.filter((a) => !a.autor).map((a) => [a.externoId, a.id]));
    let novas = 0;
    let aprovadas = 0;
    for (const item of itens) {
      if (novas >= NOVAS_POR_RODADA) break;
      const alvo = modeloDoAnuncio(item.nome);
      const modelo = alvo ? porChave.get(chaveModelo(alvo)) : undefined;
      if (!modelo) continue;
      const coresModelo = modelo.cores.map((c) => c.cor.nome);
      const variacoes = await this.variacoes(empresaId, item.id).catch(
        () => new Map<number, string>(),
      );
      for (const c of await this.comentarios(empresaId, item.id)) {
        if (novas >= NOVAS_POR_RODADA) break;
        const externoId = String(c.comment_id);
        const idSemAutor = semAutor.get(externoId);
        if (idSemAutor && c.buyer_username) {
          await this.prisma.avaliacaoVitrine
            .update({ where: { id: idSemAutor }, data: { autor: c.buyer_username.slice(0, 80) } })
            .catch(() => undefined);
          semAutor.delete(externoId);
        }
        if (ja.has(externoId)) continue;
        const urls = c.media?.image_url_list ?? [];
        if (
          !candidata({
            estrelas: c.rating_star ?? 0,
            texto: c.comment,
            fotos: urls,
            oculta: c.hidden,
          })
        )
          continue;
        const corTexto = variacoes.get(c.model_id_list?.[0] ?? -1);
        const cores = corTexto ? coresDaVariacao(corTexto, coresModelo) : null;
        if (!cores) continue;
        ja.add(externoId);
        const r = await this.gravar(empresaId, modelo.id, externoId, c, cores, urls).catch(
          (err) => {
            this.logger.warn(`[avaliações] ${externoId} não gravou: ${String(err)}`);
            return null;
          },
        );
        if (!r) continue;
        novas++;
        if (r === 'APROVADA') aprovadas++;
      }
    }
    return { novas, aprovadas };
  }

  /** Copia as fotos (webp), a IA olha a 1ª, grava com o veredito. */
  private async gravar(
    empresaId: string,
    modeloId: string,
    externoId: string,
    c: ComentarioShopee,
    cores: string[],
    urls: string[],
  ): Promise<string> {
    const sharp = await carregarSharp();
    if (!sharp) throw new Error('sem sharp no servidor');
    const paths: string[] = [];
    let primeira: Buffer | null = null;
    for (const [i, url] of urls.slice(0, FOTOS_POR_AVALIACAO).entries()) {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) continue;
      const webp = await sharp(Buffer.from(await r.arrayBuffer()))
        .rotate()
        .resize({ width: 1080, height: 1440, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const path = `${empresaId}/avaliacoes/${externoId}_${i}.webp`;
      await this.fotos.subirWebp(path, webp);
      paths.push(path);
      primeira ??= webp;
    }
    if (!paths.length || !primeira) throw new Error('nenhuma foto baixou');
    const v = await this.triar(empresaId, primeira);
    await this.prisma.avaliacaoVitrine.create({
      data: {
        empresaId,
        modeloId,
        origem: 'shopee',
        externoId,
        estrelas: c.rating_star ?? 5,
        texto: (c.comment ?? '').trim().slice(0, 2000),
        autor: c.buyer_username?.slice(0, 80) ?? null,
        cores,
        fotos: paths,
        status: v.aprovar ? 'APROVADA' : 'RECUSADA',
        motivo: v.motivo || null,
        avaliadaEm: new Date(),
      },
    });
    return v.aprovar ? 'APROVADA' : 'RECUSADA';
  }

  private async triar(
    empresaId: string,
    foto: Buffer,
  ): Promise<{ aprovar: boolean; motivo: string }> {
    if (!this.bot) return { aprovar: false, motivo: 'IA indisponível' };
    try {
      const r = await this.bot.gerarRespostaIa(
        empresaId,
        PROMPT_TRIAGEM,
        'Avalie a foto.',
        [],
        `data:image/webp;base64,${foto.toString('base64')}`,
        { responseFormat: SCHEMA_TRIAGEM },
      );
      return lerTriagem(r.texto);
    } catch (err) {
      return { aprovar: false, motivo: `IA falhou: ${String(err).slice(0, 120)}` };
    }
  }

  private async anuncios(empresaId: string): Promise<Array<{ id: number; nome: string }>> {
    const ids: number[] = [];
    for (let offset = 0; offset < MAX_ITENS; offset += 100) {
      const r = await this.shopee!.getShop<{
        response?: { item?: Array<{ item_id: number }>; has_next_page?: boolean };
      }>(empresaId, '/api/v2/product/get_item_list', {
        offset,
        page_size: 100,
        item_status: 'NORMAL',
      });
      ids.push(...(r.response?.item ?? []).map((i) => i.item_id));
      if (!r.response?.has_next_page) break;
    }
    const out: Array<{ id: number; nome: string }> = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.shopee!.getShop<{
        response?: { item_list?: Array<{ item_id: number; item_name: string }> };
      }>(empresaId, '/api/v2/product/get_item_base_info', {
        item_id_list: ids.slice(i, i + 50).join(','),
      });
      out.push(...(r.response?.item_list ?? []).map((x) => ({ id: x.item_id, nome: x.item_name })));
    }
    return out;
  }

  /** model_id → texto da cor (o tier que se chama "cor"; senão o 1º). */
  private async variacoes(empresaId: string, itemId: number): Promise<Map<number, string>> {
    const r = await this.shopee!.getShop<{
      response?: {
        tier_variation?: Array<{ name?: string; option_list?: Array<{ option?: string }> }>;
        model?: Array<{ model_id: number; tier_index?: number[] }>;
      };
    }>(empresaId, '/api/v2/product/get_model_list', { item_id: itemId });
    const tiers = r.response?.tier_variation ?? [];
    let idx = tiers.findIndex((t) => /cor|color|colour/i.test(t.name ?? ''));
    if (idx < 0) idx = 0;
    const m = new Map<number, string>();
    for (const mo of r.response?.model ?? []) {
      const op = tiers[idx]?.option_list?.[mo.tier_index?.[idx] ?? -1]?.option;
      if (op) m.set(mo.model_id, op);
    }
    return m;
  }

  private async comentarios(empresaId: string, itemId: number): Promise<ComentarioShopee[]> {
    const out: ComentarioShopee[] = [];
    let cursor = '';
    for (let pag = 0; pag < 5; pag++) {
      const r = await this.shopee!.getShop<{
        response?: { item_comment_list?: ComentarioShopee[]; more?: boolean; next_cursor?: string };
      }>(empresaId, '/api/v2/product/get_comment', {
        item_id: itemId,
        cursor,
        page_size: 100,
      }).catch(() => null);
      out.push(...(r?.response?.item_comment_list ?? []));
      if (!r?.response?.more || !r.response.next_cursor) break;
      cursor = r.response.next_cursor;
    }
    return out;
  }

  // ─── Tela de revisão ────────────────────────────────────────────────────

  async listar(user: AuthenticatedUser, status?: string) {
    const empresaId = this.empresa(user);
    const rows = await this.prisma.avaliacaoVitrine.findMany({
      where: { empresaId, ...(status ? { status } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });
    const modelos = new Map(
      (
        await this.prisma.catalogoModelo.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.modeloId))] } },
          select: { id: true, nome: true },
        })
      ).map((m) => [m.id, m.nome]),
    );
    const contagem = await this.prisma.avaliacaoVitrine.groupBy({
      by: ['status'],
      where: { empresaId },
      _count: { _all: true },
    });
    return {
      data: rows.map((r) => ({
        ...r,
        modelo: modelos.get(r.modeloId) ?? '?',
        fotos: r.fotos.map((p) => this.fotos.urlPublica(p)),
      })),
      contagem: Object.fromEntries(contagem.map((c) => [c.status, c._count._all])),
    };
  }

  async decidir(user: AuthenticatedUser, id: string, status: 'APROVADA' | 'RECUSADA') {
    const empresaId = this.empresa(user);
    const a = await this.prisma.avaliacaoVitrine.findFirst({ where: { id, empresaId } });
    if (!a) throw new NotFoundException('Avaliação não encontrada');
    return this.prisma.avaliacaoVitrine.update({
      where: { id },
      data: {
        status,
        revisada: true,
        motivo: status === 'APROVADA' ? null : (a.motivo ?? 'recusada na revisão'),
      },
    });
  }

  async importarAgora(user: AuthenticatedUser) {
    return this.importarShopee(this.empresa(user));
  }
}

type SharpFn = (input: Buffer) => {
  rotate: () => ReturnType<SharpFn>;
  resize: (o: Record<string, unknown>) => ReturnType<SharpFn>;
  webp: (o: Record<string, unknown>) => ReturnType<SharpFn>;
  toBuffer: () => Promise<Buffer>;
};

/** sharp vem com o Baileys; sem ele, a importação não roda (não derruba nada). */
async function carregarSharp(): Promise<SharpFn | null> {
  try {
    const mod = (await import('sharp')) as unknown as { default?: SharpFn } & SharpFn;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}
