import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { BrandingController } from './branding.controller';
import { BRANDING_PADRAO, type Branding } from './branding.service';

const SOMATEC: Branding = {
  nome: 'Somatec Blocking',
  nomeCurto: 'Somatec',
  dominio: 'app.somatecblocking.com.br',
  logoUrl: 'https://www.somatecblocking.com.br/logo.png',
  logoNegativoUrl: null,
  iconeUrl: 'https://www.somatecblocking.com.br/icon.png',
  tituloApp: 'APP Somatec Blocking',
  siteUrl: null,
  cores: { primaria: '#00416E', secundaria: '#008CC8', acao: '#F39200' },
};

const build = (marca: Branding = SOMATEC) => {
  const branding = { porHost: vi.fn().mockResolvedValue(marca) };
  return { ctrl: new BrandingController(branding as never), branding };
};

const resposta = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return {
    res: res as unknown as Response,
    corpo: () =>
      JSON.parse((res.send.mock.calls[0]?.[0] as string) ?? '{}') as Record<string, unknown>,
    espiao: res,
  };
};

describe('BrandingController', () => {
  it('o host que vale é o do APP, não o da API', async () => {
    // Front e API moram em domínios diferentes: o `Host` desta requisição é
    // sempre o da API. Se ele ganhasse, nenhum tenant teria marca.
    const { ctrl, branding } = build();

    await ctrl.resolver('api-production.up.railway.app', 'app.somatecblocking.com.br');

    expect(branding.porHost).toHaveBeenCalledWith('app.somatecblocking.com.br');
  });

  it('sem host explícito, o Origin é a segunda melhor pista', async () => {
    const { ctrl, branding } = build();

    await ctrl.resolver('api-production.up.railway.app', undefined, 'https://app.x.com.br');

    expect(branding.porHost).toHaveBeenCalledWith('https://app.x.com.br');
  });

  it('manifest sai com o nome e as cores do TENANT', async () => {
    // Sem isto, o atalho que o representante salva na tela do celular chama
    // "Betinna" — mesmo tendo entrado pelo domínio da empresa dele.
    const { ctrl } = build();
    const { res, corpo, espiao } = resposta();

    await ctrl.manifest(res, undefined, 'app.somatecblocking.com.br');

    expect(corpo()).toMatchObject({
      // O atalho instalado leva o nome do APP, não o da empresa.
      name: 'APP Somatec Blocking',
      short_name: 'Somatec',
      theme_color: '#F39200',
      background_color: '#00416E',
    });
    expect(espiao.type).toHaveBeenCalledWith('application/manifest+json');
  });

  it('o manifest continua NÃO instalável — a decisão de app só-online não muda aqui', async () => {
    const { ctrl } = build();
    const { res, corpo } = resposta();

    await ctrl.manifest(res, undefined, 'app.somatecblocking.com.br');

    expect(corpo().display).toBe('browser');
  });

  it('tenant SEM logo próprio vai sem ícone — nunca com o do produto', async () => {
    // Atalho da Somatec na tela do celular com o símbolo do Betinna é o
    // vazamento mais visível que existe. Sem ícone, o navegador desenha a
    // inicial do nome — que já é a marca certa.
    const { ctrl } = build({ ...SOMATEC, iconeUrl: null });
    const { res, corpo } = resposta();

    await ctrl.manifest(res, undefined, 'app.somatecblocking.com.br');

    expect(corpo().icons).toEqual([]);
  });

  it('ícone do tenant leva o type certo pela extensão', async () => {
    const { ctrl } = build();
    const { res, corpo } = resposta();

    await ctrl.manifest(res, undefined, 'app.somatecblocking.com.br');

    expect(corpo().icons).toEqual([
      // O ÍCONE quadrado, nunca o logo horizontal. E `sizes: 'any'` porque o
      // tamanho real do arquivo do tenant é desconhecido aqui — declarar
      // 192x192 faz o navegador RECUSAR o ícone com erro.
      expect.objectContaining({ src: SOMATEC.iconeUrl, type: 'image/png', sizes: 'any' }),
    ]);
  });

  it('host sem tenant devolve o manifest do PRODUTO — white-label, não rename', async () => {
    const { ctrl } = build(BRANDING_PADRAO);
    const { res, corpo } = resposta();

    await ctrl.manifest(res, 'frontend-production.up.railway.app');

    expect(corpo()).toMatchObject({ name: 'Betinna.ai', short_name: 'Betinna' });
    expect(corpo().icons).toEqual([
      expect.objectContaining({ src: '/betinna-symbol.png', type: 'image/png' }),
    ]);
  });
});
