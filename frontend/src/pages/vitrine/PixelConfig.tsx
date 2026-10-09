import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Switch } from '@/components/ui';

/**
 * Pixel do Meta + API de Conversões na vitrine. O ID do pixel (público) fica
 * aqui; o token da API de Conversões, em Integrações → Pixel do Meta.
 */
interface StatusPixel {
  conectado: boolean;
  config: { ativo?: boolean; pixelId?: string; testEventCode?: string | null };
}

export function PixelConfig() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusPixel>(gestor ? '/vitrine/admin/pixel' : null);
  const toast = useToast();
  const [ativo, setAtivo] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [teste, setTeste] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setAtivo(q.data.config.ativo === true);
    setPixelId(q.data.config.pixelId ?? '');
    setTeste(q.data.config.testEventCode ?? '');
  }, [q.data]);

  if (!gestor || !q.data) return null;
  const s = q.data;

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/pixel', {
        ativo,
        pixelId: pixelId.replace(/\D/g, ''),
        testEventCode: teste.trim() || null,
      });
      toast.success(ativo ? 'Pixel ligado na vitrine' : 'Pixel salvo (desligado)');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="pixel-config">
      <div className="flex flex-wrap items-center gap-2">
        <Target className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Pixel do Meta</h2>
        <Badge variant={s.config.ativo ? 'success' : 'neutral'}>
          {s.config.ativo ? 'Ligado' : 'Desligado'}
        </Badge>
        <Badge variant={s.conectado ? 'success' : 'warning'}>
          {s.conectado ? 'API de Conversões conectada' : 'Sem token'}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        Mede visitas, produtos vistos, itens no pedido e início do pagamento pelo navegador. A
        compra vai pelo servidor quando o pedido é pago, com os dados do cliente cifrados. Ligado,
        a política de privacidade passa a explicar o pixel.
      </p>
      {!s.conectado && (
        <p className="text-sm text-muted">
          Cole o token da API de Conversões em{' '}
          <Link to="/integracoes" className="text-primary hover:underline">
            Integrações → Pixel do Meta
          </Link>
          .
        </p>
      )}
      <Field label="ID do pixel (conjunto de dados)">
        <Input
          value={pixelId}
          inputMode="numeric"
          onChange={(e) => setPixelId(e.target.value)}
          maxLength={20}
          data-testid="pixel-id"
        />
      </Field>
      <Field label="Código de teste (opcional, do Gerenciador de Eventos)">
        <Input
          value={teste}
          onChange={(e) => setTeste(e.target.value)}
          maxLength={40}
          placeholder="TEST12345"
          data-testid="pixel-teste"
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch
          label="Ligar o pixel na vitrine"
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
        />
        <Button
          onClick={salvar}
          disabled={salvando || !/^\d{8,20}$/.test(pixelId.replace(/\D/g, ''))}
          data-testid="pixel-salvar"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Card>
  );
}
