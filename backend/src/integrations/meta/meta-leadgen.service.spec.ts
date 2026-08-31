import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MetaLeadgenService } from './meta-leadgen.service';
import type { MetaLeadgenJobData } from './meta-leadgen.types';

const JOB: MetaLeadgenJobData = {
  empresaId: 'emp-1',
  leadgenId: 'lg-777',
  pageId: 'page-1',
  formId: 'form-9',
  adId: 'ad-42',
  adgroupId: 'adset-7',
  createdTime: 1_756_600_000,
};

/** Resposta típica do `GET /{leadgen_id}` com os nomes de campo padrão do Meta. */
const CAMPOS_PADRAO = [
  { name: 'full_name', values: ['Ana Souza'] },
  { name: 'phone_number', values: ['+55 11 98888-0001'] },
  { name: 'email', values: ['ana@padaria.com.br'] },
  { name: 'city', values: ['São Paulo'] },
  { name: 'company_name', values: ['Padaria Souza'] },
];

const build = (
  opts: {
    leadExistente?: { id: string } | null;
    conexao?: unknown;
    dadosLead?: unknown;
    anuncioLanca?: boolean;
  } = {},
) => {
  const prisma = {
    lead: { findFirst: vi.fn().mockResolvedValue(opts.leadExistente ?? null) },
  };
  const queue = { add: vi.fn().mockResolvedValue({}) };
  const oauth = {
    resolverPorAccount: vi
      .fn()
      .mockResolvedValue(
        opts.conexao === undefined
          ? { empresaId: 'emp-1', credenciais: { pageId: 'page-1', pageAccessToken: 'tok-page' } }
          : opts.conexao,
      ),
  };
  const graph = {
    obterLead: vi
      .fn()
      .mockResolvedValue(opts.dadosLead ?? { id: 'lg-777', field_data: CAMPOS_PADRAO }),
    obterAnuncio: opts.anuncioLanca
      ? vi.fn().mockRejectedValue(new Error('(#200) ads_read não concedida'))
      : vi.fn().mockResolvedValue({
          id: 'ad-42',
          name: 'Criativo A',
          campaign: { id: 'c-1', name: 'MB-Industria-Agosto' },
        }),
  };
  const leads = { createPublico: vi.fn().mockResolvedValue({ id: 'lead-novo' }) };
  const svc = new MetaLeadgenService(
    queue as never,
    prisma as never,
    oauth as never,
    graph as never,
    leads as never,
  );
  return { svc, prisma, queue, oauth, graph, leads };
};

/** O 1º argumento de `createPublico` é o empresaId; o 2º é o DTO. */
const dto = (leads: { createPublico: ReturnType<typeof vi.fn> }) =>
  leads.createPublico.mock.calls[0][1] as Record<string, unknown>;

