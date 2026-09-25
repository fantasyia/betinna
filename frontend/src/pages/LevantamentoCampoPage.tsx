import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserPlus,
  Zap,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { VendasTabs } from '@/components/VendasTabs';
import { ClienteFormModal, type ClienteCadastro } from '@/components/ClienteFormModal';
import { PhoneInput } from '@/components/PhoneInput';
import { Badge, Button, Card, Checkbox, Field, Input } from '@/components/ui';
import { formatMoeda, maskDinheiro, parseDinheiro } from '@/lib/masks';

/**
 * LEVANTAMENTO DE CAMPO → PROPOSTA (card do Léo, 17–18/09).
 *
 * O rep está no cliente, mede quadro por quadro e a tela diz qual Master Block
 * entra. Cada quadro vira um item da proposta — é essa lista que sai como a
 * tabela do Anexo II.
 *
 * 🔴 SALVA A CADA QUADRO, não no fim. O primeiro quadro CRIA a proposta em
 * rascunho; os seguintes entram por `POST /propostas/:id/itens`. Antes disso o
 * levantamento vivia só na memória do navegador: o rep media cinco quadros
 * dentro do cliente, fechava a aba e perdia tudo — em campo, onde a bateria
 * acaba e a rede cai.
 *
 * 📌 Não existe entidade "levantamento": isto É a proposta, desde o primeiro
 * quadro. Uma peça a menos pra sincronizar, e a tabela do documento sai da mesma
 * fonte que o valor.
 *
 * 🔴 A tela NUNCA escolhe modelo. Quem escolhe é o backend, pela corrente
 * medida; quando ele recusa, a tela mostra o motivo em vez de um modelo.
 */

type Variante = 'BASE' | 'DATA_SENSE' | 'END_POINT';

interface ModeloEscolhido {
  produtoId: string;
  sku: string;
  nome: string;
  correnteMinA: number;
  correnteMaxA: number;
}

type RespostaSelecao =
  | { ok: true; modelo: ModeloEscolhido }
  | {
      ok: false;
      motivo:
        | 'corrente-invalida'
        | 'acima-da-linha'
        | 'sem-faixa-cadastrada'
        | 'variante-indisponivel';
    };

/** Cada motivo tem um conserto diferente; um "não achei" mandaria o rep pro lugar errado. */
const RECUSA: Record<string, string> = {
  'acima-da-linha':
    'Corrente acima da linha Master Block. É projeto especial — fale com a diretoria antes de prometer prazo.',
  'sem-faixa-cadastrada':
    'Nenhum modelo cadastrado cobre esta corrente. É lacuna no catálogo, não limite do equipamento — avise a diretoria.',
  'variante-indisponivel':
    'Não há esse hardware de acompanhamento cadastrado para esta faixa de corrente.',
  'corrente-invalida': 'Informe a corrente medida no quadro.',
};

interface ItemProposta {
  id: string;
  produtoNome: string;
  quadroPainel: string | null;
  tensaoV: number | null;
  correnteA: number | null;
}

interface Proposta {
  id: string;
  numero: string;
  status: string;
  itens: ItemProposta[];
  cliente?: { id: string; nome: string; cnpj?: string | null };
  prazoEntregaDias?: number | null;
  prazoInstalacaoDias?: number | null;
  prazoSoftwareDias?: number | null;
  prazoVerificacaoDias?: number | null;
  servicosTotal?: number | null;
  customizacaoUnitario?: number | null;
  customizacaoQuantidade?: number | null;
  validoAte?: string | null;
  signatarioNome?: string | null;
  signatarioEmail?: string | null;
  signatarioTelefone?: string | null;
}

/**
 * O que o CONTRATO exige do cadastro do cliente (documento único): CNPJ e
 * endereço completo. Mostrar aqui, enquanto o rep está no cliente, custa menos
 * que descobrir no aceite — quando o contrato simplesmente não sai.
 */
const CAMPOS_DO_CONTRATO: Array<[keyof ClienteCadastro, string]> = [
  ['cnpj', 'CNPJ'],
  ['cep', 'CEP'],
  ['endereco', 'logradouro'],
  ['numero', 'número'],
  ['bairro', 'bairro'],
  ['cidade', 'cidade'],
  ['uf', 'UF'],
];

