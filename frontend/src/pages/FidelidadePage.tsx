import { useState } from 'react';
import { PageLayout } from '@/components/PageLayout';
import { Modal } from '@/components/Modal';
import { FormField, Textarea } from '@/components/FormField';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

/**
 * Programa Fidelidade — acesso DIRETOR/ADMIN (per CLAUDE.md).
 *
 * Status: módulo backend não construído ainda. Esta página é um
 * "feature preview" — mostra a UX planejada com dados mock + permite
 * marcar interesse pra priorizar no roadmap.
 *
 * Decisão arquitetural quando o backend for construído:
 *  - Tabela `ProgramaFidelidade` (1 por empresa)
 *  - Regra: X pontos por R$ comprado, expira em Y dias
 *  - Tabela `Recompensa` (catálogo: descontos, brindes, etc.)
 *  - Tabela `Resgate` (auditável)
 *  - Cron mensal: zera pontos expirados + envia digest pra cliente
 *  - Trigger PEDIDO_ENTREGUE adiciona pontos automaticamente
 */

interface RecompensaMock {
  id: string;
  nome: string;
  pontos: number;
  descricao: string;
  tipo: 'desconto' | 'brinde' | 'frete';
  ativo: boolean;
}

const RECOMPENSAS_MOCK: RecompensaMock[] = [
  {
    id: 'r1',
    nome: '5% de desconto',
    pontos: 500,
    descricao: 'Aplicável no próximo pedido acima de R$ 200',
    tipo: 'desconto',
    ativo: true,
  },
  {
    id: 'r2',
    nome: 'Frete grátis',
    pontos: 800,
    descricao: 'Próxima entrega sem custo de frete',
    tipo: 'frete',
    ativo: true,
  },
  {
    id: 'r3',
    nome: 'Kit degustação',
    pontos: 1500,
    descricao: 'Caixa com 6 produtos novos do catálogo',
    tipo: 'brinde',
    ativo: true,
  },
  {
    id: 'r4',
    nome: '10% de desconto',
    pontos: 2000,
    descricao: 'Próximo pedido acima de R$ 500',
    tipo: 'desconto',
    ativo: false,
  },
];

const TIPO_COLOR: Record<RecompensaMock['tipo'], string> = {
  desconto: colors.primary,
  brinde: colors.success,
  frete: '#7c3aed',
};

const TIPO_LABEL: Record<RecompensaMock['tipo'], string> = {
  desconto: 'Desconto',
  brinde: 'Brinde',
  frete: 'Frete grátis',
};

