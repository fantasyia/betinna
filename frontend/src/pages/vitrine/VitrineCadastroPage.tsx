import { useEffect, useRef, useState } from 'react';
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
import { useArrastar } from './arrastar';
import { CategoriasPanel, CoresPanel, LinhasPanel } from './ListasEmpresa';
import { ModeloEditor } from './ModeloEditor';
import { apareceNaVitrine, pendenciasDoModelo } from './pendencias';
import {
  dinheiroParaNumero,
  type Categoria,
  type Cor,
  type Linha,
  type Modelo,
  type VitrineConfig,
} from './tipos';
import { PagamentoOnline } from './PagamentoOnline';
import { FreteConfig } from './FreteConfig';
import { PrivacidadeConfig } from './PrivacidadeConfig';
import { PixelConfig } from './PixelConfig';

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
  const toast = useToast();
  // `?aba=config` abre direto na configuração (atalho do card do Asaas).
  const [aba, setAba] = useState(
    () => new URLSearchParams(window.location.search).get('aba') ?? 'modelos',
  );
  const modelos = useApiQuery<Modelo[]>('/vitrine/admin/modelos');
  const cores = useApiQuery<Cor[]>('/vitrine/admin/cores');
  const linhas = useApiQuery<Linha[]>('/vitrine/admin/linhas');
  const categorias = useApiQuery<Categoria[]>('/vitrine/admin/categorias');
  const [editando, setEditando] = useState<Modelo | 'novo' | null>(null);
  // Item 5: ordem otimista enquanto o servidor salva o arrasto.
  const [ordemLocal, setOrdemLocal] = useState<string[] | null>(null);

  const lista = modelos.data ?? [];
  // `?modelo=<id>` abre direto o modelo (atalho da OP → ficha técnica/encaixe).
  const abriuDoLink = useRef(false);
  useEffect(() => {
    if (abriuDoLink.current || !modelos.data) return;
    const id = new URLSearchParams(window.location.search).get('modelo');
    const m = id ? modelos.data.find((x) => x.id === id) : undefined;
    if (m) {
      abriuDoLink.current = true;
      setEditando(m);
    }
  }, [modelos.data]);
  const ordenada = ordemLocal
    ? ordemLocal.map((id) => lista.find((m) => m.id === id)).filter((m): m is Modelo => !!m)
    : lista;
  const arrastar = useArrastar(
    ordenada.map((m) => m.id),
    (ids) => {
      setOrdemLocal(ids);
      void api
        .put('/vitrine/admin/modelos/ordem', { ids })
        .then(() => modelos.refetch())
        .catch((err) => toast.error('Não foi possível salvar a ordem', apiErrorMessage(err)))
        .finally(() => setOrdemLocal(null));
    },
  );
  const naVitrine = lista.filter(apareceNaVitrine).length;

  const listasMudaram = () => {
    cores.refetch();
    linhas.refetch();
    categorias.refetch();
    modelos.refetch();
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { value: 'modelos', label: 'Modelos', count: modelos.data?.length },
          { value: 'categorias', label: 'Categorias', count: categorias.data?.length },
          { value: 'cores', label: 'Cores', count: cores.data?.length },
          { value: 'linhas', label: 'Linhas e tamanhos', count: linhas.data?.length },
          { value: 'config', label: 'Configuração' },
        ]}
      />

      {aba === 'modelos' && (
        <StateView loading={modelos.loading} error={modelos.error} onRetry={modelos.refetch}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {lista.length > 0 && (
                <>
                  <strong className="text-text">{naVitrine}</strong> de {lista.length} modelo(s) aparecem na vitrine.
                  {lista.length > 1 && ' Arraste os cartões pra definir a ordem.'}
                </>
              )}
            </p>
            <Button onClick={() => setEditando('novo')} data-testid="vitrine-novo-modelo">
              <Plus size={14} /> Novo modelo
            </Button>
          </div>
          {lista.length === 0 ? (
            <Card className="p-6 text-sm text-muted">
              Nenhum modelo ainda. Antes, crie as categorias, as cores e as linhas com os tamanhos.
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ordenada.map((m) => (
                <div
                  key={m.id}
                  {...arrastar.props(m.id)}
                  className="rounded-[10px] data-[arrastando=true]:opacity-40 data-[sobre=true]:ring-2 data-[sobre=true]:ring-primary"
                >
                  <CartaoModelo modelo={m} onAbrir={() => setEditando(m)} />
                </div>
              ))}
            </div>
          )}
        </StateView>
      )}

      {aba === 'categorias' && (
        <StateView loading={categorias.loading} error={categorias.error} onRetry={categorias.refetch}>
          <CategoriasPanel categorias={categorias.data ?? []} onMudou={listasMudaram} />
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

      {aba === 'config' && (
        <div className="flex flex-col gap-4">
          <ConfigForm config={config} onSalvou={onConfigMudou} />
          {config && <PagamentoOnline />}
          {config && <FreteConfig />}
          {config && <PrivacidadeConfig slug={config.slug} />}
          {config && <PixelConfig />}
        </div>
      )}

      {editando && (
        <ModeloEditor
          modelo={editando === 'novo' ? null : editando}
          cores={cores.data ?? []}
          linhas={linhas.data ?? []}
          categorias={categorias.data ?? []}
          modelos={modelos.data ?? []}
          onClose={() => setEditando(null)}
          onSalvou={() => modelos.refetch()}
          onExcluiu={() => modelos.refetch()}
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
  const pendencias = pendenciasDoModelo(modelo);
  const bloqueia = pendencias.filter((p) => p.nivel === 'bloqueia');
  const avisos = pendencias.filter((p) => p.nivel === 'aviso');
  return (
    <button
      type="button"
      onClick={onAbrir}
      data-testid={`vitrine-modelo-${modelo.id}`}
      className="flex w-full gap-3 rounded-[10px] border border-border bg-surface p-3 text-left hover:bg-surface-hover"
    >
      <div className="h-24 w-[72px] shrink-0 overflow-hidden rounded-[10px] border border-border bg-surface-hover">
        {capa?.thumbUrl ? (
          <img src={capa.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-text">{modelo.nome}</span>
          {bloqueia.length === 0 ? (
            <Badge variant="success">na vitrine</Badge>
          ) : (
            <Badge variant="danger">fora da vitrine</Badge>
          )}
        </div>
        <p className="text-xs text-muted">{modelo.categoria?.nome ?? 'Sem categoria'}</p>
        <div className="mt-1 flex gap-1">
          {modelo.cores.map((c) => (
            <span
              key={c.id}
              title={`${c.cor.nome}${c.fotos.length ? '' : ' (sem foto)'}`}
              className={`inline-block h-3.5 w-3.5 rounded-full border ${c.fotos.length ? 'border-border' : 'border-dashed border-warning'}`}
              style={{ background: c.cor.hex }}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          {modelo.linhas.map((l) => l.linha.nome).join(' · ') || 'Sem grade'} · {totalFotos} foto(s)
        </p>
        <p className="text-xs text-text">{menor !== null ? `a partir de ${formatMoeda(menor)}` : 'preço sob consulta'}</p>
        {bloqueia.map((p) => (
          <p key={p.texto} className="text-xs text-danger">
            {p.texto}
          </p>
        ))}
        {avisos.length > 0 && <p className="text-xs text-warning">{avisos.length} ponto(s) a completar</p>}
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
  const [respeita, setRespeita] = useState(config?.respeitaEstoque ?? false);
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
        respeitaEstoque: respeita,
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
          <Field label="Faixa Atacadão a partir de">
            <Input value={atacadao} inputMode="numeric" onChange={(e) => setAtacadao(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">A faixa vale pelo total de peças do pedido, não por modelo.</p>
        <Switch
          label="Link público no ar"
          checked={ativa}
          onChange={(e) => setAtiva(e.target.checked)}
        />
        <Switch
          label="Respeitar o estoque"
          checked={respeita}
          onChange={(e) => setRespeita(e.target.checked)}
          data-testid="vitrine-respeita-estoque"
        />
        <p className="-mt-2 text-xs text-muted">
          Ligado (com o ERP): tamanho esgotado fica apagado na vitrine e o cliente não pede mais do que tem. Desligado,
          vende sem olhar o estoque.
        </p>
        <div>
          <Button onClick={salvar} loading={salvando} data-testid="vitrine-salvar-config">
            {config ? 'Salvar' : 'Ligar vitrine'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
