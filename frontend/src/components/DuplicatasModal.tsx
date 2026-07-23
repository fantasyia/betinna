import { useEffect, useState } from 'react';
import { AlertTriangle, GitMerge, Undo2 } from 'lucide-react';
import { Badge, Button, Dialog, Spinner } from '@/components/ui';
import { StateView } from '@/components/StateView';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { api, apiErrorMessage } from '@/lib/api';
import { formatTelefone } from '@/lib/phone';

type LeadDup = {
  id: string;
  nome: string;
  contatoTelefone: string | null;
  contatoEmail: string | null;
  criadoEm: string;
  utmCampaign: string | null;
  maisAntigo: boolean;
};

type Grupo = {
  chave: string;
  motivo: 'telefone' | 'email';
  leads: LeadDup[];
};

type Previa = {
  principal: { id: string; nome: string };
  absorvido: { id: string; nome: string };
  atribuicaoFinal: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    origemCadastro: string | null;
  };
  atribuicaoMudou: boolean;
  camposPreenchidos: Array<{ campo: string; valor: string }>;
  vinculosMigrados: { tags: number; historicoEtapas: number; conversas: number; formularios: number };
};

/**
 * Duplicatas de leads (mesmo telefone/e-mail). SÓ o gestor mescla. O app aponta
 * os candidatos; a decisão e o "quem sobrevive" são humanos — telefone parecido
 * virando fusão automática é como se perde cliente.
 */
