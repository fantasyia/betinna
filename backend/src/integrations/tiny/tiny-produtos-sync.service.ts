import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { TinyClientService } from './tiny-client.service';

interface ProdutoTiny {
  id: number;
  sku?: string;
  descricao?: string;
  /**
   * Texto livre do cadastro ("o que é / pra que serve"). Só vem no
   * `GET /produtos/{id}` — a LISTAGEM não traz. É o campo que o Léo pediu pra
   * ser a fonte da descrição que chega ao cliente (catálogo PDF e proposta).
   */
  descricaoComplementar?: string;
  situacao?: string;
  unidade?: string;
  dataAlteracao?: string;
  precos?: { preco?: number; precoCusto?: number };
}

interface EstoqueTiny {
  id: number;
  saldo?: number;
  disponivel?: number;
}

export interface ResultadoSync {
  lidos: number;
  criados: number;
  atualizados: number;
  estoqueAtualizado: number;
  erros: number;
  /**
   * Produto lido cuja imagem NÃO pôde ser conferida (rate limit, 5xx). Fica
   * separado de `erros` porque o produto entrou inteiro — só a foto ficou pra
   * trás. Mas precisa aparecer: já aconteceu de o sync dizer "0 erros" com
   * imagem velha no app, e ninguém tem como desconfiar disso.
   */
  imagensFalharam: number;
}

const PAGINA = 100;

/**
 * Nome da lista de preços do ERP que carrega a mensalidade de locação.
 *
 * O rep loca e não vê preço de venda, então esta lista não é um detalhe de
 * catálogo: é o ÚNICO número que aparece pra ele.
 */
const LISTA_LOCACAO = 'loca';

/**
 * Traz o catálogo do Tiny PRA CÁ — o sentido normal do dia a dia.
 *
 * A importação (`TinyProdutosService`) foi o bootstrap: a conta do ERP nasceu
 * vazia e alguém tinha que popular. Daqui em diante o Tiny é a fonte da verdade
 * (preço, custo, estoque, situação) e o app espelha.
 *
 * **Incremental por `dataAlteracao`**, igual ao que o ERP fazia (D21c): o sync
 * diário não re-baixa catálogo inteiro, só o que mudou desde o último. O modo
 * completo existe pra quando alguém precisa forçar.
 *
 * **O custo agora é REAL.** O `precoFabrica` deixou de ser o chute de 70% que
 * vinha do ERP: `precos.precoCusto` chega na API. Quando o Tiny não tem custo
 * cadastrado, fica `null` — "não informado" é uma resposta honesta; 70% do
 * preço de tabela não era.
 */
@Injectable()
export class TinyProdutosSyncService {
  private readonly logger = new Logger(TinyProdutosSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TinyClientService,
    private readonly integracoes: IntegracoesService,
  ) {}

