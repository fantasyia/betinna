import { useEffect, useState } from 'react';
import { Bot, Save, AlertCircle, CheckCircle2, MessageCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Field,
  Switch,
  Textarea,
} from '@/components/ui';

/**
 * PersonaBotPage — configura o Muller por empresa.
 *
 * Modelo simples: UM prompt completo escrito pelo usuário (usado tal e qual como
 * system prompt) + liga/desliga do bot no WhatsApp + diagnóstico da conexão IA.
 * DIRECTOR-only (ADMIN bypassa pra suporte).
 */

interface Persona {
  id: string;
  empresaId: string;
  nome: string;
  promptCustom?: string | null;
  ativo: boolean;
  atualizadoEm: string;
}

interface Diagnostico {
  envKeyPresente: boolean;
  modelo: string;
  catalogoLigado: boolean;
  teste: { ok: boolean; erro?: string };
}

const PLACEHOLDER_PROMPT = `Ex:

Você é o Muller, atendente comercial da MSM Alimentos no WhatsApp.
Fale em português brasileiro, de forma cordial e objetiva, com mensagens curtas.

Regras:
- Nunca invente preços, prazos ou condições. Se não souber, diga que vai confirmar com a equipe.
- Seja simpático, mas direto ao ponto.
- Se o cliente pedir algo que você não resolve, avise que um atendente humano vai dar sequência.`;