export function DuplicatasModal({
  onClose,
  onMerged,
  podeCliente = false,
}: {
  onClose: () => void;
  onMerged: () => void;
  /** ADMIN/DIRECTOR: libera a aba de duplicatas de CLIENTE (fiscal/financeiro). */
  podeCliente?: boolean;
}) {
  const [aba, setAba] = useState<'leads' | 'clientes'>('leads');
  const { data, loading, error, refetch } = useApiQuery<Grupo[]>('/contatos/duplicatas');
  const [par, setPar] = useState<{ grupo: Grupo; principal: LeadDup; absorvido: LeadDup } | null>(
    null,
  );

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title="Contatos duplicados"
        size="lg"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        }
      >
        {podeCliente && (
          <div className="flex gap-1 mb-3 border-b border-border">
            <AbaBtn ativa={aba === 'leads'} onClick={() => setAba('leads')}>
              Leads
            </AbaBtn>
            <AbaBtn ativa={aba === 'clientes'} onClick={() => setAba('clientes')}>
              Clientes
            </AbaBtn>
          </div>
        )}

        {aba === 'clientes' ? (
          <ClientesDuplicatas onMerged={onMerged} />
        ) : (
          <>
        <p className="text-sm text-text-subtle mb-3">
          Leads que parecem ser a mesma pessoa (mesmo telefone ou e-mail). Escolha quem fica e
          quem é absorvido — a campanha que trouxe o contato é sempre preservada.
        </p>
        <StateView loading={loading} error={error} onRetry={refetch}>
          {data && data.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-text-subtle">
              <GitMerge className="h-8 w-8 opacity-40" />
              <p className="text-sm">Nenhuma duplicata encontrada. Sua base está limpa.</p>
            </div>
          )}
          <div className="flex flex-col gap-4">
            {data?.map((g) => (
              <div key={`${g.motivo}:${g.chave}`} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-muted">
                  <Badge variant="warning">
                    {g.motivo === 'telefone' ? 'Mesmo telefone' : 'Mesmo e-mail'}
                  </Badge>
                  <span className="tabular">
                    {g.motivo === 'telefone' ? formatTelefone(g.chave) : g.chave}
                  </span>
                  <span>· {g.leads.length} registros</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {g.leads.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-bg-alt px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text truncate">{l.nome}</span>
                          {l.maisAntigo && <Badge variant="info">mais antigo</Badge>}
                          {l.utmCampaign && (
                            <span className="text-xs text-primary truncate">🎯 {l.utmCampaign}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted truncate">
                          {l.contatoTelefone ? formatTelefone(l.contatoTelefone) : l.contatoEmail}
                          {' · desde '}
                          {new Date(l.criadoEm).toLocaleDateString('pt-BR')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Só faz sentido mesclar par a par: 1 principal + 1 absorvido. */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {g.leads.length === 2 ? (
                    <>
                      <ParButton
                        label={`Manter "${nomeCurto(g.leads[0].nome)}", absorver o outro`}
                        onClick={() =>
                          setPar({ grupo: g, principal: g.leads[0], absorvido: g.leads[1] })
                        }
                      />
                      <ParButton
                        label={`Manter "${nomeCurto(g.leads[1].nome)}", absorver o outro`}
                        onClick={() =>
                          setPar({ grupo: g, principal: g.leads[1], absorvido: g.leads[0] })
                        }
                      />
                    </>
                  ) : (
                    <span className="text-xs text-muted">
                      3+ registros: mescle de dois em dois (comece pelos dois mais parecidos).
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </StateView>
          </>
        )}
      </Dialog>

      {par && (
        <MesclarConfirm
          principalId={par.principal.id}
          absorvidoId={par.absorvido.id}
          onClose={() => setPar(null)}
          onDone={() => {
            setPar(null);
            refetch();
            onMerged();
          }}
        />
      )}
    </>
  );
}

function AbaBtn({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ' +
        (ativa ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text')
      }
    >
      {children}
    </button>
  );
}

// ─── Duplicatas de CLIENTE (fiscal/financeiro — ADMIN/DIRECTOR) ──────────

type ClienteDup = {
  id: string;
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
  criadoEm: string;
  maisAntigo: boolean;
};
type GrupoCliente = { chave: string; motivo: 'cnpj' | 'telefone' | 'email'; clientes: ClienteDup[] };
type PreviaCliente = {
  principal: { id: string; nome: string; cnpj: string | null };
  absorvido: { id: string; nome: string; cnpj: string | null };
  migra: { pedidos: number; propostas: number; amostras: number };
  conflitosPreco: number;
  pontosFidelidadeSomados: number;
};

const MOTIVO_LABEL: Record<GrupoCliente['motivo'], string> = {
  cnpj: 'Mesmo CNPJ',
  telefone: 'Mesmo telefone',
  email: 'Mesmo e-mail',
};

function ClientesDuplicatas({ onMerged }: { onMerged: () => void }) {
  const { data, loading, error, refetch } = useApiQuery<GrupoCliente[]>(
    '/contatos/clientes/duplicatas',
  );
  const [par, setPar] = useState<{ principal: ClienteDup; absorvido: ClienteDup } | null>(null);

  return (
    <>
      <p className="text-sm text-text-subtle mb-3">
        Clientes que parecem ser a mesma empresa. Envolve pedidos e dado fiscal — só mescla com
        CNPJ igual, e a comissão já fechada nunca é recalculada.
      </p>
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && data.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-text-subtle">
            <GitMerge className="h-8 w-8 opacity-40" />
            <p className="text-sm">Nenhum cliente duplicado encontrado.</p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {data?.map((g) => (
            <div key={`${g.motivo}:${g.chave}`} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 mb-2 text-xs text-muted">
                <Badge variant="warning">{MOTIVO_LABEL[g.motivo]}</Badge>
                <span className="tabular truncate">{g.chave}</span>
                <span>· {g.clientes.length} registros</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {g.clientes.map((c) => (
                  <div key={c.id} className="rounded-md bg-bg-alt px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text truncate">{c.nome}</span>
                      {c.maisAntigo && <Badge variant="info">mais antigo</Badge>}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {c.cnpj ? `CNPJ ${c.cnpj}` : 'sem CNPJ'}
                      {c.telefone ? ` · ${formatTelefone(c.telefone)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
              {g.clientes.length === 2 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<GitMerge className="h-3.5 w-3.5" />}
                    onClick={() => setPar({ principal: g.clientes[0], absorvido: g.clientes[1] })}
                  >
                    Manter &quot;{nomeCurto(g.clientes[0].nome)}&quot;
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<GitMerge className="h-3.5 w-3.5" />}
                    onClick={() => setPar({ principal: g.clientes[1], absorvido: g.clientes[0] })}
                  >
                    Manter &quot;{nomeCurto(g.clientes[1].nome)}&quot;
                  </Button>
                </div>
              ) : (
                <span className="mt-2 block text-xs text-muted">
                  3+ registros: mescle de dois em dois.
                </span>
              )}
            </div>
          ))}
        </div>
      </StateView>

      {par && (
        <MesclarClienteConfirm
          principalId={par.principal.id}
          absorvidoId={par.absorvido.id}
          onClose={() => setPar(null)}
          onDone={() => {
            setPar(null);
            refetch();
            onMerged();
          }}
        />
      )}
    </>
  );
}

function MesclarClienteConfirm({
  principalId,
  absorvidoId,
  onClose,
  onDone,
}: {
  principalId: string;
  absorvidoId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [previa, setPrevia] = useState<PreviaCliente | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    api
      .post<PreviaCliente>('/contatos/clientes/mesclar/previa', { principalId, absorvidoId })
      .then((r) => vivo && setPrevia(r))
      .catch((err) => vivo && setErro(apiErrorMessage(err)))
      .finally(() => vivo && setLoading(false));
    return () => {
      vivo = false;
    };
  }, [principalId, absorvidoId]);

  async function mesclar() {
    setBusy(true);
    try {
      await api.post('/contatos/clientes/mesclar', { principalId, absorvidoId });
      toast.success('Clientes mesclados', 'Use "Desfazer" no histórico se foi engano.');
      onDone();
    } catch (err) {
      toast.error('Falha ao mesclar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mesclar clientes"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={loading || !!erro}
            leftIcon={<GitMerge className="h-3.5 w-3.5" />}
            onClick={() => void mesclar()}
            data-testid="confirmar-mesclagem-cliente"
          >
            Mesclar
          </Button>
        </>
      }
    >
      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner /> Calculando o que vai acontecer…
        </div>
      )}
      {erro && (
        <div className="flex items-start gap-2 rounded-md bg-danger/10 border border-danger/30 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {erro}
        </div>
      )}
      {previa && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Vai ficar <strong className="text-text">{previa.principal.nome}</strong>. O cliente{' '}
            <strong className="text-text">{previa.absorvido.nome}</strong> é absorvido e deixa de
            existir.
          </p>
          <div className="rounded-md bg-bg-alt px-3 py-2 text-text-subtle">
            Migram pro sobrevivente: <strong className="text-text">{previa.migra.pedidos}</strong>{' '}
            pedido(s), {previa.migra.propostas} proposta(s), {previa.migra.amostras} amostra(s).
            <div className="text-xs text-muted mt-1">
              Comissão já fechada NÃO é recalculada.
            </div>
          </div>
          {previa.conflitosPreco > 0 && (
            <div className="rounded-md bg-warning/12 px-3 py-2 text-warning text-xs">
              {previa.conflitosPreco} preço(s) especial(is) em conflito — vence o do sobrevivente.
            </div>
          )}
          {previa.pontosFidelidadeSomados > 0 && (
            <div className="text-xs text-muted">
              {previa.pontosFidelidadeSomados} ponto(s) de fidelidade serão somados ao sobrevivente.
            </div>
          )}
          <div className="text-xs text-muted">Dá pra desfazer depois.</div>
        </div>
      )}
    </Dialog>
  );
}

function ParButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      leftIcon={<GitMerge className="h-3.5 w-3.5" />}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/**
 * Confirmação com PRÉVIA: mostra o que fica, qual campanha sobrevive e quantos
 * vínculos migram ANTES de fundir. Mesclar é irreversível na prática, ninguém
 * deve descobrir o resultado depois.
 */
function MesclarConfirm({
  principalId,
  absorvidoId,
  onClose,
  onDone,
}: {
  principalId: string;
  absorvidoId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [loading, setLoading] = useState(true);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ultimaMesclagemId, setUltimaMesclagemId] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErroPrevia(null);
    api
      .post<Previa>('/contatos/mesclar/previa', { principalId, absorvidoId })
      .then((r) => vivo && setPrevia(r))
      .catch((err) => vivo && setErroPrevia(apiErrorMessage(err)))
      .finally(() => vivo && setLoading(false));
    return () => {
      vivo = false;
    };
  }, [principalId, absorvidoId]);

  async function mesclar() {
    setBusy(true);
    try {
      const r = await api.post<{ mesclagemId: string }>('/contatos/mesclar', {
        principalId,
        absorvidoId,
      });
      setUltimaMesclagemId(r.mesclagemId);
      toast.success('Contatos mesclados', 'Use "Desfazer" se foi engano.');
      onDone();
    } catch (err) {
      toast.error('Falha ao mesclar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function desfazer(id: string) {
    try {
      await api.post(`/contatos/mesclagens/${id}/desfazer`, {});
      toast.success('Mesclagem desfeita');
    } catch (err) {
      toast.error('Falha ao desfazer', apiErrorMessage(err));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mesclar contatos"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {ultimaMesclagemId ? (
            <Button
              variant="secondary"
              leftIcon={<Undo2 className="h-3.5 w-3.5" />}
              onClick={() => void desfazer(ultimaMesclagemId)}
            >
              Desfazer
            </Button>
          ) : (
            <Button
              variant="danger"
              loading={busy}
              disabled={loading || !!erroPrevia}
              leftIcon={<GitMerge className="h-3.5 w-3.5" />}
              onClick={() => void mesclar()}
              data-testid="confirmar-mesclagem"
            >
              Mesclar
            </Button>
          )}
        </>
      }
    >
      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner /> Calculando o que vai acontecer…
        </div>
      )}
      {erroPrevia && (
        <div className="flex items-start gap-2 rounded-md bg-danger/10 border border-danger/30 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          Não deu pra montar a prévia. {erroPrevia}
        </div>
      )}
      {previa && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Vai ficar <strong className="text-text">{previa.principal.nome}</strong>. O registro{' '}
            <strong className="text-text">{previa.absorvido.nome}</strong> é absorvido e deixa de
            existir.
          </p>

          <div className="rounded-md bg-bg-alt px-3 py-2">
            <div className="text-xs text-muted mb-1">Campanha que fica (a do mais antigo)</div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-text">
                {previa.atribuicaoFinal.utmCampaign ?? '— sem campanha —'}
              </span>
              {previa.atribuicaoMudou && <Badge variant="info">herdada do absorvido</Badge>}
            </div>
          </div>

          {previa.camposPreenchidos.length > 0 && (
            <div className="rounded-md bg-bg-alt px-3 py-2">
              <div className="text-xs text-muted mb-1">Vai preencher campos que estavam vazios</div>
              <ul className="list-disc pl-4 text-text-subtle">
                {previa.camposPreenchidos.map((c) => (
                  <li key={c.campo}>
                    <span className="text-text">{c.campo}</span>: {c.valor}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-xs text-muted">
            Migram junto: {previa.vinculosMigrados.tags} tag(s),{' '}
            {previa.vinculosMigrados.conversas} conversa(s),{' '}
            {previa.vinculosMigrados.historicoEtapas} de histórico,{' '}
            {previa.vinculosMigrados.formularios} formulário(s). Dá pra desfazer depois.
          </div>
        </div>
      )}
    </Dialog>
  );
}

function nomeCurto(nome: string): string {
  return nome.length > 22 ? nome.slice(0, 22) + '…' : nome;
}
