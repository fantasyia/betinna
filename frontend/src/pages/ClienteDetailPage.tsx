import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

// ─── Tipos compartilhados ────────────────────────────────────────────

type ClienteStatus = 'NOVO' | 'PROSPECT' | 'ATIVO' | 'INATIVO';
type OmieStatus = 'ATIVO' | 'BLOQUEADO';

interface Cliente {
  id: string;
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  status: ClienteStatus;
  omieStatus: OmieStatus;
  score: number;
  prazoPagamento?: number;
  limiteCredito?: number | null;
  representante?: { id: string; nome: string } | null;
  tags?: Array<{ id: string; nome: string; cor?: string | null }>;
  criadoEm?: string;
  atualizadoEm?: string;
}

interface NotaPrivada {
  id: string;
  texto: string;
  autor?: { id: string; nome: string };
  criadoEm: string;
  atualizadoEm: string;
}

interface Documento {
  id: string;
  nome: string;
  mimetype: string;
  tamanho: number;
  criadoEm: string;
  uploadedBy?: { id: string; nome: string };
}

interface PrecoEspecial {
  produtoId: string;
  produto?: { id: string; nome: string; sku?: string; precoTabela?: number };
  precoEspecial: number;
  descontoBase: number;
  validoAte?: string | null;
}

interface ProdutoOpt {
  id: string;
  nome: string;
  sku?: string | null;
  precoTabela?: number;
}

const STATUS_COLOR: Record<ClienteStatus, string> = {
  NOVO: colors.warning,
  PROSPECT: '#0891b2',
  ATIVO: colors.success,
  INATIVO: colors.muted,
};
const OMIE_COLOR: Record<OmieStatus, string> = {
  ATIVO: colors.success,
  BLOQUEADO: colors.danger,
};

type Tab = 'dados' | 'notas' | 'documentos' | 'precos';

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

// ─── Página principal ────────────────────────────────────────────────

export default function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('dados');

  const { data: cliente, loading, error, refetch } = useApiQuery<Cliente>(
    id ? `/clientes/${id}` : null,
  );

  if (!id) {
    return (
      <PageLayout title="Cliente">
        <p>ID inválido</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={cliente ? cliente.nome : 'Cliente'}
      actions={
        <Link to="/clientes" style={{ ...btnSecondary, textDecoration: 'none' }}>
          ← Voltar pra lista
        </Link>
      }
    >
      <StateView loading={loading && !cliente} error={error} onRetry={refetch}>
        {cliente && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <span style={badge(STATUS_COLOR[cliente.status])}>{cliente.status}</span>
              <span style={badge(OMIE_COLOR[cliente.omieStatus])}>OMIE {cliente.omieStatus}</span>
              {cliente.cnpj && (
                <span style={{ fontSize: 13, color: colors.muted }}>
                  CNPJ {cliente.cnpj}
                </span>
              )}
              {cliente.representante?.nome && (
                <span style={{ fontSize: 13, color: colors.muted }}>
                  Rep: <strong>{cliente.representante.nome}</strong>
                </span>
              )}
              {cliente.tags && cliente.tags.length > 0 && (
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {cliente.tags.map((t) => (
                    <span key={t.id} style={badge(t.cor ?? colors.muted)}>
                      {t.nome}
                    </span>
                  ))}
                </span>
              )}
            </div>

            <div
              role="tablist"
              style={{
                display: 'flex',
                gap: 0,
                borderBottom: `1px solid ${colors.border}`,
                marginBottom: '1rem',
              }}
            >
              <TabButton current={tab} value="dados" onChange={setTab}>
                Dados
              </TabButton>
              <TabButton current={tab} value="notas" onChange={setTab}>
                Notas privadas
              </TabButton>
              <TabButton current={tab} value="documentos" onChange={setTab}>
                Documentos
              </TabButton>
              <TabButton current={tab} value="precos" onChange={setTab}>
                Preços especiais
              </TabButton>
            </div>

            {tab === 'dados' && (
              <DadosTab
                cliente={cliente}
                onSaved={refetch}
                onDeleted={() => navigate('/clientes')}
              />
            )}
            {tab === 'notas' && <NotasTab clienteId={cliente.id} />}
            {tab === 'documentos' && <DocumentosTab clienteId={cliente.id} />}
            {tab === 'precos' && <PrecosTab clienteId={cliente.id} />}
          </>
        )}
      </StateView>
    </PageLayout>
  );
}

