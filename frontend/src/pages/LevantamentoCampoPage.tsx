import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Plus, Trash2, Zap } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { VendasTabs } from '@/components/VendasTabs';
import { Badge, Button, Card, Checkbox, Field, Input } from '@/components/ui';

/**
 * LEVANTAMENTO DE CAMPO → PROPOSTA (card do Léo, 17–18/09).
 *
 * O rep está no cliente, mede quadro por quadro e a tela diz qual Master Block
 * entra. Cada quadro vira um item da proposta — é essa lista que sai como a
 * tabela do Anexo II.
 *
 * 📌 Não existe entidade "levantamento": isto monta a PROPOSTA direto, em
 * rascunho. Uma peça a menos pra sincronizar, e a tabela do documento sai da
 * mesma fonte que o valor.
 *
 * 🔴 A tela NUNCA escolhe modelo sozinha. Quem escolhe é o backend, pela
 * corrente medida; quando ele recusa, a tela mostra o motivo em vez de um
 * modelo. Preencher "o maior que eu tenho" seria vender equipamento que não
 * protege a instalação.
 */

/** O acompanhamento e o papel do quadro decidem a variante do equipamento. */
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

/**
 * O motivo da recusa vira uma frase que diz O QUE FAZER — são consertos
 * diferentes, e um "não achei" genérico mandaria o rep pro lugar errado.
 */
const RECUSA: Record<string, string> = {
  'acima-da-linha':
    'Corrente acima da linha Master Block. É projeto especial — fale com a diretoria antes de prometer prazo.',
  'sem-faixa-cadastrada':
    'Nenhum modelo cadastrado cobre esta corrente. É lacuna no catálogo, não limite do equipamento — avise a diretoria.',
  'variante-indisponivel':
    'Não há esse hardware de acompanhamento cadastrado para esta faixa de corrente.',
  'corrente-invalida': 'Informe a corrente medida no quadro.',
};

