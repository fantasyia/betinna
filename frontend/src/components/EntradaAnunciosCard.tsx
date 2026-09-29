import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Button, Input, Select } from '@/components/ui';

/**
 * Onde o lead de ANÚNCIO entra no funil (card 📣, itens 6 e 10, 29/09).
 * Grava `Empresa.config.entradaAnuncios`. Vazio = funil padrão da empresa.
 *
 * - Click-to-WhatsApp: a conversa de anúncio vira lead nesta etapa. Tem que
 *   ser a MESMA do "Criar lead" da triagem, senão o lead cai num funil cujos
 *   fluxos disparam antes da triagem classificar.
 * - Lead Ads: etapa padrão e, se houver mais de um formulário, uma por
 *   formulário (o id do formulário vem do Gerenciador de Anúncios).
 */

interface Funil {
  id: string;
  nome: string;
  etapas: Array<{ id: string; nome: string }>;
}
interface Entrada {
  ctwaEtapaId?: string | null;
  leadAdsEtapaId?: string | null;
  leadAdsPorFormulario?: Record<string, string> | null;
}

function SelectEtapa({
  funis,
  value,
  onChange,
  testId,
}: {
  funis: Funil[];
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <Select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Funil padrão da empresa</option>
      {funis.map((f) => (
        <optgroup key={f.id} label={f.nome}>
          {f.etapas.map((e) => (
            <option key={e.id} value={e.id}>
              {f.nome} / {e.nome}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function EntradaAnunciosCard() {
  const { data: funis } = useApiQuery<Funil[]>('/funis');
  const { data: cfg, refetch } = useApiQuery<{ entradaAnuncios?: Entrada | null }>(
    '/empresas/config',
  );
  const [ctwa, setCtwa] = useState('');
  const [leadAds, setLeadAds] = useState('');
  const [porForm, setPorForm] = useState<Array<{ formId: string; etapaId: string }>>([]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const e = cfg?.entradaAnuncios ?? {};
    setCtwa(e.ctwaEtapaId ?? '');
    setLeadAds(e.leadAdsEtapaId ?? '');
    setPorForm(
      Object.entries(e.leadAdsPorFormulario ?? {}).map(([formId, etapaId]) => ({ formId, etapaId })),
    );
  }, [cfg]);

  const lista = funis ?? [];

  const salvar = async () => {
    setSalvando(true);
    setMsg(null);
    try {
      const mapa: Record<string, string> = {};
      for (const r of porForm) if (r.formId.trim() && r.etapaId) mapa[r.formId.trim()] = r.etapaId;
      await api.patch('/empresas/config', {
        entradaAnuncios: {
          ctwaEtapaId: ctwa || null,
          leadAdsEtapaId: leadAds || null,
          leadAdsPorFormulario: Object.keys(mapa).length ? mapa : null,
        },
      });
      setMsg('Salvo.');
      refetch();
    } catch (err) {
      setMsg(apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-[10px] p-4" data-testid="entrada-anuncios">
      <h3 className="m-0 text-[15px] font-semibold">Entrada dos leads de anúncio (Meta)</h3>
      <p className="mt-1 mb-3 text-[12px] text-muted">
        Em que etapa o lead nasce quando vem de anúncio. Vazio = funil padrão da empresa.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-[13px]">
          <span className="block mb-1 font-medium">Click-to-WhatsApp</span>
          <SelectEtapa funis={lista} value={ctwa} onChange={setCtwa} testId="entrada-ctwa" />
          <span className="block mt-1 text-[11px] text-muted">
            Use a mesma etapa do “Criar lead” da triagem do WhatsApp.
          </span>
        </label>
        <label className="text-[13px]">
          <span className="block mb-1 font-medium">Lead Ads (padrão)</span>
          <SelectEtapa funis={lista} value={leadAds} onChange={setLeadAds} testId="entrada-leadads" />
        </label>
      </div>

      <div className="mt-3">
        <div className="text-[13px] font-medium mb-1">Lead Ads por formulário (opcional)</div>
        {porForm.map((r, i) => (
          <div key={i} className="flex gap-2 mb-2 items-center">
            <Input
              placeholder="ID do formulário"
              value={r.formId}
              onChange={(e) =>
                setPorForm(porForm.map((x, j) => (j === i ? { ...x, formId: e.target.value } : x)))
              }
              className="max-w-[200px]"
            />
            <SelectEtapa
              funis={lista}
              value={r.etapaId}
              onChange={(v) => setPorForm(porForm.map((x, j) => (j === i ? { ...x, etapaId: v } : x)))}
              testId={`entrada-form-${i}`}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPorForm(porForm.filter((_, j) => j !== i))}
            >
              Remover
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPorForm([...porForm, { formId: '', etapaId: '' }])}
        >
          + formulário
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button data-testid="entrada-salvar" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
        {msg && <span className="text-[12px] text-muted">{msg}</span>}
      </div>
    </div>
  );
}
