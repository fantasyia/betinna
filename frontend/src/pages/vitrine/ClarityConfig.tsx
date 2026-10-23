import { useEffect, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Switch } from '@/components/ui';

/**
 * Microsoft Clarity na vitrine (22/10): gravação de sessão e mapa de calor.
 * Público (vai na página) — só o ID do projeto. Não carrega na visita da
 * equipe (modo interno) e os formulários de dados vão mascarados.
 */
interface StatusClarity {
  config: { ativo?: boolean; projetoId?: string | null };
}

export function ClarityConfig() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusClarity>(gestor ? '/vitrine/admin/clarity' : null);
  const toast = useToast();
  const [ativo, setAtivo] = useState(false);
  const [id, setId] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setAtivo(q.data.config.ativo === true);
    setId(q.data.config.projetoId ?? '');
  }, [q.data]);

  if (!gestor || !q.data) return null;

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/clarity', { ativo, projetoId: id.trim() || null });
      toast.success(ativo ? 'Clarity ligado na vitrine' : 'Clarity salvo (desligado)');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="clarity-config">
      <div className="flex flex-wrap items-center gap-2">
        <MousePointerClick className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Microsoft Clarity</h2>
        <Badge variant={q.data.config.ativo ? 'success' : 'neutral'}>
          {q.data.config.ativo ? 'Ligado' : 'Desligado'}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        Grava como os clientes usam a vitrine (cliques, rolagem, onde travam) e monta o mapa de calor. A
        visita da equipe (modo interno) não é gravada, e os formulários de dados e pagamento vão
        mascarados. A política de privacidade passa a citar o Clarity.
      </p>
      <Field label="ID do projeto">
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          maxLength={20}
          placeholder="ex.: z1z4fnaulg"
          data-testid="clarity-id"
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch label="Ligar o Clarity na vitrine" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        <Button onClick={salvar} disabled={salvando || (ativo && !id.trim())} data-testid="clarity-salvar">
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Card>
  );
}
