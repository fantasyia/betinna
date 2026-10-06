import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Dialog, Field, Input, Switch } from '@/components/ui';
import type { Categoria, Cor, Linha, Tamanho } from './tipos';

/**
 * Listas da EMPRESA (Léo, 05/10): cores e tamanhos se SELECIONAM no cadastro
 * do modelo, não se digitam. Aqui se cria e edita cada lista — e o que se cria
 * vale pra todos os modelos.
 */

type FormCor = { id?: string; nome: string; hex: string; ativo: boolean };

export function CoresPanel({ cores, onMudou }: { cores: Cor[]; onMudou: () => void }) {
  const [form, setForm] = useState<FormCor | null>(null);
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-text">Cores da empresa</h3>
        <Button
          size="sm"
          data-testid="vitrine-nova-cor"
          onClick={() => setForm({ nome: '', hex: '#1A2D38', ativo: true })}
        >
          <Plus size={14} /> Nova cor
        </Button>
      </div>
      {cores.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma cor ainda. Crie as cores que os modelos usam.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {cores.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid={`vitrine-cor-${c.id}`}
                onClick={() => setForm({ id: c.id, nome: c.nome, hex: c.hex, ativo: c.ativo })}
                className="flex items-center gap-2 rounded-[10px] border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
              >
                <span
                  className="inline-block h-4 w-4 rounded-full border border-border"
                  style={{ background: c.hex }}
                />
                {c.nome}
                {!c.ativo && <Badge variant="neutral">inativa</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <CorDialog
        key={form ? (form.id ?? 'nova') : 'fechado'}
        form={form}
        onClose={() => setForm(null)}
        onSalvou={onMudou}
        onExcluiu={onMudou}
      />
    </Card>
  );
}

/** Dialog de cor — reaproveitado pelo editor do modelo ("criar na hora"). */
export function CorDialog({
  form,
  onClose,
  onSalvou,
  onExcluiu,
}: {
  form: FormCor | null;
  onClose: () => void;
  onSalvou: (cor: Cor) => void;
  onExcluiu?: () => void;
}) {
  const toast = useToast();
  // O pai remonta este componente (key) a cada abertura: o rascunho nasce do form.
  const [rascunho, setRascunho] = useState<FormCor | null>(form);
  const [salvando, setSalvando] = useState(false);

  async function excluir() {
    if (!rascunho?.id) return;
    if (!window.confirm(`Excluir a cor "${rascunho.nome}"?`)) return;
    try {
      await api.delete(`/vitrine/admin/cores/${rascunho.id}`);
      toast.success('Cor excluída');
      onExcluiu?.();
      onClose();
    } catch (err) {
      toast.error('Não foi possível excluir', apiErrorMessage(err));
    }
  }

  async function salvar() {
    if (!rascunho) return;
    if (!rascunho.nome.trim()) return toast.error('Dê um nome à cor');
    if (!/^#[0-9a-fA-F]{6}$/.test(rascunho.hex)) return toast.error('Cor no formato #RRGGBB');
    setSalvando(true);
    try {
      const body = { nome: rascunho.nome.trim(), hex: rascunho.hex, ativo: rascunho.ativo };
      const cor = rascunho.id
        ? await api.put<Cor>(`/vitrine/admin/cores/${rascunho.id}`, body)
        : await api.post<Cor>('/vitrine/admin/cores', body);
      toast.success('Cor salva');
      onSalvou(cor);
      onClose();
    } catch (err) {
      toast.error('Não foi possível salvar a cor', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open={!!form}
      onClose={onClose}
      title={rascunho?.id ? 'Editar cor' : 'Nova cor'}
      size="sm"
      footer={
        <>
          {rascunho?.id && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => void excluir()}
              data-testid="vitrine-excluir-cor"
            >
              <Trash2 size={14} /> Excluir
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando} data-testid="vitrine-salvar-cor">
            Salvar
          </Button>
        </>
      }
    >
      {rascunho && (
        <div className="flex flex-col gap-3">
          <Field label="Nome" required>
            <Input
              value={rascunho.nome}
              maxLength={60}
              onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
              placeholder="Ex.: Preto, Mescla, Off-white"
              data-testid="vitrine-cor-nome"
            />
          </Field>
          <Field label="Cor da bolinha na vitrine">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={rascunho.hex}
                onChange={(e) => setRascunho({ ...rascunho, hex: e.target.value.toUpperCase() })}
                className="h-9 w-12 cursor-pointer rounded-[10px] border border-border bg-surface"
                aria-label="Escolher cor"
              />
              <Input
                value={rascunho.hex}
                maxLength={7}
                onChange={(e) => setRascunho({ ...rascunho, hex: e.target.value })}
                className="w-28 font-mono"
              />
            </div>
          </Field>
          <Switch
            label="Ativa"
            checked={rascunho.ativo}
            onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })}
          />
        </div>
      )}
    </Dialog>
  );
}

export function LinhasPanel({ linhas, onMudou }: { linhas: Linha[]; onMudou: () => void }) {
  const toast = useToast();
  const [novaLinha, setNovaLinha] = useState('');
  const [novoTamanho, setNovoTamanho] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState<{ tipo: 'linha' | 'tamanho'; item: Linha | Tamanho } | null>(
    null,
  );
  const [nomeEdicao, setNomeEdicao] = useState('');
  const [ativoEdicao, setAtivoEdicao] = useState(true);

  async function criarLinha() {
    if (!novaLinha.trim()) return;
    try {
      await api.post('/vitrine/admin/linhas', { nome: novaLinha.trim(), ordem: linhas.length });
      setNovaLinha('');
      onMudou();
    } catch (err) {
      toast.error('Não foi possível criar a linha', apiErrorMessage(err));
    }
  }

  async function criarTamanho(linha: Linha) {
    const nome = (novoTamanho[linha.id] ?? '').trim();
    if (!nome) return;
    try {
      await api.post(`/vitrine/admin/linhas/${linha.id}/tamanhos`, {
        nome,
        ordem: linha.tamanhos.length,
      });
      setNovoTamanho({ ...novoTamanho, [linha.id]: '' });
      onMudou();
    } catch (err) {
      toast.error('Não foi possível criar o tamanho', apiErrorMessage(err));
    }
  }

  async function salvarEdicao() {
    if (!editando || !nomeEdicao.trim()) return;
    const { tipo, item } = editando;
    try {
      const url = tipo === 'linha' ? `/vitrine/admin/linhas/${item.id}` : `/vitrine/admin/tamanhos/${item.id}`;
      await api.put(url, { nome: nomeEdicao.trim(), ativo: ativoEdicao });
      setEditando(null);
      onMudou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    }
  }

  async function excluir() {
    if (!editando) return;
    const { tipo, item } = editando;
    const oQue = tipo === 'linha' ? `a linha "${item.nome}" e os tamanhos dela` : `o tamanho "${item.nome}"`;
    if (!window.confirm(`Excluir ${oQue}?`)) return;
    try {
      const url = tipo === 'linha' ? `/vitrine/admin/linhas/${item.id}` : `/vitrine/admin/tamanhos/${item.id}`;
      await api.delete(url);
      setEditando(null);
      onMudou();
    } catch (err) {
      toast.error('Não foi possível excluir', apiErrorMessage(err));
    }
  }

  function abrirEdicao(tipo: 'linha' | 'tamanho', item: Linha | Tamanho) {
    setEditando({ tipo, item });
    setNomeEdicao(item.nome);
    setAtivoEdicao(item.ativo);
  }

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-text mb-1">Linhas e tamanhos</h3>
      <p className="text-sm text-muted mb-3">
        Cada linha (ex.: Regular, Plus size, Infantil) tem a sua sequência de tamanhos.
      </p>
      <div className="flex flex-col gap-3">
        {linhas.map((l) => (
          <div key={l.id} className="rounded-[10px] border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-text">{l.nome}</span>
              {!l.ativo && <Badge variant="neutral">inativa</Badge>}
              <button
                type="button"
                onClick={() => abrirEdicao('linha', l)}
                className="text-muted hover:text-text"
                aria-label={`Editar linha ${l.nome}`}
              >
                <Pencil size={13} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {l.tamanhos.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => abrirEdicao('tamanho', t)}
                  className={`rounded-[10px] border border-border px-2.5 py-1 text-sm hover:bg-surface-hover ${t.ativo ? '' : 'opacity-50 line-through'}`}
                >
                  {t.nome}
                </button>
              ))}
              <Input
                value={novoTamanho[l.id] ?? ''}
                onChange={(e) => setNovoTamanho({ ...novoTamanho, [l.id]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && void criarTamanho(l)}
                placeholder="+ tamanho"
                maxLength={20}
                className="w-28 h-8"
                data-testid={`vitrine-novo-tamanho-${l.id}`}
              />
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={novaLinha}
            onChange={(e) => setNovaLinha(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void criarLinha()}
            placeholder="Nova linha (ex.: Plus size)"
            maxLength={40}
            data-testid="vitrine-nova-linha"
          />
          <Button variant="secondary" onClick={criarLinha}>
            <Plus size={14} /> Linha
          </Button>
        </div>
      </div>

      <Dialog
        open={!!editando}
        onClose={() => setEditando(null)}
        title={editando?.tipo === 'linha' ? 'Editar linha' : 'Editar tamanho'}
        size="sm"
        footer={
          <>
            <Button variant="danger" onClick={() => void excluir()} className="mr-auto" data-testid="vitrine-excluir-linha-tamanho">
              <Trash2 size={14} /> Excluir
            </Button>
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicao}>Salvar</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Nome" required>
            <Input value={nomeEdicao} onChange={(e) => setNomeEdicao(e.target.value)} />
          </Field>
          <Switch
            label="Ativo"
            checked={ativoEdicao}
            onChange={(e) => setAtivoEdicao(e.target.checked)}
          />
          <p className="text-xs text-muted">
            Renomear atualiza os produtos dos modelos que usam este item. Inativo some da vitrine.
            Excluir só funciona se nenhum modelo usa.
          </p>
        </div>
      </Dialog>
    </Card>
  );
}

/**
 * Categorias da empresa (Moletom, Camiseta UV…) — lista, não texto livre:
 * a vitrine filtra por ela, e "Moletom" ≠ "moletom" viraria dois filtros.
 */
export function CategoriasPanel({
  categorias,
  onMudou,
}: {
  categorias: Categoria[];
  onMudou: () => void;
}) {
  const toast = useToast();
  const [nova, setNova] = useState('');
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [nome, setNome] = useState('');
  const [ativo, setAtivo] = useState(true);

  async function criar() {
    if (!nova.trim()) return;
    try {
      await api.post('/vitrine/admin/categorias', { nome: nova.trim(), ordem: categorias.length });
      setNova('');
      onMudou();
    } catch (err) {
      toast.error('Não foi possível criar a categoria', apiErrorMessage(err));
    }
  }

  async function salvar() {
    if (!editando || !nome.trim()) return;
    try {
      await api.put(`/vitrine/admin/categorias/${editando.id}`, { nome: nome.trim(), ativo });
      setEditando(null);
      onMudou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    }
  }

  async function excluir() {
    if (!editando) return;
    if (!window.confirm(`Excluir a categoria "${editando.nome}"?`)) return;
    try {
      await api.delete(`/vitrine/admin/categorias/${editando.id}`);
      setEditando(null);
      onMudou();
    } catch (err) {
      toast.error('Não foi possível excluir', apiErrorMessage(err));
    }
  }

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-text mb-1">Categorias</h3>
      <p className="text-sm text-muted mb-3">É o filtro de categorias que o cliente usa na vitrine.</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {categorias.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setEditando(c);
              setNome(c.nome);
              setAtivo(c.ativo);
            }}
            className="flex items-center gap-2 rounded-[10px] border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            {c.nome}
            <span className="text-xs text-muted">{c._count?.modelos ?? 0}</span>
            {!c.ativo && <Badge variant="neutral">inativa</Badge>}
          </button>
        ))}
        {categorias.length === 0 && <p className="text-sm text-muted">Nenhuma categoria ainda.</p>}
      </div>
      <div className="flex gap-2">
        <Input
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void criar()}
          placeholder="Nova categoria (ex.: Moletom)"
          maxLength={60}
          data-testid="vitrine-nova-categoria"
        />
        <Button variant="secondary" onClick={() => void criar()}>
          <Plus size={14} /> Categoria
        </Button>
      </div>
      <Dialog
        open={!!editando}
        onClose={() => setEditando(null)}
        title="Editar categoria"
        size="sm"
        footer={
          <>
            <Button variant="danger" className="mr-auto" onClick={() => void excluir()}>
              <Trash2 size={14} /> Excluir
            </Button>
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void salvar()}>Salvar</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Nome" required>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
          </Field>
          <Switch label="Ativa" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <p className="text-xs text-muted">Excluir só funciona se nenhum modelo usa a categoria.</p>
        </div>
      </Dialog>
    </Card>
  );
}
