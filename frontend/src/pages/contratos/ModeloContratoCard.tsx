import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileText, Upload } from 'lucide-react';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Dialog, Field, Textarea } from '@/components/ui';

interface Versao {
  id: string;
  versao: number;
  nomeArquivo: string;
  tamanhoBytes: number;
  ativo: boolean;
  observacao: string | null;
  criadoEm: string;
  ativadoEm: string | null;
  enviadoPor: string | null;
  ativadoPor: string | null;
}

interface Resposta {
  emUso: number | null;
  padrao: { nome: string; tamanhoBytes: number };
  versoes: Versao[];
}

interface Arquivo {
  nome: string;
  conteudoBase64: string;
}

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Mesmo teto do backend (`TAMANHO_MAX_MODELO`) — recusa antes de mandar 14 MB à toa. */
const TAMANHO_MAX = 14 * 1024 * 1024;

function salvar({ nome, conteudoBase64 }: Arquivo) {
  const bytes = Uint8Array.from(atob(conteudoBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME_DOCX }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function paraBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    // readAsDataURL devolve "data:<mime>;base64,<conteúdo>" — o backend quer só o conteúdo.
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

const dataCurta = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

/**
 * Modelo do contrato (documento único do Anexo I) — trocado pela tela, sem
 * deploy (Léo, 24/09). Só DIRECTOR/ADMIN: é cláusula contratual.
 *
 * O caminho é: baixar o modelo em uso → editar no Word → subir → conferir o
 * exemplo → ativar. Subir NÃO muda contrato de ninguém; ativar muda. E o
 * backend recusa arquivo que estragaria o contrato, com a lista do que está
 * errado — ela aparece aqui, um problema por linha.
 */
export function ModeloContratoCard() {
  const toast = useToast();
  const { data, refetch } = useApiQuery<Resposta>('/modelos-contrato');
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [ativando, setAtivando] = useState<Versao | 'padrao' | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function baixar(rota: string, chave: string) {
    setOcupado(chave);
    try {
      salvar(await api.get<Arquivo>(rota));
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setOcupado(null);
    }
  }

  async function enviar() {
    if (!arquivo) return;
    setProblemas([]);
    if (arquivo.size > TAMANHO_MAX) {
      setProblemas([`o arquivo tem ${(arquivo.size / 1024 / 1024).toFixed(1)} MB — o limite é 14 MB`]);
      return;
    }
    setEnviando(true);
    try {
      const v = await api.post<{ versao: number }>('/modelos-contrato', {
        nomeArquivo: arquivo.name,
        conteudoBase64: await paraBase64(arquivo),
        observacao: observacao.trim() || undefined,
      });
      toast.success(`Versão ${v.versao} guardada. Confira o exemplo e ative quando estiver certa.`);
      setArquivo(null);
      setObservacao('');
      if (entrada.current) entrada.current.value = '';
      refetch();
    } catch (e) {
      const lista =
        e instanceof ApiError && Array.isArray(e.details)
          ? (e.details as Array<{ message?: string }>).map((d) => d.message ?? '').filter(Boolean)
          : [];
      setProblemas(lista.length ? lista : [apiErrorMessage(e)]);
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarAtivacao() {
    if (!ativando) return;
    try {
      await api.post(
        ativando === 'padrao'
          ? '/modelos-contrato/padrao/ativar'
          : `/modelos-contrato/${ativando.id}/ativar`,
      );
      toast.success(
        ativando === 'padrao'
          ? 'Voltou a valer o modelo padrão do app.'
          : `A versão ${ativando.versao} passa a valer pros próximos contratos.`,
      );
      refetch();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setAtivando(null);
    }
  }

  const emUso = data?.versoes.find((v) => v.ativo) ?? null;

  return (
    <Card className="p-4" data-testid="modelo-contrato">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Modelo do contrato</p>
          <p className="text-xs text-text-subtle" data-testid="modelo-em-uso">
            {emUso
              ? `Em uso: versão ${emUso.versao}${emUso.ativadoPor ? `, ativada por ${emUso.ativadoPor}` : ''} em ${dataCurta(emUso.ativadoEm)}`
              : 'Em uso: o modelo padrão do app'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!!ocupado}
            data-testid="modelo-baixar-em-uso"
            onClick={() =>
              baixar(
                emUso ? `/modelos-contrato/${emUso.id}/arquivo` : '/modelos-contrato/padrao/arquivo',
                'em-uso',
              )
            }
          >
            <Download size={14} aria-hidden="true" /> Baixar pra editar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!!ocupado}
            data-testid="modelo-exemplo-em-uso"
            onClick={() =>
              baixar(
                emUso ? `/modelos-contrato/${emUso.id}/exemplo` : '/modelos-contrato/padrao/exemplo',
                'exemplo',
              )
            }
          >
            <FileText size={14} aria-hidden="true" /> Ver exemplo preenchido
          </Button>
        </div>
      </div>

      <p className="mt-3 text-xs text-text-subtle">
        Edite no Word à vontade, mas <strong>não apague nem renomeie</strong> o que está entre{' '}
        <code>{'{{ }}'}</code>. O app confere o arquivo antes de aceitar, e subir não muda contrato
        de ninguém: só vale depois de <strong>ativar</strong>.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <Field label="Arquivo (.docx)">
          <input
            ref={entrada}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            data-testid="modelo-arquivo"
            className="text-xs"
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null);
              setProblemas([]);
            }}
          />
        </Field>
        <Field label="O que mudou (opcional)">
          <Textarea
            rows={1}
            value={observacao}
            maxLength={500}
            placeholder="Cláusula 7 revisada pelo jurídico"
            onChange={(e) => setObservacao(e.target.value)}
            data-testid="modelo-observacao"
          />
        </Field>
        <Button onClick={enviar} disabled={!arquivo || enviando} data-testid="modelo-enviar">
          <Upload size={14} aria-hidden="true" /> {enviando ? 'Conferindo…' : 'Subir versão'}
        </Button>
      </div>

      {problemas.length > 0 && (
        <div
          data-testid="modelo-problemas"
          className="mt-3 rounded-md bg-danger/15 px-3 py-2 text-sm text-danger"
        >
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertCircle size={15} aria-hidden="true" /> O arquivo não foi aceito:
          </p>
          <ul className="ml-5 list-disc space-y-0.5 text-xs">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {data && data.versoes.length > 0 && (
        <table className="mt-4 w-full text-sm" data-testid="modelo-versoes">
          <thead>
            <tr className="text-left text-xs text-text-subtle">
              <th className="py-1 font-normal">Versão</th>
              <th className="py-1 font-normal">O que mudou</th>
              <th className="py-1 font-normal">Subida por</th>
              <th className="py-1 font-normal" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {data.versoes.map((v) => (
              <tr key={v.id} className="border-t border-border" data-testid={`modelo-versao-${v.versao}`}>
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    v{v.versao}
                    {v.ativo && (
                      <Badge variant="success">
                        <CheckCircle2 size={12} aria-hidden="true" /> em uso
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="py-2 text-xs text-text-subtle">{v.observacao ?? v.nomeArquivo}</td>
                <td className="py-2 text-xs text-text-subtle">
                  {v.enviadoPor ?? '—'} · {dataCurta(v.criadoEm)}
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!ocupado}
                      onClick={() => baixar(`/modelos-contrato/${v.id}/exemplo`, `ex-${v.id}`)}
                      data-testid={`modelo-exemplo-${v.versao}`}
                    >
                      Exemplo
                    </Button>
                    {!v.ativo && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAtivando(v)}
                        data-testid={`modelo-ativar-${v.versao}`}
                      >
                        Ativar
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {emUso && (
        <div className="mt-2 text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAtivando('padrao')}
            data-testid="modelo-voltar-padrao"
          >
            Voltar ao modelo padrão do app
          </Button>
        </div>
      )}

      <Dialog
        open={ativando !== null}
        onClose={() => setAtivando(null)}
        title={
          ativando === 'padrao'
            ? 'Voltar ao modelo padrão?'
            : `Ativar a versão ${ativando?.versao ?? ''}?`
        }
        description="Todo contrato enviado a partir de agora sai com este texto. Os que já foram enviados não mudam — cada um guarda a versão com que saiu."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAtivando(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarAtivacao} data-testid="modelo-confirmar-ativacao">
              {ativando === 'padrao' ? 'Voltar ao padrão' : 'Ativar'}
            </Button>
          </>
        }
      />
    </Card>
  );
}
