import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Input, Switch } from '@/components/ui';

/**
 * Retenção das mídias do WhatsApp (Léo, 19/10): o Storage estourou a cota e
 * derrubou fotos e anexos de todas as empresas. Ligada, toda madrugada sai a
 * mídia de CONVERSA com mais de N dias (a mensagem fica, com o texto). Mídia
 * de fluxo e documento da base de conhecimento nunca saem. Apagar é sem volta
 * — por isso é a empresa que liga, na tela.
 */
export const RETENCAO_MIN = 15;

export function MidiaRetencaoConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const atual = ((cfg?.whatsappMidia ?? {}) as { retencaoDias?: number | null }).retencaoDias ?? null;
  const [ligada, setLigada] = useState(false);
  const [dias, setDias] = useState('45');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLigada(atual !== null);
    if (atual !== null) setDias(String(atual));
  }, [atual]);

  if (!cfg) return null;
  const n = Number(dias);
  const valido = !ligada || (Number.isInteger(n) && n >= RETENCAO_MIN && n <= 3650);

  async function salvar() {
    if (ligada && atual === null) {
      const ok = window.confirm(
        `Ligar a retenção apaga EM DEFINITIVO as fotos, áudios e documentos das conversas com mais de ${n} dias, a partir desta madrugada. As mensagens (texto) continuam. Confirma?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api.patch('/empresas/config', { whatsappMidia: { retencaoDias: ligada ? n : null } });
      toast.success(ligada ? `Retenção ligada: mídias com mais de ${n} dias saem toda madrugada` : 'Retenção desligada: nada é apagado');
      refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 flex flex-col gap-3" data-testid="midia-retencao-config">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">🗂️ Mídias do WhatsApp: apagar as antigas</h3>
        <Badge variant={atual !== null ? 'success' : 'neutral'}>
          {atual !== null ? `Ligada · ${atual} dias` : 'Desligada · guarda tudo'}
        </Badge>
      </div>
      <p className="text-sm text-muted m-0">
        Fotos, áudios e documentos das conversas ocupam o armazenamento — quando ele enche, as fotos da vitrine e os
        anexos param de abrir. Ligada, toda madrugada sai a mídia com mais de N dias. A conversa e o texto ficam; só o
        arquivo some. Mídia de fluxo e documento da base de conhecimento do bot nunca saem.{' '}
        <b>Apagar é sem volta.</b>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          label="Apagar mídias com mais de"
          checked={ligada}
          disabled={!podeEditar}
          onChange={(e) => setLigada(e.target.checked)}
        />
        <Input
          type="number"
          min={RETENCAO_MIN}
          max={3650}
          value={dias}
          disabled={!podeEditar || !ligada}
          onChange={(e) => setDias(e.target.value)}
          className="w-24"
          data-testid="midia-retencao-dias"
        />
        <span className="text-sm">dias</span>
        <Button onClick={() => void salvar()} disabled={!podeEditar || busy || !valido} data-testid="midia-retencao-salvar">
          {busy ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
      {!valido && <span className="text-xs text-warning">Mínimo de {RETENCAO_MIN} dias.</span>}
    </Card>
  );
}
