import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { nomeSeguroParaStorage } from '@shared/utils/nome-de-upload';

const BUCKET = 'treinamentos';

/**
 * Teto por arquivo.
 *
 * 500 MB dá uma aula longa em 720p com folga. O limite existe menos por espaço
 * (que é barato) e mais por BANDA: cada exibição baixa o arquivo inteiro, e é
 * essa conta que cresce quando a operação cresce.
 */
const MAX_BYTES = 500 * 1024 * 1024;

/** O link de leitura expira: é ele que faz "arquivo próprio" significar login de verdade. */
const VALIDADE_LEITURA_S = 60 * 60 * 4;

/** Janela pra subir. Generosa porque upload de vídeo em 4G é lento. */
const VALIDADE_UPLOAD_S = 60 * 60 * 2;

/**
 * O arquivo de treinamento hospedado por nós.
 *
 * 🔴 O upload NÃO passa pelo backend. O serviço assina uma URL e o navegador
 * envia direto pro Storage. Fazer 500 MB atravessarem o Nest significaria
 * timeout, memória e uma requisição que não pode ser retomada — foi o motivo
 * pelo qual "upload pela tela do app" estava listado como risco desta opção.
 *
 * ⚠️ E a leitura é sempre por URL ASSINADA que expira. Guardar uma URL fixa no
 * banco recriaria exatamente o problema do YouTube não listado — um link
 * permanente que dispensa login — só que com a nossa banda pagando a conta.
 */
@Injectable()
export class TreinamentoArquivoService implements OnModuleInit {
  private readonly logger = new Logger(TreinamentoArquivoService.name);
  private readonly storage: SupabaseClient;

  constructor(private readonly env: EnvService) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  /** Fire-and-forget: Storage pendurado não pode travar o boot do Nest. */
  onModuleInit(): void {
    void this.garantirBucket();
  }

  private async garantirBucket(): Promise<void> {
    try {
      const { data: buckets } = await this.storage.storage.listBuckets();
      if (buckets?.some((b) => b.name === BUCKET)) return;
      const { error } = await this.storage.storage.createBucket(BUCKET, {
        // 🔴 PRIVADO. Bucket público serviria o vídeo por URL fixa a quem
        // tivesse o endereço — que é justamente o que esta fonte existe pra
        // evitar.
        public: false,
        fileSizeLimit: MAX_BYTES,
      });
      if (error && !error.message.includes('already exists')) {
        this.logger.error(`Falha ao criar bucket ${BUCKET}: ${error.message}`);
      } else {
        this.logger.log(`Bucket ${BUCKET} criado`);
      }
    } catch (err) {
      this.logger.warn(
        `Não foi possível verificar/criar o bucket ${BUCKET}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * A permissão pro navegador subir o arquivo direto.
   *
   * Valida ANTES de assinar: tamanho e tipo. Assinar primeiro e descobrir depois
   * significaria 500 MB de upload concluído pra então recusar.
   */
  async permitirUpload(
    empresaId: string,
    dados: { nomeArquivo: string; tamanho: number; tipo: string },
  ): Promise<{ caminho: string; url: string; token: string; expiraEm: string }> {
    if (!Number.isFinite(dados.tamanho) || dados.tamanho <= 0) {
      throw new BusinessRuleException('Tamanho do arquivo inválido', ErrorCode.VALIDATION_ERROR);
    }
    if (dados.tamanho > MAX_BYTES) {
      throw new BusinessRuleException(
        `Vídeo muito grande (${Math.round(dados.tamanho / 1024 / 1024)} MB). ` +
          `O limite é ${MAX_BYTES / 1024 / 1024} MB — comprima o arquivo ou suba no YouTube ` +
          'como "Não listado".',
        ErrorCode.VALIDATION_ERROR,
      );
    }
    if (!dados.tipo?.startsWith('video/')) {
      throw new BusinessRuleException(
        `"${dados.tipo || 'sem tipo'}" não é um arquivo de vídeo.`,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    // O caminho começa pelo empresaId: o isolamento entre tenants fica visível
    // na própria estrutura do bucket, não só na query.
    const nome = nomeSeguroParaStorage(dados.nomeArquivo);
    const caminho = `${empresaId}/${Date.now()}_${nome}`;

    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUploadUrl(caminho, { upsert: false });

    if (error || !data) {
      throw new IntegrationException(
        `Não consegui preparar o upload: ${error?.message ?? 'sem resposta do Storage'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    return {
      caminho,
      url: data.signedUrl,
      token: data.token,
      expiraEm: new Date(Date.now() + VALIDADE_UPLOAD_S * 1000).toISOString(),
    };
  }

  /**
   * O link pra assistir. Expira — e é isso que faz o vídeo exigir login.
   *
   * Devolve `null` em vez de estourar: um arquivo que sumiu não pode derrubar a
   * listagem inteira. O card aparece sem player, que é um defeito visível.
   */
  async urlParaAssistir(caminho: string): Promise<string | null> {
    try {
      const { data, error } = await this.storage.storage
        .from(BUCKET)
        .createSignedUrl(caminho, VALIDADE_LEITURA_S);
      if (error || !data) {
        this.logger.warn(`Sem URL assinada para ${caminho}: ${error?.message ?? 'sem dados'}`);
        return null;
      }
      return data.signedUrl;
    } catch (err) {
      this.logger.warn(
        `Falha assinando ${caminho}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Apaga o arquivo do Storage.
   *
   * Best-effort de propósito: se o registro sair do banco e o arquivo ficar, o
   * pior caso é um órfão ocupando espaço. Travar a remoção por causa disso
   * deixaria o usuário sem conseguir apagar um treinamento errado.
   */
  async remover(caminho: string): Promise<void> {
    try {
      const { error } = await this.storage.storage.from(BUCKET).remove([caminho]);
      if (error) this.logger.warn(`Arquivo ${caminho} não removido: ${error.message}`);
    } catch (err) {
      this.logger.warn(
        `Falha removendo ${caminho}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  static get limiteBytes(): number {
    return MAX_BYTES;
  }
}