  async sync(
    empresaId: string,
    opcoes: { modo?: 'incremental' | 'completo'; comEstoque?: boolean } = {},
  ): Promise<ResultadoSync> {
    const modo = opcoes.modo ?? 'incremental';
    // Carimbo do INÍCIO, não do fim: produto alterado no ERP enquanto o sync
    // roda cairia entre o cutoff e o carimbo final, e a próxima rodada
    // incremental o pularia — perda silenciosa. Com o início há um pequeno
    // overlap reprocessado, que é idempotente. (Regra já documentada no
    // registrarSyncOk.)
    const inicio = new Date();
    const desde = modo === 'incremental' ? await this.ultimoSync(empresaId) : null;
    const r: ResultadoSync = {
      lidos: 0,
      criados: 0,
      atualizados: 0,
      estoqueAtualizado: 0,
      erros: 0,
      imagensFalharam: 0,
    };

    // Preço de locação vem de uma LISTA de preços, não do cadastro do produto —
    // é assim que o Tiny modela "mesmo produto, outro preço".
    const locacao = await this.precosDeLocacao(empresaId);

    let offset = 0;
    for (;;) {
      const pagina = await this.client.get<{
        itens?: ProdutoTiny[];
        paginacao?: { total: number };
      }>(empresaId, '/produtos', {
        situacao: 'A',
        limit: PAGINA,
        offset,
        // Formato do Tiny: 'YYYY-MM-DD HH:mm:ss'.
        ...(desde ? { dataAlteracao: this.formatarData(desde) } : {}),
      });
      const itens = pagina.itens ?? [];
      if (itens.length === 0) break;
      r.lidos += itens.length;

      for (const p of itens) {
        try {
          // A listagem não traz a descrição; é uma chamada a mais por produto
          // (mesmo padrão do estoque). Sem ela o app espelhava o ERP sem o
          // texto que explica o produto — e o cliente recebia só o nome.
          const descricao = await this.descricaoDoErp(empresaId, p);
          const novo = await this.upsert(empresaId, p, locacao.get(p.id) ?? null, descricao);
          if (novo) r.criados += 1;
          else r.atualizados += 1;
          if (opcoes.comEstoque !== false) {
            if (await this.sincronizarEstoque(empresaId, p)) r.estoqueAtualizado += 1;
          }
          if (!(await this.sincronizarImagem(empresaId, p))) r.imagensFalharam += 1;
        } catch (err) {
          // Produto que falha não interrompe o catálogo: um SKU problemático não
          // pode deixar os outros 300 desatualizados.
          r.erros += 1;
          this.logger.warn(
            `[tiny] sync do produto ${p.sku ?? p.id} falhou: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      offset += PAGINA;
      if (itens.length < PAGINA) break;
    }

    // Só marca o relógio quando a rodada inteira passou: marcar no meio faria a
    // próxima rodada pular o que ficou pra trás — e a falta seria silenciosa.
    if (r.erros === 0) {
      await this.integracoes.registrarSyncOk(empresaId, 'tiny', inicio).catch(() => undefined);
    }

    this.logger.log(
      `[tiny] sync de produtos (${modo}): ${r.lidos} lidos, ${r.criados} criados, ` +
        `${r.atualizados} atualizados, ${r.estoqueAtualizado} com estoque, ${r.erros} erros` +
        (r.imagensFalharam ? `, ${r.imagensFalharam} imagem(ns) não conferida(s)` : ''),
    );
    return r;
  }

  /**
   * Sincroniza UM produto, pelo id do ERP — o caminho do webhook de estoque.
   *
   * Reconsulta em vez de acreditar no `saldo` que veio no evento: o payload do
   * Tiny não é assinado, e o número que interessa é o `disponivel` (saldo menos
   * reservado), que o evento nem manda.
   */
  async sincronizarUm(empresaId: string, idProduto: number): Promise<boolean> {
    const p = await this.client
      .get<ProdutoTiny>(empresaId, `/produtos/${idProduto}`)
      .catch(() => null);
    if (!p?.id) return false;
    const locacao = await this.precosDeLocacao(empresaId);
    await this.upsert(empresaId, p, locacao.get(p.id) ?? null);
    await this.sincronizarEstoque(empresaId, p);
    await this.sincronizarImagem(empresaId, p);
    return true;
  }

  /**
   * Lê as listas de preços de LOCAÇÃO do ERP → mapa idProdutoTiny → mensalidade.
   *
   * ⚠️ TODAS as listas que casam, não a primeira. Passou a existir mais de uma
   * família com mensalidade própria (Padrão e + Data Sense, 02/09), e cada
   * produto aparece em exatamente uma delas. Lendo só a primeira, metade do
   * catálogo ficaria sem mensalidade — e preço de locação vazio não parece bug,
   * parece "ainda não cadastraram".
   *
   * Falha aqui NÃO derruba o sync: catálogo desatualizado é ruim, catálogo
   * ausente é pior. O produto entra sem locação e a tela mostra "—".
   */
  private async precosDeLocacao(empresaId: string): Promise<Map<number, number>> {
    const mapa = new Map<number, number>();
    try {
      const listas = await this.client.get<{
        itens?: Array<{ id: number; descricao?: string }>;
      }>(empresaId, '/listas-precos', { limit: 100 });
      const alvos = (listas.itens ?? []).filter((l) => {
        const d = (l.descricao ?? '').toLowerCase();
        // PLACEHOLDER fica de fora: a API do Tiny não deixa APAGAR lista de
        // preço, então a de teste (MB-01 a R$ 300) convive com as reais. Sem
        // este filtro ela concorreria com o preço verdadeiro.
        return d.includes(LISTA_LOCACAO) && !d.includes('placeholder');
      });
      if (!alvos.length) return mapa;
      // ⚠️ O detalhe da lista devolve os produtos em `excecoes`, NÃO em `itens`
      // (é o terceiro formato diferente na mesma API: anexos vêm em array
      // direto, listagens em `itens`, e a lista de preços em `excecoes`). Ler a
      // chave errada dava mapa vazio, e preço de locação vazio não parece bug —
      // parece "ainda não cadastraram".
      for (const alvo of alvos) {
        const detalhe = await this.client.get<{
          excecoes?: Array<{ idProduto?: number; preco?: number }>;
          itens?: Array<{ idProduto?: number; preco?: number }>;
        }>(empresaId, `/listas-precos/${alvo.id}`);
        const linhas = detalhe.excecoes ?? detalhe.itens ?? [];
        let dessa = 0;
        for (const i of linhas) {
          if (i.idProduto && typeof i.preco === 'number') {
            mapa.set(i.idProduto, i.preco);
            dessa += 1;
          }
        }
        this.logger.log(`[tiny] lista de locação "${alvo.descricao}": ${dessa} preço(s)`);
      }
    } catch (err) {
      this.logger.warn(
        `[tiny] não consegui ler a lista de locação: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return mapa;
  }

  /** Devolve `true` quando o produto foi CRIADO (era novo por aqui). */
  private async upsert(
    empresaId: string,
    p: ProdutoTiny,
    precoLocacao: number | null,
    /** `undefined` = não conseguimos ler no ERP → não toca no que já está gravado. */
    descricao?: string | null,
  ): Promise<boolean> {
    const codigoErp = String(p.id);
    const existente = await this.prisma.produto.findFirst({
      // Casa pelo id do ERP e, na falta dele, pelo SKU — é o caso do produto que
      // nasceu aqui antes da integração e ainda não tem o vínculo.
      where: { empresaId, OR: [{ codigoErp }, ...(p.sku ? [{ sku: p.sku }] : [])] },
      select: { id: true },
    });

    const dados = {
      codigoErp,
      sku: p.sku ?? null,
      nome: p.descricao ?? p.sku ?? `Produto ${p.id}`,
      unidade: p.unidade ?? null,
      precoTabela: new Prisma.Decimal(p.precos?.preco ?? 0),
      // Custo REAL do ERP. Sem custo lá, fica null — "não informado" é honesto;
      // o chute de 70% do ERP não era.
      precoFabrica:
        typeof p.precos?.precoCusto === 'number' && p.precos.precoCusto > 0
          ? new Prisma.Decimal(p.precos.precoCusto)
          : null,
      ativo: (p.situacao ?? 'A') === 'A',
      // Null quando o produto não está na lista de locação. NÃO cai pro preço de
      // venda: o rep veria o número errado sem ninguém perceber.
      precoLocacaoMensal: precoLocacao != null ? new Prisma.Decimal(precoLocacao) : null,
      // ERP é a fonte: texto de lá substitui o de cá, inclusive apagando (null)
      // quando o campo foi esvaziado no Tiny. Só preserva o atual se a leitura
      // FALHOU — aí não sabemos, e apagar seria inventar.
      ...(descricao !== undefined ? { descricao } : {}),
    };

    if (existente) {
      await this.prisma.produto.update({ where: { id: existente.id }, data: dados });
      return false;
    }
    await this.prisma.produto.create({ data: { ...dados, empresaId } });
    return true;
  }

  /**
   * Estoque é chamada SEPARADA por produto no Tiny (`GET /estoque/{id}`) — não
   * vem na listagem. Com catálogo pequeno isso é trivial; se um tenant passar
   * de algumas centenas de SKUs, vale trocar pelo endpoint de atualizações em
   * lote da API v2 antes de estourar o rate limit.
   */
  private async sincronizarEstoque(empresaId: string, p: ProdutoTiny): Promise<boolean> {
    const e = await this.comRetry429(() =>
      this.client.get<EstoqueTiny>(empresaId, `/estoque/${p.id}`),
    ).catch(() => null);
    if (!e) return false;
    // `disponivel` (saldo − reservado) é o que o rep pode prometer; `saldo` cru
    // incluiria peça já comprometida com outro pedido.
    const disponivel = Math.trunc(e.disponivel ?? e.saldo ?? 0);
    const { count } = await this.prisma.produto.updateMany({
      where: { empresaId, codigoErp: String(p.id) },
      data: { estoque: disponivel, estoqueAtualizadoEm: new Date() },
    });
    return count > 0;
  }

  /**
   * Traz a imagem do produto do ERP pro app.
   *
   * Imagem não vem na listagem — é um recurso à parte (`/produtos/{id}/anexos`),
   * igual ao estoque. Guardamos a URL, não o arquivo: o Tiny já hospeda, e
   * duplicar binário aqui só criaria uma segunda cópia pra ficar desatualizada.
   *
   * Best-effort: produto sem imagem é produto normal. Falhar aqui não pode
   * impedir preço e estoque de entrarem.
   */
  private async sincronizarImagem(empresaId: string, p: ProdutoTiny): Promise<boolean> {
    try {
      // ⚠️ Este endpoint devolve ARRAY DIRETO, não `{ itens: [...] }` como o
      // resto da API. Ler `.itens` aqui dava vazio sempre — e "sem imagem" não
      // parece erro, parece produto sem foto. Aceita as duas formas pra não
      // depender de qual deles o Tiny resolve usar amanhã.
      const resp = await this.comRetry429(() =>
        this.client.get<Array<{ url?: string }> | { itens?: Array<{ url?: string }> }>(
          empresaId,
          `/produtos/${p.id}/anexos`,
        ),
      );
      const lista = Array.isArray(resp) ? resp : (resp?.itens ?? []);
      // A ÚLTIMA, não a primeira: a API do Tiny não deleta anexo (só o painel,
      // na mão), então trocar a imagem de um produto é EMPILHAR uma nova. Pegar
      // a primeira prenderia o app na imagem mais velha pra sempre.
      const url = [...lista].reverse().find((a) => a.url)?.url ?? null;
      // Sem anexo o produto fica SEM imagem — inclusive apagando a que estava
      // lá. Manter a antiga deixaria o app mostrando uma URL que o ERP já não
      // tem, e ninguém teria como remover imagem pelo ERP.
      await this.prisma.produto.updateMany({
        where: { empresaId, codigoErp: String(p.id) },
        data: { imagem: url },
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `[tiny] imagem de ${p.sku ?? p.id} não veio: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * 429 é "agora não", não "não". Sem isso, uma rajada de rate limit fazia o
   * sync pular estoque e imagem EM SILÊNCIO e ainda relatar "0 erros".
   */
  /**
   * `descricaoComplementar` do cadastro. Texto vazio vira `null` (o app mostra
   * nada, não "—" fantasma). Falha de rede/429 esgotado devolve `undefined`:
   * o chamador mantém o que já tinha em vez de apagar.
   */
  private async descricaoDoErp(
    empresaId: string,
    p: ProdutoTiny,
  ): Promise<string | null | undefined> {
    try {
      const d = await this.comRetry429(() =>
        this.client.get<ProdutoTiny>(empresaId, `/produtos/${p.id}`),
      );
      const texto = (d?.descricaoComplementar ?? '').trim();
      return texto.length > 0 ? texto : null;
    } catch (err) {
      this.logger.warn(
        `[tiny] descrição do produto ${p.sku ?? p.id} não lida (mantida a atual): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  private async comRetry429<T>(fn: () => Promise<T>): Promise<T> {
    for (let tentativa = 0; ; tentativa++) {
      try {
        return await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/HTTP 429/.test(msg) || tentativa >= 2) throw err;
        await new Promise((r) => setTimeout(r, 3000 * (tentativa + 1)));
      }
    }
  }

  private async ultimoSync(empresaId: string): Promise<Date | null> {
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { empresaId, servico: 'tiny' },
      select: { ultimoSync: true },
    });
    return conn?.ultimoSync ?? null;
  }

  private formatarData(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
}
