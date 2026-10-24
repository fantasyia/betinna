import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { FormField, Input } from '@/components/FormField';
import { useToast } from '@/components/toast';

/**
 * Padrão fiscal da empresa (24/10, card cmvlyt0n5) — vai no export do Magis5.
 * A nota é emitida FORA do Betinna; aqui é só cadastro. Sem valor padrão:
 * vazio = não definido (quem define é o contador).
 */
const CAMPOS: Array<{ k: string; rotulo: string; dica: string }> = [
  { k: 'crt', rotulo: 'CRT', dica: '1 = Simples Nacional' },
  { k: 'csosn', rotulo: 'CSOSN padrão', dica: '3 dígitos (ex.: 101, 102)' },
  { k: 'cfopDentro', rotulo: 'CFOP dentro do estado', dica: '4 dígitos (ex.: 5101, 5102)' },
  { k: 'cfopFora', rotulo: 'CFOP fora do estado', dica: '4 dígitos (ex.: 6101, 6102)' },
  {
    k: 'cfopForaNaoContribuinte',
    rotulo: 'CFOP fora do estado (consumidor final)',
    dica: 'Não contribuinte (ex.: 6107)',
  },
  { k: 'cstPisCofins', rotulo: 'CST PIS/COFINS', dica: '2 dígitos (ex.: 49, 99)' },
];

export function FiscalEmpresaConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, refetch } = useApiQuery<{ fiscal?: Record<string, string | null> }>(
    '/empresas/config',
  );
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const atual = cfg?.fiscal ?? {};
    setF(Object.fromEntries(CAMPOS.map((c) => [c.k, atual[c.k] ?? ''])));
  }, [cfg]);

  async function salvar() {
    setBusy(true);
    try {
      await api.patch('/empresas/config', { fiscal: f });
      toast.success('Padrão fiscal salvo');
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4" data-testid="fiscal-empresa">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        🧾 Padrão fiscal da empresa
      </h2>
      <p className="text-xs text-muted mt-0">
        Vai na exportação pro Magis5. O produto pode sobrescrever CSOSN e CFOP. Deixe vazio o que
        o contador ainda não definiu.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        {CAMPOS.map((c) => (
          <FormField key={c.k} label={c.rotulo} hint={c.dica}>
            <Input
              value={f[c.k] ?? ''}
              inputMode="numeric"
              maxLength={5}
              disabled={!podeEditar}
              data-testid={`fiscal-empresa-${c.k}`}
              onChange={(e) => setF((x) => ({ ...x, [c.k]: e.target.value }))}
            />
          </FormField>
        ))}
      </div>
      {podeEditar && (
        <button
          type="button"
          className="mt-3 bg-primary text-white rounded-md px-4 py-2 text-[13px] font-medium disabled:opacity-60"
          disabled={busy}
          onClick={() => void salvar()}
          data-testid="fiscal-empresa-salvar"
        >
          {busy ? 'Salvando…' : 'Salvar padrão fiscal'}
        </button>
      )}
    </div>
  );
}
