import { useRef, useState } from 'react';
import { AlertCircle, Mail } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { isValidCNPJ, maskCEP, maskCNPJ, stripMask } from '@/lib/masks';
import { PhoneInput } from '@/components/PhoneInput';
import { fetchCep } from '@/lib/localidades';
import { UfSelect, CidadeSelect } from '@/components/LocalidadeSelects';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';

/**
 * Cadastro de cliente (criar/editar) — saiu da ClientesPage em 24/09 pra ser
 * usado também no LEVANTAMENTO: o rep está no cliente, e o contrato não sai sem
 * CNPJ e endereço completos. Mandar o rep pra outra tela no meio da medição era
 * o jeito de o endereço ficar pra depois — e o contrato, junto.
 */

export type ClienteStatus = 'ATIVO' | 'NOVO' | 'PROSPECT' | 'RISCO' | 'CRITICO' | 'INATIVO';
export type ERPStatus = 'ATIVO' | 'BLOQUEADO';

export const STATUS_LABEL: Record<ClienteStatus, string> = {
  ATIVO: 'Ativo',
  NOVO: 'Novo',
  PROSPECT: 'Prospect',
  RISCO: 'Em risco',
  CRITICO: 'Crítico',
  INATIVO: 'Inativo',
};

/** O que o formulário lê e grava do cliente. */
export interface ClienteCadastro {
  id: string;
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  status?: ClienteStatus;
  erpStatus?: ERPStatus;
}

interface FormState {
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  segmento: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  status: ClienteStatus;
  erpStatus: ERPStatus;
  prazoPagamento: number;
}

/** Resposta de GET /clientes/cnpj/:cnpj/lookup (dados públicos da Receita). */
interface CnpjLookup {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  telefone: string | null;
}

function emptyForm(c?: ClienteCadastro | null): FormState {
  const cc = c ?? ({} as ClienteCadastro);
  return {
    nome: cc.nome ?? '',
    cnpj: cc.cnpj ?? '',
    email: cc.email ?? '',
    telefone: cc.telefone ?? '',
    segmento: cc.segmento ?? '',
    cep: cc.cep ?? '',
    endereco: cc.endereco ?? '',
    numero: cc.numero ?? '',
    complemento: cc.complemento ?? '',
    bairro: cc.bairro ?? '',
    cidade: cc.cidade ?? '',
    uf: cc.uf ?? '',
    status: cc.status ?? 'NOVO',
    erpStatus: cc.erpStatus ?? 'ATIVO',
    prazoPagamento: 30,
  };
}

