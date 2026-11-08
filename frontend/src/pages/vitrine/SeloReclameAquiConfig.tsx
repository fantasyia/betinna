import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Select, Switch } from '@/components/ui';

/**
 * Selo do Reclame Aqui na vitrine (07/11): aparece no resumo do pedido, antes
 * do "Enviar pedido". O data-id vem do código do selo no painel do Reclame
 * Aqui (área da empresa → compartilhar selo).
 */
interface StatusSelo {
  config: { ativo?: boolean; dataId?: string | null; modelo?: string | null };
}

const MODELOS = [
  ['compact_1', 'Compacto · branco'],
  ['compact_2', 'Compacto · cinza claro'],
  ['compact_3', 'Compacto · verde escuro'],
  ['horizontal_1', 'Horizontal · branco'],
  ['horizontal_2', 'Horizontal · cinza claro'],
  ['horizontal_3', 'Horizontal · verde escuro'],
] as const;

export function SeloReclameAquiConfig() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusSelo>(gestor ? '/vitrine/admin/selo-reclame-aqui' : null);
  const toast = useToast();
  const [ativo, setAtivo] = useState(false);
  const [dataId, setDataId] = useState('');
  const [modelo, setModelo] = useState('compact_1');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setAtivo(q.data.config.ativo === true);
    setDataId(q.data.config.dataId ?? '');
    setModelo(q.data.config.modelo ?? 'compact_1');
  }, [q.data]);

  if (!gestor || !q.data) return null;

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/selo-reclame-aqui', {
        ativo,
        dataId: dataId.trim() || null,
        modelo,
      });
      toast.success(ativo ? 'Selo ligado na vitrine' : 'Selo salvo (desligado)');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="selo-ra-config">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Selo do Reclame Aqui</h2>
        <Badge variant={q.data.config.ativo ? 'success' : 'neutral'}>
          {q.data.config.ativo ? 'Ligado' : 'Desligado'}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        Mostra o selo no resumo do pedido, antes do botão de enviar. O data-id está no código do
        selo, no painel do Reclame Aqui (área da empresa → compartilhar selo).
      </p>
      <Field label="data-id do selo">
        <Input
          value={dataId}
          onChange={(e) => setDataId(e.target.value)}
          maxLength={200}
          placeholder="ex.: czczbGEx…"
          data-testid="selo-ra-id"
        />
      </Field>
      <Field label="Modelo">
        <Select value={modelo} onChange={(e) => setModelo(e.target.value)} data-testid="selo-ra-modelo">
          {MODELOS.map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch label="Mostrar o selo na vitrine" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        <Button onClick={salvar} disabled={salvando || (ativo && !dataId.trim())} data-testid="selo-ra-salvar">
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Card>
  );
}
