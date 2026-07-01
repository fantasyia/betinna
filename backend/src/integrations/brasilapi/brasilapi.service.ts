import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationException,
  NotFoundException,
  ValidationException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { cnpjSchema } from '@shared/validators/br-validators';

/**
 * Dados públicos de um CNPJ vindos da Receita Federal (via BrasilAPI), já
 * normalizados pros campos do cadastro de Cliente. Tudo opcional menos
 * `cnpj`/`razaoSocial` — a Receita pode não ter telefone/e-mail.
 */
export interface CnpjLookupResult {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  telefone: string | null;
}

/** Subconjunto do payload do endpoint /api/cnpj/v1/{cnpj} da BrasilAPI. */
interface BrasilApiCnpj {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  email?: string;
}

/**
 * Consulta de CNPJ na Receita via BrasilAPI (pública, sem credenciais).
 * Usada pelo auto-preenchimento do cadastro de cliente.
 */
@Injectable()
export class BrasilApiService {
  private readonly logger = new Logger(BrasilApiService.name);
  private static readonly BASE = 'https://brasilapi.com.br/api/cnpj/v1';

  constructor(private readonly http: HttpClientService) {}

  async consultarCnpj(cnpjBruto: string): Promise<CnpjLookupResult> {
    // cnpjSchema limpa não-dígitos, valida tamanho + dígitos verificadores e retorna 14 dígitos.
    const parsed = cnpjSchema.safeParse(cnpjBruto);
    if (!parsed.success) {
      throw new ValidationException([{ field: 'cnpj', message: 'CNPJ inválido' }], 'CNPJ inválido');
    }
    const cnpj = parsed.data;

    try {
      const res = await this.http.get<BrasilApiCnpj>(`${BrasilApiService.BASE}/${cnpj}`, {
        integration: 'brasilapi',
        timeoutMs: 10_000,
        retries: 2, // API pública/rate-limitada; GET é idempotente
        // Sem User-Agent o WAF (Cloudflare) da BrasilAPI responde 403. Identificar a app.
        headers: { 'User-Agent': 'Betinna.ai/1.0 (+https://betinna.ai)' },
      });
      if (!res.data) {
        throw new IntegrationException(
          'Resposta vazia da Receita',
          ErrorCode.INTEGRATION_ERROR,
          res.status,
        );
      }
      return this.mapear(cnpj, res.data);
    } catch (err) {
      if (err instanceof HttpClientError) {
        if (err.status === 404) throw new NotFoundException('CNPJ', cnpj);
        if (err.status === 429) {
          throw new IntegrationException(
            'Muitas consultas à Receita em pouco tempo. Tente novamente em instantes.',
            ErrorCode.RATE_LIMIT_EXCEEDED,
            429,
          );
        }
        this.logger.warn(`Falha BrasilAPI cnpj=${cnpj} status=${err.status}`);
        throw new IntegrationException(
          'Falha ao consultar o CNPJ na Receita',
          ErrorCode.INTEGRATION_ERROR,
          err.status,
        );
      }
      throw err;
    }
  }

  private mapear(cnpj: string, d: BrasilApiCnpj): CnpjLookupResult {
    const limpar = (v?: string | null): string | null => {
      const t = (v ?? '').trim();
      return t.length ? t : null;
    };
    return {
      cnpj,
      razaoSocial: limpar(d.razao_social) ?? '',
      nomeFantasia: limpar(d.nome_fantasia),
      situacao: limpar(d.descricao_situacao_cadastral),
      endereco: limpar(d.logradouro),
      numero: limpar(d.numero),
      complemento: limpar(d.complemento),
      bairro: limpar(d.bairro),
      cidade: limpar(d.municipio),
      uf: limpar(d.uf)?.toUpperCase() ?? null,
      cep: limpar(d.cep)?.replace(/\D/g, '') ?? null,
      email: limpar(d.email)?.toLowerCase() ?? null,
      telefone: limpar(d.ddd_telefone_1)?.replace(/\D/g, '') ?? null,
    };
  }
}
