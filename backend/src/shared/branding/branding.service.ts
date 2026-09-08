import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';

/** O que o app precisa saber pra se vestir com a marca de um tenant. */
export interface Branding {
  /** Nome por extenso — título de página, e-mail, PWA. */
  nome: string;
  /** Nome curto — aba do navegador e ícone do celular. */
  nomeCurto: string;
  /** Domínio próprio do tenant, sem esquema (ex.: `app.somatecblocking.com.br`). */
  dominio: string | null;
  /**
   * Logo pra fundo CLARO (a colorida). Barra lateral no tema claro, favicon,
   * ícone do atalho.
   */
  logoUrl: string | null;
  /**
   * Logo pra fundo ESCURO (a versão negativa/branca). Tela de login, tema
   * escuro, faixa do e-mail.
   *
   * ⚠️ Duas variantes porque UMA não serve às duas superfícies: a logo branca
   * sobre fundo branco carrega e **não aparece** — parece imagem quebrada, e foi
   * assim que apareceu na barra lateral. A colorida sobre o navy do login some
   * do mesmo jeito.
   */
  logoNegativoUrl: string | null;
  /**
   * ÍCONE — quadrado, só o símbolo, sem texto. Aba do navegador, atalho do
   * celular, manifest.
   *
   * Não é o logo reduzido: logo horizontal com o nome dentro fica ilegível em
   * 16px, e é isso que aparece na aba. São imagens com funções diferentes.
   */
  iconeUrl: string | null;
  /**
   * Nome do APP na aba e no atalho instalado.
   *
   * Separado do `nome` porque este identifica o PRODUTO pra quem já é usuário
   * ("APP Somatec Blocking"), enquanto o `nome` é a EMPRESA e aparece em e-mail
   * e texto de tela ("Bem-vindo ao Somatec Blocking"). Cravar o "APP" no nome
   * vazaria pra dentro dos e-mails.
   */
  tituloApp: string | null;
  /**
   * Site institucional do tenant — a porta de saída da tela de login.
   *
   * Vem da config e não do código: quem chega no app do representante sem ser
   * representante precisa de um caminho de volta, e esse caminho é DIFERENTE
   * por tenant. `null` = a tela não mostra o link (é o caso do produto, que não
   * tem site institucional ligado ao app).
   */
  siteUrl: string | null;
  cores: { primaria: string; secundaria: string; acao: string };
}

/**
 * Marca PADRÃO — o produto sem tenant vestido.
 *
 * Não é "a marca da Somatec com outro nome": é o Betinna, que continua existindo
 * pra qualquer empresa que não tenha branding próprio. Tenant sem configuração
 * cai aqui, e é isso que faz o white-label não virar rename.
 */
export const BRANDING_PADRAO: Branding = {
  nome: 'Betinna.ai',
  nomeCurto: 'Betinna',
  dominio: null,
  logoUrl: null,
  logoNegativoUrl: null,
  iconeUrl: null,
  tituloApp: null,
  siteUrl: null,
  cores: { primaria: '#201554', secundaria: '#2bcae5', acao: '#bd1fbf' },
};

/**
 * White-label POR TENANT.
 *
 * O Betinna é multi-tenant: a Somatec é UM tenant. Então isto nunca é trocar
 * "Betinna" por "Somatec" — é o produto vestir a marca de quem está acessando,
 * resolvida pelo DOMÍNIO. Dois tenants com domínios diferentes veem marcas
 * diferentes ao mesmo tempo, e um não sabe da existência do outro.
 *
 * Por isso a regra dura: **zero string de tenant no código**. Tudo sai de
 * `Empresa.config.branding`, e o que falta cai no `BRANDING_PADRAO`.
 */
