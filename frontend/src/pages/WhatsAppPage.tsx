import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface WhatsAppStatus {
  conectado: boolean;
  qrDataUrl?: string;
  pareando?: boolean;
}

/**
 * Página de WhatsApp empresa — exibe QR code para pareamento.
 * Sprint 4 FIX 7 — data-testid="qr-container" para E2E test.
 */
export default function WhatsAppPage() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function check() {
      try {
        const s = await api.get<WhatsAppStatus>('/integracoes/whatsapp/status');
        if (!cancelled) setStatus(s);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Erro');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void check();
    // Polling 3s pra atualizar QR (Baileys regenera periodicamente)
    interval = setInterval(check, 3000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  async function conectar() {
    try {
      await api.post('/integracoes/whatsapp/conectar');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>WhatsApp da Empresa</h1>
      <div data-testid="qr-container" style={{ marginTop: '1.5rem' }}>
        {loading && <p data-testid="loading-skeleton">Carregando status…</p>}
        {error && (
          <p data-testid="error-state" style={{ color: '#dc2626' }}>
            {error}
          </p>
        )}
        {status?.conectado && (
          <p data-testid="connected-state" style={{ color: '#16a34a', fontWeight: 600 }}>
            ✅ WhatsApp conectado
          </p>
        )}
        {!status?.conectado && status?.qrDataUrl && (
          <div>
            <p>Escaneie o QR Code com seu WhatsApp para conectar:</p>
            <img
              src={status.qrDataUrl}
              alt="QR Code WhatsApp"
              data-testid="qr-image"
              style={{ maxWidth: 280, margin: '1rem 0' }}
            />
          </div>
        )}
        {!status?.conectado && !status?.qrDataUrl && !loading && (
          <div data-testid="empty-state">
            <p>WhatsApp não está pareado ainda.</p>
            <button onClick={conectar} type="button" data-testid="connect-btn">
              Iniciar pareamento
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
