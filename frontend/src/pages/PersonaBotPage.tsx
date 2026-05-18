import { useEffect, useState } from 'react';
import {
  Bot,
  Sparkles,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  MessageCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Switch,
  Textarea,
} from '@/components/ui';

/**
 * PersonaBotPage — edição da identidade do MullerBot por empresa.
 *
 * Permite ao DIRECTOR ajustar:
 *  - Nome do bot
 *  - Tom de voz (5 níveis: formal → entusiasmado)
 *  - Instruções específicas (anexadas ao system prompt)
 *  - Saudação (usada em mensagens iniciais)
 *  - Exemplos few-shot (até 10 pares pergunta/resposta)
 *
 * Preview do system prompt compilado em modal.
 * DIRECTOR-only (ADMIN bypassa pra suporte).
 */

type TomVoz = 'FORMAL' | 'PROFISSIONAL' | 'AMIGAVEL' | 'DESCONTRAIDO' | 'ENTUSIASMADO';

interface ExemploDto {
  pergunta: string;
  resposta: string;
}

interface Persona {
  id: string;
  empresaId: string;
  nome: string;
  tomVoz: TomVoz;
  instrucoes?: string | null;
  exemplos?: ExemploDto[];
  saudacao?: string | null;
  ativo: boolean;
  atualizadoEm: string;
}

const TOM_LABEL: Record<TomVoz, string> = {
  FORMAL: 'Formal',
  PROFISSIONAL: 'Profissional',
  AMIGAVEL: 'Amigável',
  DESCONTRAIDO: 'Descontraído',
  ENTUSIASMADO: 'Entusiasmado',
};

const TOM_DESCRIPTION: Record<TomVoz, string> = {
  FORMAL: 'Respeitoso e direto. Use "senhor/senhora", evite gírias.',
  PROFISSIONAL: 'Equilibrado. Linguagem clara, natural, sem gírias.',
  AMIGAVEL: 'Caloroso. Trata o cliente como parceiro próximo.',
  DESCONTRAIDO: 'Leve. Pode usar expressões coloquiais e emojis.',
  ENTUSIASMADO: 'Energético. Destaca benefícios com vocabulário positivo.',
};

