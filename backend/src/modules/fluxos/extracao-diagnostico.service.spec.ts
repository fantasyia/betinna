import { describe, expect, it, vi } from 'vitest';
import { ExtracaoDiagnosticoService } from './extracao-diagnostico.service';
import type { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * A rota existe pra fechar uma lacuna de VERIFICAÇÃO, não de comportamento: a
 * rede determinística só age quando o modelo falha, e o modelo falha ~1 em 10
 * sem avisar. Sem isto, ver a rede trabalhar em produção dependia de uma falha
 * acontecer com um cliente de verdade.
 *
 * ⚠️ O valor todo está em ela ler a config REAL do nó. Um diagnóstico que
 * inventa a declaração testaria o cenário de quem escreveu, não o que está no
 * ar — que é o mesmo erro de escrever caso de teste com os valores que o sistema
 * aceita.
 */
const C1_REAL = [
  'corrente_quadro',
  'tensao_rede: 127V | 220V | 380V | 440V | nao sei',
  'perfil_cliente: comercio | residencia | condominio | carro_eletrico',
];

const ADMIN = { id: 'u1', role: 'ADMIN', empresaIdAtiva: 'emp-1' } as AuthenticatedUser;

const montar = (configDoNo: unknown = { variaveisGravadas: C1_REAL }) => {
  const findFirst = vi.fn().mockResolvedValue(configDoNo ? { config: configDoNo } : null);
  const prisma = { fluxoNo: { findFirst } } as unknown as PrismaService;
  return { svc: new ExtracaoDiagnosticoService(prisma), findFirst };
};

describe('ExtracaoDiagnosticoService', () => {
  it('lê a declaração do NÓ REAL e resgata o que a frase prova', async () => {
    const { svc, findFirst } = montar();
    const r = await svc.simular(ADMIN, {
      texto: 'o disjuntor geral aqui e de 63A e a tensao e 220V',
      noId: 'no-1',
    });

    expect(r.resgatadas).toEqual({ corrente_quadro: '63A', tensao_rede: '220V' });
    // Filtra por empresa: diagnóstico não atravessa tenant.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'no-1', fluxo: { empresaId: 'emp-1' } }),
      }),
    );
  });

  it('sem noId, aceita a declaração passada à mão', async () => {
    const { svc, findFirst } = montar();
    const r = await svc.simular(ADMIN, { texto: 'aqui e 380v', declaradas: C1_REAL });
    expect(r.resgatadas.tensao_rede).toBe('380V');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('devolve o CONVITE, que é a parte menos óbvia da regra', async () => {
    const { svc } = montar();
    const r = await svc.simular(ADMIN, {
      texto: '220',
      declaradas: C1_REAL,
      perguntaAnterior: 'E qual o padrão de energia aí, 110V, 220V ou 380V?',
    });
    expect(r.convite).toBe('tensao');
    expect(r.resgatadas.tensao_rede).toBe('220V');
  });

  /** Vazio é resposta legítima — e tem que ser dita, não devolvida em silêncio. */
  it('diz com todas as letras quando NÃO afirmaria nada', async () => {
    const { svc } = montar();
    const r = await svc.simular(ADMIN, {
      texto: 'oi, queria entender como funciona',
      declaradas: C1_REAL,
    });
    expect(r.resgatadas).toEqual({});
    expect(r.resumo).toContain('não afirmaria nada');
  });

  it('nó de outra empresa não é lido', async () => {
    const { svc } = montar(null);
    await expect(svc.simular(ADMIN, { texto: '220v', noId: 'no-de-outro' })).rejects.toThrow();
  });

  it('sem empresa ativa, recusa', async () => {
    const { svc } = montar();
    await expect(
      svc.simular({ ...ADMIN, empresaIdAtiva: null } as AuthenticatedUser, {
        texto: '220v',
        noId: 'no-1',
      }),
    ).rejects.toThrow();
  });
});
