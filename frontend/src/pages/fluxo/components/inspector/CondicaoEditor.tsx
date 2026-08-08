import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/toast';
import { Button, IconButton, Input, Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import { RESERVADOS, norm } from '@/pages/fluxo/lib/saidas';

/**
 * Linha editável de uma saída do roteador. Renomeia in-place (commit no Enter/blur);
 * se o pai rejeitar (duplicado/reservado), reverte o texto pro valor anterior.
 */
function SaidaEditavel({
  valor,
  onCommit,
  onRemove,
}: {
  valor: string;
  onCommit: (novo: string) => boolean;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(valor);
  useEffect(() => {
    setDraft(valor);
  }, [valor]);
  const commit = () => {
    const v = draft.trim();
    if (!v || v === valor) {
      setDraft(valor);
      return;
    }
    if (!onCommit(v)) setDraft(valor);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="flex-1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(valor);
          }
        }}
      />
      <IconButton
        aria-label="Remover saída"
        variant="ghost"
        size="sm"
        icon={<Trash2 />}
        onClick={onRemove}
      />
    </div>
  );
}

/**
 * Editor visual da Condição: modo Simples (true/false) ou Roteador (N saídas).
 *
 * ⚠️ FRONTEIRA: este editor mexe em SAÍDAS, que afetam ARESTAS. Por isso usa os
 * callbacks edge-aware (onRemoveSaida/onRenameSaida/onChangeModo) — NÃO onUpdate —
 * pra saída e modo. Só `variavel`/`campo`/`operador`/`valor` (config-only) vão por
 * onUpdate. Misturar reintroduz arestas órfãs.
 */
