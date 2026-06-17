import { useState } from 'react';
import { Button, Input, Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/** Campo de destinatários do e-mail: usuário / papel / e-mail fixo / variável. */
export function DestinatariosField({
  data,
  onUpdate,
  usuarios,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  usuarios: Array<{ id: string; nome: string; role: string }>;
}) {
  const [novoEmail, setNovoEmail] = useState('');
  const lista = (data.config.destinatarios as string[]) ?? [];
  const PAPEIS = ['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP'];
  const setLista = (next: string[]) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, destinatarios: next } }));
  const add = (tok: string) => {
    const v = tok.trim();
    if (v && !lista.includes(v)) setLista([...lista, v]);
  };
  const rotulo = (tok: string) => {
    if (tok.startsWith('user:')) {
      const u = usuarios.find((x) => x.id === tok.slice(5));
      return u ? `👤 ${u.nome}` : tok;
    }
    if (tok.startsWith('papel:')) return `🏷️ ${tok.slice(6)}`;
    return tok;
  };
  return (
    <Field label="Destinatários" hint="Usuário, papel, e-mail fixo ou {{variável}}">
      <div className="flex flex-col gap-1.5">
        {lista.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lista.map((tok, i) => (
              <span
                key={`${tok}-${i}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border bg-surface"
              >
                {rotulo(tok)}
                <button
                  type="button"
                  aria-label="Remover destinatário"
                  onClick={() => setLista(lista.filter((_, j) => j !== i))}
                  className="text-muted hover:text-danger"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <Select
          size="sm"
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value);
          }}
        >
          <option value="">+ adicionar usuário / papel…</option>
          {usuarios.map((u) => (
            <option key={u.id} value={`user:${u.id}`}>
              👤 {u.nome}
            </option>
          ))}
          {PAPEIS.map((p) => (
            <option key={p} value={`papel:${p}`}>
              🏷️ Papel: {p}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            value={novoEmail}
            onChange={(e) => setNovoEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(novoEmail);
                setNovoEmail('');
              }
            }}
            placeholder="e-mail fixo ou {{variavel}} (Enter)"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              add(novoEmail);
              setNovoEmail('');
            }}
          >
            +
          </Button>
        </div>
      </div>
    </Field>
  );
}