export default function FidelidadePage() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <PageLayout
      title="Programa Fidelidade"
      actions={<span style={badge(colors.warning)}>🚧 Em desenvolvimento</span>}
    >
      <div
        style={{
          ...card,
          background: '#fff8e7',
          borderColor: '#fde68a',
          marginBottom: '1rem',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16, color: '#92400e' }}>👀 Feature preview</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#78350f' }}>
          Esta tela mostra a interface planejada — backend ainda não foi construído.
          A funcionalidade entra no roadmap conforme demanda dos primeiros clientes.
          Use o botão abaixo pra registrar interesse / pedir prioridade.
        </p>
        <button
          type="button"
          data-testid="fidelidade-feedback"
          onClick={() => setFeedbackOpen(true)}
          style={{ ...btn, marginTop: '0.75rem' }}
        >
          💬 Sugerir / priorizar este módulo
        </button>
      </div>

      {/* Configuração geral mock */}
      <section style={{ ...card, marginBottom: '1rem', opacity: 0.92 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>⚙️ Regras do programa</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <Stat label="Pontos por R$ 1 gasto" value="1 pt" hint="Configurável" />
          <Stat label="Validade dos pontos" value="365d" hint="A partir do crédito" />
          <Stat label="Mínimo pra resgate" value="500 pts" />
          <Stat label="Clientes no programa" value="0" hint="Mock" />
        </div>
      </section>

      {/* Catálogo de recompensas mock */}
      <section style={{ ...card, marginBottom: '1rem', opacity: 0.92 }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>🎁 Catálogo de recompensas</h2>
          <button
            type="button"
            disabled
            title="Disponível quando o backend for construído"
            style={{ ...btn, opacity: 0.5, cursor: 'not-allowed' }}
          >
            + Nova recompensa
          </button>
        </header>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {RECOMPENSAS_MOCK.map((r) => (
            <div
              key={r.id}
              style={{
                background: '#fafbfc',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '0.875rem',
                opacity: r.ativo ? 1 : 0.55,
              }}
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
                <span style={{ fontWeight: 600, fontSize: 14 }}>{r.pontos} pts</span>
              </header>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.nome}</div>
              <p style={{ fontSize: 12, color: colors.muted, margin: 0, lineHeight: 1.4 }}>
                {r.descricao}
              </p>
              {!r.ativo && (
                <p style={{ fontSize: 11, color: colors.warning, marginTop: 6 }}>Pausada</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Roadmap detalhado */}
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>🗺️ Roadmap do módulo</h2>
        <ul
          style={{
            paddingLeft: '1.25rem',
            fontSize: 13,
            lineHeight: 1.7,
            color: colors.text,
          }}
        >
          <li>
            <strong>Configuração por empresa:</strong> taxa R$ → pontos, validade, limites
            diários, bônus em datas comemorativas
          </li>
          <li>
            <strong>Trigger automático:</strong> evento PEDIDO_ENTREGUE credita pontos
            proporcionais ao valor pago
          </li>
          <li>
            <strong>Catálogo CRUD:</strong> recompensas com descrição, custo em pontos, validade,
            estoque, tipo
          </li>
          <li>
            <strong>Resgate:</strong> portal do cliente consulta saldo + solicita resgate (fluxo:
            solicita → REP aprova → marca como entregue)
          </li>
          <li>
            <strong>Cron expiração:</strong> roda diariamente, expira pontos &gt; 365d, digest
            mensal aos clientes
          </li>
          <li>
            <strong>Dashboard analytics:</strong> taxa adesão, ticket médio com vs sem programa,
            ROI das recompensas
          </li>
          <li>
            <strong>Integração WhatsApp:</strong> bot responde "pontos" / "saldo" via Inbox
          </li>
        </ul>
        <p style={{ fontSize: 12, color: colors.muted, marginTop: '0.75rem' }}>
          Estimativa: ~12-18h backend + 6-8h frontend. Entra no próximo sprint se priorizado.
        </p>
      </section>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </PageLayout>
  );
}

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

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [texto, setTexto] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Sugerir / priorizar Fidelidade"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          <button
            type="button"
            data-testid="fidelidade-submit"
            disabled={texto.trim().length === 0}
            onClick={() => {
              // localStorage tem cota ~5MB por origem. Em browsers com armazenamento
              // cheio (modo privado, restrição de cookies, etc), `setItem` lança
              // QuotaExceededError. Captura + fallback evita travar a página.
              try {
                const existing = localStorage.getItem('fidelidade_feedback') ?? '';
                // Limita acúmulo a ~100KB pra não bater quota com uso prolongado.
                const truncated = existing.length > 100_000 ? existing.slice(-50_000) : existing;
                const merged =
                  truncated +
                  (truncated ? '\n\n' : '') +
                  `[${new Date().toISOString()}]\n${texto}`;
                localStorage.setItem('fidelidade_feedback', merged);
                alert(
                  'Feedback registrado localmente. Quando o módulo entrar, vamos consultar.',
                );
              } catch (err) {
                // Quota cheia ou storage desabilitado — não bloqueia o user.
                 
                console.warn('localStorage indisponível pra feedback:', err);
                alert(
                  'Não conseguimos salvar localmente (armazenamento cheio ou desabilitado). ' +
                    'Anote o feedback em outro lugar até o módulo entrar.',
                );
              }
              onClose();
            }}
            style={{ ...btn, opacity: texto.trim().length === 0 ? 0.6 : 1 }}
          >
            Registrar
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14, color: colors.muted }}>
        Conta o que você precisa do programa de fidelidade. Pode ser uso específico,
        comparação com concorrente, ou prioridade vs outras features.
      </p>
      <FormField label="Seu feedback">
        <Textarea
          data-testid="fidelidade-textarea"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={2000}
          placeholder="Ex: nosso melhor cliente cobrou um programa de pontos comparando com a XYZ..."
          style={{ minHeight: 120 }}
        />
      </FormField>
    </Modal>
  );
}
