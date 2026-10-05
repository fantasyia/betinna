import { useState } from 'react';
import { Plus, ExternalLink } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Badge, Button, Card, Field, Input, Switch, Tabs } from '@/components/ui';
import { CoresPanel, LinhasPanel } from './ListasEmpresa';
import { ModeloEditor } from './ModeloEditor';
import { dinheiroParaNumero, type Cor, type Linha, type Modelo, type VitrineConfig } from './tipos';

/**
 * Vitrine de atacado — cadastro (Fase 1, Ribelt Distribuidora Têxtil).
 *
 * A aba só aparece no Catálogo da empresa que tem a vitrine ligada; quem
 * cair aqui pela URL sem ela vê só o formulário de ligar (ADMIN/DIRECTOR).
 */
export default function VitrineCadastroPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const config = useApiQuery<VitrineConfig | null>(gestor ? '/vitrine/admin/config' : null);

  if (!gestor) {
    return (
      <PageLayout title="Vitrine de atacado">
        <CatalogoTabs />
        <Card className="p-6 text-sm text-muted">Só a diretoria configura a vitrine.</Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Vitrine de atacado"
      description="Modelos, cores, grades e preços que o cliente vê pelo link da vitrine."
    >
      <CatalogoTabs />
      <StateView loading={config.loading} error={config.error} onRetry={config.refetch}>
        {config.data ? (
          <Cadastro config={config.data} onConfigMudou={config.refetch} />
        ) : (
          <ConfigForm config={null} onSalvou={config.refetch} />
        )}
      </StateView>
    </PageLayout>
  );
}

function Cadastro({ config, onConfigMudou }: { config: VitrineConfig; onConfigMudou: () => void }) {
  const [aba, setAba] = useState('modelos');
  const modelos = useApiQuery<Modelo[]>('/vitrine/admin/modelos');
  const cores = useApiQuery<Cor[]>('/vitrine/admin/cores');
  const linhas = useApiQuery<Linha[]>('/vitrine/admin/linhas');
  const [editando, setEditando] = useState<Modelo | 'novo' | null>(null);

  const listasMudaram = () => {
    cores.refetch();
    linhas.refetch();
    modelos.refetch();
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { value: 'modelos', label: 'Modelos', count: modelos.data?.length },
          { value: 'cores', label: 'Cores', count: cores.data?.length },
          { value: 'linhas', label: 'Linhas e tamanhos', count: linhas.data?.length },
          { value: 'config', label: 'Configuração' },
        ]}
      />

      {aba === 'modelos' && (
        <StateView loading={modelos.loading} error={modelos.error} onRetry={modelos.refetch}>
          <div className="flex justify-end mb-2">
            <Button onClick={() => setEditando('novo')} data-testid="vitrine-novo-modelo">
              <Plus size={14} /> Novo modelo
            </Button>
          </div>
          {(modelos.data ?? []).length === 0 ? (
            <Card className="p-6 text-sm text-muted">
              Nenhum modelo ainda. Antes, crie as cores e as linhas com os tamanhos.
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(modelos.data ?? []).map((m) => (
                <CartaoModelo key={m.id} modelo={m} onAbrir={() => setEditando(m)} />
              ))}
            </div>
          )}
        </StateView>
      )}

      {aba === 'cores' && (
        <StateView loading={cores.loading} error={cores.error} onRetry={cores.refetch}>
          <CoresPanel cores={cores.data ?? []} onMudou={listasMudaram} />
        </StateView>
      )}

      {aba === 'linhas' && (
        <StateView loading={linhas.loading} error={linhas.error} onRetry={linhas.refetch}>
          <LinhasPanel linhas={linhas.data ?? []} onMudou={listasMudaram} />
        </StateView>
      )}

      {aba === 'config' && <ConfigForm config={config} onSalvou={onConfigMudou} />}

      {editando && (
        <ModeloEditor
          modelo={editando === 'novo' ? null : editando}
          cores={cores.data ?? []}
          linhas={linhas.data ?? []}
          onClose={() => setEditando(null)}
          onSalvou={() => modelos.refetch()}
          onListasMudaram={listasMudaram}
        />
      )}
    </div>
  );
}

