import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Input, Select, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import { montarCron, CRON_DIAS, CRON_TIMEZONES, type CronPreviewResp } from '@/pages/fluxo/lib/cron';

/**
 * CronTriggerConfig — config do gatilho "Cron agendado" (SPEC 1).
 *
 * Wizard amigável (frequência/horário) que monta a expressão cron, OU modo
 * avançado (expressão crua). Faz preview debounced das próximas execuções.
 * montarCron / CRON_DIAS / CRON_TIMEZONES / CronPreviewResp → @/pages/fluxo/lib/cron
 */
export function CronTriggerConfig({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  const avancado = config.cronAvancado === true;
  const freq = (config.cronFreq as string) ?? 'dias_uteis';
  const horario = (config.cronHorario as string) ?? '09:00';
  const dias = (config.cronDias as string[]) ?? ['1'];
  const diaMes = (config.cronDiaMes as string) ?? '1';
  const timezone = (config.timezone as string) ?? 'America/Sao_Paulo';
  const expressao = (config.expressao as string) ?? '';

  const [preview, setPreview] = useState<CronPreviewResp | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Inicializa a expressão no modo wizard se ainda não houver.
  useEffect(() => {
    if (!avancado && !expressao.trim()) {
      onUpdate((d) => ({
        ...d,
        config: { ...d.config, expressao: montarCron(freq, horario, dias, diaMes) },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview (debounced) das próximas execuções.
  useEffect(() => {
    if (!expressao.trim()) {
      setPreview(null);
      return;
    }
    let cancel = false;
    setCarregando(true);
    const t = setTimeout(() => {
      api
        .post<CronPreviewResp>('/fluxos/cron/preview', { expressao, timezone })
        .then((r) => {
          if (!cancel) setPreview(r);
        })
        .catch(() => {
          if (!cancel) setPreview({ valido: false, erro: 'Falha ao validar', proximas: [] });
        })
        .finally(() => {
          if (!cancel) setCarregando(false);
        });
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [expressao, timezone]);

  // Patch do wizard: atualiza o campo E recalcula a expressão.
  function patchWizard(patch: Record<string, unknown>) {
    onUpdate((d) => {
      const c = { ...d.config, ...patch };
      const expr = montarCron(
        (c.cronFreq as string) ?? freq,
        (c.cronHorario as string) ?? horario,
        (c.cronDias as string[]) ?? dias,
        (c.cronDiaMes as string) ?? diaMes,
      );
      return { ...d, config: { ...c, expressao: expr } };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Quando disparar
        </span>
        <button
          type="button"
          className="text-[11px] text-primary hover:underline"
          onClick={() => onUpdate((d) => ({ ...d, config: { ...d.config, cronAvancado: !avancado } }))}
        >
          {avancado ? '← Modo simples' : 'Avançado (cron) →'}
        </button>
      </div>

      {!avancado ? (
        <>
          <Field label="Frequência">
            <Select size="sm" value={freq} onChange={(e) => patchWizard({ cronFreq: e.target.value })}>
              <option value="todo_dia">Todo dia</option>
              <option value="dias_uteis">Dias úteis (seg–sex)</option>
              <option value="fim_de_semana">Fim de semana (sáb/dom)</option>
              <option value="dias_especificos">Dias específicos da semana</option>
              <option value="dia_do_mes">Um dia do mês</option>
            </Select>
          </Field>
          {freq === 'dias_especificos' && (
            <Field label="Dias da semana">
              <div className="flex flex-wrap gap-1">
                {CRON_DIAS.map((d) => {
                  const sel = dias.includes(d.v);
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() =>
                        patchWizard({
                          cronDias: sel ? dias.filter((x) => x !== d.v) : [...dias, d.v],
                        })
                      }
                      className={cn(
                        'text-[11px] px-2 py-1 rounded-md border transition-colors',
                        sel
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface text-text border-border hover:border-border-strong',
                      )}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          {freq === 'dia_do_mes' && (
            <Field label="Dia do mês" hint="1 a 31">
              <Input
                type="number"
                min={1}
                max={31}
                value={diaMes}
                onChange={(e) => patchWizard({ cronDiaMes: e.target.value })}
              />
            </Field>
          )}
          <Field label="Horário">
            <Input
              type="time"
              value={horario}
              onChange={(e) => patchWizard({ cronHorario: e.target.value })}
            />
          </Field>
        </>
      ) : (
        <Field label="Expressão cron" hint="Ex: 0 9 * * 1-5 (9h, dias úteis) · */15 * * * * (a cada 15min)">
          <Input
            value={expressao}
            onChange={(e) =>
              onUpdate((d) => ({ ...d, config: { ...d.config, expressao: e.target.value } }))
            }
            placeholder="min hora dia mês dia-semana"
          />
        </Field>
      )}

      <Field label="Fuso horário">
        <Select
          size="sm"
          value={timezone}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, timezone: e.target.value } }))
          }
        >
          {CRON_TIMEZONES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.l}
            </option>
          ))}
        </Select>
      </Field>

      {/* Preview das próximas execuções */}
      <div className="rounded-md border border-border bg-bg-alt p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">
          Próximas execuções
        </div>
        {carregando ? (
          <p className="text-[11px] text-muted">Calculando…</p>
        ) : preview?.valido ? (
          <ul className="flex flex-col gap-0.5">
            {preview.proximas.map((p) => (
              <li key={p.iso} className="text-[11px] text-text tabular">
                🕘 {p.label}
              </li>
            ))}
          </ul>
        ) : preview ? (
          <p className="text-[11px] text-danger">⚠ {preview.erro ?? 'Expressão inválida'}</p>
        ) : (
          <p className="text-[11px] text-muted">Defina a frequência acima.</p>
        )}
      </div>
      <p className="text-[10px] text-muted">
        O fluxo precisa estar <strong>Ativo</strong> pra rodar no horário. Latência de até ~30min.
      </p>
    </div>
  );
}