function TabButton({
  current,
  value,
  onChange,
  children,
}: {
  current: Tab;
  value: Tab;
  onChange: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`tab-${value}`}
      onClick={() => onChange(value)}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? colors.primary : 'transparent'}`,
        padding: '0.625rem 1rem',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: active ? colors.primary : colors.muted,
        fontWeight: active ? 600 : 500,
        fontSize: 14,
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

// ─── Tab Dados ────────────────────────────────────────────────────────

function DadosTab({
  cliente,
  onSaved,
  onDeleted,
}: {
  cliente: Cliente;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    nome: cliente.nome,
    cnpj: cliente.cnpj ?? '',
    email: cliente.email ?? '',
    telefone: cliente.telefone ?? '',
    cidade: cliente.cidade ?? '',
    uf: cliente.uf ?? '',
    segmento: cliente.segmento ?? '',
    status: cliente.status,
    omieStatus: cliente.omieStatus,
    score: cliente.score,
    prazoPagamento: cliente.prazoPagamento ?? 30,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      status: form.status,
      omieStatus: form.omieStatus,
      score: form.score,
      prazoPagamento: form.prazoPagamento,
    };
    for (const k of ['cnpj', 'email', 'telefone', 'cidade', 'uf', 'segmento'] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    try {
      await api.patch(`/clientes/${cliente.id}`, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/clientes/${cliente.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <form onSubmit={save}>
        <FormField label="Nome" required>
          <Input
            value={form.nome}
            onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
            required
            minLength={2}
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          <FormField label="CNPJ">
            <Input
              value={form.cnpj}
              onChange={(e) => setForm((s) => ({ ...s, cnpj: e.target.value }))}
            />
          </FormField>
          <FormField label="Segmento">
            <Input
              value={form.segmento}
              onChange={(e) => setForm((s) => ({ ...s, segmento: e.target.value }))}
            />
          </FormField>
          <FormField label="E-mail">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
            />
          </FormField>
          <FormField label="Telefone">
            <Input
              value={form.telefone}
              onChange={(e) => setForm((s) => ({ ...s, telefone: e.target.value }))}
            />
          </FormField>
          <FormField label="Cidade">
            <Input
              value={form.cidade}
              onChange={(e) => setForm((s) => ({ ...s, cidade: e.target.value }))}
            />
          </FormField>
          <FormField label="UF">
            <Input
              maxLength={2}
              value={form.uf}
              onChange={(e) =>
                setForm((s) => ({ ...s, uf: e.target.value.toUpperCase() }))
              }
            />
          </FormField>
          <FormField label="Status">
            <Select
              value={form.status}
              onChange={(e) =>
                setForm((s) => ({ ...s, status: e.target.value as ClienteStatus }))
              }
            >
              <option value="NOVO">Novo</option>
              <option value="PROSPECT">Prospect</option>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </Select>
          </FormField>
          <FormField label="OMIE">
            <Select
              value={form.omieStatus}
              onChange={(e) =>
                setForm((s) => ({ ...s, omieStatus: e.target.value as OmieStatus }))
              }
            >
              <option value="ATIVO">Ativo</option>
              <option value="BLOQUEADO">Bloqueado</option>
            </Select>
          </FormField>
          <FormField label="Score (0–100)">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.score}
              onChange={(e) => setForm((s) => ({ ...s, score: Number(e.target.value) }))}
            />
          </FormField>
          <FormField label="Prazo pagamento (dias)">
            <Input
              type="number"
              min={0}
              max={180}
              value={form.prazoPagamento}
              onChange={(e) =>
                setForm((s) => ({ ...s, prazoPagamento: Number(e.target.value) }))
              }
            />
          </FormField>
        </div>

        {error && (
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="submit" data-testid="cliente-save" disabled={busy} style={btn}>
            {busy ? 'Salvando…' : 'Salvar alterações'}
          </button>
          {!confirmDel && (
            <button
              type="button"
              data-testid="cliente-del"
              onClick={() => setConfirmDel(true)}
              style={btnDanger}
            >
              Excluir cliente
            </button>
          )}
          {confirmDel && (
            <>
              <button type="button" onClick={() => setConfirmDel(false)} style={btnSecondary}>
                Cancelar
              </button>
              <button
                type="button"
                data-testid="cliente-del-confirm"
                disabled={busy}
                onClick={doDelete}
                style={btnDanger}
              >
                {busy ? '…' : 'Confirmar exclusão'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── Tab Notas privadas ──────────────────────────────────────────────

function NotasTab({ clienteId }: { clienteId: string }) {
  const { data, loading, error, refetch } = useApiQuery<NotaPrivada[] | { data: NotaPrivada[] }>(
    `/clientes/${clienteId}/notas`,
  );
  const notas: NotaPrivada[] = Array.isArray(data) ? data : data?.data ?? [];

  const [texto, setTexto] = useState('');
  const [creating, setCreating] = useState(false);
  const [error2, setError2] = useState<string | null>(null);
  const [editing, setEditing] = useState<NotaPrivada | null>(null);

  async function addNota() {
    if (!texto.trim()) return;
    setCreating(true);
    setError2(null);
    try {
      await api.post(`/clientes/${clienteId}/notas`, { texto: texto.trim() });
      setTexto('');
      refetch();
    } catch (err) {
      setError2(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setCreating(false);
    }
  }

  async function delNota(id: string) {
    if (!confirm('Excluir esta nota?')) return;
    try {
      await api.delete(`/clientes/${clienteId}/notas/${id}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha');
    }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: 15 }}>Nova nota</h3>
      <Textarea
        data-testid="nota-input"
        placeholder="Anotação interna sobre o cliente (visível só pra equipe)"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={5000}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '0.5rem',
        }}
      >
        <span style={{ fontSize: 11, color: colors.muted }}>{texto.length}/5000</span>
        <button
          type="button"
          data-testid="nota-add"
          disabled={creating || texto.trim().length === 0}
          onClick={addNota}
          style={{ ...btn, opacity: creating || texto.trim().length === 0 ? 0.6 : 1 }}
        >
          {creating ? 'Adicionando…' : 'Adicionar nota'}
        </button>
      </div>
      {error2 && (
        <p style={{ color: colors.danger, fontSize: 13 }}>{error2}</p>
      )}

      <h3 style={{ margin: '1.5rem 0 0.5rem', fontSize: 15 }}>Notas anteriores</h3>
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && notas.length === 0}
        emptyMessage="Sem notas ainda. Adicione a primeira acima."
        onRetry={refetch}
      >
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {notas.map((n) => (
            <li
              key={n.id}
              style={{
                background: '#fafbfc',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '0.75rem',
              }}
            >
              <header
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: colors.muted,
                  marginBottom: 4,
                }}
              >
                <strong>{n.autor?.nome ?? '—'}</strong>
                <span>{fmtDate(n.criadoEm)}</span>
              </header>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{n.texto}</p>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button
                  type="button"
                  data-testid={`nota-edit-${n.id}`}
                  onClick={() => setEditing(n)}
                  style={{ ...btnSecondary, padding: '0.125rem 0.5rem', fontSize: 11 }}
                >
                  Editar
                </button>
                <button
                  type="button"
                  data-testid={`nota-del-${n.id}`}
                  onClick={() => delNota(n.id)}
                  style={{ ...btnDanger, padding: '0.125rem 0.5rem', fontSize: 11 }}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      </StateView>

      {editing && (
        <EditNotaModal
          clienteId={clienteId}
          nota={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function EditNotaModal({
  clienteId,
  nota,
  onClose,
  onSaved,
}: {
  clienteId: string;
  nota: NotaPrivada;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [texto, setTexto] = useState(nota.texto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/clientes/${clienteId}/notas/${nota.id}`, { texto: texto.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar nota"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="nota-edit-form"
            data-testid="nota-save"
            disabled={busy || texto.trim().length === 0}
            style={btn}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="nota-edit-form" onSubmit={save}>
        <Textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={5000}
          style={{ minHeight: 120 }}
        />
        {error && (
          <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
        )}
      </form>
    </Modal>
  );
}

// ─── Tab Documentos ──────────────────────────────────────────────────

function DocumentosTab({ clienteId }: { clienteId: string }) {
  const { data, loading, error, refetch } = useApiQuery<Documento[] | { data: Documento[] }>(
    `/clientes/${clienteId}/documentos`,
  );
  const docs: Documento[] = Array.isArray(data) ? data : data?.data ?? [];
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Arquivo maior que 10MB — não suportado');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Direct fetch porque api client é JSON-only
      const sess = await import('@/lib/auth-store').then((m) => m.getSession());
      const baseUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
      const res = await fetch(`${baseUrl}/api/v1/clientes/${clienteId}/documentos`, {
        method: 'POST',
        body: fd,
        headers: {
          ...(sess?.accessToken ? { Authorization: `Bearer ${sess.accessToken}` } : {}),
          ...(sess?.user.empresaIdAtiva ? { 'X-Empresa-Id': sess.user.empresaIdAtiva } : {}),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`,
        );
      }
      refetch();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setUploading(false);
      e.target.value = ''; // reset input
    }
  }

  async function downloadDoc(docId: string) {
    try {
      const r = await api.get<{ url: string }>(`/clientes/${clienteId}/documentos/${docId}/download`);
      window.open(r.url, '_blank', 'noopener');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha');
    }
  }

  async function delDoc(docId: string) {
    if (!confirm('Excluir este documento? Não pode ser desfeito.')) return;
    try {
      await api.delete(`/clientes/${clienteId}/documentos/${docId}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha');
    }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: 15 }}>Enviar documento</h3>
      <p style={{ margin: '0 0 0.75rem', fontSize: 12, color: colors.muted }}>
        Máx. 10MB. Aceito: PDF, imagens, planilhas, doc, csv.
      </p>
      <input
        type="file"
        data-testid="doc-upload"
        onChange={handleFile}
        disabled={uploading}
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx,.doc,.docx,.csv,.txt"
      />
      {uploading && <span style={{ marginLeft: '0.5rem', color: colors.muted, fontSize: 13 }}>Enviando…</span>}
      {uploadError && (
        <p data-testid="upload-error" style={{ color: colors.danger, fontSize: 13 }}>
          {uploadError}
        </p>
      )}

      <h3 style={{ margin: '1.5rem 0 0.5rem', fontSize: 15 }}>Documentos anexados</h3>
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && docs.length === 0}
        emptyMessage="Sem documentos. Envie o primeiro acima."
        onRetry={refetch}
      >
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {docs.map((d) => (
            <li
              key={d.id}
              style={{
                background: '#fafbfc',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '0.5rem 0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span style={{ fontSize: 20 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.nome}
                </div>
                <div style={{ fontSize: 11, color: colors.muted }}>
                  {fmtSize(d.tamanho)} · {d.mimetype} · {fmtDate(d.criadoEm)}
                  {d.uploadedBy && ` · por ${d.uploadedBy.nome}`}
                </div>
              </div>
              <button
                type="button"
                data-testid={`doc-download-${d.id}`}
                onClick={() => downloadDoc(d.id)}
                style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
              >
                Baixar
              </button>
              <button
                type="button"
                data-testid={`doc-del-${d.id}`}
                onClick={() => delDoc(d.id)}
                style={{ ...btnDanger, padding: '0.25rem 0.625rem', fontSize: 12 }}
              >
                Excluir
              </button>
            </li>
          ))}
        </ul>
      </StateView>
    </div>
  );
}

// ─── Tab Preços especiais ────────────────────────────────────────────

function PrecosTab({ clienteId }: { clienteId: string }) {
  const { data, loading, error, refetch } = useApiQuery<PrecoEspecial[] | { data: PrecoEspecial[] }>(
    `/clientes/${clienteId}/precos-especiais`,
  );
  const precos: PrecoEspecial[] = Array.isArray(data) ? data : data?.data ?? [];
  const [adding, setAdding] = useState(false);

  async function delPreco(produtoId: string) {
    if (!confirm('Remover este preço especial?')) return;
    try {
      await api.delete(`/clientes/${clienteId}/precos-especiais/${produtoId}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha');
    }
  }

  return (
    <div style={card}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>Preços negociados</h3>
        <button
          type="button"
          data-testid="preco-add"
          onClick={() => setAdding(true)}
          style={btn}
        >
          + Novo preço especial
        </button>
      </header>

      <p style={{ fontSize: 12, color: colors.muted, marginTop: 0 }}>
        Preço acordado pra este cliente, sobrepõe a tabela. Sync OMIE pode atualizar
        automaticamente.
      </p>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && precos.length === 0}
        emptyMessage="Sem preços especiais ainda. Adicione o primeiro."
        onRetry={refetch}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: '0.5rem' }}>
          <thead>
            <tr>
              <th style={thStyle}>Produto</th>
              <th style={thStyle}>Preço tabela</th>
              <th style={thStyle}>Preço especial</th>
              <th style={thStyle}>Desconto base</th>
              <th style={thStyle}>Válido até</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {precos.map((p) => (
              <tr key={p.produtoId}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{p.produto?.nome ?? '—'}</div>
                  {p.produto?.sku && (
                    <div style={{ fontSize: 11, color: colors.muted }}>{p.produto.sku}</div>
                  )}
                </td>
                <td style={tdStyle}>{p.produto?.precoTabela !== undefined ? fmtBRL(p.produto.precoTabela) : '—'}</td>
                <td style={tdStyle}>
                  <strong>{fmtBRL(p.precoEspecial)}</strong>
                </td>
                <td style={tdStyle}>{p.descontoBase}%</td>
                <td style={tdStyle}>{p.validoAte ? fmtDate(p.validoAte) : 'sem expiração'}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    data-testid={`preco-del-${p.produtoId}`}
                    onClick={() => delPreco(p.produtoId)}
                    style={{ ...btnDanger, padding: '0.125rem 0.5rem', fontSize: 11 }}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateView>

      {adding && (
        <PrecoFormModal
          clienteId={clienteId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 11,
  textTransform: 'uppercase',
  color: colors.muted,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem',
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle',
};

function PrecoFormModal({
  clienteId,
  onClose,
  onSaved,
}: {
  clienteId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [produto, setProduto] = useState<ProdutoOpt | null>(null);
  const [precoEspecial, setPrecoEspecial] = useState('');
  const [descontoBase, setDescontoBase] = useState(0);
  const [validoAte, setValidoAte] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    produto !== null && precoEspecial.trim() !== '' && Number(precoEspecial) > 0;

  const desconto = useMemo(() => {
    if (!produto?.precoTabela || !precoEspecial) return null;
    const pe = Number(precoEspecial);
    if (!pe) return null;
    return ((1 - pe / produto.precoTabela) * 100).toFixed(1);
  }, [produto, precoEspecial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!produto || !valid) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      produtoId: produto.id,
      precoEspecial: Number(precoEspecial),
      descontoBase,
    };
    if (validoAte) payload.validoAte = validoAte;
    try {
      await api.put(`/clientes/${clienteId}/precos-especiais`, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo preço especial"
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="preco-form"
            data-testid="preco-save"
            disabled={busy || !valid}
            style={{ ...btn, opacity: busy || !valid ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Salvar preço'}
          </button>
        </>
      }
    >
      <form id="preco-form" onSubmit={submit}>
        <FormField label="Produto" required>
          <AsyncCombobox<ProdutoOpt>
            testId="preco-produto-picker"
            endpoint="/produtos"
            placeholder="Buscar produto…"
            getLabel={(p) => p.nome}
            getSubLabel={(p) =>
              [p.sku, p.precoTabela !== undefined ? `tabela ${fmtBRL(p.precoTabela)}` : null]
                .filter(Boolean)
                .join(' · ')
            }
            getId={(p) => p.id}
            value={produto}
            onChange={setProduto}
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Preço especial (R$)" htmlFor="pe-val" required>
            <Input
              id="pe-val"
              data-testid="preco-valor-input"
              type="number"
              min={0.01}
              step="0.01"
              value={precoEspecial}
              onChange={(e) => setPrecoEspecial(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Desconto base (%)" htmlFor="pe-db" hint="Para promo extras">
            <Input
              id="pe-db"
              type="number"
              min={0}
              max={80}
              step="0.1"
              value={descontoBase}
              onChange={(e) => setDescontoBase(Number(e.target.value))}
            />
          </FormField>
          <FormField label="Válido até" htmlFor="pe-validade">
            <Input
              id="pe-validade"
              type="date"
              value={validoAte}
              onChange={(e) => setValidoAte(e.target.value)}
            />
          </FormField>
        </div>
        {desconto !== null && (
          <div
            style={{
              fontSize: 13,
              padding: '0.5rem 0.75rem',
              background: '#fafbfc',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              marginTop: '0.5rem',
            }}
          >
            Diferença vs. tabela:{' '}
            <strong style={{ color: Number(desconto) > 0 ? colors.success : colors.danger }}>
              {Number(desconto) > 0 ? `−${desconto}%` : `+${(-Number(desconto)).toFixed(1)}%`}
            </strong>
          </div>
        )}
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}