function CartaoModelo({ modelo, onAbrir }: { modelo: Modelo; onAbrir: () => void }) {
  const capa = modelo.cores.find((c) => c.fotos.length)?.fotos[0];
  const totalFotos = modelo.cores.reduce((s, c) => s + c.fotos.length, 0);
  const precoEntrada = modelo.linhas
    .map((l) => dinheiroParaNumero(l.precoEntrada))
    .filter((n): n is number => n !== null);
  const menor = precoEntrada.length ? Math.min(...precoEntrada) : null;
  return (
    <button
      type="button"
      onClick={onAbrir}
      data-testid={`vitrine-modelo-${modelo.id}`}
      className="flex gap-3 rounded-[10px] border border-border bg-surface p-3 text-left hover:bg-surface-hover"
    >
      <div className="h-24 w-[72px] shrink-0 overflow-hidden rounded-[10px] border border-border bg-surface-hover">
        {capa?.thumbUrl ? (
          <img src={capa.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-text">{modelo.nome}</span>
          {!modelo.ativo && <Badge variant="neutral">inativo</Badge>}
        </div>
        <p className="text-xs text-muted">{modelo.categoria ?? 'Sem categoria'}</p>
        <div className="mt-1 flex gap-1">
          {modelo.cores.map((c) => (
            <span key={c.id} title={c.cor.nome} className="inline-block h-3.5 w-3.5 rounded-full border border-border" style={{ background: c.cor.hex }} />
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          {modelo.linhas.map((l) => l.linha.nome).join(' · ') || 'Sem grade'} · {totalFotos} foto(s)
        </p>
        <p className="text-xs text-text">{menor !== null ? `a partir de ${formatMoeda(menor)}` : 'preço sob consulta'}</p>
        {totalFotos === 0 && <p className="text-xs text-warning">Sem foto: não aparece na vitrine</p>}
      </div>
    </button>
  );
}

/** Liga/configura a vitrine: endereço público e mínimos das faixas de preço. */
function ConfigForm({ config, onSalvou }: { config: VitrineConfig | null; onSalvou: () => void }) {
  const toast = useToast();
  const [slug, setSlug] = useState(config?.slug ?? '');
  const [ativa, setAtiva] = useState(config?.ativa ?? false);
  const [entrada, setEntrada] = useState(config?.minimoEntrada?.toString() ?? '');
  const [volume, setVolume] = useState(config?.minimoVolume?.toString() ?? '');
  const [atacadao, setAtacadao] = useState(config?.minimoAtacadao?.toString() ?? '500');
  const [salvando, setSalvando] = useState(false);

  const inteiro = (t: string) => (t.trim() ? Number.parseInt(t, 10) : null);

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/config', {
        slug: slug.trim().toLowerCase(),
        ativa,
        minimoEntrada: inteiro(entrada),
        minimoVolume: inteiro(volume),
        minimoAtacadao: inteiro(atacadao),
      });
      toast.success(config ? 'Configuração salva' : 'Vitrine ligada');
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  const link = slug.trim() ? `${window.location.origin}/v/${slug.trim().toLowerCase()}` : null;

  return (
    <Card className="p-4 max-w-xl">
      {!config && (
        <p className="text-sm text-muted mb-3">
          A vitrine ainda não está ligada nesta empresa. Escolha o endereço do link pra começar o cadastro.
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Field label="Endereço do link" hint="Letras minúsculas, números e hífen" required>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ribelt" data-testid="vitrine-slug" />
        </Field>
        {link && (
          <p className="flex items-center gap-1 text-xs text-muted">
            <ExternalLink size={12} /> {link}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Faixa Entrada a partir de (peças)">
            <Input value={entrada} inputMode="numeric" onChange={(e) => setEntrada(e.target.value)} />
          </Field>
          <Field label="Faixa Volume a partir de">
            <Input value={volume} inputMode="numeric" onChange={(e) => setVolume(e.target.value)} />
          </Field>
          <Field label="Faixa 500+ a partir de">
            <Input value={atacadao} inputMode="numeric" onChange={(e) => setAtacadao(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">A faixa vale pelo total de peças do pedido, não por modelo.</p>
        <Switch
          label="Link público no ar"
          checked={ativa}
          onChange={(e) => setAtiva(e.target.checked)}
        />
        <div>
          <Button onClick={salvar} loading={salvando} data-testid="vitrine-salvar-config">
            {config ? 'Salvar' : 'Ligar vitrine'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
