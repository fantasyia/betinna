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
import { Badge, Button, Card, Dialog } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TriggerTipo, AcaoTipo } from '@/pages/fluxo/lib/types';

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
  categoria: 'Retenção' | 'Pós-venda' | 'Cobrança' | 'Boas-vindas' | 'Engajamento';
  icon: typeof Zap;
  triggerTipo: TriggerTipo;
  /** CRON: o agendamento vive em Fluxo.triggerConfig (o job lê de lá). */
  triggerConfig?: Record<string, unknown>;
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
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Enviar WhatsApp de reativação',
        posX: 100,
        posY: 220,
        config: {
          destinatarioModo: 'lead',
          mensagem:
            'Olá {{lead.contato}}, faz tempo! Tenho novidades que podem te interessar. Quer dar uma olhada?',
        },
      },
      {
        id: 'd1',
        tipo: 'DELAY',
        titulo: 'Aguardar 48h',
        posX: 100,
        posY: 360,
        config: { quantidade: 48, unidade: 'horas' },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'CRIAR_TAREFA',
        titulo: 'Tarefa: retomar contato',
        posX: 100,
        posY: 500,
        config: {
          titulo: 'Retomar contato com {{lead.nome}} (reativação sem resposta)',
          descricao: 'Reativação enviada há 48h. Ligar ou passar mais contexto.',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'a1' },
      { sourceNoId: 'a1', targetNoId: 'd1' },
      { sourceNoId: 'd1', targetNoId: 'a2' },
    ],
    highlights: ['WhatsApp de reativação', 'Delay 48h', 'Tarefa de follow-up'],
  },
  {
    slug: 'pos-venda-agradecimento',
    nome: 'Pós-venda — agradecimento + acompanhamento',
    descricao:
      'Após pedido entregue, envia WhatsApp de agradecimento. Em 3 dias, um e-mail perguntando como foi.',
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
          destinatarioModo: 'lead',
          mensagem:
            'Olá {{lead.contato}}, seu pedido foi entregue! Esperamos que goste. Qualquer coisa, é só me chamar 🙏',
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
        titulo: 'E-mail de acompanhamento',
        posX: 100,
        posY: 500,
        config: {
          assunto: 'Como foi sua experiência?',
          corpo:
            '<p>Olá {{lead.contato}},</p><p>Queremos saber como foi sua experiência com a entrega. Pode responder este e-mail contando?</p>',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'a1' },
      { sourceNoId: 'a1', targetNoId: 'd1' },
      { sourceNoId: 'd1', targetNoId: 'a2' },
    ],
    highlights: ['Trigger entrega', 'WhatsApp imediato', 'E-mail após 3d'],
  },
  {
    slug: 'lead-parado-follow-up',
    nome: 'Lead parado — follow-up em 3 dias',
    descricao:
      'Lead que entra na etapa e não avança recebe um toque por WhatsApp em 3 dias, e vira tarefa se continuar parado.',
    categoria: 'Cobrança',
    icon: AlertTriangle,
    triggerTipo: 'LEAD_ETAPA_MUDOU',
    nos: [
      {
        id: 't1',
        tipo: 'TRIGGER',
        titulo: 'Lead mudou de etapa',
        posX: 100,
        posY: 80,
        config: {},
      },
      {
        id: 'd1',
        tipo: 'DELAY',
        titulo: 'Aguardar 3 dias',
        posX: 100,
        posY: 220,
        config: { quantidade: 3, unidade: 'dias' },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Toque amistoso',
        posX: 100,
        posY: 360,
        config: {
          destinatarioModo: 'lead',
          mensagem:
            'Oi {{lead.contato}}, tudo bem? Só passando pra saber se ficou alguma dúvida do que conversamos. Qualquer coisa me chama!',
        },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'CRIAR_TAREFA',
        titulo: 'Tarefa pro responsável',
        posX: 100,
        posY: 500,
        config: {
          titulo: 'Follow-up: {{lead.nome}} parado em {{lead.etapa_atual}}',
          descricao: 'Lead sem avanço há 3 dias. Ligar ou reengajar.',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'd1' },
      { sourceNoId: 'd1', targetNoId: 'a1' },
      { sourceNoId: 'a1', targetNoId: 'a2' },
    ],
    highlights: ['Delay 3 dias', 'Toque por WhatsApp', 'Vira tarefa'],
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
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'WhatsApp de boas-vindas',
        posX: 100,
        posY: 220,
        config: {
          destinatarioModo: 'lead',
          mensagem:
            'Oi {{lead.contato}}, prazer em conhecer! Vou te atender por aqui. O que posso fazer por você?',
        },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'CRIAR_TAREFA',
        titulo: 'Tarefa: dar sequência no lead novo',
        posX: 100,
        posY: 360,
        config: {
          titulo: 'Lead novo: {{lead.nome}} ({{lead.cidade}}/{{lead.uf}})',
          descricao: 'Boas-vindas enviada. Dar sequência no atendimento.',
        },
      },
    ],
    arestas: [
      { sourceNoId: 't1', targetNoId: 'a1' },
      { sourceNoId: 'a1', targetNoId: 'a2' },
    ],
    highlights: ['WhatsApp imediato', 'Vira tarefa', 'Variáveis do lead'],
  },
  {
    slug: 'lote-diario-abordagem',
    nome: 'Abordagem diária — libera um lote por dia',
    descricao:
      'Todo dia útil às 9h, libera um lote de leads de uma etapa pra outra (ritmo controlado, sem rajada).',
    categoria: 'Engajamento',
    icon: Gift,
    triggerTipo: 'CRON_AGENDADO',
    // O agendamento vive em Fluxo.triggerConfig (é de lá que o job lê).
    triggerConfig: {
      expressoes: ['0 9 * * 1-5'],
      expressao: '0 9 * * 1-5',
      timezone: 'America/Sao_Paulo',
      pularFeriados: true,
    },
    nos: [
      {
        id: 't1',
        tipo: 'TRIGGER',
        titulo: 'Todo dia útil às 9h',
        posX: 100,
        posY: 80,
        config: {
          expressoes: ['0 9 * * 1-5'],
          expressao: '0 9 * * 1-5',
          timezone: 'America/Sao_Paulo',
          pularFeriados: true,
        },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'LIBERAR_LOTE',
        titulo: 'Liberar 50 leads pra abordagem',
        posX: 100,
        posY: 220,
        // etapaOrigemId/etapaDestinoId: escolher no inspector depois de criar.
        config: { quantidade: 50 },
      },
    ],
    arestas: [{ sourceNoId: 't1', targetNoId: 'a1' }],
    highlights: ['Cron dias úteis', 'Pula feriados', 'Lote controlado'],
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
        config: {},
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Avisar o diretor',
        posX: 100,
        posY: 220,
        config: {
          // ⚠️ destinatarioModo 'numero' é OBRIGATÓRIO aqui: no default ('lead')
          // este aviso INTERNO ia direto pro WhatsApp do próprio lead — com nome
          // do rep e valor da negociação. Preencher `numero` ao criar o fluxo.
          destinatarioModo: 'numero',
          numero: '',
          mensagem:
            '🎯 Lead {{lead.nome}} entrou na etapa {{lead.etapa_atual}} (funil {{lead.funil}}).',
        },
      },
    ],
    arestas: [{ sourceNoId: 't1', targetNoId: 'a1' }],
    highlights: ['Alerta em tempo real', 'WhatsApp pro diretor', 'Preencher o número'],
  },
  {
    slug: 'roteia-por-uf',
    nome: 'Roteia por estado — SP vs resto do Brasil',
    descricao:
      'Lead novo de SP recebe uma mensagem; os demais recebem outra. Exemplo de condição com os dois caminhos ligados.',
    categoria: 'Engajamento',
    icon: Calendar,
    triggerTipo: 'LEAD_CRIADO',
    nos: [
      { id: 't1', tipo: 'TRIGGER', titulo: 'Lead criado', posX: 100, posY: 80, config: {} },
      {
        id: 'c1',
        tipo: 'CONDICAO',
        titulo: 'É de São Paulo?',
        posX: 100,
        posY: 220,
        // Só campos que o motor expõe ({{lead.*}}) e operadores do switch.
        config: { modo: 'simples', campo: 'lead.uf', operador: 'eq', valor: 'SP' },
      },
      {
        id: 'a1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Mensagem SP',
        posX: 380,
        posY: 160,
        config: {
          destinatarioModo: 'lead',
          mensagem:
            'Oi {{lead.contato}}! Atendemos {{lead.cidade}} com visita presencial. Quer marcar uma conversa?',
        },
      },
      {
        id: 'a2',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Mensagem demais estados',
        posX: 380,
        posY: 320,
        config: {
          destinatarioModo: 'lead',
          mensagem:
            'Oi {{lead.contato}}! Atendemos {{lead.uf}} remotamente, com entrega. Posso te mandar mais detalhes?',
        },
      },
    ],
    // Os DOIS ramos ligados: condição com um caminho solto não ativa mais.
    arestas: [
      { sourceNoId: 't1', targetNoId: 'c1' },
      { sourceNoId: 'c1', targetNoId: 'a1', label: 'Sim' },
      { sourceNoId: 'c1', targetNoId: 'a2', label: 'Não' },
    ],
    highlights: ['Condição por UF', 'Dois caminhos', 'Mensagem personalizada'],
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
        // O agendamento do CRON vive em Fluxo.triggerConfig (é de lá que o job
        // lê) — sem mandar aqui, o fluxo nascia sem horário nenhum.
        ...(template.triggerConfig ? { triggerConfig: template.triggerConfig } : {}),
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
