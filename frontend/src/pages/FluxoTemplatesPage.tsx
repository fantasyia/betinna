import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
  Snowflake,
  Heart,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  Calendar,
  Gift,
  ArrowRight,
  Check,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { Badge, Button, Card, CardHeader, CardTitle, Dialog } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TriggerTipo, AcaoTipo } from './FluxoEditor';

/**
 * FluxoTemplatesPage — galeria de fluxos pré-construídos.
 *
 * Cada template define `nos` e `arestas` que viram um Fluxo pronto pra editar.
 * Click em "Usar este template" cria o fluxo (status=RASCUNHO) e abre o editor.
 */

interface TemplateNode {
  id: string; // referência local pra connectar com edges
  tipo: 'TRIGGER' | 'CONDICAO' | 'ACAO' | 'DELAY';
  acaoTipo?: AcaoTipo;
  titulo: string;
  posX: number;
  posY: number;
  config?: Record<string, unknown>;
}

interface TemplateEdge {
  sourceNoId: string;
  targetNoId: string;
  label?: string;
}

interface FluxoTemplate {
  slug: string;
  nome: string;
  descricao: string;
  categoria: 'Retenção' | 'Pós-venda' | 'Cobrança' | 'Boas-vindas' | 'NPS' | 'Engajamento';
  icon: typeof Zap;
  triggerTipo: TriggerTipo;
  nos: TemplateNode[];
  arestas: TemplateEdge[];
  /** Estimativa visual pro card (em palavras). */
  highlights: string[];
}

// ─── Templates ────────────────────────────────────────────────

