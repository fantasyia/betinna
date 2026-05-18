import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/PageLayout';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';
import { api, ApiError } from '@/lib/api';
import { usePermission, useRole } from '@/hooks/usePermission';
import { useConfirm } from '@/hooks/useConfirm';

/**
 * Programa Fidelidade — backend integrado (D45/D48).
 *
 * - Configuração + recompensas CRUD: ADMIN/DIRECTOR (`@Roles`)
 * - Resgate, consulta saldo, extrato, ranking: usuário com `fidelidade.view/edit`
 * - Pontos creditados automaticamente quando pedido vai pro OMIE
 *   (trigger em `PedidosService.enviarParaOmie`).
 */

type RecompensaTipo = 'DESCONTO_PERCENTUAL' | 'DESCONTO_VALOR' | 'BRINDE';
type MovimentoTipo =
  | 'GANHO_PEDIDO'
  | 'ESTORNO_PEDIDO'
  | 'RESGATE'
  | 'EXPIRACAO'
  | 'AJUSTE_MANUAL';

interface Programa {
  id: string;
  nome: string;
  ativo: boolean;
  pontosPorReal: number;
  ttlMeses: number;
  valorMinimoPedido: number;
}

interface Recompensa {
  id: string;
  nome: string;
  descricao: string | null;
  custoPontos: number;
  tipo: RecompensaTipo;
  valor: number | null;
  estoque: number | null;
  ativo: boolean;
}

interface Saldo {
  clienteId: string;
  pontos: number;
  atualizadoEm: string | null;
}

interface Movimento {
  id: string;
  tipo: MovimentoTipo;
  pontos: number;
  motivo: string | null;
  criadoEm: string;
  cliente?: { id: string; nome: string } | null;
  recompensa?: { id: string; nome: string } | null;
  pedido?: { id: string; numero: string } | null;
}

