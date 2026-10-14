import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { mascararWhatsapp } from '@/pages/vitrine-publica/calculo';
import { Badge, Button, Card, Field, Input } from '@/components/ui';

/**
 * WhatsApp de atendimento da vitrine (Léo, 14/10): vira um ícone pequeno no
 * topo, ao lado do carrinho. Vazio = sem ícone.
 */
interface StatusContato {
  whatsapp: string | null;
  noAr: boolean;
}

export function ContatoConfig() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusContato>(gestor ? '/vitrine/admin/contato' : null);
  const toast = useToast();
  const [whatsapp, setWhatsapp] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (q.data) setWhatsapp(q.data.whatsapp ?? '');
  }, [q.data]);

  if (!gestor || !q.data) return null;
  const digitos = whatsapp.replace(/\D/g, '').length;
  const valido = digitos === 0 || digitos === 10 || digitos === 11;

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/contato', { whatsapp: whatsapp.trim() });
      toast.success(digitos ? 'WhatsApp no topo da vitrine' : 'Ícone do WhatsApp removido');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="contato-config">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">WhatsApp de atendimento</h2>
        <Badge variant={q.data.noAr ? 'success' : 'neutral'}>
          {q.data.noAr ? 'Na vitrine' : 'Sem ícone'}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        Aparece como um ícone pequeno no topo da vitrine, ao lado do carrinho. O cliente toca e
        abre uma conversa com este número. Deixe vazio pra tirar o ícone.
      </p>
      <Field label="WhatsApp com DDD">
        <Input
          value={whatsapp}
          inputMode="tel"
          onChange={(e) => setWhatsapp(mascararWhatsapp(e.target.value))}
          placeholder="(11) 99999-9999"
          maxLength={20}
          data-testid="contato-whatsapp"
        />
      </Field>
      {!valido && <p className="text-xs text-danger">Informe o DDD e o número.</p>}
      <div className="flex justify-end">
        <Button onClick={salvar} disabled={salvando || !valido} data-testid="contato-salvar">
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Card>
  );
}
