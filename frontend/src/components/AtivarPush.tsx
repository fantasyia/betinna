import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';

/**
 * Liga as notificações (Web Push) NESTE aparelho (24/10). O navegador pede a
 * permissão uma vez; a inscrição vai pro servidor, que avisa as pendências.
 * iPhone: só funciona com o site adicionado à Tela de Início.
 */
function chaveParaBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function AtivarPush() {
  const toast = useToast();
  const [estado, setEstado] = useState<'carregando' | 'sem-suporte' | 'ligado' | 'desligado'>(
    'carregando',
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setEstado('sem-suporte');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setEstado(sub ? 'ligado' : 'desligado');
    })().catch(() => setEstado('sem-suporte'));
  }, []);

  async function ligar() {
    setBusy(true);
    try {
      const { chave } = await api.get<{ chave: string | null }>('/push/chave');
      if (!chave) {
        toast.error('Notificações ainda não configuradas no servidor');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast.error('Permissão negada', 'Libere as notificações deste site nas configurações do navegador.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(chave),
      });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.post('/push/inscrever', {
        endpoint: j.endpoint,
        keys: j.keys,
        userAgent: navigator.userAgent.slice(0, 300),
      });
      await api.post('/push/teste', {});
      setEstado('ligado');
      toast.success('Notificações ligadas neste aparelho');
    } catch (err) {
      toast.error('Não deu pra ligar as notificações', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function desligar() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.post('/push/sair', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEstado('desligado');
    } catch (err) {
      toast.error('Não deu pra desligar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (estado === 'carregando') return null;
  if (estado === 'sem-suporte') {
    return (
      <span className="text-xs text-muted" data-testid="push-sem-suporte">
        Este navegador não recebe notificações (no iPhone: adicione o site à Tela de Início).
      </span>
    );
  }
  return estado === 'ligado' ? (
    <Button variant="ghost" onClick={() => void desligar()} loading={busy} data-testid="push-desligar">
      🔔 Notificações ligadas neste aparelho · desligar
    </Button>
  ) : (
    <Button onClick={() => void ligar()} loading={busy} data-testid="push-ligar">
      🔔 Ativar notificações neste aparelho
    </Button>
  );
}
