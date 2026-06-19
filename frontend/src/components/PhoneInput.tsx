import { useEffect, useRef, useState } from 'react';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * PhoneInput — campo de telefone INTERNACIONAL: seletor de país (bandeira + DDI)
 * + número nacional. Emite o valor em E.164 (`+<DDI><número>`) via `onChange`.
 *
 * Multi-país (atendemos clientes de qualquer lugar). O país é detectado ao
 * carregar um E.164 existente; default Brasil pra cadastro novo.
 */

/** Emoji da bandeira a partir do ISO-2 (sem asset — usa regional indicators). */
function bandeira(cc: string): string {
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Países comuns no topo; o resto em ordem de ISO. */
const COMUNS: CountryCode[] = ['BR', 'US', 'PT', 'AR', 'CL', 'CO', 'MX', 'ES', 'PY', 'UY'];

const PAISES: Array<{ cc: CountryCode; ddi: string; flag: string }> = (() => {
  const todos = getCountries();
  const mk = (cc: CountryCode) => ({ cc, ddi: getCountryCallingCode(cc), flag: bandeira(cc) });
  const comuns = COMUNS.filter((c) => todos.includes(c)).map(mk);
  const resto = todos
    .filter((c) => !COMUNS.includes(c))
    .sort()
    .map(mk);
  return [...comuns, ...resto];
})();

export function PhoneInput({
  value,
  onChange,
  testId,
  required,
}: {
  value: string;
  onChange: (e164: string) => void;
  testId?: string;
  required?: boolean;
}) {
  const [pais, setPais] = useState<CountryCode>('BR');
  const [nacional, setNacional] = useState('');
  const emitido = useRef<string>('');

  // Sincroniza com o `value` externo (carga/edição) sem atropelar a digitação.
  useEffect(() => {
    if ((value ?? '') === emitido.current) return;
    const p = value ? parsePhoneNumberFromString(value) : null;
    if (p) {
      setPais(p.country ?? 'BR');
      setNacional(p.formatNational());
    } else {
      setNacional(value ?? '');
    }
    emitido.current = value ?? '';
  }, [value]);

  function emitir(p: CountryCode, nacRaw: string) {
    const digits = nacRaw.replace(/\D/g, '');
    let e164 = '';
    if (digits) {
      const tel = parsePhoneNumberFromString(digits, p);
      e164 = tel ? tel.number : `+${getCountryCallingCode(p)}${digits}`;
    }
    emitido.current = e164;
    onChange(e164);
  }

  return (
    <div className="flex gap-1.5">
      <select
        data-testid={testId ? `${testId}-pais` : undefined}
        value={pais}
        onChange={(e) => {
          const p = e.target.value as CountryCode;
          setPais(p);
          emitir(p, nacional);
        }}
        aria-label="País (código do país)"
        className={cn(
          'shrink-0 w-[96px] rounded-md border border-border bg-surface px-2 text-sm text-text',
          'cursor-pointer focus:outline-none focus:border-primary',
        )}
      >
        {PAISES.map((p) => (
          <option key={p.cc} value={p.cc}>
            {p.flag} +{p.ddi}
          </option>
        ))}
      </select>
      <Input
        data-testid={testId}
        value={nacional}
        onChange={(e) => {
          const fmt = new AsYouType(pais).input(e.target.value);
          setNacional(fmt);
          emitir(pais, fmt);
        }}
        placeholder="número"
        inputMode="tel"
        required={required}
        className="flex-1"
      />
    </div>
  );
}
