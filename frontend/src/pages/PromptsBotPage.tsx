import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input } from '@/components/FormField';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/toast';
import { btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

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
        <button type="button" data-testid="prompt-new-btn" onClick={() => setCreating(true)} style={btn}>
          + Novo prompt
        </button>
      }
    >
      <div style={{ marginBottom: '0.75rem' }}>
        <Link to="/mullerbot/persona" style={{ fontSize: 13, color: colors.primary }}>
          ← Persona do bot (tom de voz, tetos de custo)
        </Link>
      </div>

      <div style={card}>
        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && prompts.length === 0}
          emptyMessage="Sem prompts ainda. Crie o primeiro e marque como padrão."
          onRetry={refetch}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {prompts.map((p) => (
              <div
                key={p.id}
                data-testid={`prompt-card-${p.id}`}
                style={{
                  border: `1px solid ${p.isPadrao ? colors.primary : colors.border}`,
                  borderRadius: 10,
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  background: colors.surface,
                  opacity: p.ativo ? 1 : 0.6,
                }}
              >
                <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <strong
                    style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {p.nome}
                  </strong>
                  {p.isPadrao && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#fff',
                        background: colors.primary,
                        padding: '2px 8px',
                        borderRadius: 999,
                      }}
                    >
                      PADRÃO
                    </span>
                  )}
                  {!p.ativo && (
                    <span style={{ fontSize: 11, color: colors.muted }}>inativo</span>
                  )}
                </header>
                {p.descricao && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: colors.muted,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {p.descricao}
                  </p>
                )}
                <p style={{ margin: 0, fontSize: 11, color: colors.muted }}>
                  Modelo: {p.modelo || 'padrão da empresa'} · v{p.versao}
                </p>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-testid={`prompt-edit-${p.id}`}
                    onClick={() => setEditing(p)}
                    style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
                  >
                    Editar
                  </button>
                  {!p.isPadrao && (
                    <button
                      type="button"
                      data-testid={`prompt-set-padrao-${p.id}`}
                      onClick={() => tornarPadrao(p)}
                      style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
                    >
                      Tornar padrão
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`prompt-del-${p.id}`}
                    onClick={() => excluir(p)}
                    style={{ ...btnDanger, padding: '0.25rem 0.625rem', fontSize: 12 }}
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
      <div style={{ ...card, marginTop: '0.75rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: 14 }}>Variáveis disponíveis</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: 12, color: colors.muted }}>
          Use nos prompts e nas mensagens dos fluxos com a sintaxe <code>{'{{escopo.nome}}'}</code>.
        </p>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {VARIAVEIS_REF.map((v) => (
            <div key={v.escopo} style={{ fontSize: 12 }}>
              <strong>{v.escopo}:</strong>{' '}
              {v.exemplos.map((ex) => (
                <code
                  key={ex}
                  style={{
                    background: colors.surfaceHover ?? '#f1f3f5',
                    padding: '1px 6px',
                    borderRadius: 6,
                    marginRight: 6,
                  }}
                >
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
      {ConfirmDialog}
    </PageLayout>
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
    <div style={{ ...card, marginTop: '0.75rem' }}>
      <strong style={{ fontSize: 14 }}>Variáveis customizadas ({'{{custom.*}}'})</strong>
      <p style={{ fontSize: 12, color: colors.muted, margin: '4px 0 8px' }}>
        Variáveis da empresa com valor padrão. Use nos prompts/fluxos como{' '}
        <code>{'{{custom.<chave>}}'}</code> — o lead pode sobrescrever.
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <Input
          placeholder="chave (ex: pedido_minimo_kg)"
          value={chave}
          onChange={(e) => setChave(e.target.value)}
        />
        <Input placeholder="valor padrão" value={valor} onChange={(e) => setValor(e.target.value)} />
        <button type="button" style={btn} disabled={busy || !chave.trim()} onClick={() => void salvar()}>
          Salvar
        </button>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {vars.map((v) => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <code style={{ background: '#f1f3f5', padding: '1px 6px', borderRadius: 6 }}>
              {`{{custom.${v.chave}}}`}
            </code>
            <span style={{ flex: 1, color: colors.muted }}>{v.valorPadrao ?? '—'}</span>
            <button
              type="button"
              onClick={() => void remover(v.id)}
              style={{ ...btnDanger, padding: '2px 8px', fontSize: 12 }}
            >
              remover
            </button>
          </div>
        ))}
        {vars.length === 0 && (
          <span style={{ fontSize: 12, color: colors.muted }}>Nenhuma variável ainda.</span>
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
  const [temperatura, setTemperatura] = useState(
    prompt?.temperatura != null ? String(prompt.temperatura) : '0.7',
  );
  const [isPadrao, setIsPadrao] = useState(prompt?.isPadrao ?? false);
  const [ativo, setAtivo] = useState(prompt?.ativo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        temperatura: temperatura.trim() ? Number(temperatura) : undefined,
        isPadrao,
        ativo,
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
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Editar prompt — ${prompt?.nome}` : 'Novo prompt'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="prompt-form"
            data-testid="prompt-save-btn"
            disabled={busy || nome.trim().length === 0 || texto.trim().length === 0}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
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
            maxLength={20000}
            placeholder="Ex: Você é a Bê, entrevistadora comercial da MSM..."
            style={{
              width: '100%',
              fontFamily: '"Fira Mono", monospace',
              fontSize: 13,
              padding: '0.5rem 0.625rem',
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              resize: 'vertical',
              background: colors.surface,
              color: colors.text,
            }}
          />
        </FormField>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <FormField label="Modelo" htmlFor="prompt-modelo" hint="vazio = padrão da empresa">
            <Input
              id="prompt-modelo"
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder="ex: gpt-4o-mini"
              maxLength={60}
            />
          </FormField>
          <FormField label="Temperatura" htmlFor="prompt-temp" hint="0 a 2">
            <Input
              id="prompt-temp"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperatura}
              onChange={(e) => setTemperatura(e.target.value)}
            />
          </FormField>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              data-testid="prompt-padrao-check"
              checked={isPadrao}
              onChange={(e) => setIsPadrao(e.target.checked)}
            />
            Prompt padrão
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo
          </label>
        </div>
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}