describe('MetaLeadgenService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('enfileirar', () => {
    it('usa jobId determinístico — reentrega do MESMO webhook não vira job duplicado', async () => {
      const { svc, queue } = build();

      await svc.enfileirar(JOB);

      expect(queue.add.mock.calls[0][2]).toMatchObject({ jobId: 'leadgen_lg-777' });
    });

    it('o jobId não tem ":" — BullMQ v5 rejeita custom job id com dois-pontos', async () => {
      const { svc, queue } = build();

      await svc.enfileirar(JOB);

      expect(String(queue.add.mock.calls[0][2].jobId)).not.toContain(':');
    });

    it('pede retry com backoff: a busca falha por token/permissão e o lead já foi PAGO', async () => {
      const { svc, queue } = build();

      await svc.enfileirar(JOB);

      const opts = queue.add.mock.calls[0][2] as { attempts: number; backoff: unknown };
      expect(opts.attempts).toBeGreaterThan(1);
      expect(opts.backoff).toMatchObject({ type: 'exponential' });
    });

    it('NÃO engole erro de fila — sem isso o webhook responderia 200 e o lead sumiria', async () => {
      const { svc, queue } = build();
      queue.add.mockRejectedValue(new Error('redis fora'));

      await expect(svc.enfileirar(JOB)).rejects.toThrow('redis fora');
    });
  });

  describe('processar', () => {
    it('busca os dados na Graph com o Page Access Token da conexão', async () => {
      const { svc, graph } = build();

      await svc.processar(JOB);

      expect(graph.obterLead).toHaveBeenCalledWith('lg-777', 'tok-page');
    });

    it('mapeia os campos padrão do formulário pro lead', async () => {
      const { svc, leads } = build();

      await svc.processar(JOB);

      expect(dto(leads)).toMatchObject({
        nome: 'Padaria Souza', // company_name é o nome do LEAD
        contatoNome: 'Ana Souza',
        contatoTelefone: '+55 11 98888-0001',
        contatoEmail: 'ana@padaria.com.br',
        cidade: 'São Paulo',
        origemCadastro: 'meta_lead_ads',
      });
    });

    it('formulário com nome e sobrenome separados (sem full_name) ainda vira nome', async () => {
      const { svc, leads } = build({
        dadosLead: {
          id: 'lg-777',
          field_data: [
            { name: 'first_name', values: ['Ana'] },
            { name: 'last_name', values: ['Souza'] },
            { name: 'phone_number', values: ['11988880001'] },
          ],
        },
      });

      await svc.processar(JOB);

      expect(dto(leads).contatoNome).toBe('Ana Souza');
    });

    it('guarda TODAS as respostas — pergunta customizada é onde vive a qualificação', async () => {
      const { svc, leads } = build({
        dadosLead: {
          id: 'lg-777',
          field_data: [
            ...CAMPOS_PADRAO,
            { name: 'qual_seu_setor', values: ['cadeia do frio'] },
            { name: 'ja_teve_queima', values: ['sim'] },
          ],
        },
      });

      await svc.processar(JOB);

      const vars = dto(leads).variaveis as Record<string, unknown>;
      expect(vars.respostasFormulario).toMatchObject({
        qual_seu_setor: 'cadeia do frio',
        ja_teve_queima: 'sim',
      });
    });

    it('resolve ad_id → nome da campanha e grava a atribuição', async () => {
      const { svc, leads } = build();

      await svc.processar(JOB);

      expect(dto(leads)).toMatchObject({
        utmSource: 'meta',
        utmMedium: 'lead_ads',
        utmCampaign: 'mb-industria-agosto', // normalizado (lower) como nos outros canais
      });
    });

    it('sem `ads_read` o lead ENTRA assim mesmo, com o ad_id de identificador', async () => {
      // ads_read é permissão separada de leads_retrieval: dá pra ter o lead e
      // não ter a campanha. Lead sem atribuição > nenhum lead.
      const { svc, leads } = build({ anuncioLanca: true });

      await svc.processar(JOB);

      expect(dto(leads)).toMatchObject({ utmSource: 'meta', utmCampaign: 'ad-42' });
    });

    it('grava o leadgen_id no lead — é a guarda durável de idempotência', async () => {
      const { svc, leads } = build();

      await svc.processar(JOB);

      expect((dto(leads).variaveis as Record<string, unknown>).metaLeadgenId).toBe('lg-777');
    });

    it('NÃO recria quando o leadgen_id já existe — o Meta reentrega webhook', async () => {
      const { svc, leads, graph } = build({ leadExistente: { id: 'lead-ja' } });

      await svc.processar(JOB);

      expect(leads.createPublico).not.toHaveBeenCalled();
      expect(graph.obterLead).not.toHaveBeenCalled();
    });

    it('página sem conexão não cria lead e não estoura — retry não resolveria isso', async () => {
      const { svc, leads } = build({ conexao: null });

      await expect(svc.processar(JOB)).resolves.toBeUndefined();
      expect(leads.createPublico).not.toHaveBeenCalled();
    });

    it('falha na Graph ESTOURA — é o que faz o BullMQ re-tentar', async () => {
      const { svc, graph } = build();
      graph.obterLead.mockRejectedValue(new Error('Meta Graph HTTP 500'));

      await expect(svc.processar(JOB)).rejects.toThrow('Meta Graph HTTP 500');
    });

    it('formulário sem nome, telefone nem e-mail não vira lead fantasma', async () => {
      const { svc, leads } = build({
        dadosLead: { id: 'lg-777', field_data: [{ name: 'consentimento', values: ['sim'] }] },
      });

      await svc.processar(JOB);

      expect(leads.createPublico).not.toHaveBeenCalled();
    });
  });
});
