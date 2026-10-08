import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { MelhorEnvioClient } from '@integrations/melhorenvio/melhorenvio.client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  FreteRegraError,
  SUGESTAO_FRETE,
  configFrete,
  faltandoNoFrete,
  montarVolumes,
  retiradaLiberada,
  somarCotacoes,
  soDigitos,
  type AmbienteFrete,
  type ConfigFrete,
  type OpcaoCotada,
  type OpcaoFrete,
  type Volume,
} from './frete';
import type { FreteConfigDto } from './vitrine.dto';

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/** Credenciais da conexão `melhorenvio` (cifradas em IntegracaoConexao). */
interface CredMelhorEnvio {
  token?: string;
  email?: string;
}

export interface Cotacao {
  volumes: Array<Pick<Volume, 'embalagem' | 'pecas'> & { pesoKg: number }>;
  opcoes: Array<{
    id: number;
    nome: string;
    transportadora: string;
    preco: number;
    prazoDias: number | null;
  }>;
  /** Retirada em mãos (R$ 0) — só a partir do mínimo de peças. */
  retirada: { endereco: string; horario: string } | null;
}

/** Cotação que não deu: o pedido segue com "frete a combinar". */
export class FreteIndisponivel extends Error {}

const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;

/**
 * Frete da vitrine pelo Melhor Envio (Checkout, itens 5–5e).
 *
 * Config em `Empresa.config.frete` (sem segredo); o token fica na conexão
 * `melhorenvio` (Integrações, cifrada). A cotação do PEDIDO é refeita no
 * servidor — o preço que a tela mostrou nunca é aceito de volta.
 */
@Injectable()
export class FreteService {
  private readonly logger = new Logger(FreteService.name);
  /** Cotação por volume, 10 min: a tela cota, o pedido cota de novo logo depois. */
  private readonly cache = new Map<string, { em: number; opcoes: OpcaoCotada[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
  ) {}

  /** Injetável nos testes. */
  protected cliente(token: string, ambiente: AmbienteFrete, email: string): MelhorEnvioClient {
    return new MelhorEnvioClient(token, ambiente, email);
  }

  private empresaDo(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw regra('Empresa não definida');
    return id;
  }

  async configDaEmpresa(empresaId: string): Promise<ConfigFrete> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return configFrete(e?.config);
  }

  private async credenciais(empresaId: string): Promise<CredMelhorEnvio | null> {
    try {
      const c = await this.integracoes.obterCredenciaisInternas(empresaId, 'melhorenvio');
      return c.credenciais as CredMelhorEnvio;
    } catch {
      return null; // não conectado (ou desativado)
    }
  }

  // ─── Tela de configuração ────────────────────────────────────────────────

  async status(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    const [cfg, cred] = await Promise.all([
      this.configDaEmpresa(empresaId),
      this.credenciais(empresaId),
    ]);
    return {
      conectado: !!cred?.token,
      config: cfg,
      sugestao: SUGESTAO_FRETE,
      falta: faltandoNoFrete(cfg),
    };
  }

  async salvar(user: AuthenticatedUser, dto: FreteConfigDto) {
    const empresaId = this.empresaDo(user);
    if (dto.ativo) {
      const falta = faltandoNoFrete(dto);
      if (falta.length) throw regra(`Pra ligar o frete, falta: ${falta.join(', ')}`);
      if (!(await this.credenciais(empresaId))?.token) {
        throw regra('Conecte o Melhor Envio em Integrações antes de ligar o frete');
      }
    }
    // jsonb_set atômico: só a seção `frete`, sem ler-modificar-escrever a config.
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{frete}', ${JSON.stringify(dto)}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    this.cache.clear();
    this.logger.log(`[frete] config salva na empresa ${empresaId} (ativo=${dto.ativo})`);
    return this.status(user);
  }

  /** N peças de X gramas pra um CEP — pra conferir caixas e preços antes de ligar. */
  async simular(
    user: AuthenticatedUser,
    dto: { cep: string; pecas: number; pesoG: number; valor: number },
  ): Promise<Cotacao> {
    const empresaId = this.empresaDo(user);
    const cfg = await this.configDaEmpresa(empresaId);
    try {
      return await this.cotarPesos(
        empresaId,
        cfg,
        dto.cep,
        Array.from({ length: dto.pecas }, () => dto.pesoG),
        dto.valor,
      );
    } catch (err) {
      if (err instanceof FreteIndisponivel) throw regra(err.message);
      throw err;
    }
  }

  // ─── Cotação ─────────────────────────────────────────────────────────────