function faltaNoCadastro(c: ClienteCadastro): string[] {
  return CAMPOS_DO_CONTRATO.filter(([k]) => !String(c[k] ?? '').trim()).map(([, nome]) => nome);
}

function enderecoCurto(c: ClienteCadastro): string {
  const rua = [c.endereco, c.numero].filter(Boolean).join(', ');
  const cidade = [c.cidade, c.uf].filter(Boolean).join('/');
  return [rua, c.bairro, cidade].filter(Boolean).join(' · ');
}

/** Número vindo da API → texto do campo de dinheiro ("1.234,56"). */
function paraCampoDinheiro(v: number | null | undefined): string {
  return v == null ? '' : maskDinheiro(String(Math.round(v * 100)));
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj: string | null;
}

/**
 * O Data Sense é UM por instalação — fica no quadro principal e computa a
 * qualidade da energia que entra pela rede; os End Points são a comunicação
 * dele até os outros quadros (Léo, 18/09).
 *
 * O backend recusa proposta que viole isso. Aqui a checagem existe pra o rep ver
 * o problema ENQUANTO monta, e não só no fim.
 */
function problemaDeTopologia(itens: ItemProposta[]): string | null {
  const ds = itens.filter((i) => i.produtoNome.includes('Data Sense')).length;
  const ep = itens.filter((i) => i.produtoNome.includes('End Point')).length;
  if (ds > 1) {
    return 'Há mais de um Data Sense. Ele é um por instalação — deixe só o quadro principal.';
  }
  if (ep > 0 && ds === 0) {
    return 'Há End Point sem Data Sense. Marque qual quadro é o principal: é ele que concentra os dados.';
  }
  return null;
}

function varianteDe(acompanhamento: boolean, principal: boolean): Variante {
  if (!acompanhamento) return 'BASE';
  return principal ? 'DATA_SENSE' : 'END_POINT';
}