@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Resolve a marca pelo HOST da requisição — é o que a tela de LOGIN usa.
   *
   * A marca precisa existir ANTES de haver usuário autenticado: sem isto, a
   * primeira tela que o representante vê é a do Betinna, e só depois de logar
   * viraria Somatec. Por isso a chave é o domínio, não o token.
   */
  async porHost(host: string | undefined): Promise<Branding> {
    const dominio = this.normalizarHost(host);
    if (!dominio) return BRANDING_PADRAO;
    try {
      // Compara já normalizado no banco: config gravada com "https://app.x/" ou
      // com maiúscula não pode deixar o tenant sem marca em silêncio.
      const linhas = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Empresa"
        WHERE ativo = true
          AND lower(regexp_replace(COALESCE(config #>> '{branding,dominio}', ''), '^https?://|/$', '', 'g')) = ${dominio}
        LIMIT 1`;
      const id = linhas[0]?.id;
      if (!id) return BRANDING_PADRAO;
      return this.doTenant(id);
    } catch (err) {
      // Falhar aqui deixaria o app sem marca nenhuma na tela de login. O padrão
      // é feio nesse caso, mas é uma tela que abre.
      this.logger.warn(`Branding por host falhou (${host}): ${String(err)}`);
      return BRANDING_PADRAO;
    }
  }

  /** Marca de um tenant conhecido — e-mails, links, notificações. */
  async doTenant(empresaId: string): Promise<Branding> {
    const empresa = await this.prisma.empresa
      .findUnique({ where: { id: empresaId }, select: { nome: true, config: true } })
      .catch(() => null);
    const cfg = ((empresa?.config as Record<string, unknown> | null)?.branding ?? {}) as {
      nome?: string;
      nomeCurto?: string;
      dominio?: string;
      logoUrl?: string;
      logoNegativoUrl?: string;
      iconeUrl?: string;
      tituloApp?: string;
      siteUrl?: string;
      cores?: { primaria?: string; secundaria?: string; acao?: string };
    };
    const nome = cfg.nome?.trim() || empresa?.nome?.trim() || BRANDING_PADRAO.nome;
    return {
      nome,
      nomeCurto: cfg.nomeCurto?.trim() || nome.split(' ')[0] || BRANDING_PADRAO.nomeCurto,
      dominio: this.normalizarHost(cfg.dominio) ?? null,
      logoUrl: cfg.logoUrl?.trim() || null,
      // Sem negativa configurada, a clara é usada nos dois — é o que existia
      // antes, e continua melhor que não mostrar logo nenhuma.
      logoNegativoUrl: cfg.logoNegativoUrl?.trim() || cfg.logoUrl?.trim() || null,
      iconeUrl: cfg.iconeUrl?.trim() || null,
      tituloApp: cfg.tituloApp?.trim() || null,
      siteUrl: cfg.siteUrl?.trim() || null,
      cores: {
        primaria: cfg.cores?.primaria || BRANDING_PADRAO.cores.primaria,
        secundaria: cfg.cores?.secundaria || BRANDING_PADRAO.cores.secundaria,
        acao: cfg.cores?.acao || BRANDING_PADRAO.cores.acao,
      },
    };
  }

  /**
   * Endereço do app PARA ESTE TENANT — a base de todo link que sai por e-mail.
   *
   * `FRONTEND_URL` é UMA só no ambiente. Com dois domínios no ar, o convite e o
   * "esqueci minha senha" do representante da Somatec sairiam apontando pro
   * domínio do outro — o link até abre, mas com a marca errada, e no caso do
   * Supabase pode nem estar na allowlist de redirect.
   */
  async urlDoApp(empresaId?: string): Promise<string> {
    const padrao = (this.env.get('FRONTEND_URL') || '').replace(/\/+$/, '');
    if (!empresaId) return padrao;
    const b = await this.doTenant(empresaId).catch(() => BRANDING_PADRAO);
    return b.dominio ? `https://${b.dominio}` : padrao;
  }

  /** minúsculas, sem esquema, sem porta, sem barra final, sem `www.`. */
  private normalizarHost(bruto: string | undefined | null): string | null {
    const v = (bruto ?? '').trim().toLowerCase();
    if (!v) return null;
    const semEsquema = v.replace(/^https?:\/\//, '');
    const semCaminho = semEsquema.split('/')[0] ?? '';
    const semPorta = semCaminho.split(':')[0] ?? '';
    const limpo = semPorta.replace(/^www\./, '');
    return limpo || null;
  }
}