const TEMPLATES: FluxoTemplate[] = [
  {
    slug: 'cliente-esfriando',
    nome: 'Cliente esfriando — reativação 21 dias',
    descricao:
      'Cliente sem pedido há 21+ dias recebe WhatsApp de reativação. Se não responder em 48h, notifica diretor.',
    categoria: 'Retenção',
    icon: Snowflake,
    triggerTipo: 'CLIENTE_INATIVO_30D',
    nos: [
      {
        id: 't1',
        tipo: 'TRIGGER',
        titulo: 'Cliente sem pedido há 21d',
        posX: 100,
        posY: 80,
        config: { dias: 21, ticketMinimo: 2000 },
      },
      {
        id: 'c1',
        tipo: 'CONDICAO',
        titulo: 'Cliente está na blacklist?',
        posX: 100,
        posY: 220,
        config: { campo: 'cliente.blacklist', operador: 'igual', valor: false },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Enviar WhatsApp de reativação',
        posX: 380,
        posY: 220,
        config: {
          mensagem:
            'Olá {{nome}}, faz tempo! Tenho ofertas novas que podem te interessar. Quer dar uma olhada?',
        },
      },
      {
        id: 'd1',
        tipo: 'DELAY',
        titulo: 'Aguardar 48h',
        posX: 380,
        posY: 360,
        config: { quantidade: 48, unidade: 'horas' },
      },
      {
        id: 'c2',
        tipo: 'CONDICAO',
        titulo: 'Cliente respondeu?',
        posX: 380,
        posY: 500,
        config: { campo: 'inbox.respondeu', operador: 'igual', valor: false },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'WEBHOOK_EXTERNO',
        titulo: 'Notificar diretor',
        posX: 680,
        posY: 500,
        config: { url: '/internal/notify-director', method: 'POST' },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'c1' },
      { sourceNoId: 'c1', targetNoId: 'a1', label: 'Sim' },
      { sourceNoId: 'a1', targetNoId: 'd1' },
      { sourceNoId: 'd1', targetNoId: 'c2' },
      { sourceNoId: 'c2', targetNoId: 'a2', label: 'Não' },
    ],
    highlights: ['WhatsApp', 'Delay 48h', 'Condição blacklist', 'Notifica diretor'],
  },
  {
    slug: 'pos-venda-agradecimento',
    nome: 'Pós-venda — agradecimento + NPS',
    descricao:
      'Após pedido entregue, envia WhatsApp de agradecimento. Em 3 dias, envia pesquisa NPS por e-mail.',
    categoria: 'Pós-venda',
    icon: Heart,
    triggerTipo: 'PEDIDO_ENTREGUE',
    nos: [
      { id: 't1', tipo: 'TRIGGER', titulo: 'Pedido entregue', posX: 100, posY: 80, config: {} },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Agradecer pelo pedido',
        posX: 100,
        posY: 220,
        config: {
          mensagem:
            'Olá {{nome}}, seu pedido {{pedido_numero}} foi entregue! Esperamos que goste. Qualquer coisa, é só me chamar 🙏',
        },
      },
      {
        id: 'd1',
        tipo: 'DELAY',
        titulo: 'Aguardar 3 dias',
        posX: 100,
        posY: 360,
        config: { quantidade: 3, unidade: 'dias' },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_EMAIL',
        titulo: 'Pesquisa NPS',
        posX: 100,
        posY: 500,
        config: {
          assunto: 'Como foi sua experiência?',
          corpo:
            '<p>Olá {{nome}},</p><p>Quanto você nos recomendaria de 0 a 10?</p><p><a href="{{nps_url}}">Responder NPS</a></p>',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'a1' },
      { sourceNoId: 'a1', targetNoId: 'd1' },
      { sourceNoId: 'd1', targetNoId: 'a2' },
    ],
    highlights: ['Trigger entrega', 'WhatsApp imediato', 'E-mail NPS após 3d'],
  },
  {
    slug: 'cobranca-suave',
    nome: 'Cobrança suave — lembrete amistoso',
    descricao:
      'Pedido com vencimento próximo dispara lembrete WhatsApp 2 dias antes. Se passa do prazo, escalona para o representante.',
    categoria: 'Cobrança',
    icon: AlertTriangle,
    triggerTipo: 'CRON_AGENDADO',
    nos: [
      {
        id: 't1',
        tipo: 'TRIGGER',
        titulo: 'Cron diário 9h',
        posX: 100,
        posY: 80,
        config: { cron: '0 9 * * *' },
      },
      {
        id: 'c1',
        tipo: 'CONDICAO',
        titulo: 'Vencimento em 2 dias?',
        posX: 100,
        posY: 220,
        config: { campo: 'pedido.vencimento', operador: 'em_dias', valor: 2 },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Lembrete amistoso',
        posX: 380,
        posY: 220,
        config: {
          mensagem:
            'Oi {{nome}}, só passando pra lembrar que o pedido {{pedido_numero}} vence em 2 dias. Qualquer dúvida me chama!',
        },
      },
      {
        id: 'd1',
        tipo: 'DELAY',
        titulo: 'Aguardar 3 dias',
        posX: 380,
        posY: 360,
        config: { quantidade: 3, unidade: 'dias' },
      },
      {
        id: 'c2',
        tipo: 'CONDICAO',
        titulo: 'Está em atraso?',
        posX: 380,
        posY: 500,
        config: { campo: 'pedido.vencido', operador: 'igual', valor: true },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'CRIAR_TAREFA',
        titulo: 'Tarefa pro representante cobrar',
        posX: 680,
        posY: 500,
        config: { titulo: 'Cobrar {{cliente_nome}} — pedido {{pedido_numero}}', responsavel: 'rep' },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'c1' },
      { sourceNoId: 'c1', targetNoId: 'a1', label: 'Sim' },
      { sourceNoId: 'a1', targetNoId: 'd1' },
      { sourceNoId: 'd1', targetNoId: 'c2' },
      { sourceNoId: 'c2', targetNoId: 'a2', label: 'Sim' },
    ],
    highlights: ['Cron diário', 'Lembrete antes do vencimento', 'Escala pro rep'],
  },
  {
    slug: 'boas-vindas-novo-lead',
    nome: 'Boas-vindas — novo lead captado',
    descricao:
      'Novo lead recebe WhatsApp de boas-vindas imediato + atribui representante da região automaticamente.',
    categoria: 'Boas-vindas',
    icon: Sparkles,
    triggerTipo: 'LEAD_CRIADO',
    nos: [
      { id: 't1', tipo: 'TRIGGER', titulo: 'Lead criado', posX: 100, posY: 80, config: {} },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ATRIBUIR_REP',
        titulo: 'Atribuir representante por região',
        posX: 100,
        posY: 220,
        config: { criterio: 'regiao' },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'WhatsApp de boas-vindas',
        posX: 100,
        posY: 360,
        config: {
          mensagem:
            'Oi {{nome}}, prazer em conhecer! Sou {{rep_nome}}, vou te atender por aqui. O que posso fazer por você?',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'a1' },
      { sourceNoId: 'a1', targetNoId: 'a2' },
    ],
    highlights: ['Atribui rep', 'WhatsApp imediato', 'Variáveis dinâmicas'],
  },
  {
    slug: 'aniversario-cliente',
    nome: 'Aniversário do cliente — felicitação',
    descricao:
      'No aniversário do contato principal, envia WhatsApp de feliz aniversário + cupom de desconto.',
    categoria: 'Engajamento',
    icon: Gift,
    triggerTipo: 'CRON_AGENDADO',
    nos: [
      {
        id: 't1',
        tipo: 'TRIGGER',
        titulo: 'Cron diário 10h',
        posX: 100,
        posY: 80,
        config: { cron: '0 10 * * *' },
      },
      {
        id: 'c1',
        tipo: 'CONDICAO',
        titulo: 'Hoje é aniversário?',
        posX: 100,
        posY: 220,
        config: { campo: 'cliente.aniversario_hoje', operador: 'igual', valor: true },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Mensagem de feliz aniversário',
        posX: 380,
        posY: 220,
        config: {
          mensagem:
            'Feliz aniversário, {{nome}}! 🎂 Como presente, 10% off no próximo pedido. Use o cupom ANIVER10 até o fim do mês.',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'c1' },
      { sourceNoId: 'c1', targetNoId: 'a1', label: 'Sim' },
    ],
    highlights: ['Cron diário', 'Cupom de desconto', 'Personalização'],
  },
  {
    slug: 'lead-qualificado-alerta',
    nome: 'Lead qualificado — alerta do diretor',
    descricao:
      'Lead movido pra etapa Negociação dispara notificação imediata pro diretor por WhatsApp.',
    categoria: 'Engajamento',
    icon: TrendingUp,
    triggerTipo: 'LEAD_ETAPA_MUDOU',
    nos: [
      {
        id: 't1',
        tipo: 'TRIGGER',
        titulo: 'Lead mudou de etapa',
        posX: 100,
        posY: 80,
        config: { etapa: 'NEGOCIACAO' },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Avisar diretor',
        posX: 100,
        posY: 220,
        config: {
          mensagem:
            '🎯 Lead {{lead_nome}} ({{valor_estimado}}) entrou em NEGOCIAÇÃO com o representante {{rep_nome}}.',
        },
      },
    ],
    arestas: [{ sourceNoId: 't1', targetNoId: 'a1' }],
    highlights: ['Alerta em tempo real', 'WhatsApp pro diretor', 'Filtro por etapa'],
  },
  {
    slug: 'agenda-visita',
    nome: 'Agenda de visita — lembrete prévio',
    descricao:
      'Visita agendada dispara lembrete 1h antes pro representante com endereço completo do cliente.',
    categoria: 'Engajamento',
    icon: Calendar,
    triggerTipo: 'CRON_AGENDADO',
    nos: [
      {
        id: 't1',
        tipo: 'TRIGGER',
        titulo: 'Cron a cada hora',
        posX: 100,
        posY: 80,
        config: { cron: '0 * * * *' },
      },
      {
        id: 'c1',
        tipo: 'CONDICAO',
        titulo: 'Visita em 1h?',
        posX: 100,
        posY: 220,
        config: { campo: 'agenda.proxima_visita_em_minutos', operador: 'menor_que', valor: 60 },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Lembrete pro representante',
        posX: 380,
        posY: 220,
        config: {
          mensagem:
            '⏰ Em 1h: visita ao cliente {{cliente_nome}}. Endereço: {{endereco_completo}}. Última observação: {{obs}}',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'c1' },
      { sourceNoId: 'c1', targetNoId: 'a1', label: 'Sim' },
    ],
    highlights: ['Cron horário', 'Lembrete logístico', 'Endereço dinâmico'],
  },
];

const CATEGORIA_VARIANT: Record<
  FluxoTemplate['categoria'],
  'primary' | 'info' | 'warning' | 'success' | 'neutral'
> = {
  Retenção: 'warning',
  'Pós-venda': 'success',
  Cobrança: 'warning',
  'Boas-vindas': 'primary',
  NPS: 'info',
  Engajamento: 'info',
};

// ─── Page ──────────────────────────────────────────────────────

export default function FluxoTemplatesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [filterCat, setFilterCat] = useState<string>('todos');
  const [confirming, setConfirming] = useState<FluxoTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = filterCat === 'todos' ? TEMPLATES : TEMPLATES.filter((t) => t.categoria === filterCat);

  async function instantiate(template: FluxoTemplate) {
    setCreating(true);
    try {
      // IMPORTANTE: backend schema (createFluxoNoSchema/createFluxoEdgeSchema)
      // exige `id: z.string().min(1)` em TODO nó e TODA aresta. Sem isso,
      // o Zod recusa o payload com 'Dados inválidos' (bug B4 fix 2026-05-21).
      const payload = {
        nome: template.nome,
        descricao: template.descricao,
        triggerTipo: template.triggerTipo,
        nos: template.nos.map((n) => ({
          id: n.id, // ← obrigatório (referência das arestas usa esses ids)
          tipo: n.tipo,
          acaoTipo: n.acaoTipo,
          titulo: n.titulo,
          posX: n.posX,
          posY: n.posY,
          config: n.config ?? {},
        })),
        arestas: template.arestas.map((e, idx) => ({
          // Aresta não tem id no template; gera id estável baseado no índice
          id: `e_${idx}_${e.sourceNoId}_${e.targetNoId}`,
          sourceNoId: e.sourceNoId,
          targetNoId: e.targetNoId,
          label: e.label ?? null,
        })),
      };
      const r = await api.post<{ id: string }>('/fluxos', payload);
      toast.success('Fluxo criado a partir do template');
      navigate(`/fluxos?edit=${r.id}`);
    } catch (err) {
      toast.error('Falha ao criar fluxo', apiErrorMessage(err));
    } finally {
      setCreating(false);
      setConfirming(null);
    }
  }

  const categorias = ['todos', ...new Set(TEMPLATES.map((t) => t.categoria))] as const;

  return (
    <PageLayout
      title="Templates de fluxos"
      description="Comece de um exemplo pronto e adapte pro seu negócio."
      actions={
        <Button variant="secondary" onClick={() => navigate('/fluxos')}>
          Ver meus fluxos
        </Button>
      }
    >
      <CrmTabs />
      {/* Filtro de categoria */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {categorias.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilterCat(c)}
            className={cn(
              'h-7 px-3 rounded-full text-xs font-medium',
              'border transition-colors duration-100',
              filterCat === c
                ? 'bg-primary text-primary-contrast border-primary'
                : 'bg-surface border-border text-text-subtle hover:border-border-strong hover:text-text',
            )}
          >
            {c === 'todos' ? 'Todos' : c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {visible.map((t) => (
          <TemplateCard
            key={t.slug}
            template={t}
            onUse={() => setConfirming(t)}
          />
        ))}
      </div>

      {confirming && (
        <Dialog
          open
          onClose={() => setConfirming(null)}
          title={`Usar template "${confirming.nome}"?`}
          description="Vamos criar um novo fluxo (rascunho) com base nesse template. Você poderá editar antes de ativar."
          size="md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => instantiate(confirming)}
                loading={creating}
                leftIcon={<Check className="h-3.5 w-3.5" />}
              >
                Criar e abrir editor
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-border bg-bg-alt p-3">
              <p className="text-sm text-text-subtle leading-relaxed">{confirming.descricao}</p>
            </div>
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                O fluxo terá
              </h4>
              <ul className="flex flex-col gap-1.5">
                <li className="text-sm text-text flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  {confirming.nos.length} nós
                </li>
                <li className="text-sm text-text flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  {confirming.arestas.length} conexões
                </li>
                <li className="text-sm text-text flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  Trigger: {confirming.triggerTipo}
                </li>
              </ul>
            </div>
          </div>
        </Dialog>
      )}
    </PageLayout>
  );
}

// ─── Template card ────────────────────────────────────────────

function TemplateCard({
  template,
  onUse,
}: {
  template: FluxoTemplate;
  onUse: () => void;
}) {
  const Icon = template.icon;
  return (
    <Card padding="md" variant="default" className="flex flex-col gap-3 group">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary shrink-0 [&>svg]:h-4 [&>svg]:w-4">
          <Icon />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-md font-semibold text-text tracking-tight leading-tight">
            {template.nome}
          </h3>
          <Badge variant={CATEGORIA_VARIANT[template.categoria]} size="sm" className="mt-1">
            {template.categoria}
          </Badge>
        </div>
      </header>

      <p className="text-xs text-text-subtle leading-relaxed line-clamp-3">{template.descricao}</p>

      <div className="flex flex-wrap gap-1.5">
        {template.highlights.map((h) => (
          <Badge key={h} variant="outline" size="sm">
            {h}
          </Badge>
        ))}
      </div>

      <footer className="flex items-center justify-between pt-2 mt-auto border-t border-border">
        <span className="text-[11px] text-muted tabular">
          {template.nos.length} nós · {template.arestas.length} conexões
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={onUse}
          rightIcon={<ArrowRight className="h-3 w-3" />}
        >
          Usar
        </Button>
      </footer>
    </Card>
  );
}

// Re-export only what's used (mark cn used)
const _u = CardHeader;
void _u;
const _u2 = CardTitle;
void _u2;
