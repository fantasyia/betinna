import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { StateView } from '@/components/StateView';
import { Card, Field, Input, Select } from '@/components/ui';
import {
  dataBr,
  hojeIso,
  intervaloPadrao,
  type Agrupar,
  type Fluxo,
  type PorContato,
} from './tipos';

/** Cartão de total do topo (mesmo das abas A receber / A pagar). */
export function Total({
  rotulo,
  v,
  tom,
  detalhe,
}: {
  rotulo: string;
  v: number | undefined;
  tom?: 'danger' | 'success';
  detalhe?: string;
}) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{rotulo}</div>
      <b
        className={cn(
          'text-xl tabular-nums',
          tom === 'danger' && v ? 'text-danger' : '',
          tom === 'success' ? 'text-success' : '',
        )}
      >
        {v === undefined ? '—' : formatMoeda(v)}
      </b>
      {detalhe && <div className="mt-0.5 text-xs text-muted">{detalhe}</div>}
    </Card>
  );
}

const ROTULO_AGRUPAR: Record<Agrupar, string> = { dia: 'Dia', semana: 'Semana', mes: 'Mês' };

/**
 * Fluxo de caixa: saldo atual das contas, vencidos em destaque e, por
 * período, o realizado (entrou/saiu) e o previsto (a entrar/a sair), com o
 * saldo projetado se tudo o que vence acontecer.
 */
