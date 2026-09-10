import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IaAFrenteDiagnosticoService } from './ia-a-frente-diagnostico.service';

/**
 * A rota existe pra medir o que quatro rodadas por WhatsApp não conseguiram
 * medir. Se ela mesma montar o estado errado, a próxima conclusão sai tão
 * inventada quanto a de 10/09 — então o que estes testes travam é o ESTADO que
 * ela cria, não só o retorno.
 *
 * O estado certo é UM só: `EM_EXECUCAO`, sem `aguardandoNoId`, sem
 * `processandoTurno`. Qualquer desvio faz o `turnoDeIaAberto` responder "sim"
 * sozinho e a medição volta a não separar um sinal do outro.
 */
const ADMIN = { empresaIdAtiva: 'emp-1', role: 'ADMIN', id: 'u-1' } as never;

describe('IaAFrenteDiagnosticoService', () => {
  let prisma: Record<string, never>;
  let criado: Record<string, unknown> | null;
  let deletado: string | null;
  let svc: IaAFrenteDiagnosticoService;
  /** Filas de resposta do $queryRaw, na ordem em que o service pergunta. */
  let respostasRaw: Array<Array<{ id: string }>>;

  const montar = (opts: { alcanca?: boolean; abertoAntes?: boolean; aFrenteDurante?: boolean }) => {
    const { alcanca = true, abertoAntes = false, aFrenteDurante = true } = opts;
    // Ordem das consultas raw: alcance · (antes) aberto+aFrente · (durante) aberto+aFrente.
    // `Promise.all` dispara aberto e aFrente juntos, mas o mock resolve por ordem
    // de CHAMADA, que é a ordem do array no `Promise.all`.
    respostasRaw = [
      alcanca ? [{ id: 'no-ia' }] : [],
      abertoAntes ? [{ id: 'x' }] : [],
      [],
      abertoAntes ? [{ id: 'x' }] : [],
      aFrenteDurante ? [{ id: 'exec-sintetica' }] : [],
    ];
  };

  beforeEach(() => {
    criado = null;
    deletado = null;
    montar({});
    prisma = {
      fluxo: { findFirst: vi.fn().mockResolvedValue({ id: 'f-1', nome: 'C1' }) },
      fluxoNo: { findFirst: vi.fn().mockResolvedValue({ id: 'no-trigger', titulo: 'Gatilho' }) },
      fluxoExecucao: {
        create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          criado = args.data;
          return Promise.resolve({ id: 'exec-sintetica' });
        }),
        delete: vi.fn().mockImplementation((args: { where: { id: string } }) => {
          deletado = args.where.id;
          return Promise.resolve({});
        }),
      },
      $queryRaw: vi.fn().mockImplementation(() => Promise.resolve(respostasRaw.shift() ?? [])),
    } as never;
    svc = new IaAFrenteDiagnosticoService(
      prisma as never,
      {
        get: vi.fn().mockReturnValue(true),
      } as never,
    );
  });

  describe('o estado que ela monta', () => {
    it('a execução sintética é EM_EXECUCAO — o único status que o iaAFrente olha', async () => {
      await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(criado?.status).toBe('EM_EXECUCAO');
    });

    /**
     * O CORAÇÃO DO TESTE. Com `aguardandoNoId` ou `processandoTurno` a execução
     * passa a ser vista pelo `turnoDeIaAberto` também — e aí os dois sinais
     * respondem "sim", exatamente o erro que invalidou as quatro rodadas por
     * WhatsApp. A medição diria "a flag funciona" sem a flag ter sido usada.
     */
    it('NÃO fica visível pro turnoDeIaAberto (sem aguardandoNoId, sem processandoTurno)', async () => {
      await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(criado?.aguardandoNoId).toBeUndefined();
      expect(criado?.processandoTurno).toBeUndefined();
    });

    it('carimba iniciouEm — o iaAFrente só enxerga dentro da janela de 30s', async () => {
      await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(criado?.iniciouEm).toBeInstanceOf(Date);
      expect(Date.now() - (criado?.iniciouEm as Date).getTime()).toBeLessThan(5000);
    });

    it('nasce como teste, pra não sujar a taxa de sucesso do fluxo', async () => {
      await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(criado?.teste).toBe(true);
    });

    it('o contexto leva o alvo e diz que é diagnóstico', async () => {
      await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1', conversationId: 'conv-1' });
      expect(criado?.contexto).toMatchObject({
        leadId: 'lead-1',
        conversationId: 'conv-1',
        _diagnostico: 'ia-a-frente',
      });
    });

    it('a posição vira um LOG — é dele que o iaAFrente lê onde a execução está', async () => {
      await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      const logs = criado?.logs as { create: { noId: string } };
      expect(logs.create.noId).toBe('no-trigger');
    });
  });

  describe('a limpeza', () => {
    it('apaga a execução sintética', async () => {
      await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(deletado).toBe('exec-sintetica');
    });

    /**
     * Linha sintética esquecida no banco vira execução fantasma barrando
     * proativo de verdade, e ninguém saberia de onde veio. Por isso o delete
     * está no `finally`.
     */
    it('apaga MESMO quando a medição estoura no meio', async () => {
      prisma.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce([{ id: 'no-ia' }]) // alcance
        .mockResolvedValueOnce([]) // antes: aberto
        .mockResolvedValueOnce([]) // antes: a frente
        .mockRejectedValue(new Error('banco fora')) as never;

      await expect(svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' })).rejects.toThrow(
        'banco fora',
      );
      expect(deletado).toBe('exec-sintetica');
    });
  });

  describe('o veredito', () => {
    it('diz que a flag FAZ diferença quando só o iaAFrente responde sim', async () => {
      const r = await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(r.durante.guardSemFlag).toBe(false);
      expect(r.durante.guardComFlag).toBe(true);
      expect(r.veredito).toMatch(/FAZ DIFERENÇA/);
    });

    /**
     * O caso que produziu o erro de 10/09: a conversa já tinha turno aberto, e
     * aí os dois respondem "sim" com ou sem flag. Medir isso e concluir "a flag
     * funciona" é o que aconteceu. Agora a própria rota recusa a conclusão.
     */
    it('recusa a medição quando JÁ havia turno aberto antes', async () => {
      montar({ abertoAntes: true });
      const r = await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(r.veredito).toMatch(/INCONCLUSIVO/);
      expect(r.veredito).toMatch(/já havia turno de IA aberto/);
    });

    it('recusa quando a posição não alcança nó de IA — responderia "não" por construção', async () => {
      montar({ alcanca: false });
      const r = await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(r.posicao.alcancaNoDeIa).toBe(false);
      expect(r.veredito).toMatch(/INCONCLUSIVO/);
    });

    it('avisa quando a flag NÃO pegou mesmo com o estado montado certo', async () => {
      montar({ aFrenteDurante: false });
      const r = await svc.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });
      expect(r.veredito).toMatch(/A FLAG NÃO PEGOU/);
    });
  });

  describe('as recusas de entrada', () => {
    it('sem leadId nem conversationId, recusa — os dois guards responderiam "não"', async () => {
      await expect(svc.medir(ADMIN, { fluxoId: 'f-1' })).rejects.toThrow(
        /leadId e\/ou conversationId/,
      );
      expect(criado).toBeNull();
    });

    it('usuário sem empresa ativa é barrado', async () => {
      await expect(
        svc.medir({ empresaIdAtiva: null, role: 'ADMIN' } as never, {
          fluxoId: 'f-1',
          leadId: 'lead-1',
        }),
      ).rejects.toThrow(/Empresa não definida/);
    });

    it('fluxo de outra empresa não existe daqui', async () => {
      prisma.fluxo.findFirst = vi.fn().mockResolvedValue(null) as never;
      await expect(svc.medir(ADMIN, { fluxoId: 'f-alheio', leadId: 'lead-1' })).rejects.toThrow();
      expect(criado).toBeNull();
    });
  });

  /**
   * Ela responde "o que a flag FARIA", não "o que a flag fez". É o que dispensa
   * ligar e desligar a variável de produção pra saber — o custo que travou esta
   * medição por um dia inteiro.
   */
  it('os dois guards são consultados independente da flag estar ligada', async () => {
    const desligada = new IaAFrenteDiagnosticoService(
      prisma as never,
      {
        get: vi.fn().mockReturnValue(false),
      } as never,
    );

    const r = await desligada.medir(ADMIN, { fluxoId: 'f-1', leadId: 'lead-1' });

    expect(r.flagLigada).toBe(false);
    // mesmo desligada, o iaAFrente foi perguntado e respondeu
    expect(r.durante.iaAFrente).toBe(true);
    expect(r.durante.guardComFlag).toBe(true);
    expect(r.durante.guardSemFlag).toBe(false);
  });
});
