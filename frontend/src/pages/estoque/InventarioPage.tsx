import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Button, Card, Field, Input, Select } from '@/components/ui';
import { GradeEditor, inteiro, type ValoresGrade } from '@/pages/producao/GradeEditor';
import { paraCelula } from '@/pages/producao/ProducaoPage';
import type { SaldoVariacao } from './grade';

/**
 * Inventário (ERP próprio · entrega 5): conta por modelo na grade e o sistema
 * lança, de uma vez, o AJUSTE da diferença de cada variação contada. Casa
 * vazia = não contada (não mexe).
 */

/** Diferenças da contagem contra o físico — o que vai virar ajuste. PURO. */
export function diferencas(contado: ValoresGrade, fisico: Map<string, number>) {
  return Object.entries(contado)
    .filter(([, t]) => t !== '')
    .map(([produtoId, t]) => ({ produtoId, contado: inteiro(t), diferenca: inteiro(t) - (fisico.get(produtoId) ?? 0) }));
}

export default function InventarioPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<SaldoVariacao[]>(gestor ? '/erp/estoque/saldos' : null);
  const toast = useToast();
  const modelos = useMemo(
    () => [...new Map((q.data ?? []).map((v) => [v.modelo.id, v.modelo])).values()].sort((a, b) => a.ordem - b.ordem),
    [q.data],
  );
  const [modeloId, setModeloId] = useState('');
  const [contado, setContado] = useState<ValoresGrade>({});
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!modeloId && modelos[0]) setModeloId(modelos[0].id);
  }, [modelos, modeloId]);

  const doModelo = (q.data ?? []).filter((v) => v.modelo.id === modeloId);
  const fisico = new Map(doModelo.map((v) => [v.produtoId, v.fisico]));
  const difs = diferencas(contado, fisico);
  const mudam = difs.filter((d) => d.diferenca !== 0);

  async function lancar() {
    setSalvando(true);
    try {
      const r = await api.post<{ ajustes: number; diferenca: number; conferidas: number }>('/erp/estoque/inventario', {
        contagens: difs.map((d) => ({ produtoId: d.produtoId, contado: d.contado })),
        motivo,
      });
      toast.success(`Inventário lançado: ${r.conferidas} conferidas, ${r.ajustes} ajustadas`);
      setContado({});
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível lançar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <PageLayout
      title="Inventário"
      description="Conte as peças e digite. O que você não preencher não é mexido."
      actions={
        <Link to="/estoque" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" /> Estoque
        </Link>
      }
    >
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa o estoque.</Card>
      ) : (
        <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
          <Card className="p-4 flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Modelo">
                <Select
                  value={modeloId}
                  onChange={(e) => {
                    setModeloId(e.target.value);
                    setContado({});
                  }}
                  data-testid="inv-modelo"
                >
                  {modelos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Motivo (opcional)" hint="Vazio = “Inventário dd/mm/aaaa”">
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
              </Field>
            </div>
            <GradeEditor
              celulas={doModelo.map(paraCelula)}
              valores={contado}
              onChange={setContado}
              dicas={Object.fromEntries(doModelo.map((v) => [v.produtoId, `sistema ${v.fisico}`]))}
              testid="inv-grade"
            />
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted mr-auto" data-testid="inv-resumo">
                {difs.length} contadas · {mudam.length} com diferença
                {mudam.length > 0 && ` (saldo ${mudam.reduce((s, d) => s + d.diferenca, 0) > 0 ? '+' : ''}${formatNumero(mudam.reduce((s, d) => s + d.diferenca, 0))})`}
              </span>
              <Button onClick={lancar} loading={salvando} disabled={difs.length === 0} data-testid="inv-lancar">
                Lançar inventário
              </Button>
            </div>
          </Card>
        </StateView>
      )}
    </PageLayout>
  );
}