export default function PersonaBotPage() {
  const toast = useToast();
  const role = useRole();
  const canEdit = role === 'ADMIN' || role === 'DIRECTOR';

  const { data, loading, refetch } = useApiQuery<Persona>('/mullerbot/persona');

  // Local edit state — hidrata quando data chega
  const [nome, setNome] = useState('MullerBot');
  const [tomVoz, setTomVoz] = useState<TomVoz>('PROFISSIONAL');
  const [instrucoes, setInstrucoes] = useState('');
  const [saudacao, setSaudacao] = useState('');
  const [exemplos, setExemplos] = useState<ExemploDto[]>([]);
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Hidrata ao chegar
  useEffect(() => {
    if (!data) return;
    setNome(data.nome);
    setTomVoz(data.tomVoz);
    setInstrucoes(data.instrucoes ?? '');
    setSaudacao(data.saudacao ?? '');
    setExemplos(data.exemplos ?? []);
    setAtivo(data.ativo);
    setDirty(false);
  }, [data]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  function addExemplo() {
    if (exemplos.length >= 10) {
      toast.error('Máximo de 10 exemplos.');
      return;
    }
    setExemplos((es) => [...es, { pergunta: '', resposta: '' }]);
    setDirty(true);
  }

  function updateExemplo(idx: number, patch: Partial<ExemploDto>) {
    setExemplos((es) => es.map((ex, i) => (i === idx ? { ...ex, ...patch } : ex)));
    setDirty(true);
  }

  function removeExemplo(idx: number) {
    setExemplos((es) => es.filter((_, i) => i !== idx));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Filtra exemplos vazios
      const exemplosLimpos = exemplos.filter(
        (ex) => ex.pergunta.trim().length >= 2 && ex.resposta.trim().length >= 2,
      );
      await api.put<Persona>('/mullerbot/persona', {
        nome: nome.trim() || 'MullerBot',
        tomVoz,
        instrucoes: instrucoes.trim() || null,
        saudacao: saudacao.trim() || null,
        exemplos: exemplosLimpos.length > 0 ? exemplosLimpos : undefined,
        ativo,
      });
      toast.success('Persona atualizada');
      setDirty(false);
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await api.post<Persona>('/mullerbot/persona/reset');
      toast.success('Persona resetada pro default');
      setResetDialogOpen(false);
      refetch();
    } catch (err) {
      toast.error('Falha ao resetar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <PageLayout title="Persona MullerBot">
        <Card padding="lg">
          <div className="text-muted text-center py-8">Carregando…</div>
        </Card>
      </PageLayout>
    );
  }

  if (!canEdit) {
    return (
      <PageLayout title="Persona MullerBot">
        <EmptyState
          icon={<AlertCircle />}
          title="Acesso restrito"
          description="A persona do MullerBot só pode ser editada por DIRECTOR ou ADMIN."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Persona do MullerBot"
      description="Defina o tom, a voz e os exemplos que moldam como o seu MullerBot conversa com os clientes."
      actions={
        <>
          <Button
            variant="ghost"
            onClick={() => setResetDialogOpen(true)}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
          >
            Resetar
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPreviewOpen(true)}
            leftIcon={<Eye className="h-3.5 w-3.5" />}
          >
            Preview prompt
          </Button>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={!dirty}
            leftIcon={<Save className="h-3.5 w-3.5" />}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Coluna principal — edição */}
        <div className="flex flex-col gap-4">
          {/* Identidade */}
          <Card padding="md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                Identidade
              </CardTitle>
              <CardDescription>Como o bot se apresenta.</CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3">
              <Field
                label="Nome do bot"
                hint="Aparece em saudações. Ex: MullerBot, Bia, AssistenteX"
              >
                <Input
                  value={nome}
                  onChange={(e) => markDirty(setNome)(e.target.value)}
                  maxLength={60}
                  placeholder="MullerBot"
                />
              </Field>
              <Field
                label="Saudação"
                hint="Opcional. Usada em primeira mensagem de WhatsApp/Inbox."
              >
                <Input
                  value={saudacao}
                  onChange={(e) => markDirty(setSaudacao)(e.target.value)}
                  maxLength={280}
                  placeholder="Oi! Sou o {{nome}}, posso te ajudar com o catálogo?"
                />
              </Field>
              <Field label="Status">
                <Switch
                  checked={ativo}
                  onChange={(e) => markDirty(setAtivo)(e.target.checked)}
                  label={ativo ? 'Ativa — usada em todas as perguntas' : 'Inativa — bot usa default'}
                />
              </Field>
            </div>
          </Card>

          {/* Tom de voz */}
          <Card padding="md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Tom de voz
              </CardTitle>
              <CardDescription>Como o bot se expressa nas respostas.</CardDescription>
            </CardHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(Object.keys(TOM_LABEL) as TomVoz[]).map((t) => {
                const isActive = tomVoz === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => markDirty(setTomVoz)(t)}
                    className={[
                      'flex items-start gap-3 p-3 rounded-md text-left',
                      'border transition-all duration-100',
                      isActive
                        ? 'bg-primary/10 border-primary'
                        : 'bg-surface border-border hover:border-border-strong hover:bg-surface-hover',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex h-5 w-5 items-center justify-center rounded-full border-2 shrink-0 mt-0.5',
                        isActive ? 'border-primary bg-primary' : 'border-border-strong bg-bg',
                      ].join(' ')}
                    >
                      {isActive && (
                        <CheckCircle2 className="h-3 w-3 text-primary-contrast" strokeWidth={3} />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text">{TOM_LABEL[t]}</div>
                      <div className="text-xs text-muted leading-snug">{TOM_DESCRIPTION[t]}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Instruções extras */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Instruções específicas</CardTitle>
              <CardDescription>
                Diretrizes que ficam por cima do prompt base. Ex: "Sempre cite prazo de entrega",
                "Não dê descontos em produtos da marca X".
              </CardDescription>
            </CardHeader>
            <Textarea
              value={instrucoes}
              onChange={(e) => markDirty(setInstrucoes)(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder={`Ex:\n- Sempre mencione o prazo de entrega de 3-5 dias úteis\n- Indique alternativas se o produto estiver em falta\n- Use emojis com moderação (máximo 1 por resposta)`}
            />
            <div className="text-[10px] text-muted-light text-right mt-1 tabular">
              {instrucoes.length}/2000
            </div>
          </Card>

          {/* Exemplos few-shot */}
          <Card padding="md">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>Exemplos (few-shot)</CardTitle>
                  <CardDescription>
                    Pares pergunta/resposta que ensinam o estilo. O bot vai imitar o tom.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addExemplo}
                  disabled={exemplos.length >= 10}
                  leftIcon={<Plus className="h-3 w-3" />}
                >
                  Adicionar
                </Button>
              </div>
            </CardHeader>
            {exemplos.length === 0 ? (
              <div className="text-sm text-muted-light italic text-center py-4">
                Nenhum exemplo ainda. Adicione até 10 pra ensinar o estilo do bot.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {exemplos.map((ex, idx) => (
                  <ExemploRow
                    key={idx}
                    exemplo={ex}
                    onChange={(patch) => updateExemplo(idx, patch)}
                    onRemove={() => removeExemplo(idx)}
                    index={idx}
                  />
                ))}
              </div>
            )}
          </Card>

          {error && (
            <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Coluna lateral — dicas */}
        <aside className="flex flex-col gap-3">
          <Card padding="md" variant="outline">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-info" />
                Como funciona
              </CardTitle>
            </CardHeader>
            <ul className="text-xs text-text-subtle space-y-2 leading-relaxed list-disc pl-4">
              <li>
                A persona é injetada no system prompt do LLM antes de cada pergunta.
              </li>
              <li>
                Tom + instruções + exemplos influenciam o estilo, não a precisão dos
                dados (que vem do catálogo).
              </li>
              <li>
                Exemplos curtos e bem escolhidos ensinam melhor que muitos exemplos
                ruins.
              </li>
              <li>
                Quando você desativa, o bot usa o prompt default (profissional).
              </li>
            </ul>
          </Card>

          <Card padding="md" variant="outline" className="bg-primary/5 border-primary/30">
            <h4 className="text-xs font-semibold text-primary mb-2 uppercase tracking-wider">
              Dica
            </h4>
            <p className="text-xs text-text-subtle leading-relaxed">
              Teste mudanças na página{' '}
              <strong className="text-text">MullerBot</strong> antes de soltar pros reps.
              O system prompt aplicado é o mesmo.
            </p>
          </Card>

          {data?.atualizadoEm && (
            <div className="text-[11px] text-muted-light text-center">
              Última atualização:{' '}
              {new Date(data.atualizadoEm).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </div>
          )}
        </aside>
      </div>

      {previewOpen && <PreviewDialog onClose={() => setPreviewOpen(false)} />}

      {resetDialogOpen && (
        <Dialog
          open
          onClose={() => setResetDialogOpen(false)}
          title="Resetar persona?"
          description="Volta tudo pro padrão (nome MullerBot, tom profissional, sem instruções ou exemplos)."
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={saving}
                onClick={handleReset}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Confirmar reset
              </Button>
            </>
          }
        >
          <div className="px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            Esta ação não pode ser desfeita. Você terá que reconfigurar tudo.
          </div>
        </Dialog>
      )}
    </PageLayout>
  );
}

// ─── Exemplo row ────────────────────────────────────────────

function ExemploRow({
  exemplo,
  onChange,
  onRemove,
  index,
}: {
  exemplo: ExemploDto;
  onChange: (patch: Partial<ExemploDto>) => void;
  onRemove: () => void;
  index: number;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-alt p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="primary" size="sm">
          #{index + 1}
        </Badge>
        <IconButton
          aria-label="Remover exemplo"
          variant="danger"
          size="sm"
          icon={<Trash2 />}
          onClick={onRemove}
        />
      </div>
      <Field label="Pergunta do cliente">
        <Input
          value={exemplo.pergunta}
          onChange={(e) => onChange({ pergunta: e.target.value })}
          maxLength={500}
          placeholder="Tem óleo de soja em 5L?"
        />
      </Field>
      <Field label="Como o bot deve responder">
        <Textarea
          value={exemplo.resposta}
          onChange={(e) => onChange({ resposta: e.target.value })}
          maxLength={2000}
          rows={3}
          placeholder="Sim! Temos Óleo de Soja Refinado 5L (SKU OLE-SOJ-5L). Quer que eu reserve quantas unidades?"
        />
      </Field>
    </div>
  );
}

// ─── Preview dialog ─────────────────────────────────────────

function PreviewDialog({ onClose }: { onClose: () => void }) {
  const { data, loading } = useApiQuery<{ systemPromptPreview: string }>(
    '/mullerbot/persona/preview',
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="System prompt compilado"
      description="Este é o prompt exato que vai pro LLM antes de cada pergunta."
      size="xl"
      footer={
        <Button variant="secondary" onClick={onClose} leftIcon={<EyeOff className="h-3.5 w-3.5" />}>
          Fechar
        </Button>
      }
    >
      {loading ? (
        <div className="text-muted text-sm py-4 text-center">Compilando…</div>
      ) : (
        <pre className="text-xs font-mono whitespace-pre-wrap bg-bg p-4 rounded-md border border-border max-h-[60vh] overflow-y-auto leading-relaxed">
          {data?.systemPromptPreview ?? '—'}
        </pre>
      )}
    </Dialog>
  );
}
