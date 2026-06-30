import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IntegrationException,
  NotFoundException,
  ValidationException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { BrasilApiService } from './brasilapi.service';

// CNPJ real e válido (Google Brasil) — passa os dígitos verificadores.
const CNPJ_VALIDO = '06990590000123';

function makeService(getImpl: ReturnType<typeof vi.fn>) {
  const http = { get: getImpl } as unknown as HttpClientService;
  return new BrasilApiService(http);
}

describe('BrasilApiService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mapeia a resposta da BrasilAPI pros campos do cadastro', async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      data: {
        cnpj: CNPJ_VALIDO,
        razao_social: 'GOOGLE BRASIL INTERNET LTDA',
        nome_fantasia: 'GOOGLE',
        descricao_situacao_cadastral: 'ATIVA',
        logradouro: 'AVENIDA BRIGADEIRO FARIA LIMA',
        numero: '3477',
        complemento: 'ANDAR 18',
        bairro: 'ITAIM BIBI',
        municipio: 'SAO PAULO',
        uf: 'sp',
        cep: '04538-133',
        ddd_telefone_1: '(11) 2395-8400',
        email: '',
      },
      headers: {},
      attempts: 1,
      durationMs: 1,
    });
    const svc = makeService(get);

    const r = await svc.consultarCnpj('06.990.590/0001-23'); // com máscara

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toContain(`/cnpj/v1/${CNPJ_VALIDO}`);
    expect(r).toMatchObject({
      cnpj: CNPJ_VALIDO,
      razaoSocial: 'GOOGLE BRASIL INTERNET LTDA',
      nomeFantasia: 'GOOGLE',
      situacao: 'ATIVA',
      endereco: 'AVENIDA BRIGADEIRO FARIA LIMA',
      numero: '3477',
      bairro: 'ITAIM BIBI',
      cidade: 'SAO PAULO',
      uf: 'SP', // normalizado pra maiúscula
      cep: '04538133', // só dígitos
      telefone: '1123958400', // só dígitos
    });
    // e-mail vazio vira null (campo obrigatório no cadastro não é poluído)
    expect(r.email).toBeNull();
  });

  it('rejeita CNPJ inválido antes de chamar a API', async () => {
    const get = vi.fn();
    const svc = makeService(get);
    await expect(svc.consultarCnpj('123')).rejects.toBeInstanceOf(ValidationException);
    expect(get).not.toHaveBeenCalled();
  });

  it('404 da Receita vira NotFoundException', async () => {
    const get = vi.fn().mockRejectedValue(new HttpClientError(404, null, 'url', 'GET', 1));
    const svc = makeService(get);
    await expect(svc.consultarCnpj(CNPJ_VALIDO)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('429 da Receita vira IntegrationException com código de rate-limit', async () => {
    const get = vi.fn().mockRejectedValue(new HttpClientError(429, null, 'url', 'GET', 3));
    const svc = makeService(get);
    await expect(svc.consultarCnpj(CNPJ_VALIDO)).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
    });
  });

  it('outros erros upstream viram IntegrationException', async () => {
    const get = vi.fn().mockRejectedValue(new HttpClientError(500, null, 'url', 'GET', 3));
    const svc = makeService(get);
    await expect(svc.consultarCnpj(CNPJ_VALIDO)).rejects.toBeInstanceOf(IntegrationException);
  });
});
