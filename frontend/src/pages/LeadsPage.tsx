import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { maskTelefone, normalizeUF } from '@/lib/masks';
import { badge, btn, btnDanger, btnSecondary, colors } from '@/components/styles';

type LeadEtapa = 'NOVO' | 'QUALIFICANDO' | 'PROPOSTA' | 'NEGOCIACAO' | 'GANHO' | 'PERDIDO';
type CanalOrigem =
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'FORMULARIO'
  | 'EMAIL'
  | 'TELEFONE'
  | 'INDICACAO';

interface Lead {
  id: string;
  nome: string;
  contatoNome?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  valorEstimado: number;
  canalOrigem: CanalOrigem;
  etapa: LeadEtapa;
  score: number;
  proximaAcao?: string | null;
  observacoes?: string | null;
  representante?: { id: string; nome: string } | null;
  criadoEm: string;
  etapaDesde?: string;
}

type KanbanResponse = Record<LeadEtapa, Lead[]>;

const ETAPAS_PIPELINE: LeadEtapa[] = [
  'NOVO',
  'QUALIFICANDO',
  'PROPOSTA',
  'NEGOCIACAO',
  'GANHO',
  'PERDIDO',
];

const ETAPA_COLOR: Record<LeadEtapa, string> = {
  NOVO: '#0891b2',
  QUALIFICANDO: '#7c3aed',
  PROPOSTA: colors.warning,
  NEGOCIACAO: '#d97706',
  GANHO: colors.success,
  PERDIDO: colors.danger,
};

const ETAPA_LABEL: Record<LeadEtapa, string> = {
  NOVO: 'Novo',
  QUALIFICANDO: 'Qualificando',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};

const CANAIS: CanalOrigem[] = [
  'WHATSAPP',
  'INSTAGRAM',
  'FACEBOOK',
  'FORMULARIO',
  'EMAIL',
  'TELEFONE',
  'INDICACAO',
];

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

