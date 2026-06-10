import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select } from '@/components/FormField';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/toast';
import { btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

/**
 * Modelos OpenAI oferecidos no dropdown (MullerBot usa Chat Completions). Lista
 * curada pra evitar typo no nome do modelo (que estouraria erro na chamada).
 * Só modelos que aceitam `temperature` (os de raciocínio o-series ficam de fora).
 */
const MODELOS_OPENAI = [
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini (recomendado · rápido e barato)' },
  { id: 'gpt-4o', label: 'gpt-4o (mais capaz)' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
  { id: 'gpt-4.1', label: 'gpt-4.1 (mais capaz)' },
  { id: 'gpt-4.1-nano', label: 'gpt-4.1-nano (mais barato)' },
  { id: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo (legado · barato)' },
] as const;

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
                  <button
                    type="button"
                    data-testid={`prompt-versoes-${p.id}`}
                    onClick={() => setVersoesDe(p)}
                    style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
                    title="Histórico de versões e restauração"
                  >
                    Versões
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
                    background: colors.surfaceHover ?? colors.bgAlt,
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
    <Modal
      open
      onClose={onClose}
      title={`Versões — ${prompt.nome} (atual: v${prompt.versao})`}
      footer={
        <button type="button" onClick={onClose} style={btnSecondary}>
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
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {versoes.map((v) => (
            <div
              key={v.id}
              data-testid={`prompt-versao-${v.versao}`}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                padding: '0.625rem 0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.375rem',
                background: colors.surface,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <strong style={{ fontSize: 13, flex: 1 }}>
                  Versão {v.versao}
                  <span style={{ fontWeight: 400, color: colors.muted }}>
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
                  style={{
                    ...btnSecondary,
                    padding: '0.25rem 0.625rem',
                    fontSize: 12,
                    opacity: restoring != null ? 0.6 : 1,
                  }}
                >
                  {restoring === v.versao ? 'Restaurando…' : 'Restaurar'}
                </button>
              </div>
              {v.criadoEm && (
                <span style={{ fontSize: 11, color: colors.muted }}>
                  {new Date(v.criadoEm).toLocaleString('pt-BR')}
                </span>
              )}
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontFamily: '"Fira Mono", monospace',
                  color: colors.text,
                  background: colors.surfaceHover ?? colors.bgAlt,
                  padding: '0.5rem',
                  borderRadius: 8,
                  maxHeight: 120,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {v.texto}
              </pre>
            </div>
          ))}
        </div>
      </StateView>
    </Modal>
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
            <code style={{ background: colors.bgAlt, padding: '1px 6px', borderRadius: 6 }}>
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
  const [tetoTokensDia, setTetoTokensDia] = useState(
    prompt?.tetoTokensDia != null ? String(prompt.tetoTokensDia) : '',
  );
  const [tetoTokensMes, setTetoTokensMes] = useState(
    prompt?.tetoTokensMes != null ? String(prompt.tetoTokensMes) : '',
  );
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
            maxLength={50000}
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
            <Select id="prompt-modelo" value={modelo} onChange={(e) => setModelo(e.target.value)}>
              <option value="">Padrão da empresa</option>
              {MODELOS_OPENAI.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {/* Preserva um modelo customizado já salvo que não esteja na lista. */}
              {modelo && !MODELOS_OPENAI.some((m) => m.id === modelo) && (
                <option value={modelo}>{modelo} (customizado)</option>
              )}
            </Select>
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
        <div style={{ display: 'flex', gap: '0.75rem' }}>
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
