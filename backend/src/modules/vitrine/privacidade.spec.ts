import { describe, expect, it, vi } from 'vitest';
import { politicaDePrivacidade, type DadosPolitica } from './privacidade';
import { PrivacidadeService, privacidadePublicada } from './privacidade.service';

/** Política de Privacidade: texto verdadeiro POR EMPRESA (só o que ela usa). */

const base: DadosPolitica = {
  controlador: 'Ribelt Comércio Têxtil Ltda',
  marca: 'Ribelt Têxtil',
  cnpj: '12345678000199',
  cidade: 'Brusque',
  uf: 'SC',
  email: 'privacidade@ribelt.com.br',
  atualizadaEm: '2026-10-09',
  usa: { pagamentoOnline: false, frete: false, assistenteIa: false },
};
const texto = (d: DadosPolitica) =>
  politicaDePrivacidade(d)
    .secoes.flatMap((s) => [s.titulo, ...s.paragrafos, ...(s.itens ?? [])])
    .join('\n');

describe('politicaDePrivacidade', () => {
  it('controlador, CNPJ formatado, local e contato aparecem; data em formato BR', () => {
    const t = texto(base);
    expect(t).toContain('Ribelt Comércio Têxtil Ltda, CNPJ 12.345.678/0001-99, Brusque/SC');
    expect(t).toContain('privacidade@ribelt.com.br');
    expect(t).toContain('Última atualização: 09/10/2026');
    expect(t).toContain('Lei 13.709/2018');
  });

  it('empresa SEM pagamento online, frete ou IA: não cita Asaas, Melhor Envio nem IA', () => {
    const t = texto(base);
    expect(t).not.toMatch(/Asaas/);
    expect(t).not.toMatch(/Melhor Envio/);
    expect(t).not.toMatch(/inteligência artificial/);
    expect(t).not.toMatch(/endereço, número, complemento/);
  });

  it('cada serviço que a empresa usa entra no texto', () => {
    const t = texto({ ...base, usa: { pagamentoOnline: true, frete: true, assistenteIa: true } });
    expect(t).toMatch(/Asaas/);
    expect(t).toMatch(/Melhor Envio/);
    expect(t).toMatch(/inteligência artificial/);
    expect(t).toMatch(/CEP, endereço, número, complemento e bairro/);
  });

  it('formulário de anúncio da Meta e WhatsApp sempre aparecem (é pra isso que o Meta pede)', () => {
    const t = texto(base);
    expect(t).toMatch(/formulários de anúncios do Facebook e do Instagram/);
    expect(t).toMatch(/WhatsApp/);
  });

  it('não promete bloqueio automático de mensagens (depende de config da empresa)', () => {
    expect(texto(base)).not.toMatch(/paramos de enviar/i);
  });
});

describe('PrivacidadeService.publica', () => {
  const vitrine = (config: unknown, extra = {}) => ({
    ativa: true,
    empresa: {
      nome: 'Ribelt',
      cnpj: null,
      cidade: null,
      uf: null,
      ativo: true,
      botWhatsappAtivo: true,
      config,
      ...extra,
    },
  });
  const montar = (v: unknown) =>
    new PrivacidadeService({ vitrine: { findUnique: vi.fn().mockResolvedValue(v) } } as never);

  it('sem razão social ou e-mail: 404 (não publica política com contato vazio)', async () => {
    await expect(
      montar(vitrine({ privacidade: { email: 'a@b.com' } })).publica('x'),
    ).rejects.toThrow();
    await expect(montar(vitrine({})).publica('x')).rejects.toThrow();
    await expect(montar(null).publica('x')).rejects.toThrow();
  });

  it('publicada: usa a marca do branding e o que a empresa liga (frete, pagamento, IA)', async () => {
    const p = await montar(
      vitrine({
        branding: { nome: 'Ribelt Têxtil' },
        privacidade: { razaoSocial: 'Ribelt Ltda', email: 'p@r.com', atualizadaEm: '2026-10-09' },
        frete: { ativo: true },
        checkout: { ativo: true, taxas: {} },
      }),
    ).publica('atacado-ribelt');
    expect(p.titulo).toBe('Política de Privacidade · Ribelt Têxtil');
    const t = p.secoes.flatMap((s) => [...s.paragrafos, ...(s.itens ?? [])]).join('\n');
    expect(t).toMatch(/Melhor Envio/);
    expect(t).toMatch(/Asaas/);
    expect(t).toMatch(/inteligência artificial/);
  });

  it('privacidadePublicada exige os dois campos', () => {
    expect(privacidadePublicada({ privacidade: { razaoSocial: 'X', email: 'a@b.com' } })).toBe(
      true,
    );
    expect(privacidadePublicada({ privacidade: { razaoSocial: ' ', email: 'a@b.com' } })).toBe(
      false,
    );
    expect(privacidadePublicada(null)).toBe(false);
  });
});
