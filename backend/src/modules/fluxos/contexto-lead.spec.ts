import { describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

/**
 * Campos do LEAD expostos ao contexto do fluxo.
 *
 * `origem` e `formulario` existiam no banco (`origemCadastro`,
 * `formularioOrigem`) e NUNCA chegavam aqui. Sem eles, separar "veio do
 * orçamento industrial" de "veio do checkout NI" só dava comparando `segmento`,
 * que é TEXTO LIVRE — a mesma armadilha da etapa comparada por nome: a condição
 * deixa de casar em silêncio quando alguém muda a redação.
 */
const leadNoBanco = {
  nome: 'Padaria do Zé',
  contatoNome: 'Zé',
  contatoTelefone: '11999990000',
  contatoEmail: null,
  cidade: 'São Paulo',
  uf: 'SP',
  segmento: 'NI · comercial',
  score: 50,
  etapa: 'NOVO',
  origemCadastro: 'site',
  formularioOrigem: 'calculadora',
  variaveis: {},
  funilId: 'f1',
  funilEtapaId: 'e1',
  funil: { nome: 'Canal Própio' },
  funilEtapa: { nome: 'Novo' },
  tags: [{ tag: { nome: 'publico:comercio' } }],
  representanteId: 'rep-7',
  representante: { nome: 'Marcelo Harada' },
  etapaDesde: new Date(Date.now() - 3 * 86_400_000),
};

const makeSvc = (lead: unknown) => {
  const prisma = {
    lead: { findFirst: vi.fn().mockResolvedValue(lead) },
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: {} }) },
    variavelCustomizada: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const svc = new FluxoExecutorService(prisma as never, ...(Array(12).fill({}) as never[]));
  return { svc, prisma };
};

/** Acesso ao método privado — é o contrato que interessa testar. */
const enriquecer = async (svc: FluxoExecutorService, ctx: Record<string, unknown>) =>
  (
    svc as unknown as {
      enriquecerContexto: (
        c: Record<string, unknown>,
        e: string,
      ) => Promise<Record<string, unknown>>;
    }
  ).enriquecerContexto(ctx, 'emp-1');

describe('contexto do fluxo — campos de ORIGEM do lead', () => {
  it('expõe `lead.origem` e `lead.formulario` (vocabulário controlado)', async () => {
    const { svc } = makeSvc(leadNoBanco);

    const ctx = await enriquecer(svc, { leadId: 'lead-1' });
    const lead = ctx.lead as Record<string, unknown>;

    expect(lead.origem).toBe('site');
    expect(lead.formulario).toBe('calculadora');
  });

  it('lead sem origem preenchida vira string vazia, não `undefined`', async () => {
    // Campo ausente tem que renderizar em branco no template e comparar como
    // vazio na condição — nunca vazar o literal {{lead.origem}}.
    const { svc } = makeSvc({ ...leadNoBanco, origemCadastro: null, formularioOrigem: null });

    const ctx = await enriquecer(svc, { leadId: 'lead-1' });
    const lead = ctx.lead as Record<string, unknown>;

    expect(lead.origem).toBe('');
    expect(lead.formulario).toBe('');
  });

  it('expõe `lead.representante_id` e `lead.representante_nome`', async () => {
    const { svc } = makeSvc(leadNoBanco);

    const ctx = await enriquecer(svc, { leadId: 'lead-1' });
    const lead = ctx.lead as Record<string, unknown>;

    expect(lead.representante_id).toBe('rep-7');
    expect(lead.representante_nome).toBe('Marcelo Harada');
  });

  it('lead SEM dono: `representante_id` vazio — é como a CONDICAO separa os dois', async () => {
    // Este é o campo que decide, num fluxo de reabordagem, se o bot cutuca o
    // REP ou fala com o CLIENTE. Sem ele no contexto a condição comparava
    // contra vazio pros DOIS casos e caía sempre no mesmo ramo, em silêncio —
    // o bot mandando mensagem pro cliente de quem está negociando.
    const { svc } = makeSvc({ ...leadNoBanco, representanteId: null, representante: null });

    const ctx = await enriquecer(svc, { leadId: 'lead-1' });
    const lead = ctx.lead as Record<string, unknown>;

    expect(lead.representante_id).toBe('');
    expect(lead.representante_nome).toBe('');
  });

  it('expõe `lead.dias_na_etapa` a partir de `etapaDesde`', async () => {
    const { svc } = makeSvc(leadNoBanco);

    const ctx = await enriquecer(svc, { leadId: 'lead-1' });

    expect((ctx.lead as Record<string, unknown>).dias_na_etapa).toBe(3);
  });

  it('`segmento` continua exposto — mas é texto livre, não serve pra rotear', async () => {
    const { svc } = makeSvc(leadNoBanco);

    const ctx = await enriquecer(svc, { leadId: 'lead-1' });

    expect((ctx.lead as Record<string, unknown>).segmento).toBe('NI · comercial');
  });
});
