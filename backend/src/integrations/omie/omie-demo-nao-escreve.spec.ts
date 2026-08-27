import { describe, expect, it, vi } from 'vitest';
import { OmieProdutosService } from './omie-produtos.service';

/**
 * DEMO NUNCA ESCREVE EM CATÁLOGO DE PRODUÇÃO.
 *
 * 27/08: o botão "Sincronizar do ERP" ainda apontava pro OMIE, que estava em
 * `OMIE_DEMO_MODE=true` (o default), e três produtos FICTÍCIOS de mercearia
 * entraram no catálogo real da Somatec — óleo de girassol, azeite e farinha.
 *
 * Dado de mentira em catálogo não fica no catálogo: vira proposta, vira pedido,
 * vira nota. A barreira certa é não deixar escrever — não é lembrar de não
 * clicar.
 */
function build(demo: boolean, producao: boolean) {
  const prisma = { produto: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } };
  const omie = { listarProdutos: vi.fn().mockResolvedValue({ produto_servico_cadastro: [] }) };
  const integracoes = {
    obterCursorRecurso: vi.fn().mockResolvedValue(undefined),
    gravarCursorRecurso: vi.fn().mockResolvedValue(undefined),
    registrarSyncOk: vi.fn().mockResolvedValue(undefined),
    registrarSaudeOk: vi.fn().mockResolvedValue(undefined),
  };
  return new OmieProdutosService(
    prisma as never,
    omie as never,
    integracoes as never,
    { criarParaRole: vi.fn() } as never,
    { get: () => demo, isProduction: producao } as never,
  );
}

describe('sync do OMIE em modo demo', () => {
  it('RECUSA em produção — não deixa produto fictício entrar no catálogo real', async () => {
    await expect(build(true, true).sync('emp-1')).rejects.toThrow(/modo DEMO/);
  });

  it('fora de produção, roda normal (é pra isso que o demo existe)', async () => {
    await expect(build(true, false).sync('emp-1')).resolves.toBeDefined();
  });

  it('com OMIE real configurado, produção roda normal', async () => {
    await expect(build(false, true).sync('emp-1')).resolves.toBeDefined();
  });
});