export default function PersonaBotPage() {
  const toast = useToast();
  const role = useRole();
  const canEdit = role === 'ADMIN' || role === 'DIRECTOR';

  const { data, loading, refetch } = useApiQuery<Persona>('/mullerbot/persona');

  // Estado de edição — o prompt completo do Muller
  const [prompt, setPrompt] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setPrompt(data.promptCustom ?? '');
    setDirty(false);
  }, [data]);

  // Liga/desliga global do bot no WhatsApp da empresa
  const empresaQuery = useApiQuery<{ id: string; botWhatsappAtivo?: boolean }>('/empresas/atual');
  const [botWhatsappAtivo, setBotWhatsappAtivo] = useState(true);
  const [savingBot, setSavingBot] = useState(false);
  useEffect(() => {
    if (empresaQuery.data) setBotWhatsappAtivo(empresaQuery.data.botWhatsappAtivo ?? true);
  }, [empresaQuery.data]);

  // Diagnóstico da conexão com a OpenAI
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  async function testarBot() {
    setDiagLoading(true);
    try {
      const r = await api.get<Diagnostico>('/mullerbot/bot/diagnostico');
      setDiag(r);
    } catch (err) {
      setDiag({
        envKeyPresente: false,
        modelo: '?',
        catalogoLigado: false,
        teste: { ok: false, erro: err instanceof ApiError ? err.message : 'Falha ao testar' },
      });
    } finally {
      setDiagLoading(false);
    }
  }

  useEffect(() => {
    void testarBot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function alternarBotWhatsapp(ativo: boolean) {
    const empresaId = empresaQuery.data?.id;
    if (!empresaId) return;
    setSavingBot(true);
    setBotWhatsappAtivo(ativo); // otimista
    try {
      await api.patch(`/empresas/${empresaId}`, { botWhatsappAtivo: ativo });
      toast.success(
        ativo
          ? 'Bot ligado — responde automaticamente no WhatsApp da empresa'
          : 'Bot desligado — nenhuma resposta automática no WhatsApp',
      );
      empresaQuery.refetch();
    } catch (err) {
      setBotWhatsappAtivo(!ativo); // reverte
      toast.error('Falha ao alterar o bot', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingBot(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.put<Persona>('/mullerbot/persona', {
        // nome só é usado se o prompt tiver {{nome}}; mantém um default.
        nome: data?.nome?.trim() || 'Muller',
        tomVoz: 'PROFISSIONAL',
        ativo: true,
        promptCustom: prompt.trim() || null,
      });
      toast.success('Prompt do Muller salvo');
      setDirty(false);
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <PageLayout title="Muller — Prompt">
        <Card padding="lg">
          <div className="text-muted text-center py-8">Carregando…</div>
        </Card>
      </PageLayout>
    );
  }

  if (!canEdit) {
    return (
      <PageLayout title="Muller — Prompt">
        <EmptyState
          icon={<AlertCircle />}
          title="Acesso restrito"
          description="O prompt do Muller só pode ser editado por DIRECTOR ou ADMIN."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Muller — Prompt"
      description="Escreva o prompt completo do seu assistente. É exatamente esse texto que vai pra IA."
      actions={
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={!dirty}
          leftIcon={<Save className="h-3.5 w-3.5" />}
        >
          Salvar
        </Button>
      }
    >
      <AtendimentoTabs />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Coluna principal */}
        <div className="flex flex-col gap-4">
          {/* Liga/desliga + diagnóstico do bot no WhatsApp */}
          <Card padding="md" className={botWhatsappAtivo ? 'border-success/40 bg-success/5' : ''}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                Bot no WhatsApp da empresa
              </CardTitle>
              <CardDescription>
                Quando ligado, o Muller responde automaticamente as mensagens que chegam no
                WhatsApp central da empresa. Não afeta o WhatsApp pessoal dos representantes.
              </CardDescription>
            </CardHeader>
            <Field label="Resposta automática">
              <Switch
                checked={botWhatsappAtivo}
                disabled={savingBot || !empresaQuery.data}
                onChange={(e) => void alternarBotWhatsapp(e.target.checked)}
                label={
                  botWhatsappAtivo
                    ? 'Ligado — o Muller responde os clientes automaticamente'
                    : 'Desligado — só atendimento humano no WhatsApp'
                }
              />
            </Field>

            {/* Diagnóstico — confirma que o bot consegue falar com a OpenAI */}
            <div className="mt-3 rounded-md border border-border bg-bg-alt p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text">Conexão com a IA (OpenAI)</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void testarBot()}
                  loading={diagLoading}
                >
                  Testar agora
                </Button>
              </div>
              {diag && !diagLoading && (
                <div className="mt-2 text-xs leading-relaxed">
                  {diag.teste.ok ? (
                    <p className="text-success flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      IA conectada e respondendo (modelo {diag.modelo}). Bot pronto pra atender.
                    </p>
                  ) : (
                    <div className="text-danger flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div>
                        <strong>O bot NÃO consegue responder.</strong>
                        <p className="text-text-subtle mt-0.5">{diag.teste.erro}</p>
                        {!diag.envKeyPresente && (
                          <p className="text-text-subtle mt-1">
                            👉 Configure a variável <code>OPENAI_API_KEY</code> no Railway (serviços
                            api e worker) e refaça o deploy.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Prompt do Muller — o coração da configuração */}
          <Card padding="md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                Prompt do Muller
              </CardTitle>
              <CardDescription>
                Este texto é o prompt completo do assistente — usado exatamente como você escrever.
                Coloque aqui a identidade, o tom, as regras e tudo mais.
              </CardDescription>
            </CardHeader>
            <Textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setDirty(true);
              }}
              maxLength={12000}
              rows={18}
              placeholder={PLACEHOLDER_PROMPT}
              className="font-mono text-[13px] leading-relaxed"
            />
            <div className="text-[10px] text-muted-light text-right mt-1 tabular">
              {prompt.length}/12000
            </div>
            {error && (
              <div className="mt-2 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </Card>
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
              <li>O texto vai pra IA <strong>exatamente</strong> como você escrever — sem nada escondido por baixo.</li>
              <li>
                Você pode usar <code>{'{{nome}}'}</code> no texto pra inserir o nome do bot
                automaticamente (opcional).
              </li>
              <li>
                Diga claramente o que ele <strong>não pode</strong> fazer (inventar preço, prometer
                prazo) — isso reduz erro.
              </li>
              <li>
                Quando o catálogo for ligado, os produtos entram automaticamente junto deste prompt.
              </li>
            </ul>
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
    </PageLayout>
  );
}