export function FluxoCaixa() {
  const hoje = hojeIso();
  const [agrupar, setAgrupar] = useState<Agrupar>('semana');
  const [intervalo, setIntervalo] = useState(() => intervaloPadrao('semana', hoje));
  const qs = new URLSearchParams({ agrupar, de: intervalo.de, ate: intervalo.ate });
  const q = useApiQuery<Fluxo>(`/financeiro/fluxo?${qs.toString()}`);
  const f = q.data;

  return (
    <div className="flex flex-col gap-4" data-testid="fin-fluxo">
      <div className="grid gap-3 sm:grid-cols-3">
        <Total
          rotulo="Saldo atual nas contas"
          v={f?.saldoAtual}
          detalhe={f?.contas.map((c) => `${c.nome} ${formatMoeda(c.saldo)}`).join(' · ')}
        />
        <Total
          rotulo="Vencido a receber"
          v={f?.vencidos.aReceber}
          tom="danger"
          detalhe="Cliente atrasado"
        />
        <Total
          rotulo="Vencido a pagar"
          v={f?.vencidos.aPagar}
          tom="danger"
          detalhe="Nós atrasados"
        />
      </div>

      <Card className="p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Ver por" className="w-32">
            <Select
              value={agrupar}
              onChange={(e) => {
                const a = e.target.value as Agrupar;
                setAgrupar(a);
                setIntervalo(intervaloPadrao(a, hoje));
              }}
              data-testid="fin-fluxo-agrupar"
            >
              {(Object.keys(ROTULO_AGRUPAR) as Agrupar[]).map((a) => (
                <option key={a} value={a}>
                  {ROTULO_AGRUPAR[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="De" className="w-40">
            <Input
              type="date"
              value={intervalo.de}
              onChange={(e) => setIntervalo((i) => ({ ...i, de: e.target.value }))}
            />
          </Field>
          <Field label="até" className="w-40">
            <Input
              type="date"
              value={intervalo.ate}
              onChange={(e) => setIntervalo((i) => ({ ...i, ate: e.target.value }))}
            />
          </Field>
          <p className="ml-auto max-w-sm text-xs text-muted">
            Entrou/saiu = o que já foi baixado. A entrar/a sair = o que vence de hoje em diante. O
            saldo projetado soma o previsto ao saldo de hoje (o vencido fica de fora, nos cartões
            acima).
          </p>
        </div>

        <StateView loading={q.loading && !q.data} error={q.error} onRetry={q.refetch}>
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[720px] text-sm tabular-nums"
              data-testid="fin-fluxo-tabela"
            >
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">Período</th>
                  <th className="py-2 text-right font-medium">Entrou</th>
                  <th className="py-2 text-right font-medium">Saiu</th>
                  <th className="py-2 text-right font-medium">A entrar</th>
                  <th className="py-2 text-right font-medium">A sair</th>
                  <th className="py-2 text-right font-medium">Saldo projetado</th>
                </tr>
              </thead>
              <tbody>
                {(f?.linhas ?? []).map((l) => (
                  <tr
                    key={l.inicio}
                    className={cn('border-t border-border', l.atual && 'bg-primary/5 font-medium')}
                    data-atual={l.atual || undefined}
                  >
                    <td className="py-1.5">
                      {l.rotulo}
                      {l.atual && <span className="ml-2 text-xs text-primary">agora</span>}
                    </td>
                    <Valor v={l.entrou} tom="success" />
                    <Valor v={l.saiu} tom="danger" />
                    <Valor v={l.aEntrar} />
                    <Valor v={l.aSair} />
                    <td
                      className={cn(
                        'py-1.5 text-right',
                        l.saldoProjetado !== null && l.saldoProjetado < 0 && 'text-danger',
                      )}
                    >
                      {l.saldoProjetado === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        formatMoeda(l.saldoProjetado)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateView>
      </Card>
    </div>
  );
}

function Valor({ v, tom }: { v: number; tom?: 'success' | 'danger' }) {
  return (
    <td
      className={cn(
        'py-1.5 text-right',
        !v && 'text-muted',
        v && tom === 'success' && 'text-success',
        v && tom === 'danger' && 'text-danger',
      )}
    >
      {v ? formatMoeda(v) : '—'}
    </td>
  );
}

/** Quanto cada cliente deve (a receber) / quanto devemos a cada um (a pagar). */
export function PorContatoView({
  onAbrir,
}: {
  onAbrir: (tipo: 'RECEBER' | 'PAGAR', contato: string) => void;
}) {
  const [tipo, setTipo] = useState<'RECEBER' | 'PAGAR'>('RECEBER');
  const q = useApiQuery<PorContato[]>(`/financeiro/por-contato?tipo=${tipo}`);
  const lista = q.data ?? [];
  const total = lista.reduce((s, c) => s + c.emAberto, 0);

  return (
    <Card className="p-4 flex flex-col gap-3" data-testid="fin-contatos">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mostrar" className="w-56">
          <Select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as 'RECEBER' | 'PAGAR')}
            data-testid="fin-contatos-tipo"
          >
            <option value="RECEBER">Quem nos deve (a receber)</option>
            <option value="PAGAR">A quem devemos (a pagar)</option>
          </Select>
        </Field>
        <div className="ml-auto text-sm text-muted">
          Total em aberto: <b className="text-text tabular-nums">{formatMoeda(total)}</b>
        </div>
      </div>
      <StateView loading={q.loading && !q.data} error={q.error} onRetry={q.refetch}>
        {lista.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nada em aberto.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">
                    {tipo === 'RECEBER' ? 'Cliente' : 'Facção / fornecedor'}
                  </th>
                  <th className="py-2 text-right font-medium">Em aberto</th>
                  <th className="py-2 text-right font-medium">Vencido</th>
                  <th className="py-2 text-right font-medium">Lançamentos</th>
                  <th className="py-2 text-right font-medium">Próximo vencimento</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr
                    key={c.contato ?? '(sem)'}
                    className={cn(
                      'border-t border-border',
                      c.contato && 'cursor-pointer hover:bg-surface-2',
                    )}
                    onClick={() => c.contato && onAbrir(tipo, c.contato)}
                    title={c.contato ? 'Ver os lançamentos deste contato' : undefined}
                  >
                    <td className="py-1.5">
                      {c.contato ?? <span className="text-muted">Sem contato</span>}
                    </td>
                    <td className="py-1.5 text-right font-medium">{formatMoeda(c.emAberto)}</td>
                    <td
                      className={cn('py-1.5 text-right', c.vencido ? 'text-danger' : 'text-muted')}
                    >
                      {c.vencido ? formatMoeda(c.vencido) : '—'}
                    </td>
                    <td className="py-1.5 text-right">{c.titulos}</td>
                    <td className="py-1.5 text-right">{dataBr(c.proximoVencimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StateView>
    </Card>
  );
}
