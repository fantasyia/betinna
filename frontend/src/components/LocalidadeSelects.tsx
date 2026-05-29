import { useEffect, useState } from 'react';
import { Select } from '@/components/ui';
import { fetchEstados, fetchMunicipios, type Estado } from '@/lib/localidades';

/**
 * CL4 (Lote 7) — Selects de UF e Cidade baseados na lista oficial do IBGE.
 *
 * - UfSelect: as 27 UFs (impossível digitar inválido).
 * - CidadeSelect: municípios da UF escolhida (carregados sob demanda).
 *
 * Ambos preservam um valor "legado" que não esteja na lista (ex: dado antigo
 * importado do OMIE) adicionando-o como opção, pra nunca apagar o que já existe.
 */

interface UfSelectProps {
  value: string;
  onChange: (uf: string) => void;
  id?: string;
  testId?: string;
  disabled?: boolean;
  error?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function UfSelect({ value, onChange, id, testId, disabled, error, size }: UfSelectProps) {
  const [estados, setEstados] = useState<Estado[]>([]);

  useEffect(() => {
    let active = true;
    void fetchEstados().then((e) => {
      if (active) setEstados(e);
    });
    return () => {
      active = false;
    };
  }, []);

  const conhecida = estados.some((e) => e.sigla === value);

  return (
    <Select
      id={id}
      data-testid={testId}
      value={value}
      disabled={disabled}
      error={error}
      size={size}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">UF</option>
      {/* preserva valor legado fora da lista oficial */}
      {value && !conhecida && <option value={value}>{value}</option>}
      {estados.map((e) => (
        <option key={e.sigla} value={e.sigla}>
          {e.sigla}
        </option>
      ))}
    </Select>
  );
}

interface CidadeSelectProps {
  uf: string;
  value: string;
  onChange: (cidade: string) => void;
  id?: string;
  testId?: string;
  disabled?: boolean;
  error?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function CidadeSelect({
  uf,
  value,
  onChange,
  id,
  testId,
  disabled,
  error,
  size,
}: CidadeSelectProps) {
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!uf || uf.trim().length !== 2) {
      setMunicipios([]);
      return;
    }
    setLoading(true);
    void fetchMunicipios(uf)
      .then((m) => {
        if (active) setMunicipios(m);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [uf]);

  const semUf = !uf || uf.trim().length !== 2;
  const conhecida = municipios.includes(value);

  return (
    <Select
      id={id}
      data-testid={testId}
      value={value}
      disabled={disabled || semUf}
      error={error}
      size={size}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {semUf ? 'Escolha a UF primeiro' : loading ? 'Carregando cidades…' : 'Selecione a cidade'}
      </option>
      {/* preserva valor legado fora da lista oficial */}
      {value && !conhecida && <option value={value}>{value}</option>}
      {municipios.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </Select>
  );
}