export default function LevantamentoCampoPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const propostaIdUrl = params.get('proposta');

  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  /** O cadastro COMPLETO do cliente escolhido — é dele que o contrato lê o endereço. */
  const [cadastro, setCadastro] = useState<ClienteCadastro | null>(null);
  const [modalCliente, setModalCliente] = useState<'novo' | 'editar' | null>(null);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [rascunhos, setRascunhos] = useState<Proposta[]>([]);

  const [quadroPainel, setQuadroPainel] = useState('');
  const [tensao, setTensao] = useState('');
  const [corrente, setCorrente] = useState('');
  const [acompanhamento, setAcompanhamento] = useState(false);
  const [principal, setPrincipal] = useState(false);

  const [prazoEntrega, setPrazoEntrega] = useState('');
  const [prazoInstalacao, setPrazoInstalacao] = useState('');
  const [prazoSoftware, setPrazoSoftware] = useState('');
  const [prazoVerificacao, setPrazoVerificacao] = useState('');
  const [salvandoPrazos, setSalvandoPrazos] = useState(false);

  // Serviços de implantação (itens 7.2 e III.a do documento único): valor
  // ÚNICO, separado do aluguel mensal.
  const [servicosTotal, setServicosTotal] = useState('');
  const [customUnitario, setCustomUnitario] = useState('');
  const [customQuantidade, setCustomQuantidade] = useState('1');

  // Dados do CONTRATO (Léo, 24/09): antes só existiam no formulário de "Nova
  // proposta" — e o signatário em tela nenhuma. Proposta nascida do levantamento
  // chegava no aceite sem eles, e o contrato não saía.
  const [validoAte, setValidoAte] = useState('');
  const [signatarioNome, setSignatarioNome] = useState('');
  const [signatarioEmail, setSignatarioEmail] = useState('');
  const [signatarioTelefone, setSignatarioTelefone] = useState('');
  const [salvandoContrato, setSalvandoContrato] = useState(false);

  const [previa, setPrevia] = useState<RespostaSelecao | null>(null);
  const [consultando, setConsultando] = useState(false);
  /**
   * Número da consulta que ainda vale. Mudar corrente ou acompanhamento
   * invalida a que está em voo: sem isto, a resposta ATRASADA (da variante
   * anterior) chegava depois e virava o modelo do quadro. Acontecia no gesto
   * mais comum — digitar a corrente e clicar direto no checkbox: o blur
   * consultava sem acompanhamento, o "Ver modelo" ficava desabilitado enquanto
   * isso, e o quadro principal era gravado sem o Data Sense (24/09, teste do
   * contrato em produção).
   */
  const consultaAtual = useRef(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const itens = proposta?.itens ?? [];
  const topologia = problemaDeTopologia(itens);

  /** Levantamentos pela metade, pra retomar de onde parou. */
  useEffect(() => {
    if (propostaIdUrl) return;
    api
      .get<{ data: Proposta[] }>('/propostas?status=RASCUNHO&limit=20')
      .then((r) => setRascunhos(r.data ?? []))
      .catch(() => setRascunhos([]));
  }, [propostaIdUrl]);

  /** Retomar: carrega o rascunho com os quadros que já foram medidos. */
  useEffect(() => {
    if (!propostaIdUrl) return;
    api
      .get<Proposta>(`/propostas/${propostaIdUrl}`)
      .then((p) => {
        setProposta(p);
        if (p.cliente) setCliente({ id: p.cliente.id, nome: p.cliente.nome, cnpj: null });
        setPrazoEntrega(p.prazoEntregaDias ? String(p.prazoEntregaDias) : '');
        setPrazoInstalacao(p.prazoInstalacaoDias ? String(p.prazoInstalacaoDias) : '');
        setPrazoSoftware(p.prazoSoftwareDias ? String(p.prazoSoftwareDias) : '');
        setPrazoVerificacao(p.prazoVerificacaoDias ? String(p.prazoVerificacaoDias) : '');
        setServicosTotal(paraCampoDinheiro(p.servicosTotal));
        setCustomUnitario(paraCampoDinheiro(p.customizacaoUnitario));
        setCustomQuantidade(p.customizacaoQuantidade ? String(p.customizacaoQuantidade) : '1');
        setValidoAte(p.validoAte ? p.validoAte.slice(0, 10) : '');
        setSignatarioNome(p.signatarioNome ?? '');
        setSignatarioEmail(p.signatarioEmail ?? '');
        setSignatarioTelefone(p.signatarioTelefone ?? '');
      })
      .catch((e) => setErro(apiErrorMessage(e)));
  }, [propostaIdUrl]);

  /** Cliente escolhido (ou retomado) → busca o cadastro inteiro. */
  useEffect(() => {
    if (!cliente?.id) {
      setCadastro(null);
      return;
    }
    let vivo = true;
    api
      .get<ClienteCadastro>(`/clientes/${cliente.id}`)
      .then((c) => {
        if (vivo) setCadastro(c);
      })
      .catch(() => {
        if (vivo) setCadastro(null);
      });
    return () => {
      vivo = false;
    };
  }, [cliente?.id]);

  function usarCliente(c: ClienteCadastro) {
    setCliente({ id: c.id, nome: c.nome, cnpj: c.cnpj ?? null });
    setCadastro(c);
    setModalCliente(null);
  }

  /**
   * Consulta o modelo pra corrente digitada.
   *
   * Sai do blur e do botão, não de cada tecla: digitando "420" o usuário passa
   * por 4 e por 42, que são correntes válidas de OUTROS modelos — a tela ficaria
   * piscando modelo errado enquanto ele digita.
   */
  function invalidarConsulta() {
    consultaAtual.current += 1;
    setPrevia(null);
    setConsultando(false);
  }

  async function consultarModelo() {
    const correnteA = Number(corrente);
    if (!Number.isFinite(correnteA) || correnteA <= 0) {
      setPrevia(null);
      return;
    }
    const minha = ++consultaAtual.current;
    setConsultando(true);
    try {
      const variante = varianteDe(acompanhamento, principal);
      const r = await api.get<RespostaSelecao>(
        `/propostas/selecao-modelo?correnteA=${correnteA}&variante=${variante}`,
      );
      if (minha !== consultaAtual.current) return; // a tela mudou enquanto isso
      setPrevia(r);
    } catch (e) {
      if (minha !== consultaAtual.current) return;
      setErro(apiErrorMessage(e));
      setPrevia(null);
    } finally {
      if (minha === consultaAtual.current) setConsultando(false);
    }
  }

  /**
   * Grava o quadro NA HORA.
   *
   * O primeiro cria a proposta; os seguintes entram na que já existe. É o que
   * faz o levantamento sobreviver a fechar a aba.
   */
  async function adicionarQuadro() {
    if (!previa?.ok) return;
    if (!cliente) {
      setErro('Escolha o cliente antes de medir o primeiro quadro.');
      return;
    }
    const nome = quadroPainel.trim();
    if (!nome) {
      setErro('Dê um nome ao quadro — é como ele aparece no documento do cliente.');
      return;
    }
    setSalvando(true);
    setErro(null);
    const item = {
      produtoId: previa.modelo.produtoId,
      quantidade: 1,
      desconto: 0,
      quadroPainel: nome,
      tensaoV: Number(tensao) || undefined,
      correnteA: Number(corrente),
      secaoTecnica: 'SUPRESSOR' as const,
    };
    try {
      let atualizada: Proposta;
      if (proposta) {
        atualizada = await api.post<Proposta>(`/propostas/${proposta.id}/itens`, item);
      } else {
        atualizada = await api.post<Proposta>('/propostas', {
          clienteId: cliente.id,
          modalidade: 'LOCACAO',
          itens: [item],
        });
        // A URL passa a apontar pro rascunho: recarregar a página não perde nada.
        setParams({ proposta: atualizada.id }, { replace: true });
      }
      setProposta(atualizada);
      setQuadroPainel('');
      setTensao('');
      setCorrente('');
      setPrincipal(false);
      setPrevia(null);
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setSalvando(false);
    }
  }

  async function removerQuadro(itemId: string) {
    if (!proposta) return;
    try {
      const atualizada = await api.delete<Proposta>(`/propostas/${proposta.id}/itens/${itemId}`);
      setProposta(atualizada);
    } catch (e) {
      setErro(apiErrorMessage(e));
    }
  }

  /**
   * Os prazos (item 08) e os serviços de implantação (7.2 / III.a) do documento
   * único — o rep combina com o cliente depois da medição, e é daqui que sai o
   * texto do contrato.
   */
  async function salvarPrazos() {
    if (!proposta) return;
    setSalvandoPrazos(true);
    setErro(null);
    try {
      const atualizada = await api.patch<Proposta>(`/propostas/${proposta.id}`, {
        prazoEntregaDias: Number(prazoEntrega) || undefined,
        prazoInstalacaoDias: Number(prazoInstalacao) || undefined,
        prazoVerificacaoDias: Number(prazoVerificacao) || undefined,
        prazoSoftwareDias: Number(prazoSoftware) || undefined,
        servicosTotal: servicosTotal ? parseDinheiro(servicosTotal) : undefined,
        customizacaoUnitario: customUnitario ? parseDinheiro(customUnitario) : undefined,
        customizacaoQuantidade: Number(customQuantidade) || undefined,
      });
      setProposta((p) => (p ? { ...p, ...atualizada } : atualizada));
      toast.success('Prazos e serviços salvos');
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setSalvandoPrazos(false);
    }
  }

  async function salvarContrato() {
    if (!proposta) return;
    if (signatarioNome.trim() && signatarioNome.trim().length < 3) {
      setErro('Quem assina é uma pessoa: informe nome e sobrenome.');
      return;
    }
    setSalvandoContrato(true);
    setErro(null);
    try {
      const atualizada = await api.patch<Proposta>(`/propostas/${proposta.id}`, {
        validoAte: validoAte || undefined,
        signatarioNome: signatarioNome.trim() || undefined,
        signatarioEmail: signatarioEmail.trim() || undefined,
        signatarioTelefone: signatarioTelefone.trim() || undefined,
      });
      setProposta((p) => (p ? { ...p, ...atualizada } : atualizada));
      toast.success('Dados do contrato salvos');
    } catch (e) {
      setErro(apiErrorMessage(e));
    } finally {
      setSalvandoContrato(false);
    }
  }

  function concluir() {
    if (!proposta) return;
    toast.success(`Levantamento salvo na proposta ${proposta.numero}`);
    navigate(`/propostas?id=${proposta.id}`);
  }

  const semPrazo = !prazoEntrega || !prazoInstalacao || !prazoVerificacao || !prazoSoftware;
  const semServicos = !servicosTotal || !customUnitario;
  const semContrato =
    !validoAte || !signatarioNome.trim() || !signatarioEmail.trim();
  const faltaCadastro = cadastro ? faltaNoCadastro(cadastro) : [];
  // III.a promete "2 parcelas de R$ X cada": centavo ímpar não divide igual, e o
  // contrato é recusado na montagem. Avisar aqui é mais barato que no aceite.
  const centavosServicos = Math.round(parseDinheiro(servicosTotal) * 100);
  const servicosImpar = !!servicosTotal && centavosServicos % 2 !== 0;

  return (
    <PageLayout
      title="Levantamento de campo"
      description="Meça quadro a quadro; o modelo é escolhido pela corrente."
    >
      <VendasTabs />
      <div className="flex flex-col gap-4">
        {/* Retomar o que ficou pela metade. Some assim que há proposta aberta. */}
        {!proposta && rascunhos.length > 0 && (
          <Card className="p-4" data-testid="levantamento-rascunhos">
            <p className="mb-2 text-sm font-medium">Levantamentos em aberto</p>
            <div className="flex flex-col gap-1">
              {rascunhos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setParams({ proposta: r.id })}
                  data-testid={`retomar-${r.id}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                >
                  <span>
                    {r.numero} · {r.cliente?.nome ?? 'sem cliente'}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-text-subtle">
                    <RotateCcw size={13} aria-hidden="true" />
                    {r.itens?.length ?? 0} quadro(s)
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4">
          <Field label="Cliente" required>
            {proposta ? (
              <p className="text-sm" data-testid="levantamento-cliente-fixo">
                {cliente?.nome ?? proposta.cliente?.nome} ·{' '}
                <span className="text-text-subtle">{proposta.numero}</span>
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <AsyncCombobox<ClienteOpt>
                    testId="levantamento-cliente"
                    endpoint="/clientes"
                    placeholder="Buscar cliente por nome ou CNPJ…"
                    getLabel={(c) => c.nome}
                    getSubLabel={(c) => c.cnpj ?? null}
                    getId={(c) => c.id}
                    value={cliente}
                    onChange={setCliente}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setModalCliente('novo')}
                  data-testid="levantamento-novo-cliente"
                >
                  <UserPlus size={15} aria-hidden="true" /> Novo cliente
                </Button>
              </div>
            )}
          </Field>

          {cadastro && (
            <div
              className="mt-3 border-t border-border pt-3 text-xs"
              data-testid="levantamento-cadastro"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-text-subtle">
                  {cadastro.cnpj ? `CNPJ ${cadastro.cnpj}` : 'sem CNPJ'}
                  {enderecoCurto(cadastro) && ` · ${enderecoCurto(cadastro)}`}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setModalCliente('editar')}
                  data-testid="levantamento-editar-cliente"
                >
                  <Pencil size={13} aria-hidden="true" />
                  {faltaCadastro.length ? 'Completar cadastro' : 'Editar cadastro'}
                </Button>
              </div>
              {faltaCadastro.length > 0 && (
                <p className="mt-1 text-warning" data-testid="levantamento-cadastro-falta">
                  O contrato não sai sem: {faltaCadastro.join(', ')}.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Field label="Quadro / painel" required>
              <Input
                data-testid="levantamento-quadro"
                value={quadroPainel}
                onChange={(e) => setQuadroPainel(e.target.value)}
                placeholder="QGBT, Painel 3…"
              />
            </Field>
            <Field label="Tensão (V)">
              <Input
                data-testid="levantamento-tensao"
                inputMode="numeric"
                value={tensao}
                onChange={(e) => setTensao(e.target.value.replace(/\D/g, ''))}
                placeholder="380"
              />
            </Field>
            <Field label="Corrente (A)" required>
              <Input
                data-testid="levantamento-corrente"
                inputMode="numeric"
                value={corrente}
                onChange={(e) => {
                  setCorrente(e.target.value.replace(/\D/g, ''));
                  invalidarConsulta();
                }}
                onBlur={consultarModelo}
                placeholder="420"
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
            <Checkbox
              label="Com acompanhamento"
              data-testid="levantamento-acompanhamento"
              checked={acompanhamento}
              onChange={(e) => {
                setAcompanhamento(e.target.checked);
                // Sem software não há papel na topologia; deixar a marca faria o
                // próximo quadro herdar um estado que não existe mais.
                if (!e.target.checked) setPrincipal(false);
                invalidarConsulta();
              }}
            />
            <Checkbox
              label="É o quadro principal"
              data-testid="levantamento-principal"
              disabled={!acompanhamento}
              checked={principal}
              onChange={(e) => {
                setPrincipal(e.target.checked);
                invalidarConsulta();
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={consultarModelo}
              disabled={!corrente || consultando}
              data-testid="levantamento-consultar"
            >
              {consultando ? 'Consultando…' : 'Ver modelo'}
            </Button>
          </div>

          {previa?.ok && (
            <div
              data-testid="levantamento-previa"
              className="mt-3 flex items-center gap-2 rounded-md bg-success/15 px-3 py-2 text-sm text-success"
            >
              <ArrowRight size={16} aria-hidden="true" />
              <span>
                <strong>{previa.modelo.sku}</strong> — faixa {previa.modelo.correnteMinA} a{' '}
                {previa.modelo.correnteMaxA} A
              </span>
            </div>
          )}
          {previa && !previa.ok && (
            <div
              data-testid="levantamento-recusa"
              className="mt-3 flex items-start gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{RECUSA[previa.motivo] ?? 'Não foi possível escolher o modelo.'}</span>
            </div>
          )}

          <div className="mt-3">
            <Button
              onClick={adicionarQuadro}
              disabled={!previa?.ok || salvando}
              data-testid="levantamento-adicionar"
            >
              <Plus size={16} aria-hidden="true" />
              {salvando ? 'Salvando…' : 'Adicionar quadro'}
            </Button>
          </div>
        </Card>

        {itens.length > 0 && (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-hover text-left text-xs text-text-subtle">
                  <th className="px-4 py-2 font-normal">Quadro</th>
                  <th className="px-2 py-2 font-normal">Tensão</th>
                  <th className="px-2 py-2 font-normal">Corrente</th>
                  <th className="px-4 py-2 font-normal">Modelo</th>
                  <th className="w-10 px-2 py-2" aria-label="Remover" />
                </tr>
              </thead>
              <tbody data-testid="levantamento-lista">
                {itens.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        {i.quadroPainel ?? '—'}
                        {i.produtoNome.includes('Data Sense') && (
                          <Badge variant="primary">principal</Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2">{i.tensaoV ? `${i.tensaoV} V` : '—'}</td>
                    <td className="px-2 py-2">{i.correnteA ? `${i.correnteA} A` : '—'}</td>
                    <td className="px-4 py-2 font-medium">{i.produtoNome}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        aria-label={`Remover ${i.quadroPainel ?? 'quadro'}`}
                        onClick={() => removerQuadro(i.id)}
                        className="text-text-subtle hover:text-danger"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* Os prazos do item 04 do Anexo II. Só depois de haver proposta: são
            combinados com o cliente, e antes do levantamento não há conversa. */}
        {proposta && (
          <Card className="p-4" data-testid="levantamento-prazos">
            <p className="mb-1 text-sm font-medium">Prazos combinados com o cliente</p>
            <p className="mb-3 text-xs text-text-subtle">
              Vão impressos no contrato como &quot;em até 10 (dez) dias&quot;. Sem os quatro, o
              contrato não sai pra assinatura — o app não imprime lacuna.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Entrega (dias)">
                <Input
                  data-testid="prazo-entrega"
                  inputMode="numeric"
                  value={prazoEntrega}
                  onChange={(e) => setPrazoEntrega(e.target.value.replace(/\D/g, ''))}
                  placeholder="45"
                />
              </Field>
              <Field label="Instalação (dias)">
                <Input
                  data-testid="prazo-instalacao"
                  inputMode="numeric"
                  value={prazoInstalacao}
                  onChange={(e) => setPrazoInstalacao(e.target.value.replace(/\D/g, ''))}
                  placeholder="15"
                />
              </Field>
              <Field label="Verificação (dias)" hint="Depois do fim da obra">
                <Input
                  data-testid="prazo-verificacao"
                  inputMode="numeric"
                  value={prazoVerificacao}
                  onChange={(e) => setPrazoVerificacao(e.target.value.replace(/\D/g, ''))}
                  placeholder="5"
                />
              </Field>
              <Field label="Software (dias)">
                <Input
                  data-testid="prazo-software"
                  inputMode="numeric"
                  value={prazoSoftware}
                  onChange={(e) => setPrazoSoftware(e.target.value.replace(/\D/g, ''))}
                  placeholder="7"
                />
              </Field>
            </div>

            <p className="mb-1 mt-5 text-sm font-medium">Serviços de implantação</p>
            <p className="mb-3 text-xs text-text-subtle">
              Valor único, fora do aluguel mensal: instalação + materiais + customização do
              software, pago em 2 parcelas.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.6fr_1.2fr]">
              <Field label="Customização — valor unitário (R$)">
                <Input
                  data-testid="custom-unitario"
                  inputMode="numeric"
                  value={customUnitario}
                  onChange={(e) => setCustomUnitario(maskDinheiro(e.target.value))}
                  placeholder="1.500,00"
                />
              </Field>
              <Field label="Quantidade">
                <Input
                  data-testid="custom-quantidade"
                  inputMode="numeric"
                  value={customQuantidade}
                  onChange={(e) => setCustomQuantidade(e.target.value.replace(/\D/g, ''))}
                  placeholder="1"
                />
              </Field>
              <Field
                label="Total de instalação, materiais e customização (R$)"
                hint={
                  servicosTotal && !servicosImpar
                    ? `2 parcelas de ${formatMoeda(centavosServicos / 200)}`
                    : undefined
                }
                error={
                  servicosImpar ? 'Não divide em 2 parcelas iguais — ajuste os centavos.' : undefined
                }
              >
                <Input
                  data-testid="servicos-total"
                  inputMode="numeric"
                  value={servicosTotal}
                  onChange={(e) => setServicosTotal(maskDinheiro(e.target.value))}
                  placeholder="12.000,00"
                />
              </Field>
            </div>

            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={salvarPrazos}
                disabled={salvandoPrazos}
                data-testid="salvar-prazos"
              >
                {salvandoPrazos ? 'Salvando…' : 'Salvar prazos e serviços'}
              </Button>
            </div>
          </Card>
        )}

        {proposta && (
          <Card className="p-4" data-testid="levantamento-contrato">
            <p className="mb-1 text-sm font-medium">Dados do contrato</p>
            <p className="mb-3 text-xs text-text-subtle">
              Quem assina pelo cliente é uma PESSOA — a assinatura eletrônica recusa razão social.
              Sem estes dados o cliente aceita e o contrato não sai.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Validade da proposta">
                <Input
                  data-testid="contrato-validade"
                  type="date"
                  value={validoAte}
                  onChange={(e) => setValidoAte(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Quem assina pelo cliente (nome)">
                <Input
                  data-testid="contrato-signatario-nome"
                  value={signatarioNome}
                  maxLength={120}
                  onChange={(e) => setSignatarioNome(e.target.value)}
                  placeholder="Nome e sobrenome"
                />
              </Field>
              <Field label="E-mail de quem assina">
                <Input
                  data-testid="contrato-signatario-email"
                  type="email"
                  value={signatarioEmail}
                  maxLength={160}
                  onChange={(e) => setSignatarioEmail(e.target.value)}
                  placeholder={cadastro?.email ?? 'nome@empresa.com.br'}
                />
              </Field>
              <Field label="Celular de quem assina">
                <PhoneInput
                  testId="contrato-signatario-telefone"
                  value={signatarioTelefone}
                  onChange={setSignatarioTelefone}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={salvarContrato}
                disabled={salvandoContrato}
                data-testid="salvar-contrato"
              >
                {salvandoContrato ? 'Salvando…' : 'Salvar dados do contrato'}
              </Button>
            </div>
          </Card>
        )}

        {topologia && (
          <div
            data-testid="levantamento-topologia"
            className="flex items-start gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning"
          >
            <Zap size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{topologia}</span>
          </div>
        )}

        {erro && (
          <div
            data-testid="levantamento-erro"
            className="flex items-start gap-2 rounded-md bg-danger/15 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{erro}</span>
          </div>
        )}

        {proposta && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-subtle">
              {itens.length} quadro(s) salvos em {proposta.numero}
              {semPrazo && ' · prazos pendentes'}
              {semServicos && ' · serviços pendentes'}
              {semContrato && ' · dados do contrato pendentes'}
              {faltaCadastro.length > 0 && ' · cadastro do cliente incompleto'}
            </p>
            <Button onClick={concluir} disabled={!!topologia} data-testid="levantamento-concluir">
              <Check size={16} aria-hidden="true" /> Ver proposta
            </Button>
          </div>
        )}
      </div>

      {modalCliente && (
        <ClienteFormModal
          open
          cliente={modalCliente === 'editar' ? cadastro : null}
          onClose={() => setModalCliente(null)}
          onSaved={usarCliente}
          onUsarExistente={usarCliente}
        />
      )}
    </PageLayout>
  );
}