  /**
   * Cota um carrinho já resolvido em peças (peso de cada peça em gramas) e
   * valor das peças. Lança `FreteIndisponivel` quando não dá pra cotar (config
   * incompleta, peso faltando, Melhor Envio fora ou sem serviço pro CEP).
   */
  async cotarPesos(
    empresaId: string,
    cfg: ConfigFrete,
    cepDestino: string,
    pesosG: number[],
    valor: number,
  ): Promise<Cotacao> {
    const cep = soDigitos(cepDestino);
    if (cep.length !== 8) throw new FreteIndisponivel('CEP inválido');
    const falta = faltandoNoFrete(cfg);
    if (falta.length) throw new FreteIndisponivel(`Frete sem configuração: ${falta.join(', ')}`);
    const cred = await this.credenciais(empresaId);
    if (!cred?.token) throw new FreteIndisponivel('Melhor Envio não conectado');

    let volumes: Volume[];
    try {
      volumes = montarVolumes(pesosG, cfg);
    } catch (err) {
      if (err instanceof FreteRegraError) throw new FreteIndisponivel(err.message);
      throw err;
    }
    const totalPecas = pesosG.length;
    const declarar = cfg.declararValor !== false;
    const me = this.cliente(cred.token, cfg.ambiente ?? 'producao', cred.email ?? '');

    // Volumes iguais (mesma caixa, mesmo peso e mesmas peças) cotam uma vez só.
    const porVolume: OpcaoCotada[][] = [];
    const memo = new Map<string, OpcaoCotada[]>();
    for (const v of volumes) {
      const seguro = declarar && totalPecas ? (valor * v.pecas) / totalPecas : 0;
      const chave = [
        empresaId,
        cfg.ambiente,
        cfg.cepOrigem,
        cep,
        v.comprimentoCm,
        v.larguraCm,
        v.alturaCm,
        v.pesoG,
        Math.round(seguro * 100),
      ].join('|');
      let opcoes = memo.get(chave) ?? this.doCache(chave);
      if (!opcoes) {
        try {
          opcoes = await me.cotar(cfg.cepOrigem as string, cep, { ...v, seguro });
        } catch (err) {
          this.logger.warn(`[frete] cotação falhou (empresa ${empresaId}): ${String(err)}`);
          throw new FreteIndisponivel('Não conseguimos calcular o frete agora');
        }
        this.guardar(chave, opcoes);
      }
      memo.set(chave, opcoes);
      porVolume.push(opcoes);
    }
    const opcoes: OpcaoFrete[] = somarCotacoes(porVolume);
    const retirada = retiradaLiberada(cfg, totalPecas)
      ? { endereco: cfg.retirada?.endereco ?? '', horario: cfg.retirada?.horario ?? '' }
      : null;
    if (opcoes.length === 0 && !retirada) {
      throw new FreteIndisponivel('Nenhuma transportadora atende esse CEP com esses volumes');
    }
    return {
      volumes: volumes.map((v) => ({
        embalagem: v.embalagem,
        pecas: v.pecas,
        pesoKg: Math.round(v.pesoG / 10) / 100,
      })),
      opcoes: opcoes.map((o) => ({
        id: o.id,
        nome: o.nome,
        transportadora: o.transportadora,
        preco: o.precoC / 100,
        prazoDias: o.prazoDias,
      })),
      retirada,
    };
  }

  private doCache(chave: string): OpcaoCotada[] | undefined {
    const c = this.cache.get(chave);
    if (!c) return undefined;
    if (Date.now() - c.em > CACHE_MS) {
      this.cache.delete(chave);
      return undefined;
    }
    return c.opcoes;
  }

  private guardar(chave: string, opcoes: OpcaoCotada[]) {
    if (this.cache.size >= CACHE_MAX) {
      const velha = this.cache.keys().next().value;
      if (velha !== undefined) this.cache.delete(velha);
    }
    this.cache.set(chave, { em: Date.now(), opcoes });
  }

  // ─── CEP ─────────────────────────────────────────────────────────────────

  /** Endereço do CEP (ViaCEP). null = não achou ou o serviço não respondeu. */
  async buscarCep(cepBruto: string, fetchFn: typeof fetch = fetch) {
    const cep = soDigitos(cepBruto);
    if (cep.length !== 8) throw new NotFoundException('CEP');
    try {
      const r = await fetchFn(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: AbortSignal.timeout(5_000),
        redirect: 'error',
      });
      if (!r.ok) return null;
      const j = (await r.json()) as {
        erro?: boolean | string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (j.erro) return null;
      return {
        cep,
        endereco: j.logradouro ?? '',
        bairro: j.bairro ?? '',
        cidade: j.localidade ?? '',
        uf: j.uf ?? '',
      };
    } catch {
      return null;
    }
  }
}
