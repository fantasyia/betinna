import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Badge, Button, Card, Dialog, Field, Input, Switch, Textarea } from '@/components/ui';
import { lerNumero, paraCampo } from '@/pages/precificacao/calculo';

/**
 * Facções (ERP próprio · Fase 2 · entrega 3): quem costura, contato e quanto
 * cobra por peça de cada modelo. A facção recebe o tecido JÁ CORTADO e cobra
 * por peça ENVIADA — é esse preço que a OP usa pra custear (entrega 4).
 */

interface Faccao {
  id: string;
  nome: string;
  contato: string | null;
  telefone: string | null;
  especialidade: string | null;
  observacoes: string | null;
  ativo: boolean;
  precos: Array<{ modeloId: string; modelo: string; precoPorPeca: number }>;
}

export default function FaccoesPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<Faccao[]>(gestor ? '/erp/faccoes' : null);
  const modelos = useApiQuery<Array<{ id: string; nome: string }>>(gestor ? '/vitrine/admin/modelos' : null);
  const [cadastro, setCadastro] = useState<Faccao | 'nova' | null>(null);
  const [precos, setPrecos] = useState<Faccao | null>(null);

  return (
    <PageLayout
      title="Facções"
      description="Quem costura, como falar com ela e quanto cobra por peça de cada modelo."
      actions={
        gestor ? (
          <Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCadastro('nova')} data-testid="faccao-nova">
            Nova facção
          </Button>
        ) : undefined
      }
    >
      <CatalogoTabs />
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa as facções.</Card>
      ) : (
        <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
          {(q.data ?? []).length === 0 ? (
            <Card className="p-6 text-sm text-muted text-center">Nenhuma facção cadastrada ainda.</Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(q.data ?? []).map((f) => (
                <Card key={f.id} className={`p-4 flex flex-col gap-2 ${f.ativo ? '' : 'opacity-60'}`} data-testid={`faccao-${f.id}`}>
                  <div className="flex items-start gap-2">
                    <div className="mr-auto">
                      <h2 className="text-base font-semibold">
                        {f.nome} {!f.ativo && <Badge variant="neutral" size="sm">inativa</Badge>}
                      </h2>
                      <p className="text-sm text-muted">
                        {[f.contato, f.telefone].filter(Boolean).join(' · ') || 'sem contato'}
                        {f.especialidade ? ` — ${f.especialidade}` : ''}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setCadastro(f)}>
                      Editar
                    </Button>
                  </div>
                  {f.precos.length === 0 ? (
                    <p className="text-sm text-muted">Sem preço por modelo ainda.</p>
                  ) : (
                    <ul className="text-sm divide-y divide-border">
                      {f.precos.map((p) => (
                        <li key={p.modeloId} className="flex justify-between py-1">
                          <span>{p.modelo}</span>
                          <b className="tabular-nums">{formatMoeda(p.precoPorPeca)}/peça</b>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <Button size="sm" variant="secondary" onClick={() => setPrecos(f)} data-testid={`faccao-precos-${f.id}`}>
                      Preço por modelo
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </StateView>
      )}

      {cadastro && (
        <CadastroDialog
          faccao={cadastro === 'nova' ? null : cadastro}
          onClose={() => setCadastro(null)}
          onSalvou={() => {
            setCadastro(null);
            q.refetch();
          }}
        />
      )}
      {precos && (
        <PrecosDialog
          faccao={precos}
          modelos={modelos.data ?? []}
          onClose={() => setPrecos(null)}
          onSalvou={() => {
            setPrecos(null);
            q.refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

function CadastroDialog({ faccao, onClose, onSalvou }: { faccao: Faccao | null; onClose: () => void; onSalvou: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState(faccao?.nome ?? '');
  const [contato, setContato] = useState(faccao?.contato ?? '');
  const [telefone, setTelefone] = useState(faccao?.telefone ?? '');
  const [especialidade, setEspecialidade] = useState(faccao?.especialidade ?? '');
  const [observacoes, setObservacoes] = useState(faccao?.observacoes ?? '');
  const [ativo, setAtivo] = useState(faccao?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);

  async function enviar(fn: () => Promise<unknown>, ok: string) {
    setSalvando(true);
    try {
      await fn();
      toast.success(ok);
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }
  const corpo = { nome: nome.trim(), contato, telefone, especialidade, observacoes, ativo };

  return (
    <Dialog
      open
      onClose={onClose}
      title={faccao ? 'Editar facção' : 'Nova facção'}
      footer={
        <div className="flex w-full items-center gap-2">
          {faccao && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-danger"
              disabled={salvando}
              onClick={() => enviar(() => api.delete(`/erp/faccoes/${faccao.id}`), 'Facção excluída')}
            >
              Excluir
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={nome.trim().length < 2}
            onClick={() =>
              enviar(
                () => (faccao ? api.put(`/erp/faccoes/${faccao.id}`, corpo) : api.post('/erp/faccoes', corpo)),
                faccao ? 'Facção salva' : 'Facção cadastrada',
              )
            }
            data-testid="faccao-salvar"
          >
            Salvar
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome" required className="col-span-2">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="faccao-nome" />
        </Field>
        <Field label="Contato">
          <Input value={contato} onChange={(e) => setContato(e.target.value)} />
        </Field>
        <Field label="Telefone / WhatsApp">
          <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="O que costura" className="col-span-2" hint="Ex.: moletom, malha, UV">
          <Input value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} />
        </Field>
        <Field label="Observações" className="col-span-2">
          <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} />
        </Field>
        {faccao && (
          <div className="col-span-2">
            <Switch label="Ativa" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PrecosDialog({
  faccao,
  modelos,
  onClose,
  onSalvou,
}: {
  faccao: Faccao;
  modelos: Array<{ id: string; nome: string }>;
  onClose: () => void;
  onSalvou: () => void;
}) {
  const toast = useToast();
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(faccao.precos.map((p) => [p.modeloId, paraCampo(p.precoPorPeca)])),
  );
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const precos = Object.entries(valores)
        .map(([modeloId, t]) => ({ modeloId, precoPorPeca: lerNumero(t) }))
        .filter((p): p is { modeloId: string; precoPorPeca: number } => p.precoPorPeca !== null && p.precoPorPeca >= 0);
      await api.put(`/erp/faccoes/${faccao.id}/precos`, { precos });
      toast.success('Tabela de preço salva');
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Preço por peça"
      description={`${faccao.nome} — quanto ela cobra por peça ENVIADA de cada modelo. Vazio = não costura esse modelo.`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando} data-testid="faccao-precos-salvar">
            Salvar
          </Button>
        </div>
      }
    >
      {modelos.length === 0 ? (
        <p className="text-sm text-muted">Nenhum modelo cadastrado na vitrine ainda.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {modelos.map((m) => (
            <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2">
              <span className="text-sm">{m.nome}</span>
              <Input
                value={valores[m.id] ?? ''}
                onChange={(e) => setValores((v) => ({ ...v, [m.id]: e.target.value }))}
                inputMode="decimal"
                placeholder="R$ / peça"
              />
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