export function ClienteFormModal({
  open,
  cliente,
  onClose,
  onSaved,
  onUsarExistente,
}: {
  open: boolean;
  cliente: ClienteCadastro | null;
  onClose: () => void;
  /** Recebe o cadastro como ficou salvo — quem abriu pode seguir com ele. */
  onSaved: (salvo: ClienteCadastro) => void;
  /**
   * CNPJ que JÁ está cadastrado: em vez de recusar no fim (o backend não deixa
   * duplicar), a tela avisa na hora e, se quem abriu souber usar o cadastro
   * existente, oferece o botão. Sem isto, o formulário só mostra o aviso.
   */
  onUsarExistente?: (existente: ClienteCadastro) => void;
}) {
  const isEdit = Boolean(cliente);
  const [form, setForm] = useState<FormState>(emptyForm(cliente));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Auto-preenche razão social + endereço pela Receita (BrasilAPI) ao sair do
  // campo CNPJ. NÃO mexe em e-mail/telefone (dados da Receita ficam desatualizados).
  const [cnpjBusy, setCnpjBusy] = useState(false);
  const [existente, setExistente] = useState<ClienteCadastro | null>(null);
  const ultimoCnpjBuscado = useRef<string>('');
  async function preencherPorCnpj() {
    const digitos = stripMask(form.cnpj);
    if (!isValidCNPJ(form.cnpj) || digitos === ultimoCnpjBuscado.current) return;
    ultimoCnpjBuscado.current = digitos;
    setCnpjBusy(true);
    setError(null);
    setExistente(null);
    try {
      // Antes da Receita, o NOSSO cadastro: se o CNPJ já existe, preencher tudo
      // de novo só pra o backend recusar a duplicata no fim é trabalho jogado fora.
      if (!isEdit) {
        const achados = await api.get<{ data: ClienteCadastro[] }>(
          `/clientes?search=${digitos}&limit=5`,
        );
        const mesmo = (achados.data ?? []).find((c) => stripMask(c.cnpj ?? '') === digitos);
        if (mesmo) {
          setExistente(mesmo);
          return;
        }
      }
      const r = await api.get<CnpjLookup>(`/clientes/cnpj/${digitos}/lookup`);
      setForm((f) => ({
        ...f,
        nome: f.nome.trim() ? f.nome : r.razaoSocial,
        endereco: r.endereco ?? f.endereco,
        numero: r.numero ?? f.numero,
        complemento: r.complemento ?? f.complemento,
        bairro: r.bairro ?? f.bairro,
        cidade: r.cidade ?? f.cidade,
        uf: r.uf ?? f.uf,
        cep: r.cep ? maskCEP(r.cep) : f.cep,
      }));
    } catch (err) {
      ultimoCnpjBuscado.current = ''; // permite retentar após falha (ex: rate-limit)
      setError(apiErrorMessage(err));
    } finally {
      setCnpjBusy(false);
    }
  }

  // CL4 — ao completar o CEP, busca o endereço no ViaCEP e preenche o resto.
  const [cepBusy, setCepBusy] = useState(false);
  async function preencherPorCep() {
    if (stripMask(form.cep).length !== 8) return;
    setCepBusy(true);
    try {
      const r = await fetchCep(form.cep);
      if (r) {
        setForm((f) => ({
          ...f,
          endereco: r.logradouro || f.endereco,
          bairro: r.bairro || f.bairro,
          cidade: r.cidade || f.cidade,
          uf: r.uf || f.uf,
        }));
      }
    } finally {
      setCepBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Campos obrigatórios — aplicam em CREATE e EDIT.
    // Mesmo em edição, o cliente precisa ter todos os campos preenchidos
    // antes de salvar (não aceita salvar parcial).
    const required = [
      ['nome', form.nome, 'Nome obrigatório.', 2],
      ['cnpj', form.cnpj, 'CNPJ obrigatório.'],
      ['email', form.email, 'E-mail obrigatório.'],
      ['telefone', form.telefone, 'Telefone obrigatório.'],
      ['segmento', form.segmento, 'Segmento obrigatório.'],
      ['cep', form.cep, 'CEP obrigatório.'],
      ['endereco', form.endereco, 'Endereço (logradouro) obrigatório.'],
      ['numero', form.numero, 'Número obrigatório.'],
      ['bairro', form.bairro, 'Bairro obrigatório.'],
      ['cidade', form.cidade, 'Cidade obrigatória.'],
      ['uf', form.uf, 'UF obrigatória.'],
    ] as const;
    for (const [, value, msg, min] of required) {
      const v = String(value).trim();
      if (!v || (typeof min === 'number' && v.length < min)) {
        setError(msg);
        return;
      }
    }

    // Validações de formato
    if (!isValidCNPJ(form.cnpj)) {
      setError('CNPJ inválido. Confira os dígitos verificadores.');
      return;
    }
    if (form.uf.trim().length !== 2) {
      setError('UF deve ter 2 letras (ex: SP, RJ).');
      return;
    }
    if (stripMask(form.telefone).length < 10) {
      setError('Telefone incompleto — informe DDD + número.');
      return;
    }
    if (stripMask(form.cep).length !== 8) {
      setError('CEP deve ter 8 dígitos.');
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      status: form.status,
      erpStatus: form.erpStatus,
      prazoPagamento: form.prazoPagamento,
    };
    const optional = [
      'cnpj',
      'email',
      'telefone',
      'segmento',
      'cep',
      'endereco',
      'numero',
      'complemento',
      'bairro',
      'cidade',
      'uf',
    ] as const;
    for (const k of optional) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }

    try {
      const salvo =
        isEdit && cliente
          ? await api.patch<ClienteCadastro>(`/clientes/${cliente.id}`, payload)
          : await api.post<ClienteCadastro>('/clientes', payload);
      onSaved(salvo);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar cliente' : 'Novo cliente'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="cliente-form"
            data-testid="cliente-save-btn"
            disabled={form.nome.trim().length < 2}
            loading={saving}
          >
            {isEdit ? 'Salvar alterações' : 'Criar cliente'}
          </Button>
        </>
      }
    >
      <form id="cliente-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Nome" required htmlFor="f-nome">
          <Input
            id="f-nome"
            data-testid="cliente-nome-input"
            value={form.nome}
            onChange={(e) => setField('nome', e.target.value)}
            required
            minLength={2}
            maxLength={200}
            placeholder="Razão social ou nome fantasia"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="CNPJ"
            required
            hint={cnpjBusy ? 'Buscando na Receita…' : 'preenche razão social + endereço'}
          >
            <Input
              data-testid="cliente-cnpj-input"
              value={form.cnpj}
              onChange={(e) => setField('cnpj', maskCNPJ(e.target.value))}
              onBlur={() => void preencherPorCnpj()}
              placeholder="00.000.000/0001-00"
              maxLength={18}
              inputMode="numeric"
              required
            />
          </Field>
          <Field label="Segmento" required>
            <Input
              value={form.segmento}
              onChange={(e) => setField('segmento', e.target.value)}
              placeholder="Ex: Restaurante, Supermercado…"
              required
              maxLength={60}
            />
          </Field>
          <Field label="E-mail" required>
            <Input
              type="email"
              leftIcon={<Mail />}
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              required
              maxLength={200}
              placeholder="contato@empresa.com.br"
            />
          </Field>
          <Field label="Telefone" required>
            <PhoneInput
              testId="cliente-telefone"
              value={form.telefone}
              onChange={(e164) => setField('telefone', e164)}
              required
            />
          </Field>
        </div>

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Endereço
          </h4>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-[160px_1fr_120px]">
            <Field label="CEP" required hint={cepBusy ? 'Buscando endereço…' : 'preenche o resto'}>
              <Input
                value={form.cep}
                onChange={(e) => setField('cep', maskCEP(e.target.value))}
                onBlur={() => void preencherPorCep()}
                placeholder="00000-000"
                maxLength={9}
                inputMode="numeric"
                required
              />
            </Field>
            <Field label="Logradouro" required>
              <Input
                value={form.endereco}
                onChange={(e) => setField('endereco', e.target.value)}
                placeholder="Rua, avenida, etc."
                maxLength={200}
                required
              />
            </Field>
            <Field label="Número" required>
              <Input
                data-testid="cliente-numero-input"
                value={form.numero}
                onChange={(e) => setField('numero', e.target.value)}
                maxLength={20}
                required
              />
            </Field>
          </div>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 mt-3">
            <Field label="Complemento" hint="Opcional">
              <Input
                value={form.complemento}
                onChange={(e) => setField('complemento', e.target.value)}
                maxLength={100}
                placeholder="Sala, andar, bloco…"
              />
            </Field>
            <Field label="Bairro" required>
              <Input
                value={form.bairro}
                onChange={(e) => setField('bairro', e.target.value)}
                maxLength={100}
                required
              />
            </Field>
            <Field label="UF" required>
              <UfSelect
                testId="cliente-uf-select"
                value={form.uf}
                onChange={(uf) => setForm((f) => ({ ...f, uf, cidade: '' }))}
              />
            </Field>
            <Field label="Cidade" required hint={form.uf ? undefined : 'Escolha a UF primeiro'}>
              <CidadeSelect
                testId="cliente-cidade-select"
                uf={form.uf}
                value={form.cidade}
                onChange={(cidade) => setField('cidade', cidade)}
              />
            </Field>
          </div>
        </section>

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Operação
          </h4>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as ClienteStatus)}
              >
                {(Object.keys(STATUS_LABEL) as ClienteStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ERP">
              <Select
                value={form.erpStatus}
                onChange={(e) => setField('erpStatus', e.target.value as ERPStatus)}
              >
                <option value="ATIVO">Ativo</option>
                <option value="BLOQUEADO">Bloqueado</option>
              </Select>
            </Field>
            <Field label="Prazo (dias)">
              <Input
                type="number"
                min={0}
                max={180}
                value={form.prazoPagamento}
                onChange={(e) => setField('prazoPagamento', Number(e.target.value))}
              />
            </Field>
          </div>
        </section>

        {existente && (
          <div
            data-testid="cliente-cnpj-existente"
            className="px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-sm flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              Este CNPJ já está cadastrado: <strong>{existente.nome}</strong>.
            </span>
            {onUsarExistente && (
              <Button
                size="sm"
                variant="secondary"
                data-testid="cliente-usar-existente"
                onClick={() => onUsarExistente(existente)}
              >
                Usar este cadastro
              </Button>
            )}
          </div>
        )}

        {error && (
          <div
            data-testid="form-error"
            className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

