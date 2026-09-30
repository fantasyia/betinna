import { useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api, apiErrorMessage } from '@/lib/api';
import { Button, Dialog, Input, Textarea } from '@/components/ui';

/**
 * Respostas prontas da pré-venda (card ML, 30/09): textos que o vendedor
 * escolhe na pergunta e edita antes de enviar. Moram em
 * Empresa.config.respostasProntas.marketplace — quem lê é todo o atendimento,
 * quem edita é DIRETOR/ADMIN (PATCH /empresas/config).
 */
export interface RespostaPronta {
  titulo: string;
  texto: string;
}

interface ConfigComProntas {
  respostasProntas?: { marketplace?: RespostaPronta[] | null } | null;
}

export function useRespostasProntas() {
  const r = useApiQuery<ConfigComProntas>('/empresas/config');
  const cru = r.data?.respostasProntas?.marketplace;
  // referência estável: o diálogo reinicia o rascunho quando a lista muda
  const lista = useMemo(() => cru ?? [], [cru]);
  return { lista, refetch: r.refetch };
}

export function GerenciarRespostasProntas({
  open,
  onClose,
  atuais,
  onSalvo,
}: {
  open: boolean;
  onClose: () => void;
  atuais: RespostaPronta[];
  onSalvo: () => void;
}) {
  const [itens, setItens] = useState<RespostaPronta[]>(atuais);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // reabrir o diálogo parte do que está salvo
  useEffect(() => {
    if (open) {
      setItens(atuais);
      setErro(null);
    }
  }, [open, atuais]);

  const mudar = (i: number, campo: keyof RespostaPronta, v: string) =>
    setItens((l) => l.map((it, j) => (j === i ? { ...it, [campo]: v } : it)));

  const salvar = async () => {
    const limpos = itens
      .map((it) => ({ titulo: it.titulo.trim(), texto: it.texto.trim() }))
      .filter((it) => it.titulo || it.texto);
    if (limpos.some((it) => !it.titulo || !it.texto)) {
      setErro('Cada resposta pronta precisa de título e texto.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await api.patch('/empresas/config', { respostasProntas: { marketplace: limpos } });
      onSalvo();
      onClose();
    } catch (err) {
      setErro(apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Respostas prontas — pré-venda"
      description="Aparecem na pergunta do anúncio. O texto cai no campo pra revisar antes de enviar."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button data-testid="prontas-salvar" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {itens.length === 0 && (
          <p className="text-[13px] text-muted">Nenhuma resposta pronta ainda.</p>
        )}
        {itens.map((it, i) => (
          <div key={i} className="rounded-md border border-border p-3 flex flex-col gap-2">
            <div className="flex gap-2">
              <Input
                data-testid={`prontas-titulo-${i}`}
                value={it.titulo}
                maxLength={60}
                placeholder="Título (ex.: Prazo de envio)"
                onChange={(e) => mudar(i, 'titulo', e.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                data-testid={`prontas-remover-${i}`}
                onClick={() => setItens((l) => l.filter((_, j) => j !== i))}
              >
                Remover
              </Button>
            </div>
            <Textarea
              data-testid={`prontas-texto-${i}`}
              rows={3}
              value={it.texto}
              maxLength={2000}
              placeholder="Texto da resposta"
              onChange={(e) => mudar(i, 'texto', e.target.value)}
            />
          </div>
        ))}
        {itens.length < 30 && (
          <Button
            variant="secondary"
            size="sm"
            data-testid="prontas-adicionar"
            onClick={() => setItens((l) => [...l, { titulo: '', texto: '' }])}
          >
            + Adicionar resposta pronta
          </Button>
        )}
        {erro && (
          <p data-testid="prontas-erro" className="text-[12px] text-danger">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}