export default function LeadsPage() {
  const { data, loading, error, refetch } = useApiQuery<KanbanResponse>('/leads/kanban');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  return (
    <PageLayout
      title="Leads"
      actions={
        <button
          type="button"
          data-testid="lead-new-btn"
          onClick={() => setCreating(true)}
          style={btn}
        >
          + Novo lead
        </button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${ETAPAS_PIPELINE.length}, minmax(220px, 1fr))`,
              gap: '0.75rem',
              overflowX: 'auto',
              paddingBottom: '0.5rem',
            }}
          >
            {ETAPAS_PIPELINE.map((etapa) => (
              <KanbanColumn
                key={etapa}
                etapa={etapa}
                leads={data[etapa] ?? []}
                onCardClick={setSelected}
              />
            ))}
          </div>
        )}
      </StateView>

      {creating && (
        <LeadFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refetch();
          }}
        />
      )}
      {selected && (
        <LeadDetailModal
          lead={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

function KanbanColumn({
  etapa,
  leads,
  onCardClick,
}: {
  etapa: LeadEtapa;
  leads: Lead[];
  onCardClick: (l: Lead) => void;
}) {
  const total = leads.reduce((s, l) => s + l.valorEstimado, 0);
  return (
    <div
      data-testid={`kanban-col-${etapa}`}
      style={{
        background: '#fafbfc',
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '0.5rem',
        minHeight: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.25rem 0.25rem',
        }}
      >
        <span style={badge(ETAPA_COLOR[etapa])}>{ETAPA_LABEL[etapa]}</span>
        <span style={{ fontSize: 11, color: colors.muted }}>
          {leads.length} · {fmtBRL(total)}
        </span>
      </header>
      {leads.length === 0 ? (
        <p style={{ fontSize: 12, color: colors.muted, textAlign: 'center', padding: '1rem 0' }}>
          Sem leads
        </p>
      ) : (
        leads.map((l) => (
          <button
            key={l.id}
            type="button"
            data-testid={`lead-card-${l.id}`}
            onClick={() => onCardClick(l)}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '0.625rem',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              color: colors.text,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{l.nome}</div>
            <div style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>
              {l.cidade ? `${l.cidade}${l.uf ? '/' + l.uf : ''}` : l.segmento ?? '—'}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 600 }}>{fmtBRL(l.valorEstimado)}</span>
              <span style={{ color: colors.muted }}>{l.representante?.nome ?? 'sem rep'}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

// ─── Detail modal — mover etapa, atribuir rep, excluir ────────────────

function LeadDetailModal({
  lead,
  onClose,
  onChanged,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moverEtapa, setMoverEtapa] = useState<LeadEtapa | null>(null);
  const [motivo, setMotivo] = useState('');

  async function callMover() {
    if (!moverEtapa) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { etapa: moverEtapa };
      if (motivo.trim()) payload.motivo = motivo.trim();
      await api.put(`/leads/${lead.id}/etapa`, payload);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao mover etapa');
    } finally {
      setBusy(false);
    }
  }

  async function callDelete() {
    if (!confirm('Excluir este lead?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/leads/${lead.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao excluir');
    } finally {
      setBusy(false);
    }
  }

  const exigeMotivo = moverEtapa === 'GANHO' || moverEtapa === 'PERDIDO';

  return (
    <Modal
      open
      onClose={onClose}
      title={lead.nome}
      width={580}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          <button type="button" data-testid="lead-delete" onClick={callDelete} style={btnDanger}>
            Excluir
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={badge(ETAPA_COLOR[lead.etapa])}>{ETAPA_LABEL[lead.etapa]}</span>
        <span style={{ color: colors.muted, fontSize: 13 }}>Score {lead.score}</span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: 14 }}>
        <Info label="Valor estimado">{fmtBRL(lead.valorEstimado)}</Info>
        <Info label="Canal">{lead.canalOrigem}</Info>
        <Info label="Localização">
          {lead.cidade ? `${lead.cidade}${lead.uf ? '/' + lead.uf : ''}` : '—'}
        </Info>
        <Info label="Segmento">{lead.segmento ?? '—'}</Info>
        <Info label="Contato">
          {lead.contatoNome ?? '—'}
        </Info>
        <Info label="Representante">{lead.representante?.nome ?? 'sem rep'}</Info>
      </dl>
      {lead.proximaAcao && (
        <div style={{ marginTop: '0.75rem' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Próxima ação
          </h3>
          <p style={{ marginTop: 4 }}>{lead.proximaAcao}</p>
        </div>
      )}
      {lead.observacoes && (
        <div style={{ marginTop: '0.75rem' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Observações
          </h3>
          <p style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{lead.observacoes}</p>
        </div>
      )}

      <div
        style={{
          borderTop: `1px solid ${colors.border}`,
          marginTop: '1rem',
          paddingTop: '1rem',
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Mover para etapa</h3>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ETAPAS_PIPELINE.filter((e) => e !== lead.etapa).map((e) => (
            <button
              key={e}
              type="button"
              data-testid={`mover-${e}`}
              onClick={() => setMoverEtapa(e)}
              style={{
                ...btnSecondary,
                padding: '0.25rem 0.625rem',
                fontSize: 12,
                borderColor: moverEtapa === e ? ETAPA_COLOR[e] : undefined,
              }}
            >
              → {ETAPA_LABEL[e]}
            </button>
          ))}
        </div>
        {moverEtapa && (
          <div style={{ marginTop: '0.75rem' }}>
            {exigeMotivo && (
              <FormField
                label="Motivo"
                htmlFor="lead-motivo"
                required
                hint={`Obrigatório ao marcar como ${ETAPA_LABEL[moverEtapa]}`}
              >
                <Textarea
                  id="lead-motivo"
                  data-testid="lead-motivo-input"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Por que foi para esse status?"
                />
              </FormField>
            )}
            <button
              type="button"
              data-testid="lead-confirmar-etapa"
              disabled={busy || (exigeMotivo && motivo.trim().length === 0)}
              onClick={callMover}
              style={{ ...btn, opacity: busy ? 0.7 : 1 }}
            >
              {busy ? 'Movendo…' : `Confirmar movimentação`}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}>{error}</p>
      )}
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: colors.muted,
          marginBottom: 2,
          letterSpacing: 0.3,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─── Create modal ─────────────────────────────────────────────────────

function LeadFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nome: '',
    cidade: '',
    uf: '',
    segmento: '',
    contatoNome: '',
    contatoEmail: '',
    contatoTelefone: '',
    valorEstimado: 0,
    canalOrigem: 'WHATSAPP' as CanalOrigem,
    proximaAcao: '',
    observacoes: '',
    score: 50,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setF<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      canalOrigem: form.canalOrigem,
      valorEstimado: form.valorEstimado,
      score: form.score,
    };
    for (const k of [
      'cidade',
      'uf',
      'segmento',
      'contatoNome',
      'contatoEmail',
      'contatoTelefone',
      'proximaAcao',
      'observacoes',
    ] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    try {
      await api.post('/leads', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar lead');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo lead"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="lead-form"
            data-testid="lead-save-btn"
            disabled={busy || form.nome.trim().length < 2}
            style={btn}
          >
            {busy ? 'Salvando…' : 'Criar lead'}
          </button>
        </>
      }
    >
      <form id="lead-form" onSubmit={submit}>
        <FormField label="Nome" htmlFor="l-nome" required>
          <Input
            id="l-nome"
            data-testid="lead-nome-input"
            value={form.nome}
            onChange={(e) => setF('nome', e.target.value)}
            minLength={2}
            maxLength={200}
            required
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Cidade" htmlFor="l-cidade">
            <Input id="l-cidade" value={form.cidade} onChange={(e) => setF('cidade', e.target.value)} />
          </FormField>
          <FormField label="UF" htmlFor="l-uf">
            <Input
              id="l-uf"
              maxLength={2}
              value={form.uf}
              onChange={(e) => setF('uf', normalizeUF(e.target.value))}
            />
          </FormField>
          <FormField label="Segmento" htmlFor="l-seg">
            <Input id="l-seg" value={form.segmento} onChange={(e) => setF('segmento', e.target.value)} />
          </FormField>
          <FormField label="Canal" htmlFor="l-canal">
            <Select
              id="l-canal"
              value={form.canalOrigem}
              onChange={(e) => setF('canalOrigem', e.target.value as CanalOrigem)}
            >
              {CANAIS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Contato (nome)" htmlFor="l-cn">
            <Input id="l-cn" value={form.contatoNome} onChange={(e) => setF('contatoNome', e.target.value)} />
          </FormField>
          <FormField label="Contato (telefone)" htmlFor="l-ct">
            <Input id="l-ct" value={form.contatoTelefone} onChange={(e) => setF('contatoTelefone', maskTelefone(e.target.value))} placeholder="(00) 00000-0000" maxLength={15} inputMode="tel" />
          </FormField>
          <FormField label="Contato (e-mail)" htmlFor="l-ce">
            <Input id="l-ce" type="email" value={form.contatoEmail} onChange={(e) => setF('contatoEmail', e.target.value)} />
          </FormField>
          <FormField label="Valor estimado" htmlFor="l-val">
            <Input
              id="l-val"
              type="number"
              min={0}
              step="0.01"
              value={form.valorEstimado}
              onChange={(e) => setF('valorEstimado', Number(e.target.value))}
            />
          </FormField>
          <FormField label="Score (0–100)" htmlFor="l-score">
            <Input
              id="l-score"
              type="number"
              min={0}
              max={100}
              value={form.score}
              onChange={(e) => setF('score', Number(e.target.value))}
            />
          </FormField>
        </div>
        <FormField label="Próxima ação" htmlFor="l-acao">
          <Input id="l-acao" value={form.proximaAcao} onChange={(e) => setF('proximaAcao', e.target.value)} />
        </FormField>
        <FormField label="Observações" htmlFor="l-obs">
          <Textarea id="l-obs" value={form.observacoes} onChange={(e) => setF('observacoes', e.target.value)} />
        </FormField>
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}
