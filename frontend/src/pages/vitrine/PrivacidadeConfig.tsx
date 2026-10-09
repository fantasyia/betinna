import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input } from '@/components/ui';

/**
 * Política de Privacidade da vitrine (exigida pelo Meta pro formulário de
 * anúncio). O texto é montado pelo sistema conforme o que a empresa usa; aqui
 * só entram quem responde pelos dados e o e-mail de contato. Sem os dois, a
 * página não é publicada.
 */
interface StatusPrivacidade {
  razaoSocial: string | null;
  email: string | null;
  atualizadaEm: string | null;
  publicada: boolean;
  empresa: { nome: string | null; cnpj: string | null };
}

export function PrivacidadeConfig({ slug }: { slug: string }) {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusPrivacidade>(gestor ? '/vitrine/admin/privacidade' : null);
  const toast = useToast();
  const [razao, setRazao] = useState('');
  const [email, setEmail] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setRazao(q.data.razaoSocial ?? '');
    setEmail(q.data.email ?? '');
  }, [q.data]);

  if (!gestor || !q.data) return null;
  const s = q.data;
  const link = `/v/${encodeURIComponent(slug)}/privacidade`;

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/privacidade', { razaoSocial: razao, email });
      toast.success('Política de privacidade publicada');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="privacidade-config">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Política de privacidade</h2>
        <Badge variant={s.publicada ? 'success' : 'neutral'}>
          {s.publicada ? 'Publicada' : 'Não publicada'}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        Exigida pelo Meta pra formulário de anúncio. O texto segue a LGPD e se ajusta ao que a
        empresa usa (pagamento online, frete, atendimento automático). Aqui você informa só quem
        responde pelos dados e o e-mail pra pedidos de privacidade.
      </p>
      <Field label="Razão social (quem responde pelos dados)">
        <Input
          value={razao}
          onChange={(e) => setRazao(e.target.value)}
          placeholder={s.empresa.nome ?? ''}
          maxLength={160}
          data-testid="privacidade-razao"
        />
      </Field>
      <Field label="E-mail para assuntos de privacidade">
        <Input
          value={email}
          type="email"
          onChange={(e) => setEmail(e.target.value)}
          maxLength={160}
          data-testid="privacidade-email"
        />
      </Field>
      {!s.empresa.cnpj && (
        <p className="text-xs text-muted">
          A empresa está sem CNPJ no cadastro: a página sai sem ele.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {s.publicada ? (
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className="text-sm font-semibold text-primary underline"
          >
            Ver a página publicada →
          </a>
        ) : (
          <span />
        )}
        <Button
          onClick={salvar}
          disabled={salvando || razao.trim().length < 2 || !email.trim()}
          data-testid="privacidade-salvar"
        >
          {salvando ? 'Salvando…' : s.publicada ? 'Salvar' : 'Publicar'}
        </Button>
      </div>
    </Card>
  );
}