interface MovimentosPage {
  data: Movimento[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface RankingItem {
  cliente: { id: string; nome: string };
  pontos: number;
}

interface ClienteLite {
  id: string;
  nome: string;
}

const TIPO_LABEL: Record<RecompensaTipo, string> = {
  DESCONTO_PERCENTUAL: 'Desconto %',
  DESCONTO_VALOR: 'Desconto R$',
  BRINDE: 'Brinde',
};
const TIPO_COLOR: Record<RecompensaTipo, string> = {
  DESCONTO_PERCENTUAL: colors.primary,
  DESCONTO_VALOR: colors.success,
  BRINDE: '#7c3aed',
};

const MOV_LABEL: Record<MovimentoTipo, string> = {
  GANHO_PEDIDO: 'Ganho (pedido)',
  ESTORNO_PEDIDO: 'Estorno',
  RESGATE: 'Resgate',
  EXPIRACAO: 'Expiração',
  AJUSTE_MANUAL: 'Ajuste manual',
};
const MOV_COLOR: Record<MovimentoTipo, string> = {
  GANHO_PEDIDO: colors.success,
  ESTORNO_PEDIDO: colors.warning,
  RESGATE: colors.primary,
  EXPIRACAO: colors.muted,
  AJUSTE_MANUAL: '#7c3aed',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function FidelidadePage() {
  const role = useRole();
  const canView = usePermission('fidelidade.view');
  const canEdit = usePermission('fidelidade.edit');
  const canManage = role === 'ADMIN' || role === 'DIRECTOR';

  const [programa, setPrograma] = useState<Programa | null>(null);
  const [recompensas, setRecompensas] = useState<Recompensa[]>([]);
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [movPage, setMovPage] = useState(1);
  const [movTotal, setMovTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [filtroClienteId, setFiltroClienteId] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<MovimentoTipo | ''>('');

  const [editProgramaOpen, setEditProgramaOpen] = useState(false);
  const [recompensaModal, setRecompensaModal] = useState<{ id: string | null } | null>(null);
  const [resgateOpen, setResgateOpen] = useState(false);
  const [ajusteOpen, setAjusteOpen] = useState(false);
  const [saldoLookup, setSaldoLookup] = useState<{ cliente: ClienteLite; saldo: Saldo } | null>(
    null,
  );

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [p, rs, rk] = await Promise.all([
        api.get<Programa>('/fidelidade/programa'),
        api.get<Recompensa[]>(`/fidelidade/recompensas?incluirInativas=${canManage ? 'true' : 'false'}`),
        api.get<RankingItem[]>('/fidelidade/ranking?limit=10'),
      ]);
      setPrograma(p);
      setRecompensas(rs);
      setRanking(rk);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao carregar fidelidade');
    } finally {
      setLoading(false);
    }
  }

  async function loadMovimentos(page = 1) {
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('limit', '20');
      if (filtroClienteId) qs.set('clienteId', filtroClienteId);
      if (filtroTipo) qs.set('tipo', filtroTipo);
      const r = await api.get<MovimentosPage>(`/fidelidade/movimentos?${qs.toString()}`);
      setMovimentos(r.data);
      setMovPage(r.pagination.page);
      setMovTotal(r.pagination.totalPages);
    } catch (e) {
      console.warn('mov fail', e);
    }
  }

  async function loadClientes() {
    try {
      const r = await api.get<{ data: ClienteLite[] }>('/clientes?limit=200');
      setClientes(r.data ?? []);
    } catch {
      /* opcional */
    }
  }

  useEffect(() => {
    if (canView) {
      void loadAll();
      void loadClientes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    if (canView) void loadMovimentos(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroClienteId, filtroTipo, canView]);

  const clientesDict = useMemo(
    () => Object.fromEntries(clientes.map((c) => [c.id, c.nome])),
    [clientes],
  );

  if (!canView) {
    return (
      <PageLayout title="Programa Fidelidade">
        <div style={card}>
          <p style={{ margin: 0 }}>Você não tem permissão para visualizar este módulo.</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Programa Fidelidade"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && (
            <button type="button" onClick={() => setResgateOpen(true)} style={btnSecondary}>
              🎁 Resgatar
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => setAjusteOpen(true)} style={btnSecondary}>
              ⚙️ Ajuste manual
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => setEditProgramaOpen(true)} style={btn}>
              Configurar programa
            </button>
          )}
        </div>
      }
    >
      {err && (
        <div
          style={{
            ...card,
            background: '#fef2f2',
            borderColor: '#fecaca',
            color: '#991b1b',
            marginBottom: '1rem',
          }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <div style={card}>Carregando…</div>
      ) : (
        <>
          {/* Configuração */}
          {programa && (
            <section style={{ ...card, marginBottom: '1rem' }}>
              <header
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '0.75rem',
                }}
              >
                <h2 style={{ margin: 0, fontSize: 16 }}>⚙️ {programa.nome}</h2>
                <span style={badge(programa.ativo ? colors.success : colors.muted)}>
                  {programa.ativo ? 'Ativo' : 'Pausado'}
                </span>
              </header>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                <Stat
                  label="Pontos por R$ 1"
                  value={`${programa.pontosPorReal}`}
                  hint="Aplicado ao subtotal do pedido aprovado"
                />
                <Stat
                  label="Validade"
                  value={programa.ttlMeses > 0 ? `${programa.ttlMeses} meses` : 'Sem expirar'}
                />
                <Stat
                  label="Pedido mín."
                  value={`R$ ${programa.valorMinimoPedido.toFixed(2)}`}
                  hint="Ganha pontos a partir deste valor"
                />
              </div>
            </section>
          )}

          {/* Recompensas */}
          <section style={{ ...card, marginBottom: '1rem' }}>
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16 }}>🎁 Catálogo de recompensas</h2>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setRecompensaModal({ id: null })}
                  style={btn}
                >
                  + Nova recompensa
                </button>
              )}
            </header>

            {recompensas.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>
                Nenhuma recompensa cadastrada ainda.
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {recompensas.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      background: '#fafbfc',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      padding: '0.875rem',
                      opacity: r.ativo ? 1 : 0.55,
                      cursor: canManage ? 'pointer' : 'default',
                    }}
                    onClick={() => canManage && setRecompensaModal({ id: r.id })}
                  >
                    <header
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <span style={badge(TIPO_COLOR[r.tipo])}>{TIPO_LABEL[r.tipo]}</span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{r.custoPontos} pts</span>
                    </header>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.nome}</div>
                    {r.descricao && (
                      <p style={{ fontSize: 12, color: colors.muted, margin: 0, lineHeight: 1.4 }}>
                        {r.descricao}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 11 }}>
                      {r.valor != null && (
                        <span style={{ color: colors.muted }}>
                          Valor:{' '}
                          {r.tipo === 'DESCONTO_PERCENTUAL' ? `${r.valor}%` : `R$ ${r.valor}`}
                        </span>
                      )}
                      {r.estoque != null && (
                        <span style={{ color: r.estoque > 0 ? colors.success : colors.warning }}>
                          Estoque: {r.estoque}
                        </span>
                      )}
                      {!r.ativo && (
                        <span style={{ color: colors.warning }}>Inativa</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Ranking + Saldo lookup */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '1rem',
              marginBottom: '1rem',
            }}
          >
            <div style={card}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>🏆 Top 10 (pontos)</h2>
              {ranking.length === 0 ? (
                <p style={{ color: colors.muted, margin: 0 }}>Sem clientes pontuando ainda.</p>
              ) : (
                <ol style={{ paddingLeft: '1.25rem', margin: 0, lineHeight: 1.7, fontSize: 13 }}>
                  {ranking.map((r) => (
                    <li key={r.cliente.id}>
                      <strong>{r.cliente.nome}</strong>{' '}
                      <span style={{ color: colors.muted }}>— {r.pontos} pts</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div style={card}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>🔍 Consultar saldo</h2>
              <SaldoLookup
                clientes={clientes}
                onResult={(cliente, saldo) => setSaldoLookup({ cliente, saldo })}
              />
              {saldoLookup && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: '#f0fdf4',
                    border: `1px solid #86efac`,
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{saldoLookup.cliente.nome}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: colors.success }}>
                    {saldoLookup.saldo.pontos} pts
                  </div>
                  {saldoLookup.saldo.atualizadoEm && (
                    <div style={{ fontSize: 11, color: colors.muted }}>
                      Atualizado em {fmtDate(saldoLookup.saldo.atualizadoEm)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Extrato */}
          <section style={card}>
            <header
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginBottom: '0.75rem',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>📋 Extrato de movimentos</h2>
              <FormField label="Cliente">
                <Select
                  value={filtroClienteId}
                  onChange={(e) => setFiltroClienteId(e.target.value)}
                  style={{ minWidth: 180 }}
                >
                  <option value="">Todos</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Tipo">
                <Select
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value as MovimentoTipo | '')}
                >
                  <option value="">Todos</option>
                  {Object.entries(MOV_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </FormField>
            </header>

            {movimentos.length === 0 ? (
              <p style={{ color: colors.muted, margin: 0 }}>Sem movimentos ainda.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: `1px solid ${colors.border}` }}>
                    <th style={{ padding: '0.5rem 0.25rem' }}>Data</th>
                    <th style={{ padding: '0.5rem 0.25rem' }}>Cliente</th>
                    <th style={{ padding: '0.5rem 0.25rem' }}>Tipo</th>
                    <th style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>Pontos</th>
                    <th style={{ padding: '0.5rem 0.25rem' }}>Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentos.map((m) => (
                    <tr key={m.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '0.5rem 0.25rem' }}>{fmtDate(m.criadoEm)}</td>
                      <td style={{ padding: '0.5rem 0.25rem' }}>
                        {m.cliente?.nome ?? clientesDict[m.cliente?.id ?? ''] ?? '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.25rem' }}>
                        <span style={badge(MOV_COLOR[m.tipo])}>{MOV_LABEL[m.tipo]}</span>
                      </td>
                      <td
                        style={{
                          padding: '0.5rem 0.25rem',
                          textAlign: 'right',
                          fontWeight: 600,
                          color: m.pontos >= 0 ? colors.success : colors.warning,
                        }}
                      >
                        {m.pontos > 0 ? `+${m.pontos}` : m.pontos}
                      </td>
                      <td style={{ padding: '0.5rem 0.25rem', color: colors.muted, fontSize: 12 }}>
                        {m.recompensa?.nome ?? m.pedido?.numero ?? m.motivo ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {movTotal > 1 && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginTop: '0.75rem',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  disabled={movPage <= 1}
                  onClick={() => loadMovimentos(movPage - 1)}
                  style={btnSecondary}
                >
                  ‹
                </button>
                <span style={{ fontSize: 12, color: colors.muted }}>
                  Página {movPage} de {movTotal}
                </span>
                <button
                  type="button"
                  disabled={movPage >= movTotal}
                  onClick={() => loadMovimentos(movPage + 1)}
                  style={btnSecondary}
                >
                  ›
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {editProgramaOpen && programa && (
        <ProgramaModal
          programa={programa}
          onClose={() => setEditProgramaOpen(false)}
          onSaved={(p) => {
            setPrograma(p);
            setEditProgramaOpen(false);
          }}
        />
      )}

      {recompensaModal && (
        <RecompensaModal
          recompensaId={recompensaModal.id}
          recompensas={recompensas}
          onClose={() => setRecompensaModal(null)}
          onSaved={() => {
            setRecompensaModal(null);
            void loadAll();
          }}
        />
      )}

      {resgateOpen && (
        <ResgateModal
          clientes={clientes}
          recompensas={recompensas.filter((r) => r.ativo)}
          onClose={() => setResgateOpen(false)}
          onDone={() => {
            setResgateOpen(false);
            void loadMovimentos(1);
            void loadAll();
          }}
        />
      )}

      {ajusteOpen && (
        <AjusteModal
          clientes={clientes}
          onClose={() => setAjusteOpen(false)}
          onDone={() => {
            setAjusteOpen(false);
            void loadMovimentos(1);
            void loadAll();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Componentes auxiliares ────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        background: '#fafbfc',
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '0.5rem 0.75rem',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: colors.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function SaldoLookup({
  clientes,
  onResult,
}: {
  clientes: ClienteLite[];
  onResult: (c: ClienteLite, s: Saldo) => void;
}) {
  const [clienteId, setClienteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function consultar() {
    if (!clienteId) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await api.get<Saldo>(`/fidelidade/saldo/${clienteId}`);
      const c = clientes.find((x) => x.id === clienteId);
      if (c) onResult(c, s);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <FormField label="Cliente">
        <Select
          value={clienteId}
          onChange={(e) => setClienteId(e.target.value)}
          style={{ minWidth: 200 }}
        >
          <option value="">Selecione</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
      </FormField>
      <button
        type="button"
        onClick={consultar}
        disabled={!clienteId || busy}
        style={{ ...btn, opacity: !clienteId || busy ? 0.6 : 1 }}
      >
        {busy ? '…' : 'Consultar'}
      </button>
      {err && <span style={{ color: colors.warning, fontSize: 12 }}>{err}</span>}
    </div>
  );
}

function ProgramaModal({
  programa,
  onClose,
  onSaved,
}: {
  programa: Programa;
  onClose: () => void;
  onSaved: (p: Programa) => void;
}) {
  const [nome, setNome] = useState(programa.nome);
  const [ativo, setAtivo] = useState(programa.ativo);
  const [pontosPorReal, setPontosPorReal] = useState(String(programa.pontosPorReal));
  const [ttlMeses, setTtlMeses] = useState(String(programa.ttlMeses));
  const [valorMin, setValorMin] = useState(String(programa.valorMinimoPedido));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function salvar() {
    setBusy(true);
    setErr(null);
    try {
      const p = await api.patch<Programa>('/fidelidade/programa', {
        nome,
        ativo,
        pontosPorReal: Number(pontosPorReal),
        ttlMeses: Number(ttlMeses),
        valorMinimoPedido: Number(valorMin),
      });
      onSaved(p);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Configurar programa"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={busy} style={btn}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {err && <p style={{ color: colors.warning, fontSize: 13 }}>{err}</p>}
      <FormField label="Nome">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} />
      </FormField>
      <FormField label="Programa ativo">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span style={{ fontSize: 13 }}>Crédito automático em pedidos aprovados</span>
        </label>
      </FormField>
      <FormField label="Pontos por R$ 1" hint="Ex: 1 = 1 ponto por real">
        <Input
          type="number"
          step="0.01"
          value={pontosPorReal}
          onChange={(e) => setPontosPorReal(e.target.value)}
        />
      </FormField>
      <FormField label="Validade (meses)" hint="0 = sem expirar">
        <Input
          type="number"
          value={ttlMeses}
          onChange={(e) => setTtlMeses(e.target.value)}
        />
      </FormField>
      <FormField label="Valor mínimo do pedido (R$)" hint="Abaixo disso não credita">
        <Input
          type="number"
          step="0.01"
          value={valorMin}
          onChange={(e) => setValorMin(e.target.value)}
        />
      </FormField>
    </Modal>
  );
}

function RecompensaModal({
  recompensaId,
  recompensas,
  onClose,
  onSaved,
}: {
  recompensaId: string | null;
  recompensas: Recompensa[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = recompensaId ? recompensas.find((r) => r.id === recompensaId) ?? null : null;
  const [nome, setNome] = useState(editing?.nome ?? '');
  const [descricao, setDescricao] = useState(editing?.descricao ?? '');
  const [custoPontos, setCustoPontos] = useState(String(editing?.custoPontos ?? 100));
  const [tipo, setTipo] = useState<RecompensaTipo>(editing?.tipo ?? 'DESCONTO_PERCENTUAL');
  const [valor, setValor] = useState(editing?.valor != null ? String(editing.valor) : '');
  const [estoque, setEstoque] = useState(editing?.estoque != null ? String(editing.estoque) : '');
  const [ativo, setAtivo] = useState(editing?.ativo ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function salvar() {
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        nome,
        descricao: descricao || null,
        custoPontos: Number(custoPontos),
        tipo,
        valor: valor ? Number(valor) : tipo === 'BRINDE' ? null : 0,
        estoque: estoque ? Number(estoque) : null,
        ativo,
      };
      if (editing) {
        await api.patch(`/fidelidade/recompensas/${editing.id}`, payload);
      } else {
        await api.post('/fidelidade/recompensas', payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function desativar() {
    if (!editing) return;
    const ok = await confirmAsync({
      title: `Desativar "${editing.nome}"?`,
      message: 'A recompensa some da lista mas o histórico de resgates fica preservado.',
      confirmLabel: 'Desativar',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/fidelidade/recompensas/${editing.id}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar recompensa' : 'Nova recompensa'}
      footer={
        <>
          {editing && editing.ativo && (
            <button type="button" onClick={desativar} style={btnSecondary}>
              Desativar
            </button>
          )}
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={busy || !nome} style={btn}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {err && <p style={{ color: colors.warning, fontSize: 13 }}>{err}</p>}
      <FormField label="Nome">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} />
      </FormField>
      <FormField label="Descrição">
        <Textarea
          value={descricao ?? ''}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={500}
        />
      </FormField>
      <FormField label="Tipo">
        <Select value={tipo} onChange={(e) => setTipo(e.target.value as RecompensaTipo)}>
          {(Object.keys(TIPO_LABEL) as RecompensaTipo[]).map((t) => (
            <option key={t} value={t}>
              {TIPO_LABEL[t]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Custo (pontos)">
        <Input
          type="number"
          value={custoPontos}
          onChange={(e) => setCustoPontos(e.target.value)}
        />
      </FormField>
      {tipo !== 'BRINDE' && (
        <FormField
          label={tipo === 'DESCONTO_PERCENTUAL' ? 'Desconto (%)' : 'Desconto (R$)'}
        >
          <Input
            type="number"
            step="0.01"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </FormField>
      )}
      <FormField label="Estoque" hint="Deixe vazio para ilimitado">
        <Input
          type="number"
          value={estoque}
          onChange={(e) => setEstoque(e.target.value)}
        />
      </FormField>
      {editing && (
        <FormField label="Ativa">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>Visível para resgate</span>
          </label>
        </FormField>
      )}
    </Modal>
    {ConfirmDialog}
    </>
  );
}

function ResgateModal({
  clientes,
  recompensas,
  onClose,
  onDone,
}: {
  clientes: ClienteLite[];
  recompensas: Recompensa[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [clienteId, setClienteId] = useState('');
  const [recompensaId, setRecompensaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function resgatar() {
    setBusy(true);
    setErr(null);
    try {
      await api.post('/fidelidade/resgatar', { clienteId, recompensaId });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao resgatar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Resgatar recompensa"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={resgatar}
            disabled={!clienteId || !recompensaId || busy}
            style={{ ...btn, opacity: !clienteId || !recompensaId || busy ? 0.6 : 1 }}
          >
            {busy ? 'Resgatando…' : 'Confirmar resgate'}
          </button>
        </>
      }
    >
      {err && <p style={{ color: colors.warning, fontSize: 13 }}>{err}</p>}
      <FormField label="Cliente">
        <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          <option value="">Selecione</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Recompensa">
        <Select value={recompensaId} onChange={(e) => setRecompensaId(e.target.value)}>
          <option value="">Selecione</option>
          {recompensas.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome} — {r.custoPontos} pts
            </option>
          ))}
        </Select>
      </FormField>
    </Modal>
  );
}

function AjusteModal({
  clientes,
  onClose,
  onDone,
}: {
  clientes: ClienteLite[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [clienteId, setClienteId] = useState('');
  const [pontos, setPontos] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function aplicar() {
    if (!clienteId) {
      setErr('Selecione um cliente.');
      return;
    }
    const pontosNum = Number(pontos);
    if (!pontos || Number.isNaN(pontosNum) || pontosNum === 0) {
      setErr('Informe um valor de pontos diferente de zero.');
      return;
    }
    if (motivo.trim().length < 3) {
      setErr('Motivo precisa ter no mínimo 3 caracteres.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.post('/fidelidade/ajustar', {
        clienteId,
        pontos: pontosNum,
        motivo,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ajuste manual de pontos"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={aplicar}
            disabled={busy}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Aplicando…' : 'Aplicar'}
          </button>
        </>
      }
    >
      {err && <p style={{ color: colors.warning, fontSize: 13 }}>{err}</p>}
      <p style={{ fontSize: 12, color: colors.muted, marginTop: 0 }}>
        Use valores positivos para creditar, negativos para debitar. Motivo fica em auditoria.
      </p>
      <FormField label="Cliente">
        <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          <option value="">Selecione</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Pontos (+/-)">
        <Input
          type="number"
          value={pontos}
          onChange={(e) => setPontos(e.target.value)}
          placeholder="Ex: 100 ou -50"
        />
      </FormField>
      <FormField label="Motivo" hint="Mínimo 3 caracteres">
        <Textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={280}
          placeholder="Ex: bônus de boas-vindas, ajuste de cortesia, correção de erro…"
        />
      </FormField>
    </Modal>
  );
}
