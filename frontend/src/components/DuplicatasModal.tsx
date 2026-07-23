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
export function DuplicatasModal({ onClose, onMerged }: { onClose: () => void; onMerged: () => void }) {
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