export function CondicaoEditor({
  data,
  onUpdate,
  variaveis,
  etapasOpts,
  onRemoveSaida,
  onRenameSaida,
  onChangeModo,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  variaveis: Array<{ id: string; chave: string }>;
  /** Etapas de todos os funis — pro seletor quando o campo é `lead.etapa_id`. */
  etapasOpts: Array<{ id: string; label: string }>;
  onRemoveSaida: (valor: string) => void;
  onRenameSaida: (antigo: string, novo: string) => void;
  onChangeModo: (novoModo: string) => void;
}) {
  const toast = useToast();
  const [novaSaida, setNovaSaida] = useState('');
  const modo = (data.config.modo as string) ?? 'simples';
  const saidas = (data.config.saidas as string[]) ?? [];
  const campo = (data.config.campo as string) ?? '';
  const valorAtual = ((data.config.valor as string | number | undefined) ?? '').toString();
  // `lead.etapa_id`/`funil_id` guardam ID: o valor vira dropdown (grava id, mostra
  // nome) em vez de texto livre — é o que impede alguém digitar o NOME de novo.
  const ehCampoEtapa = campo === 'lead.etapa_id' || campo === 'lead.funil_id';
  const setCfg = (patch: Record<string, unknown>) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, ...patch } }));
  // RESERVADOS / norm vêm do contrato central em @/pages/fluxo/lib/saidas.
  const valido = (v: string, ignorar?: string): boolean => {
    if (saidas.some((s) => s !== ignorar && norm(s) === norm(v))) {
      toast.error('Essa saída já existe (ignorando maiúsculas/espaços)');
      return false;
    }
    if (RESERVADOS.includes(norm(v))) {
      toast.error(`"${v}" é um nome reservado — escolha outro valor pra saída`);
      return false;
    }
    return true;
  };
  const addSaida = () => {
    const v = novaSaida.trim();
    if (!v || !valido(v)) return;
    setCfg({ saidas: [...saidas, v] });
    setNovaSaida('');
  };
  // Renomeia in-place (config + arestas via callback do pai). Retorna se aplicou —
  // a linha editável reverte o texto quando rejeitado (duplicado/reservado).
  const handleRename = (antigo: string, novo: string): boolean => {
    const v = novo.trim();
    if (!v || v === antigo) return false;
    if (!valido(v, antigo)) return false;
    onRenameSaida(antigo, v);
    return true;
  };
  return (
    <>
      <Field label="Modo">
        <Select size="sm" value={modo} onChange={(e) => onChangeModo(e.target.value)}>
          <option value="simples">Simples (Sim / Não)</option>
          <option value="roteador">Roteador (uma saída por valor)</option>
        </Select>
      </Field>
      {modo === 'roteador' ? (
        <>
          <Field
            label="Variável"
            hint="Roteia pelo valor desta variável (ex: classificacao_final)"
          >
            <div>
              <Input
                list="fluxo-variaveis"
                value={(data.config.variavel as string) ?? ''}
                onChange={(e) => setCfg({ variavel: e.target.value })}
                placeholder="classificacao_final"
              />
              <datalist id="fluxo-variaveis">
                {variaveis.map((v) => (
                  <option key={v.id} value={v.chave} />
                ))}
              </datalist>
            </div>
          </Field>
          <Field label="Saídas (valores)" hint="Cada valor vira uma saída. Há sempre a saída 'default'.">
            <div className="flex flex-col gap-1.5">
              {saidas.map((s, i) => (
                <SaidaEditavel
                  key={`${s}-${i}`}
                  valor={s}
                  onCommit={(novo) => handleRename(s, novo)}
                  onRemove={() => onRemoveSaida(s)}
                />
              ))}
              <div className="flex items-center gap-1.5">
                <Input
                  value={novaSaida}
                  onChange={(e) => setNovaSaida(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSaida();
                    }
                  }}
                  placeholder="Ex: Forte Sinergia (Enter)"
                />
                <Button type="button" size="sm" variant="secondary" onClick={addSaida}>
                  +
                </Button>
              </div>
              <span className="text-[11px] text-muted">
                No canvas, conecte cada saída (o rótulo do valor) ao próximo nó.
              </span>
            </div>
          </Field>
        </>
      ) : (
        <>
          <Field
            label="Variável / campo"
            hint="Ex: classificacao_final, lead.tags, lead.etapa_id"
          >
            <div>
              <Input
                list="fluxo-variaveis"
                value={campo}
                onChange={(e) => setCfg({ campo: e.target.value })}
                placeholder="classificacao_final"
              />
              <datalist id="fluxo-variaveis">
                {/* Campos do lead que o motor entende — sem isso a única forma de
                    descobrir era tentativa e erro. `etapa_id` vem antes de
                    `etapa_atual` de propósito: é o estável. */}
                <option value="lead.etapa_id" />
                <option value="lead.funil_id" />
                <option value="lead.tags" />
                <option value="lead.etapa_atual" />
                <option value="lead.segmento" />
                <option value="lead.uf" />
                <option value="lead.cidade" />
                <option value="lead.score" />
                {variaveis.map((v) => (
                  <option key={v.id} value={v.chave} />
                ))}
              </datalist>
            </div>
          </Field>

          {/* Renomear etapa NÃO quebra quem compara por id — mas quebra quem compara
              por nome, e em silêncio. Avisa e oferece a troca com 1 clique. */}
          {campo === 'lead.etapa_atual' && (
            <p className="text-[11px] text-warning -mt-1">
              ⚠️ Comparar a etapa pelo <strong>nome</strong> quebra em silêncio se alguém
              renomear a etapa.{' '}
              <button
                type="button"
                className="underline hover:text-text"
                onClick={() => setCfg({ campo: 'lead.etapa_id', valor: '' })}
                data-testid="condicao-trocar-para-etapa-id"
              >
                Usar lead.etapa_id
              </button>{' '}
              (estável).
            </p>
          )}
          <Field label="Operador">
            <Select
              size="sm"
              value={(data.config.operador as string) ?? 'eq'}
              onChange={(e) => setCfg({ operador: e.target.value })}
            >
              <option value="eq">= igual</option>
              <option value="neq">≠ diferente</option>
              <option value="contains">contém</option>
              <option value="gt">&gt; maior</option>
              <option value="lt">&lt; menor</option>
              <option value="gte">≥ maior ou igual</option>
              <option value="lte">≤ menor ou igual</option>
            </Select>
          </Field>
          <Field
            label="Valor"
            hint={ehCampoEtapa ? 'Escolha a etapa — grava o id, que não muda se renomearem' : undefined}
          >
            {ehCampoEtapa ? (
              <Select
                size="sm"
                value={valorAtual}
                onChange={(e) => setCfg({ valor: e.target.value })}
                data-testid="condicao-valor-etapa"
              >
                <option value="">— escolha a etapa —</option>
                {etapasOpts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={valorAtual} onChange={(e) => setCfg({ valor: e.target.value })} />
            )}
          </Field>
        </>
      )}
    </>
  );
}
