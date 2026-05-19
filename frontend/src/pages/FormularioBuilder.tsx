import { useEffect, useState } from 'react';
import {
  X,
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Eye,
  Type,
  Mail,
  Phone,
  Hash,
  AlignLeft,
  ChevronDown,
  CheckSquare,
  CircleDot,
  AlertCircle,
  Copy,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * FormularioBuilder — editor visual de formulários públicos.
 *
 * Layout fullscreen (idêntico ao FluxoEditor):
 *  - Topbar: nome + status + Save
 *  - Esquerda: paleta de tipos de campo (Texto, E-mail, Tel, ...)
 *  - Centro: lista de campos editáveis (reordenável com botões)
 *  - Direita: settings do form (slug, descricao, geraLead, etc.) + preview público
 */

type CampoTipo =
  | 'TEXT'
  | 'EMAIL'
  | 'TEL'
  | 'NUMERO'
  | 'TEXTAREA'
  | 'SELECT'
  | 'CHECKBOX'
  | 'RADIO';

interface Campo {
  ordem: number;
  tipo: CampoTipo;
  label: string;
  campo: string;
  placeholder?: string;
  obrigatorio: boolean;
  opcoes?: string[];
  hint?: string;
  /** v1.5.0 — Passo multi-step (1..10). Default 1. */
  passo?: number;
}

export interface FormularioPayload {
  slug: string;
  titulo: string;
  descricao?: string | null;
  mensagemSucesso?: string | null;
  redirectUrl?: string | null;
  geraLead: boolean;
  leadEtapaInicial?: string | null;
  campos: Campo[];
  ativo: boolean;
}

interface FormularioDetail extends FormularioPayload {
  id: string;
}

const CAMPO_ICON: Record<CampoTipo, LucideIcon> = {
  TEXT: Type,
  EMAIL: Mail,
  TEL: Phone,
  NUMERO: Hash,
  TEXTAREA: AlignLeft,
  SELECT: ChevronDown,
  CHECKBOX: CheckSquare,
  RADIO: CircleDot,
};

const CAMPO_LABEL: Record<CampoTipo, string> = {
  TEXT: 'Texto curto',
  EMAIL: 'E-mail',
  TEL: 'Telefone',
  NUMERO: 'Número',
  TEXTAREA: 'Texto longo',
  SELECT: 'Lista (dropdown)',
  CHECKBOX: 'Múltipla escolha',
  RADIO: 'Escolha única',
};

const PALETTE: CampoTipo[] = [
  'TEXT',
  'EMAIL',
  'TEL',
  'NUMERO',
  'TEXTAREA',
  'SELECT',
  'RADIO',
  'CHECKBOX',
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function fieldNameFromLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join('')
    .slice(0, 60);
}

export function FormularioBuilder({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = id === null;
  const toast = useToast();
  const { data } = useApiQuery<FormularioDetail>(!isNew && id ? `/formularios/${id}` : null);

  const [titulo, setTitulo] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [geraLead, setGeraLead] = useState(true);
  const [ativo, setAtivo] = useState(true);
  const [campos, setCampos] = useState<Campo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (data) {
      setTitulo(data.titulo);
      setSlug(data.slug);
      setSlugTouched(true);
      setDescricao(data.descricao ?? '');
      setMensagemSucesso(data.mensagemSucesso ?? '');
      setRedirectUrl(data.redirectUrl ?? '');
      setGeraLead(data.geraLead);
      setAtivo(data.ativo);
      setCampos(data.campos);
    }
  }, [data]);

  // Auto-slug do título
  useEffect(() => {
    if (!slugTouched && titulo) {
      setSlug(slugify(titulo));
    }
  }, [titulo, slugTouched]);

  function addCampo(tipo: CampoTipo) {
    const ordem = campos.length;
    const label = `${CAMPO_LABEL[tipo]} ${ordem + 1}`;
    // Pega o passo do último campo (novo campo entra no mesmo passo)
    const passoAtual = campos.length > 0 ? (campos[campos.length - 1]!.passo ?? 1) : 1;
    const campo: Campo = {
      ordem,
      tipo,
      label,
      campo: fieldNameFromLabel(label),
      obrigatorio: false,
      passo: passoAtual,
      opcoes:
        tipo === 'SELECT' || tipo === 'RADIO' || tipo === 'CHECKBOX'
          ? ['Opção 1', 'Opção 2']
          : undefined,
    };
    setCampos((cs) => [...cs, campo]);
    setSelectedIdx(ordem);
  }

  function updateCampo(idx: number, patch: Partial<Campo>) {
    setCampos((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function removeCampo(idx: number) {
    setCampos((cs) => cs.filter((_, i) => i !== idx).map((c, i) => ({ ...c, ordem: i })));
    if (selectedIdx === idx) setSelectedIdx(null);
  }

  function moveCampo(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= campos.length) return;
    setCampos((cs) => {
      const next = [...cs];
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      return next.map((c, i) => ({ ...c, ordem: i }));
    });
    setSelectedIdx(target);
  }

  async function handleSave() {
    setError(null);

    if (titulo.trim().length < 2) {
      setError('Título obrigatório (mínimo 2 caracteres).');
      return;
    }
    if (slug.length < 2 || !/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug inválido: use apenas a-z, 0-9 e hífen.');
      return;
    }
    if (campos.length === 0) {
      setError('Adicione ao menos 1 campo.');
      return;
    }
    // Valida campos
    const camposClean: Campo[] = [];
    const nomesUsados = new Set<string>();
    for (const c of campos) {
      if (c.label.trim().length < 1) {
        setError(`Campo #${c.ordem + 1}: label obrigatória.`);
        return;
      }
      if (!c.campo || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.campo)) {
        setError(`Campo "${c.label}": nome interno inválido (use letras/dígitos/_, comece com letra).`);
        return;
      }
      if (nomesUsados.has(c.campo)) {
        setError(`Campo "${c.label}": nome interno "${c.campo}" duplicado.`);
        return;
      }
      nomesUsados.add(c.campo);
      camposClean.push(c);
    }

    setSaving(true);
    try {
      const payload: FormularioPayload = {
        slug,
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        mensagemSucesso: mensagemSucesso.trim() || null,
        redirectUrl: redirectUrl.trim() || null,
        geraLead,
        leadEtapaInicial: 'NOVO',
        campos: camposClean,
        ativo,
      };
      if (isNew) {
        await api.post('/formularios', payload);
      } else {
        await api.put(`/formularios/${id}`, payload);
      }
      toast.success(isNew ? 'Formulário criado' : 'Formulário atualizado');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  const publicUrl = slug ? `${window.location.origin}/f/${slug}` : '';
  const selectedCampo = selectedIdx !== null ? campos[selectedIdx] : null;

  return (
    <div className="fixed inset-0 z-[110] bg-bg flex flex-col">
      {/* Topbar */}
      <header className="flex items-center gap-3 px-4 h-[56px] border-b border-border bg-bg-alt shrink-0">
        <IconButton
          aria-label="Voltar"
          variant="ghost"
          icon={<ArrowLeft />}
          onClick={onClose}
        />
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título do formulário"
            className="max-w-md font-semibold"
          />
          <Badge variant={ativo ? 'success' : 'neutral'}>
            {ativo ? 'Ativo' : 'Inativo'}
          </Badge>
        </div>
        <Button
          variant="secondary"
          onClick={() => setPreviewOpen(true)}
          leftIcon={<Eye className="h-3.5 w-3.5" />}
        >
          Preview
        </Button>
        <Button
          onClick={handleSave}
          loading={saving}
          leftIcon={<Save className="h-3.5 w-3.5" />}
        >
          Salvar
        </Button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Palette */}
        <aside className="w-[220px] shrink-0 border-r border-border bg-bg-alt overflow-y-auto p-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 px-1">
            Adicionar campo
          </h4>
          <div className="flex flex-col gap-1">
            {PALETTE.map((tipo) => {
              const Icon = CAMPO_ICON[tipo];
              return (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => addCampo(tipo)}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-2 rounded-md text-left',
                    'border border-border bg-surface text-sm font-medium text-text',
                    'hover:border-border-strong hover:bg-surface-hover transition-colors',
                  )}
                >
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="flex-1 truncate">{CAMPO_LABEL[tipo]}</span>
                  <Plus className="h-3 w-3 text-muted" />
                </button>
              );
            })}
          </div>
        </aside>

        {/* Canvas — lista de campos */}
        <main className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {campos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong bg-bg-alt p-12 text-center text-muted-light">
              <Plus className="h-8 w-8 mx-auto mb-3" />
              <p className="text-sm font-medium">Adicione campos pela paleta lateral</p>
              <p className="text-xs mt-1">Texto, e-mail, telefone, números, listas…</p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto flex flex-col gap-2">
              {campos.map((c, idx) => (
                <CampoRow
                  key={idx}
                  campo={c}
                  index={idx}
                  total={campos.length}
                  selected={selectedIdx === idx}
                  onSelect={() => setSelectedIdx(idx)}
                  onUpdate={(patch) => updateCampo(idx, patch)}
                  onRemove={() => removeCampo(idx)}
                  onMove={(d) => moveCampo(idx, d)}
                />
              ))}
            </div>
          )}
        </main>

        {/* Inspector / Settings */}
        <aside className="w-[320px] shrink-0 border-l border-border bg-bg-alt overflow-y-auto p-4 flex flex-col gap-4">
          {selectedCampo ? (
            <CampoInspector
              campo={selectedCampo}
              onUpdate={(patch) => updateCampo(selectedIdx!, patch)}
            />
          ) : (
            <FormSettings
              slug={slug}
              setSlug={(v) => {
                setSlug(slugify(v));
                setSlugTouched(true);
              }}
              descricao={descricao}
              setDescricao={setDescricao}
              mensagemSucesso={mensagemSucesso}
              setMensagemSucesso={setMensagemSucesso}
              redirectUrl={redirectUrl}
              setRedirectUrl={setRedirectUrl}
              geraLead={geraLead}
              setGeraLead={setGeraLead}
              ativo={ativo}
              setAtivo={setAtivo}
              publicUrl={publicUrl}
            />
          )}
        </aside>
      </div>

      {previewOpen && (
        <PreviewDialog
          titulo={titulo}
          descricao={descricao}
          campos={campos}
          mensagemSucesso={mensagemSucesso}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Campo row ────────────────────────────────────────────

function CampoRow({
  campo,
  index,
  total,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onMove,
}: {
  campo: Campo;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<Campo>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const Icon = CAMPO_ICON[campo.tipo];
  return (
    <div
      onClick={onSelect}
      className={cn(
        'rounded-md border bg-surface p-3 cursor-pointer transition-all',
        'group',
        selected
          ? 'border-primary shadow-sm ring-1 ring-primary/30'
          : 'border-border hover:border-border-strong',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-0.5 shrink-0 mt-0.5">
          <button
            type="button"
            aria-label="Mover pra cima"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation();
              onMove(-1);
            }}
            className="text-muted-light hover:text-text disabled:opacity-30 cursor-pointer"
          >
            <GripVertical className="h-3.5 w-3.5 rotate-90" />
          </button>
        </div>
        <Icon className="h-4 w-4 text-primary mt-1 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Input
              size="sm"
              value={campo.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0"
              placeholder="Label do campo"
            />
            {campo.obrigatorio && (
              <Badge variant="primary" size="sm">
                obrigatório
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span>{CAMPO_LABEL[campo.tipo]}</span>
            <span>·</span>
            <code className="tabular">{campo.campo}</code>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            aria-label="Mover pra baixo"
            variant="ghost"
            size="sm"
            icon={<GripVertical className="rotate-90 rotate-180" />}
            disabled={index === total - 1}
            onClick={(e) => {
              e.stopPropagation();
              onMove(1);
            }}
          />
          <IconButton
            aria-label="Remover"
            variant="ghost"
            size="sm"
            icon={<Trash2 className="text-danger" />}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Inspector (right panel) ────────────────────────────

function CampoInspector({
  campo,
  onUpdate,
}: {
  campo: Campo;
  onUpdate: (patch: Partial<Campo>) => void;
}) {
  const hasOpcoes = campo.tipo === 'SELECT' || campo.tipo === 'RADIO' || campo.tipo === 'CHECKBOX';

  function setOpcao(idx: number, v: string) {
    const opcoes = [...(campo.opcoes ?? [])];
    opcoes[idx] = v;
    onUpdate({ opcoes });
  }
  function addOpcao() {
    const opcoes = [...(campo.opcoes ?? []), `Opção ${(campo.opcoes?.length ?? 0) + 1}`];
    onUpdate({ opcoes });
  }
  function removeOpcao(idx: number) {
    const opcoes = (campo.opcoes ?? []).filter((_, i) => i !== idx);
    onUpdate({ opcoes });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Badge variant="primary">{CAMPO_LABEL[campo.tipo]}</Badge>
      </div>

      <Field label="Label" required>
        <Input
          value={campo.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </Field>

      <Field label="Nome interno" hint="Chave no JSON da resposta. snake_case ou camelCase.">
        <Input
          value={campo.campo}
          onChange={(e) => onUpdate({ campo: e.target.value })}
        />
      </Field>

      <Field label="Placeholder" hint="Texto cinza dentro do input">
        <Input
          value={campo.placeholder ?? ''}
          onChange={(e) => onUpdate({ placeholder: e.target.value })}
        />
      </Field>

      <Field label="Hint" hint="Texto pequeno abaixo do input">
        <Input
          value={campo.hint ?? ''}
          onChange={(e) => onUpdate({ hint: e.target.value })}
        />
      </Field>

      <Switch
        checked={campo.obrigatorio}
        onChange={(e) => onUpdate({ obrigatorio: e.target.checked })}
        label="Obrigatório"
      />

      {/* v1.5.0 — Passo multi-step */}
      <Field label="📑 Passo (multi-step)" hint="1 = único passo. Use 2, 3… pra dividir em páginas.">
        <Input
          type="number"
          min={1}
          max={10}
          data-testid="campo-passo"
          value={campo.passo ?? 1}
          onChange={(e) =>
            onUpdate({ passo: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })
          }
        />
      </Field>

      {hasOpcoes && (
        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-text-subtle">Opções</span>
            <Button variant="ghost" size="sm" onClick={addOpcao} leftIcon={<Plus className="h-3 w-3" />}>
              Adicionar
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {(campo.opcoes ?? []).map((op, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  size="sm"
                  value={op}
                  onChange={(e) => setOpcao(i, e.target.value)}
                />
                <IconButton
                  aria-label="Remover opção"
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="text-danger" />}
                  onClick={() => removeOpcao(i)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FormSettings({
  slug,
  setSlug,
  descricao,
  setDescricao,
  mensagemSucesso,
  setMensagemSucesso,
  redirectUrl,
  setRedirectUrl,
  geraLead,
  setGeraLead,
  ativo,
  setAtivo,
  publicUrl,
}: {
  slug: string;
  setSlug: (v: string) => void;
  descricao: string;
  setDescricao: (v: string) => void;
  mensagemSucesso: string;
  setMensagemSucesso: (v: string) => void;
  redirectUrl: string;
  setRedirectUrl: (v: string) => void;
  geraLead: boolean;
  setGeraLead: (v: boolean) => void;
  ativo: boolean;
  setAtivo: (v: boolean) => void;
  publicUrl: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
        Configurações
      </h4>

      <Field
        label="Slug (URL pública)"
        required
        hint="Apenas a-z, 0-9 e hífen"
      >
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="contato-comercial"
        />
      </Field>

      {publicUrl && (
        <div className="rounded-md border border-border bg-surface px-2 py-1.5 flex items-center gap-1.5 text-[11px]">
          <span className="text-muted-light truncate flex-1">{publicUrl}</span>
          <IconButton
            aria-label="Copiar"
            variant="ghost"
            size="sm"
            icon={<Copy />}
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
            }}
          />
          <IconButton
            aria-label="Abrir"
            variant="ghost"
            size="sm"
            icon={<ExternalLink />}
            onClick={() => window.open(publicUrl, '_blank')}
          />
        </div>
      )}

      <Field label="Descrição" hint="Texto exibido abaixo do título">
        <Textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={3}
        />
      </Field>

      <Field label="Mensagem de sucesso" hint="Exibida após o envio">
        <Textarea
          value={mensagemSucesso}
          onChange={(e) => setMensagemSucesso(e.target.value)}
          rows={2}
          placeholder="Obrigado! Em breve entraremos em contato."
        />
      </Field>

      <Field label="Redirecionar após envio (opcional)">
        <Input
          type="url"
          value={redirectUrl}
          onChange={(e) => setRedirectUrl(e.target.value)}
          placeholder="https://meusite.com.br/obrigado"
        />
      </Field>

      <div className="pt-3 border-t border-border flex flex-col gap-2.5">
        <Switch
          checked={geraLead}
          onChange={(e) => setGeraLead(e.target.checked)}
          label="Gerar Lead a cada submissão"
        />
        <Switch
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
          label="Formulário ativo"
        />
      </div>
    </div>
  );
}

// ─── Preview dialog ───────────────────────────────────────

function PreviewDialog({
  titulo,
  descricao,
  campos,
  mensagemSucesso,
  onClose,
}: {
  titulo: string;
  descricao: string;
  campos: Campo[];
  mensagemSucesso: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Preview do formulário"
      description="Veja como o público verá o formulário"
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className="bg-bg p-6 rounded-md border border-border">
        <h2 className="text-xl font-bold text-text mb-2">{titulo || 'Título do formulário'}</h2>
        {descricao && <p className="text-sm text-text-subtle mb-5">{descricao}</p>}
        <div className="flex flex-col gap-4">
          {campos.map((c, i) => (
            <PreviewField key={i} campo={c} />
          ))}
        </div>
        <div className="mt-5">
          <Button disabled fullWidth>
            Enviar
          </Button>
        </div>
        {mensagemSucesso && (
          <p className="mt-4 text-[11px] text-muted-light italic text-center">
            Após enviar: "{mensagemSucesso}"
          </p>
        )}
      </div>
    </Dialog>
  );
}

function PreviewField({ campo }: { campo: Campo }) {
  const required = campo.obrigatorio;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-text-subtle">
        {campo.label}
        {required && <span className="text-primary ml-0.5">*</span>}
      </label>
      {campo.tipo === 'TEXTAREA' ? (
        <Textarea placeholder={campo.placeholder} disabled rows={3} />
      ) : campo.tipo === 'SELECT' ? (
        <Select disabled>
          <option>Selecione…</option>
          {(campo.opcoes ?? []).map((op) => (
            <option key={op}>{op}</option>
          ))}
        </Select>
      ) : campo.tipo === 'RADIO' ? (
        <div className="flex flex-col gap-1.5">
          {(campo.opcoes ?? []).map((op) => (
            <label key={op} className="flex items-center gap-2 text-sm text-text">
              <input type="radio" disabled className="accent-primary" />
              {op}
            </label>
          ))}
        </div>
      ) : campo.tipo === 'CHECKBOX' ? (
        <div className="flex flex-col gap-1.5">
          {(campo.opcoes ?? []).map((op) => (
            <label key={op} className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" disabled className="accent-primary" />
              {op}
            </label>
          ))}
        </div>
      ) : (
        <Input
          type={
            campo.tipo === 'EMAIL'
              ? 'email'
              : campo.tipo === 'TEL'
                ? 'tel'
                : campo.tipo === 'NUMERO'
                  ? 'number'
                  : 'text'
          }
          placeholder={campo.placeholder}
          disabled
        />
      )}
      {campo.hint && <p className="text-[11px] text-muted-light">{campo.hint}</p>}
    </div>
  );
}

// Marker used by Card (preview) - prevent unused import errors
const _u1 = Card;
const _u2 = X;
void _u1;
void _u2;