interface QuadroMedido {
  /** Chave só de UI — nada disso vai pro backend. */
  uid: string;
  quadroPainel: string;
  tensaoV: number;
  correnteA: number;
  acompanhamento: boolean;
  principal: boolean;
  modelo: ModeloEscolhido;
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
 * O backend recusa proposta que viole isso. Aqui a checagem existe pra o rep
 * ver o problema ENQUANTO monta, em vez de descobrir no botão de gerar.
 */
function problemaDeTopologia(quadros: QuadroMedido[]): string | null {
  const ds = quadros.filter((q) => q.modelo.sku.endsWith('_D.S.')).length;
  const ep = quadros.filter((q) => q.modelo.sku.endsWith('_E.P.')).length;
  if (ds > 1) {
    return 'Há mais de um Data Sense. Ele é um por instalação — marque só o quadro principal.';
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

  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [quadros, setQuadros] = useState<QuadroMedido[]>([]);

  const [quadroPainel, setQuadroPainel] = useState('');
  const [tensao, setTensao] = useState('');
  const [corrente, setCorrente] = useState('');
  const [acompanhamento, setAcompanhamento] = useState(false);
  const [principal, setPrincipal] = useState(false);

  const [previa, setPrevia] = useState<RespostaSelecao | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const topologia = problemaDeTopologia(quadros);

  /**
   * Consulta o modelo pra corrente digitada.
   *
   * Sai do `onBlur` e do botão, não de cada tecla: a cada dígito de "420" o
   * usuário passa por 4 e por 42, que são correntes válidas de OUTROS modelos —
   * a tela ficaria piscando modelo errado enquanto ele digita.
   */
  async function consultarModelo() {
    const correnteA = Number(corrente);
    if (!Number.isFinite(correnteA) || correnteA <= 0) {
      setPrevia(null);
      return;
    }
    setConsultando(true);
    try {
      const variante = varianteDe(acompanhamento, principal);
      const r = await api.get<RespostaSelecao>(
        `/propostas/selecao-modelo?correnteA=${correnteA}&variante=${variante}`,
      );
      setPrevia(r);
    } catch (e) {
      setErro(apiErrorMessage(e));
      setPrevia(null);
    } finally {
      setConsultando(false);
    }
  }

  function adicionarQuadro() {
    if (!previa?.ok) return;
    const nome = quadroPainel.trim();
    if (!nome) {
      setErro('Dê um nome ao quadro — é como ele aparece no documento do cliente.');
      return;
    }
    setErro(null);
    setQuadros((atual) => [
      ...atual,
      {
        uid: `${Date.now()}-${atual.length}`,
        quadroPainel: nome,
        tensaoV: Number(tensao) || 0,
        correnteA: Number(corrente),
        acompanhamento,
        principal,
        modelo: previa.modelo,
      },
    ]);
    setQuadroPainel('');
    setTensao('');
    setCorrente('');
    setPrincipal(false);
    setPrevia(null);
  }

  function removerQuadro(uid: string) {
    setQuadros((atual) => atual.filter((q) => q.uid !== uid));
  }

  async function gerarProposta() {
    if (!cliente || quadros.length === 0 || topologia) return;
    setGerando(true);
    setErro(null);
    try {
      const proposta = await api.post<{ id: string; numero: string }>('/propostas', {
        clienteId: cliente.id,
        modalidade: 'LOCACAO',
        itens: quadros.map((q) => ({
          produtoId: q.modelo.produtoId,
          quantidade: 1,
          desconto: 0,
          quadroPainel: q.quadroPainel,
          tensaoV: q.tensaoV || undefined,
          correnteA: q.correnteA,
          secaoTecnica: 'SUPRESSOR' as const,
        })),
      });
      toast.success(`Proposta ${proposta.numero} criada a partir do levantamento`);
      navigate(`/propostas?id=${proposta.id}`);
    } catch (e) {
      // O backend tem as guardas de verdade (topologia, produto inativo, preço
      // de locação ausente). A mensagem dele é mais específica que qualquer
      // coisa que a tela saiba dizer — então ela vai inteira pra tela.
      setErro(apiErrorMessage(e));
    } finally {
      setGerando(false);
    }
  }

  const podeGerar = !!cliente && quadros.length > 0 && !topologia && !gerando;

  return (
    <PageLayout
      title="Levantamento de campo"
      description="Meça quadro a quadro; o modelo é escolhido pela corrente."
    >
      <VendasTabs />
      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <Field label="Cliente" required>
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
          </Field>
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
                  setPrevia(null);
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
                // Desmarcar o acompanhamento zera o "principal": quadro sem
                // software não tem papel na topologia, e deixar a marca ali
                // faria o próximo quadro herdar um estado que não existe mais.
                if (!e.target.checked) setPrincipal(false);
                setPrevia(null);
              }}
            />
            <Checkbox
              label="É o quadro principal"
              data-testid="levantamento-principal"
              disabled={!acompanhamento}
              checked={principal}
              onChange={(e) => {
                setPrincipal(e.target.checked);
                setPrevia(null);
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
              disabled={!previa?.ok}
              data-testid="levantamento-adicionar"
            >
              <Plus size={16} aria-hidden="true" /> Adicionar quadro
            </Button>
          </div>
        </Card>

        {quadros.length > 0 && (
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
                {quadros.map((q) => (
                  <tr key={q.uid} className="border-t border-border">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        {q.quadroPainel}
                        {q.principal && <Badge variant="primary">principal</Badge>}
                      </span>
                    </td>
                    <td className="px-2 py-2">{q.tensaoV ? `${q.tensaoV} V` : '—'}</td>
                    <td className="px-2 py-2">{q.correnteA} A</td>
                    <td className="px-4 py-2 font-medium">{q.modelo.sku}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        aria-label={`Remover ${q.quadroPainel}`}
                        onClick={() => removerQuadro(q.uid)}
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

        <div className="flex justify-end gap-2">
          <Button
            onClick={gerarProposta}
            disabled={!podeGerar}
            data-testid="levantamento-gerar"
            title={
              !cliente
                ? 'Escolha o cliente'
                : quadros.length === 0
                  ? 'Adicione ao menos um quadro'
                  : undefined
            }
          >
            {gerando ? 'Gerando…' : 'Gerar proposta'}
          </Button>
        </div>

        {quadros.length > 0 && (
          <p className="text-right text-xs text-text-subtle">
            {quadros.length} {quadros.length === 1 ? 'quadro' : 'quadros'} · os valores saem na
            proposta, pela tabela de locação
          </p>
        )}
      </div>
    </PageLayout>
  );
}
