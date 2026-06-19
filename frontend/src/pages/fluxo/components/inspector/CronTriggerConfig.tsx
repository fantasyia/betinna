import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Input, Select, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import {
  montarCrons,
  traduzirCrons,
  lerHorarios,
  CRON_DIAS,
  CRON_PRESET_DIAS,
  CRON_TIMEZONES,
  CRON_TEMPLATES,
  type CronPreviewResp,
  type CronWizardCfg,
} from '@/pages/fluxo/lib/cron';

/**
 * CronTriggerConfig — config do gatilho "Cron agendado".
 *
 * Modo simples (wizard) cobre: frequências por dia (com MÚLTIPLOS horários),
 * "a cada N min/horas" e "a cada N dentro de uma janela de horário". Modo
 * avançado edita 1 expressão crua. Preview debounced + tradução humana (pt-BR).
 *
 * Canônico no config: `expressoes: string[]` (back-compat com `expressao`).
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
  const horarios = lerHorarios(config as CronWizardCfg);
  const dias = (config.cronDias as string[]) ?? ['1'];
  const diaMes = (config.cronDiaMes as string) ?? '1';
  const intervaloN = (config.cronIntervaloN as number | string) ?? 15;
  const janelaUnidade = (config.cronJanelaUnidade as string) ?? 'min';
  const janelaInicio = (config.cronJanelaInicio as string) ?? '9';
  const janelaFim = (config.cronJanelaFim as string) ?? '18';
  const janelaDias = (config.cronJanelaDias as string) ?? 'dias_uteis';
  const timezone = (config.timezone as string) ?? 'America/Sao_Paulo';
  const expressaoRaw = (config.expressao as string) ?? '';

  // Expressões efetivas (preview/tradução): plural tem precedência; fallback singular.
  const expressoes: string[] =
    (config.expressoes as string[] | undefined)?.filter(Boolean) ??
    (expressaoRaw ? [expressaoRaw] : []);
  const exprKey = expressoes.join('|');

  const [preview, setPreview] = useState<CronPreviewResp | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Inicializa as expressões no modo wizard se ainda não houver.
  useEffect(() => {
    if (!avancado && expressoes.length === 0) {
      const exprs = montarCrons(config as CronWizardCfg);
      onUpdate((d) => ({
        ...d,
        config: { ...d.config, expressoes: exprs, expressao: exprs[0] },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview (debounced) das próximas execuções — manda o ARRAY de expressões.
  useEffect(() => {
    if (expressoes.length === 0) {
      setPreview(null);
      return;
    }
    let cancel = false;
    setCarregando(true);
    const t = setTimeout(() => {
      api
        .post<CronPreviewResp>('/fluxos/cron/preview', { expressoes, timezone })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exprKey, timezone]);

  // Patch do wizard: atualiza o campo E recalcula as expressões.
  function patchWizard(patch: Partial<CronWizardCfg>) {
    onUpdate((d) => {
      const c = { ...d.config, ...patch } as Record<string, unknown>;
      const exprs = montarCrons(c as CronWizardCfg);
      return { ...d, config: { ...c, expressoes: exprs, expressao: exprs[0] } };
    });
  }

  // Aplica um template (preenche o wizard e volta pro modo simples).
  function aplicarTemplate(patch: Partial<CronWizardCfg>) {
    onUpdate((d) => {
      const c = { ...d.config, ...patch, cronAvancado: false } as Record<string, unknown>;
      const exprs = montarCrons(c as CronWizardCfg);
      return { ...d, config: { ...c, expressoes: exprs, expressao: exprs[0] } };
    });
  }

  // Alterna simples↔avançado. Voltar pro simples RECALCULA do wizard (descarta a
  // expressão crua obsoleta — corrige o bug de sync). Entrar no avançado colapsa
  // pra 1 regra (o input edita uma só; múltiplos horários ficam no simples).
  function alternarModo() {
    onUpdate((d) => {
      const indoPraAvancado = d.config.cronAvancado !== true;
      if (indoPraAvancado) {
        const atual =
          (d.config.expressoes as string[] | undefined)?.[0] ??
          (d.config.expressao as string) ??
          montarCrons(d.config as CronWizardCfg)[0];
        return {
          ...d,
          config: { ...d.config, cronAvancado: true, expressoes: [atual], expressao: atual },
        };
      }
      const exprs = montarCrons(d.config as CronWizardCfg);
      return {
        ...d,
        config: { ...d.config, cronAvancado: false, expressoes: exprs, expressao: exprs[0] },
      };
    });
  }

  // ─── Múltiplos horários ────────────────────────────────────────
  const usaHorarios = ['todo_dia', 'dias_uteis', 'fim_de_semana', 'dias_especificos', 'dia_do_mes'].includes(
    freq,
  );
  function setHorario(i: number, value: string) {
    const next = [...horarios];
    next[i] = value;
    patchWizard({ cronHorarios: next });
  }
  function addHorario() {
    patchWizard({ cronHorarios: [...horarios, '12:00'] });
  }
  function removeHorario(i: number) {
    const next = horarios.filter((_, j) => j !== i);
    patchWizard({ cronHorarios: next.length ? next : ['09:00'] });
  }

  const traducao = traduzirCrons(expressoes);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Quando disparar
        </span>
        <button
          type="button"
          data-testid="cron-toggle-modo"
          className="text-[11px] text-primary hover:underline"
          onClick={alternarModo}
        >
          {avancado ? '← Modo simples' : 'Avançado (cron) →'}
        </button>
      </div>

      {!avancado ? (
        <>
          {/* Templates de atalho */}
          <div className="flex flex-wrap gap-1">
            {CRON_TEMPLATES.map((t) => (
              <button
                key={t.l}
                type="button"
                data-testid={`cron-template-${t.l}`}
                onClick={() => aplicarTemplate(t.cfg)}
                className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-bg-alt text-text-subtle hover:border-primary hover:text-primary transition-colors"
              >
                {t.l}
              </button>
            ))}
          </div>

          <Field label="Frequência">
            <Select size="sm" value={freq} onChange={(e) => patchWizard({ cronFreq: e.target.value })}>
              <option value="todo_dia">Todo dia</option>
              <option value="dias_uteis">Dias úteis (seg–sex)</option>
              <option value="fim_de_semana">Fim de semana (sáb/dom)</option>
              <option value="dias_especificos">Dias específicos da semana</option>
              <option value="dia_do_mes">Um dia do mês</option>
              <option value="cada_n_min">A cada N minutos</option>
              <option value="cada_n_horas">A cada N horas</option>
              <option value="intervalo">A cada N, numa janela de horário</option>
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

          {/* "A cada N min / horas" */}
          {(freq === 'cada_n_min' || freq === 'cada_n_horas') && (
            <Field label={freq === 'cada_n_min' ? 'A cada quantos minutos' : 'A cada quantas horas'}>
              <Input
                type="number"
                data-testid="cron-intervalo-n"
                min={1}
                max={freq === 'cada_n_min' ? 59 : 23}
                value={String(intervaloN)}
                onChange={(e) => patchWizard({ cronIntervaloN: e.target.value })}
              />
            </Field>
          )}

          {/* Janela de horário */}
          {freq === 'intervalo' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="A cada">
                  <Input
                    type="number"
                    data-testid="cron-intervalo-n"
                    min={1}
                    max={janelaUnidade === 'horas' ? 23 : 59}
                    value={String(intervaloN)}
                    onChange={(e) => patchWizard({ cronIntervaloN: e.target.value })}
                  />
                </Field>
                <Field label="Unidade">
                  <Select
                    size="sm"
                    value={janelaUnidade}
                    onChange={(e) => patchWizard({ cronJanelaUnidade: e.target.value })}
                  >
                    <option value="min">minutos</option>
                    <option value="horas">horas</option>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Das (hora)" hint="0–23">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={janelaInicio}
                    onChange={(e) => patchWizard({ cronJanelaInicio: e.target.value })}
                  />
                </Field>
                <Field label="Até (hora)" hint="0–23">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={janelaFim}
                    onChange={(e) => patchWizard({ cronJanelaFim: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Em quais dias">
                <Select
                  size="sm"
                  value={janelaDias}
                  onChange={(e) => patchWizard({ cronJanelaDias: e.target.value })}
                >
                  {CRON_PRESET_DIAS.map((p) => (
                    <option key={p.v} value={p.v}>
                      {p.l}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {/* Horário(s) — múltiplos pra frequências por dia */}
          {usaHorarios && (
            <Field label={horarios.length > 1 ? 'Horários' : 'Horário'}>
              <div className="flex flex-col gap-1.5">
                {horarios.map((h, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      type="time"
                      data-testid={`cron-horario-${i}`}
                      value={h}
                      onChange={(e) => setHorario(i, e.target.value)}
                    />
                    {horarios.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remover horário"
                        data-testid={`cron-horario-remove-${i}`}
                        onClick={() => removeHorario(i)}
                        className="text-[12px] text-muted hover:text-danger px-1.5 py-1 rounded-md border border-border hover:border-danger/50 transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  data-testid="cron-horario-add"
                  onClick={addHorario}
                  className="self-start text-[11px] text-primary hover:underline"
                >
                  + adicionar horário
                </button>
              </div>
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label="Expressão cron" hint="Ex: 0 9 * * 1-5 (9h, dias úteis) · */15 * * * * (a cada 15min)">
            <Input
              value={expressaoRaw}
              data-testid="cron-expressao-raw"
              onChange={(e) =>
                onUpdate((d) => ({
                  ...d,
                  config: {
                    ...d.config,
                    expressao: e.target.value,
                    expressoes: e.target.value.trim() ? [e.target.value] : [],
                  },
                }))
              }
              placeholder="min hora dia mês dia-semana"
            />
          </Field>
          {((config.cronHorarios as string[] | undefined)?.length ?? 0) > 1 && (
            <p className="text-[10px] text-warning -mt-1.5">
              O modo simples tinha {(config.cronHorarios as string[]).length} horários — aqui você
              edita 1 regra. Volte pro simples pra manter os vários.
            </p>
          )}
        </>
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

      {/* Tradução humana */}
      {traducao && preview?.valido !== false && (
        <div
          className="rounded-md border border-border bg-bg-alt p-2 text-[11px] text-text"
          data-testid="cron-traducao"
        >
          <span className="text-muted">O que isso faz: </span>
          {traducao}
        </div>
      )}

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
          <p className="text-[11px] text-danger" data-testid="cron-erro">
            ⚠ {preview.erro ?? 'Expressão inválida'}
          </p>
        ) : (
          <p className="text-[11px] text-muted">Defina a frequência acima.</p>
        )}
      </div>
      <p className="text-[10px] text-muted">
        O fluxo precisa estar <strong>Ativo</strong> pra rodar no horário. Precisão de ~1 minuto.
      </p>
    </div>
  );
}
