import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Save, AlertCircle, CheckCircle2, MessageCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { usePermission } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { AssistenteTabs } from '@/components/AssistenteTabs';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Field,
  Input,
  Select,
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
  modelo?: string | null;
  ativo: boolean;
  limiteTokensDiaIn: number;
  limiteTokensMesIn: number;
  historicoMensagens: number;
  delayRespostaSegundos: number;
  mostrarDigitando: boolean;
  quebrarMensagens: boolean;
  maxMensagens: number;
  transcreverAudio: boolean;
  analisarImagem: boolean;
  atualizadoEm: string;
}

interface CustoStatus {
  // Um orçamento por período (total de tokens), não dois somados.
  dia: { usado: number; limite: number; pct: number };
  mes: { usado: number; limite: number; pct: number };
  pausadoPorCustoAte: string | null;
}

interface Diagnostico {
  envKeyPresente: boolean;
  empresaKeyPresente?: boolean;
  fonte?: 'empresa' | 'env' | 'nenhuma';
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

/** Texto amigável do motivo pelo qual a lista de modelos caiu na reserva. */
function motivoModeloTexto(motivo: string): string {
  switch (motivo) {
    case 'sem_chave':
      return 'a empresa não tem chave OpenAI configurada — o DIRETOR precisa configurá-la em Integrações (escopo empresa). É a chave que o bot usa; a chave pessoal do rep não conta aqui';
    case 'mock':
      return 'o bot está em modo de teste (MULLERBOT_MOCK), sem chamada real à OpenAI';
    case 'sem_permissao_modelos':
      return 'sua chave FUNCIONA pro bot, mas é uma chave restrita SEM permissão de listar modelos. A lista abaixo é curada e funciona normalmente. Pra ver os modelos exatos da sua conta: na OpenAI, dê à chave a permissão "Models → Read" (ou gere uma chave sem restrição)';
    case 'erro_openai':
      return 'a OpenAI recusou a chamada — chave inválida ou expirada (valide no diagnóstico acima)';
    case 'sem_modelos_chat':
      return 'a conta não retornou nenhum modelo de chat';
    default:
      return 'verifique a chave da OpenAI no diagnóstico acima';
  }
}

export default function PersonaBotPage() {
  const toast = useToast();
  const canEdit = usePermission('mullerbot.config');

  const { data, loading, refetch } = useApiQuery<Persona>('/mullerbot/persona');

  // Estado de edição — o prompt completo do Muller + modelo da IA
  const [nomeBot, setNomeBot] = useState('');
  const [prompt, setPrompt] = useState('');
  const [modelo, setModelo] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sprint 2.2 — teto de custo (limite diário/mensal de tokens) + consumo atual.
  // Um único limite por período, aplicado a entrada e saída no backend.
  const [limDia, setLimDia] = useState(100000);
  const [limMes, setLimMes] = useState(2000000);
  const custoQuery = useApiQuery<CustoStatus>('/mullerbot/custo');

  // Comportamento da conversa do bot — quão "humano" ele responde.
  const [histMsgs, setHistMsgs] = useState(10); // mensagens de contexto passadas pra IA
  const [delaySeg, setDelaySeg] = useState(0); // espera antes de responder (segundos)
  const [mostrarDigitando, setMostrarDigitando] = useState(false); // mostra "digitando…" no WhatsApp
  const [quebrarMsgs, setQuebrarMsgs] = useState(false); // quebra a resposta em vários balões
  const [maxMsgs, setMaxMsgs] = useState(3); // teto de balões quando quebra está ligado
  const [transcreverAudio, setTranscreverAudio] = useState(false); // bot ouve áudios (transcrição)
  const [analisarImagem, setAnalisarImagem] = useState(false); // bot vê imagens (visão)

  // Modelos reais da conta OpenAI (puxados ao vivo); cai pra lista curada se falhar.
  const [modelosLive, setModelosLive] = useState<string[]>([]);
  const [modelosFonte, setModelosFonte] = useState<string>('');
  const [modelosMotivo, setModelosMotivo] = useState<string>('');

  useEffect(() => {
    if (!data) return;
    setNomeBot(data.nome ?? '');
    setPrompt(data.promptCustom ?? '');
    setModelo(data.modelo ?? '');
    setLimDia(data.limiteTokensDiaIn ?? 100000);
    setLimMes(data.limiteTokensMesIn ?? 2000000);
    setHistMsgs(data.historicoMensagens ?? 10);
    setDelaySeg(data.delayRespostaSegundos ?? 0);
    setMostrarDigitando(data.mostrarDigitando ?? false);
    setQuebrarMsgs(data.quebrarMensagens ?? false);
    setMaxMsgs(data.maxMensagens ?? 3);
    setTranscreverAudio(data.transcreverAudio ?? false);
    setAnalisarImagem(data.analisarImagem ?? false);
    setDirty(false);
  }, [data]);

  useEffect(() => {
    api
      .get<{ modelos: string[]; fonte: string; motivo?: string }>('/mullerbot/bot/modelos')
      .then((r) => {
        setModelosLive(r.modelos ?? []);
        setModelosFonte(r.fonte ?? '');
        setModelosMotivo(r.motivo ?? '');
      })
      .catch(() => {
        setModelosLive([]);
        setModelosFonte('');
        setModelosMotivo('');
      });
  }, []);

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
        // Nome do bot escolhido pela empresa (ex.: "SomaBOT"). Aparece no chat e
        // onde o prompt usar {{nome}}.
        nome: nomeBot.trim() || 'MullerBot',
        tomVoz: 'PROFISSIONAL',
        ativo: true,
        promptCustom: prompt.trim() || null,
        modelo: modelo || null,
        // Teto de custo — orçamento ÚNICO por período (total de tokens).
        limiteTokensDiaIn: limDia,
        limiteTokensMesIn: limMes,
        // Comportamento da conversa — contexto, delay humano e "digitando…"
        historicoMensagens: histMsgs,
        delayRespostaSegundos: delaySeg,
        mostrarDigitando,
        // Quebra da resposta em vários balões + teto
        quebrarMensagens: quebrarMsgs,
        maxMensagens: maxMsgs,
        // Multimodal: ouvir áudios (transcrição) e ver imagens (visão)
        transcreverAudio,
        analisarImagem,
      });
      toast.success('Configuração do Muller salva');
      setDirty(false);
      refetch();
      custoQuery.refetch();
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
      <AssistenteTabs />
      <div className="mb-3">
        <Link
          to="/mullerbot/prompts"
          data-testid="link-prompts-bot"
          className="text-sm text-primary hover:underline"
        >
          Biblioteca de prompts (multi-prompt) →
        </Link>
      </div>
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

            {/* Comportamento da conversa — deixa o bot mais humano.
                Estes 3 fazem parte da persona; salvam no botão Salvar do topo. */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-border bg-bg-alt p-3">
              <Field label="Mensagens de contexto" className="mb-0">
                <div>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={histMsgs}
                    onChange={(e) => {
                      setHistMsgs(Math.min(50, Math.max(1, Number(e.target.value))));
                      setDirty(true);
                    }}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm tabular"
                  />
                  <p className="text-[10px] text-muted-light mt-1">
                    Quantas mensagens anteriores a IA enxerga (1–50).
                  </p>
                </div>
              </Field>
              <Field label="Delay da resposta (s)" className="mb-0">
                <div>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={delaySeg}
                    onChange={(e) => {
                      setDelaySeg(Math.min(60, Math.max(0, Number(e.target.value))));
                      setDirty(true);
                    }}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm tabular"
                  />
                  <p className="text-[10px] text-muted-light mt-1">
                    Espera antes de enviar — fica mais humano (0–60).
                  </p>
                </div>
              </Field>
              <div className="col-span-2">
                <Switch
                  checked={mostrarDigitando}
                  onChange={(e) => {
                    setMostrarDigitando(e.target.checked);
                    setDirty(true);
                  }}
                  label={'Mostrar "digitando…" no WhatsApp antes de responder'}
                />
              </div>
              {/* Quebrar a resposta em vários balões (mais humano) */}
              <div className="col-span-2 border-t border-border pt-3">
                <Switch
                  checked={quebrarMsgs}
                  onChange={(e) => {
                    setQuebrarMsgs(e.target.checked);
                    setDirty(true);
                  }}
                  label="Quebrar a resposta em vários balões (mais humano)"
                />
                {quebrarMsgs && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-muted">Máximo de balões:</span>
                    <input
                      type="number"
                      min={2}
                      max={6}
                      value={maxMsgs}
                      onChange={(e) => {
                        setMaxMsgs(Math.min(6, Math.max(2, Number(e.target.value))));
                        setDirty(true);
                      }}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="w-16 rounded-md border border-border-strong bg-surface px-2 py-1 text-sm tabular"
                    />
                    <span className="text-[10px] text-muted-light">
                      A IA decide quantos pelo contexto (2–6). Resposta simples = 1 balão.
                    </span>
                  </div>
                )}
              </div>
              {/* Multimodal — o bot passa a entender áudio e imagem */}
              <div className="col-span-2 border-t border-border pt-3 space-y-2">
                <Switch
                  checked={transcreverAudio}
                  onChange={(e) => {
                    setTranscreverAudio(e.target.checked);
                    setDirty(true);
                  }}
                  label="🎤 Transcrever áudios (o bot ouve e responde; você lê na inbox)"
                />
                <Switch
                  checked={analisarImagem}
                  onChange={(e) => {
                    setAnalisarImagem(e.target.checked);
                    setDirty(true);
                  }}
                  label="📷 Analisar imagens (o bot vê fotos de produto/etiqueta e responde)"
                />
                <p className="text-[10px] text-muted-light">
                  Cada áudio/imagem é uma chamada extra à IA — entra no teto de custo. Desligado = não muda nada.
                </p>
              </div>
            </div>

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
                      IA conectada e respondendo
                      {diag.fonte === 'empresa'
                        ? ' (chave da empresa)'
                        : diag.fonte === 'env'
                          ? ' (chave do servidor)'
                          : ''}
                      . Bot pronto pra atender.
                    </p>
                  ) : (
                    <div className="text-danger flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div>
                        <strong>O bot NÃO consegue responder.</strong>
                        <p className="text-text-subtle mt-0.5">{diag.teste.erro}</p>
                        <p className="text-text-subtle mt-1">
                          👉 Cadastre a chave OpenAI em <strong>Integrações</strong> (escopo
                          empresa, como diretor) — é a que o bot usa. Alternativa: definir{' '}
                          <code>OPENAI_API_KEY</code> no Railway (serviços api e worker) e
                          refazer o deploy.
                        </p>
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
            <Field
              label="Nome do bot"
              hint='Como o seu assistente se chama (ex.: "SomaBOT"). Aparece no chat e onde o prompt usar {{nome}}.'
              className="mb-3"
            >
              <Input
                value={nomeBot}
                onChange={(e) => {
                  setNomeBot(e.target.value);
                  setDirty(true);
                }}
                maxLength={60}
                placeholder="Ex.: SomaBOT"
                data-testid="persona-nome-bot"
              />
            </Field>
            <Field
              label="Modelo da IA (OpenAI)"
              hint={
                modelosFonte === 'openai'
                  ? 'Lista puxada AO VIVO da sua conta OpenAI — inclui os modelos mais novos. Quanto mais inteligente, mais caro por mensagem.'
                  : `Mostrando uma lista de RESERVA (não consegui listar da sua conta): ${motivoModeloTexto(modelosMotivo)}. Assim que resolver, a lista completa da sua conta aparece aqui.`
              }
              className="mb-3"
            >
              <Select
                value={modelo}
                onChange={(e) => {
                  setModelo(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="">Padrão do servidor (gpt-4o-mini)</option>
                {/* Mantém o modelo salvo visível mesmo se a lista ainda não carregou */}
                {modelo && !modelosLive.includes(modelo) && (
                  <option value={modelo}>{modelo} (atual)</option>
                )}
                {modelosLive.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            </Field>
            <Textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setDirty(true);
              }}
              maxLength={50000}
              rows={18}
              placeholder={PLACEHOLDER_PROMPT}
              className="font-mono text-[13px] leading-relaxed"
            />
            <div className="text-[10px] text-muted-light text-right mt-1 tabular">
              {prompt.length}/50000
            </div>
            {error && (
              <div className="mt-2 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
          </Card>
        </div>

        {/* Coluna lateral — teto de custo + dicas */}
        <aside className="flex flex-col gap-3">
          {/* Teto de custo (Sprint 2.2) */}
          <Card padding="md">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                Teto de custo (tokens)
              </CardTitle>
              <CardDescription>
                Limite de consumo da OpenAI. Aos 80% você é avisado; aos 100% o bot pausa sozinho
                até a virada do dia/mês.
              </CardDescription>
            </CardHeader>

            {custoQuery.data && (
              <div className="flex flex-col gap-2.5 mb-3">
                <BarraCusto
                  label="Hoje"
                  pct={custoQuery.data.dia.pct}
                  usado={custoQuery.data.dia.usado}
                  limite={custoQuery.data.dia.limite}
                />
                <BarraCusto
                  label="Mês"
                  pct={custoQuery.data.mes.pct}
                  usado={custoQuery.data.mes.usado}
                  limite={custoQuery.data.mes.limite}
                />
                {custoQuery.data.pausadoPorCustoAte &&
                  new Date(custoQuery.data.pausadoPorCustoAte) > new Date() && (
                    <p className="text-xs text-danger flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Bot pausado por custo até{' '}
                      {new Date(custoQuery.data.pausadoPorCustoAte).toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      .
                    </p>
                  )}
              </div>
            )}

            <Field label="Limite diário (tokens)" className="mb-2">
              <input
                type="number"
                min={0}
                value={limDia}
                onChange={(e) => {
                  setLimDia(Math.max(0, Number(e.target.value)));
                  setDirty(true);
                }}
                // Evita o navegador incrementar o número ao rolar o mouse sobre o campo.
                onWheel={(e) => e.currentTarget.blur()}
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm tabular"
              />
            </Field>
            <Field label="Limite mensal (tokens)">
              <input
                type="number"
                min={0}
                value={limMes}
                onChange={(e) => {
                  setLimMes(Math.max(0, Number(e.target.value)));
                  setDirty(true);
                }}
                // Evita o navegador incrementar o número ao rolar o mouse sobre o campo.
                onWheel={(e) => e.currentTarget.blur()}
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm tabular"
              />
            </Field>
            <p className="text-[10px] text-muted-light mt-1">
              Salve (botão no topo) pra aplicar os novos limites.
            </p>
          </Card>

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

/** Barra de progresso de consumo de tokens (verde < 80%, amarela < 100%, vermelha = cheio). */
function BarraCusto({
  label,
  pct,
  usado,
  limite,
}: {
  label: string;
  pct: number;
  usado: number;
  limite: number;
}) {
  const p = Math.min(100, Math.round(pct));
  const cor = p >= 100 ? 'bg-danger' : p >= 80 ? 'bg-warning' : 'bg-success';
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted mb-1">
        <span>
          {label}: {p}%
        </span>
        <span className="tabular">
          {formatNumero(usado)}/{formatNumero(limite)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-bg-alt overflow-hidden">
        <div className={`h-full ${cor} rounded-full`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
