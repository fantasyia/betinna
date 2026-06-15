import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select } from '@/components/FormField';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

/** Biblioteca de prompts do bot (orquestração Fase A). */
interface BotPrompt {
  id: string;
  nome: string;
  descricao?: string | null;
  texto: string;
  modelo?: string | null;
  temperatura?: number | null;
  isPadrao: boolean;
  ativo: boolean;
  versao: number;
  tetoTokensDia?: number | null;
  tetoTokensMes?: number | null;
  atualizadoEm?: string;
}

/** Variáveis disponíveis pra interpolar nos prompts/mensagens dos fluxos. */
const VARIAVEIS_REF: { escopo: string; exemplos: string[] }[] = [
  { escopo: 'Lead', exemplos: ['{{lead.nome}}', '{{lead.empresa}}', '{{lead.cidade}}', '{{lead.uf}}'] },
  { escopo: 'Custom (IA/fluxos gravam)', exemplos: ['{{custom.classificacao_betinna}}', '{{custom.canal_dominante}}'] },
  { escopo: 'Sistema', exemplos: ['{{sistema.empresa_nome}}', '{{sistema.data_hoje}}'] },
];

export default function PromptsBotPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<BotPrompt[] | { data: BotPrompt[] }>(
    '/mullerbot/prompts',
  );
  const prompts: BotPrompt[] = Array.isArray(data) ? data : (data?.data ?? []);

  const [editing, setEditing] = useState<BotPrompt | null>(null);
  const [creating, setCreating] = useState(false);
  const [versoesDe, setVersoesDe] = useState<BotPrompt | null>(null);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function tornarPadrao(p: BotPrompt) {
    try {
      await api.patch(`/mullerbot/prompts/${p.id}/padrao`);
      toast.success(`"${p.nome}" agora é o prompt padrão`);
      refetch();
    } catch (err) {
      toast.error('Falha ao definir padrão', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function excluir(p: BotPrompt) {
    const ok = await confirmAsync({
      title: `Excluir o prompt "${p.nome}"?`,
      message: p.isPadrao
        ? 'É o prompt padrão. O bot volta a usar a persona até você marcar outro.'
        : 'Não pode ser desfeito.',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/mullerbot/prompts/${p.id}`);
      toast.success('Prompt excluído');
      refetch();
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <PageLayout
      title="Prompts do bot"
      description="Biblioteca de prompts reutilizáveis. O marcado como padrão é o que o bot usa quando um fluxo não especifica outro."
      actions={
        <button
          type="button"
          data-testid="prompt-new-btn"
          onClick={() => setCreating(true)}
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
        >
          + Novo prompt
        </button>
      }
    >
      <div className="mb-3">
        <Link to="/mullerbot/persona" className="text-[13px] text-primary">
          ← Persona do bot (tom de voz, tetos de custo)
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-[10px] p-6">
        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && prompts.length === 0}
          emptyMessage="Sem prompts ainda. Crie o primeiro e marque como padrão."
          onRetry={refetch}
        >
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {prompts.map((p) => (
              <div
                key={p.id}
                data-testid={`prompt-card-${p.id}`}
                className={cn(
                  'border rounded-[10px] p-3 flex flex-col gap-2 bg-surface',
                  p.isPadrao ? 'border-primary' : 'border-border',
                  !p.ativo && 'opacity-60',
                )}
              >
                <header className="flex items-center gap-2">
                  <strong className="flex-1 text-[14px] overflow-hidden text-ellipsis">
                    {p.nome}
                  </strong>
                  {p.isPadrao && (
                    <span className="text-[11px] font-bold text-white bg-primary px-2 py-0.5 rounded-full">
                      PADRÃO
                    </span>
                  )}
                  {!p.ativo && <span className="text-[11px] text-muted">inativo</span>}
                </header>
                {p.descricao && (
                  <p className="m-0 text-[12px] text-muted [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
                    {p.descricao}
                  </p>
                )}
                <p className="m-0 text-[11px] text-muted">
                  Modelo: {p.modelo || 'padrão da empresa'} · v{p.versao}
                </p>
                <div className="flex gap-1 flex-wrap">
                  <button
                    type="button"
                    data-testid={`prompt-edit-${p.id}`}
                    onClick={() => setEditing(p)}
                    className="bg-surface text-text border border-border-strong rounded-md px-2.5 py-1 text-[12px] font-medium cursor-pointer tracking-[-0.1px]"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    data-testid={`prompt-versoes-${p.id}`}
                    onClick={() => setVersoesDe(p)}
                    className="bg-surface text-text border border-border-strong rounded-md px-2.5 py-1 text-[12px] font-medium cursor-pointer tracking-[-0.1px]"
                    title="Histórico de versões e restauração"
                  >
                    Versões
                  </button>
                  {!p.isPadrao && (
                    <button
                      type="button"
                      data-testid={`prompt-set-padrao-${p.id}`}
                      onClick={() => tornarPadrao(p)}
                      className="bg-surface text-text border border-border-strong rounded-md px-2.5 py-1 text-[12px] font-medium cursor-pointer tracking-[-0.1px]"
                    >
                      Tornar padrão
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`prompt-del-${p.id}`}
                    onClick={() => excluir(p)}
                    className="bg-danger text-white rounded-md px-2.5 py-1 text-[12px] font-semibold cursor-pointer tracking-[-0.1px]"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </StateView>
      </div>

      {/* Referência de variáveis disponíveis */}
      <div className="bg-surface border border-border rounded-[10px] p-6 mt-3">
        <h3 className="mt-0 mx-0 mb-2 text-[14px]">Variáveis disponíveis</h3>
        <p className="mt-0 mx-0 mb-3 text-[12px] text-muted">
          Use nos prompts e nas mensagens dos fluxos com a sintaxe <code>{'{{escopo.nome}}'}</code>.
        </p>
        <div className="grid gap-2">
          {VARIAVEIS_REF.map((v) => (
            <div key={v.escopo} className="text-[12px]">
              <strong>{v.escopo}:</strong>{' '}
              {v.exemplos.map((ex) => (
                <code key={ex} className="bg-surface-hover px-1.5 py-px rounded-md mr-1.5">
                  {ex}
                </code>
              ))}
            </div>
          ))}
        </div>
      </div>

      <VariaveisCustomizadasSection />

      {(creating || editing) && (
        <PromptFormModal
          prompt={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            refetch();
          }}
        />
      )}
      {versoesDe && (
        <VersoesModal
          prompt={versoesDe}
          onClose={() => setVersoesDe(null)}
          onRestored={() => {
            setVersoesDe(null);
            refetch();
          }}
        />
      )}
      {ConfirmDialog}
    </PageLayout>
  );
}

interface PromptVersao {
  id: string;
  versao: number;
  texto: string;
  modelo?: string | null;
  temperatura?: number | null;
  criadoEm?: string;
}

/** Histórico de versões de um prompt + restauração (rollback) — Fase C. */
function VersoesModal({
  prompt,
  onClose,
  onRestored,
}: {
  prompt: BotPrompt;
  onClose: () => void;
  onRestored: () => void;
}) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<
    PromptVersao[] | { data: PromptVersao[] }
  >(`/mullerbot/prompts/${prompt.id}/versoes`);
  const versoes: PromptVersao[] = Array.isArray(data) ? data : (data?.data ?? []);
  const [restoring, setRestoring] = useState<number | null>(null);

  async function restaurar(v: PromptVersao) {
    setRestoring(v.versao);
    try {
      await api.post(`/mullerbot/prompts/${prompt.id}/rollback/${v.versao}`);
      toast.success(`Prompt restaurado para a versão ${v.versao}`);
      onRestored();
    } catch (err) {
      toast.error('Falha ao restaurar', err instanceof ApiError ? err.message : undefined);
      setRestoring(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Versões — ${prompt.nome} (atual: v${prompt.versao})`}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
        >
          Fechar
        </button>
      }
    >
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && versoes.length === 0}
        emptyMessage="Sem versões anteriores. Cada edição do texto/modelo/temperatura gera uma."
        onRetry={refetch}
      >
        <div className="grid gap-2">
          {versoes.map((v) => (
            <div
              key={v.id}
              data-testid={`prompt-versao-${v.versao}`}
              className="border border-border rounded-[10px] px-3 py-2.5 flex flex-col gap-1.5 bg-surface"
            >
              <div className="flex items-center gap-2">
                <strong className="text-[13px] flex-1">
                  Versão {v.versao}
                  <span className="font-normal text-muted">
                    {' '}
                    · {v.modelo || 'modelo padrão'}
                    {v.temperatura != null ? ` · temp ${v.temperatura}` : ''}
                  </span>
                </strong>
                <button
                  type="button"
                  data-testid={`prompt-restaurar-${v.versao}`}
                  onClick={() => void restaurar(v)}
                  disabled={restoring != null}
                  className={cn(
                    'bg-surface text-text border border-border-strong rounded-md px-2.5 py-1 text-[12px] font-medium cursor-pointer tracking-[-0.1px]',
                    restoring != null ? 'opacity-60' : 'opacity-100',
                  )}
                >
                  {restoring === v.versao ? 'Restaurando…' : 'Restaurar'}
                </button>
              </div>
              {v.criadoEm && (
                <span className="text-[11px] text-muted">
                  {new Date(v.criadoEm).toLocaleString('pt-BR')}
                </span>
              )}
              <pre
                className='m-0 text-[11px] font-["Fira_Mono",monospace] text-text bg-surface-hover p-2 rounded-[8px] max-h-[120px] overflow-auto whitespace-pre-wrap [word-break:break-word]'
              >
                {v.texto}
              </pre>
            </div>
          ))}
        </div>
      </StateView>
    </Dialog>
  );
}

interface VarCustom {
  id: string;
  chave: string;
  descricao?: string | null;
  valorPadrao?: string | null;
}

/** Editor de variáveis customizadas da empresa ({{custom.*}}) — Fase C. */
function VariaveisCustomizadasSection() {
  const toast = useToast();
  const { data, refetch } = useApiQuery<VarCustom[] | { data: VarCustom[] }>('/orquestracao/variaveis');
  const vars: VarCustom[] = Array.isArray(data) ? data : (data?.data ?? []);
  const [chave, setChave] = useState('');
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);

  async function salvar() {
    if (!chave.trim()) return;
    setBusy(true);
    try {
      await api.post('/orquestracao/variaveis', {
        chave: chave.trim(),
        valorPadrao: valor.trim() || undefined,
      });
      setChave('');
      setValor('');
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  async function remover(id: string) {
    try {
      await api.delete(`/orquestracao/variaveis/${id}`);
      refetch();
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-3">
      <strong className="text-[14px]">Variáveis customizadas ({'{{custom.*}}'})</strong>
      <p className="text-[12px] text-muted mt-1 mx-0 mb-2">
        Variáveis da empresa com valor padrão. Use nos prompts/fluxos como{' '}
        <code>{'{{custom.<chave>}}'}</code> — o lead pode sobrescrever.
      </p>
      <div className="flex gap-1.5 mb-2 flex-wrap">
        <Input
          placeholder="chave (ex: pedido_minimo_kg)"
          value={chave}
          onChange={(e) => setChave(e.target.value)}
        />
        <Input placeholder="valor padrão" value={valor} onChange={(e) => setValor(e.target.value)} />
        <button
          type="button"
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          disabled={busy || !chave.trim()}
          onClick={() => void salvar()}
        >
          Salvar
        </button>
      </div>
      <div className="grid gap-1">
        {vars.map((v) => (
          <div key={v.id} className="flex items-center gap-2 text-[13px]">
            <code className="bg-bg-alt px-1.5 py-px rounded-md">
              {`{{custom.${v.chave}}}`}
            </code>
            <span className="flex-1 text-muted">{v.valorPadrao ?? '—'}</span>
            <button
              type="button"
              onClick={() => void remover(v.id)}
              className="bg-danger text-white rounded-md px-2 py-0.5 text-[12px] font-semibold cursor-pointer tracking-[-0.1px]"
            >
              remover
            </button>
          </div>
        ))}
        {vars.length === 0 && (
          <span className="text-[12px] text-muted">Nenhuma variável ainda.</span>
        )}
      </div>
    </div>
  );
}

function PromptFormModal({
  prompt,
  onClose,
  onSaved,
}: {
  prompt: BotPrompt | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(prompt);
  const [nome, setNome] = useState(prompt?.nome ?? '');
  const [descricao, setDescricao] = useState(prompt?.descricao ?? '');
  const [texto, setTexto] = useState(prompt?.texto ?? '');
  const [modelo, setModelo] = useState(prompt?.modelo ?? '');
  // Modelos reais da conta OpenAI (puxados ao vivo) — mesmo dropdown da Persona.
  const [modelosLive, setModelosLive] = useState<string[]>([]);
  const [isPadrao, setIsPadrao] = useState(prompt?.isPadrao ?? false);
  const [ativo, setAtivo] = useState(prompt?.ativo ?? true);
  const [tetoTokensDia, setTetoTokensDia] = useState(
    prompt?.tetoTokensDia != null ? String(prompt.tetoTokensDia) : '',
  );
  const [tetoTokensMes, setTetoTokensMes] = useState(
    prompt?.tetoTokensMes != null ? String(prompt.tetoTokensMes) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ modelos: string[]; fonte: string }>('/mullerbot/bot/modelos')
      .then((r) => setModelosLive(r.modelos ?? []))
      .catch(() => setModelosLive([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        texto: texto.trim(),
        modelo: modelo.trim() || undefined,
        isPadrao,
        ativo,
        tetoTokensDia: tetoTokensDia.trim() ? Number(tetoTokensDia) : null,
        tetoTokensMes: tetoTokensMes.trim() ? Number(tetoTokensMes) : null,
      };
      if (isEdit && prompt) {
        await api.patch(`/mullerbot/prompts/${prompt.id}`, payload);
      } else {
        await api.post('/mullerbot/prompts', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? `Editar prompt — ${prompt?.nome}` : 'Novo prompt'}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="prompt-form"
            data-testid="prompt-save-btn"
            disabled={busy || nome.trim().length === 0 || texto.trim().length === 0}
            className={cn(
              'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]',
              busy ? 'opacity-60' : 'opacity-100',
            )}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="prompt-form" onSubmit={submit}>
        <FormField label="Nome" htmlFor="prompt-nome" required>
          <Input
            id="prompt-nome"
            data-testid="prompt-nome-input"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            maxLength={80}
            autoFocus
          />
        </FormField>
        <FormField label="Descrição" htmlFor="prompt-descricao" hint="Opcional — pra você se lembrar do uso">
          <Input
            id="prompt-descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={1000}
          />
        </FormField>
        <FormField label="Texto do prompt" htmlFor="prompt-texto" required>
          <textarea
            id="prompt-texto"
            data-testid="prompt-texto-input"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            required
            rows={10}
            maxLength={50000}
            placeholder="Ex: Você é a Bê, entrevistadora comercial da MSM..."
            className='w-full font-["Fira_Mono",monospace] text-[13px] py-2 px-2.5 border border-border rounded-[10px] resize-y bg-surface text-text'
          />
        </FormField>
        <FormField
          label="Modelo"
          htmlFor="prompt-modelo"
          hint={
            modelosLive.length
              ? 'Lista puxada ao vivo da sua conta OpenAI — inclui os modelos mais novos.'
              : 'vazio = padrão da empresa'
          }
        >
          <Select id="prompt-modelo" value={modelo} onChange={(e) => setModelo(e.target.value)}>
            <option value="">Padrão da empresa</option>
            {/* Mantém o modelo salvo visível mesmo se a lista ainda não carregou. */}
            {modelo && !modelosLive.includes(modelo) && (
              <option value={modelo}>{modelo} (atual)</option>
            )}
            {modelosLive.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="flex gap-3">
          <FormField
            label="Teto de tokens/dia"
            htmlFor="prompt-teto-dia"
            hint="0 ou vazio = sem limite"
          >
            <Input
              id="prompt-teto-dia"
              data-testid="prompt-teto-dia-input"
              type="number"
              min={0}
              step={1000}
              value={tetoTokensDia}
              onChange={(e) => setTetoTokensDia(e.target.value)}
              placeholder="ex: 100000"
            />
          </FormField>
          <FormField
            label="Teto de tokens/mês"
            htmlFor="prompt-teto-mes"
            hint="0 ou vazio = sem limite"
          >
            <Input
              id="prompt-teto-mes"
              data-testid="prompt-teto-mes-input"
              type="number"
              min={0}
              step={10000}
              value={tetoTokensMes}
              onChange={(e) => setTetoTokensMes(e.target.value)}
              placeholder="ex: 2000000"
            />
          </FormField>
        </div>
        <div className="flex gap-5 mt-2">
          <label className="flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              data-testid="prompt-padrao-check"
              checked={isPadrao}
              onChange={(e) => setIsPadrao(e.target.checked)}
            />
            Prompt padrão
          </label>
          <label className="flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo
          </label>
        </div>
        {error && <p className="text-danger text-[13px]">{error}</p>}
      </form>
    </Dialog>
  );
}
