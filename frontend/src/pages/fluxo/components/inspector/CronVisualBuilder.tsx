import { useState } from 'react';
import { Input, Select } from '@/components/ui';

/**
 * CronVisualBuilder — construtor visual de 5 colunas pra montar a expressão cron
 * sem decorar sintaxe. Cada campo (minuto/hora/dia-mês/mês/dia-semana) tem um
 * modo: Qualquer (asterisco) / Específico / Intervalo (X-Y) / Passo (a cada N).
 *
 * Seedado a partir de `value` no MOUNT (estado local autoritativo enquanto
 * montado) — o pai re-monta ao alternar pro construtor, então re-seeda sozinho.
 * Cada mudança reconstrói a expressão e chama `onChange`.
 */

type Modo = 'qualquer' | 'especifico' | 'intervalo' | 'passo';

interface Campo {
  modo: Modo;
  valor: string;
  de: string;
  ate: string;
  passo: string;
}

const COLUNAS: Array<{ label: string; hint: string }> = [
  { label: 'Minuto', hint: '0–59' },
  { label: 'Hora', hint: '0–23' },
  { label: 'Dia do mês', hint: '1–31' },
  { label: 'Mês', hint: '1–12' },
  { label: 'Dia da semana', hint: '0=dom … 6=sáb' },
];

function vazio(): Campo {
  return { modo: 'qualquer', valor: '', de: '', ate: '', passo: '' };
}

function parseCampo(raw: string): Campo {
  const r = (raw || '*').trim();
  if (r === '*' || r === '') return vazio();
  const mPasso = r.match(/^\*\/(\d+)$/);
  if (mPasso) return { ...vazio(), modo: 'passo', passo: mPasso[1] };
  const mInt = r.match(/^(\d+)-(\d+)$/);
  if (mInt) return { ...vazio(), modo: 'intervalo', de: mInt[1], ate: mInt[2] };
  return { ...vazio(), modo: 'especifico', valor: r };
}

function buildCampo(c: Campo): string {
  switch (c.modo) {
    case 'passo':
      return `*/${c.passo || '1'}`;
    case 'intervalo':
      return `${c.de || '0'}-${c.ate || '0'}`;
    case 'especifico':
      return c.valor.trim() || '*';
    case 'qualquer':
    default:
      return '*';
  }
}

function seed(value: string): Campo[] {
  const partes = (value || '').trim().split(/\s+/);
  return COLUNAS.map((_, i) => parseCampo(partes[i] ?? '*'));
}

export function CronVisualBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (expr: string) => void;
}) {
  const [campos, setCampos] = useState<Campo[]>(() => seed(value));

  function patch(i: number, patch: Partial<Campo>) {
    const next = campos.map((c, j) => (j === i ? { ...c, ...patch } : c));
    setCampos(next);
    onChange(next.map(buildCampo).join(' '));
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-alt p-2">
      {COLUNAS.map((col, i) => {
        const c = campos[i];
        return (
          <div key={col.label} className="flex items-center gap-1.5">
            <span className="w-[88px] shrink-0 text-[11px] text-text-subtle">{col.label}</span>
            <Select
              size="sm"
              data-testid={`cron-builder-modo-${i}`}
              value={c.modo}
              onChange={(e) => patch(i, { modo: e.target.value as Modo })}
            >
              <option value="qualquer">Qualquer</option>
              <option value="especifico">Específico</option>
              <option value="intervalo">Intervalo</option>
              <option value="passo">A cada (passo)</option>
            </Select>
            {c.modo === 'especifico' && (
              <Input
                data-testid={`cron-builder-valor-${i}`}
                value={c.valor}
                onChange={(e) => patch(i, { valor: e.target.value })}
                placeholder={col.hint}
                className="flex-1"
              />
            )}
            {c.modo === 'intervalo' && (
              <div className="flex items-center gap-1 flex-1">
                <Input
                  type="number"
                  data-testid={`cron-builder-de-${i}`}
                  value={c.de}
                  onChange={(e) => patch(i, { de: e.target.value })}
                  placeholder="de"
                />
                <span className="text-[11px] text-muted">até</span>
                <Input
                  type="number"
                  data-testid={`cron-builder-ate-${i}`}
                  value={c.ate}
                  onChange={(e) => patch(i, { ate: e.target.value })}
                  placeholder="até"
                />
              </div>
            )}
            {c.modo === 'passo' && (
              <Input
                type="number"
                data-testid={`cron-builder-passo-${i}`}
                value={c.passo}
                onChange={(e) => patch(i, { passo: e.target.value })}
                placeholder="N"
                className="flex-1"
              />
            )}
            {c.modo === 'qualquer' && <span className="flex-1 text-[11px] text-muted">(*)</span>}
          </div>
        );
      })}
    </div>
  );
}
