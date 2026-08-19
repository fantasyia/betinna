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

  it('`segmento` continua exposto — mas é texto livre, não serve pra rotear', async () => {
    const { svc } = makeSvc(leadNoBanco);

    const ctx = await enriquecer(svc, { leadId: 'lead-1' });

    expect((ctx.lead as Record<string, unknown>).segmento).toBe('NI · comercial');
  });
});
