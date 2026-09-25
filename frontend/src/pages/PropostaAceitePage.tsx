import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda as fmtBRL } from '@/lib/masks';
import { carregarMarca, escurecer, marca, type Marca } from '@/lib/marca';

/**
 * Página pública de aceite — o que o CLIENTE recebe (Léo, 25/09: "já precisa
 * ficar tudo no formato de como o cliente vai receber mesmo").
 *
 * Era uma tabela genérica produto/qtd/preço, sem o levantamento, sem prazos nem
 * condições — e SEM O PROJETO, que é justamente o que o cliente aprova. Agora é
 * o documento do levantamento (quadros, aluguel por mês, condições, serviços,
 * prazos), o projeto pra abrir, e o aceite embaixo.
 *
 * Levantamento e projeto são UMA coisa só: "Levantamento técnico de projeto"
 * (Léo, 25/09). E o CONTRATO se lê aqui antes de aprovar — o arquivo congelado
 * no link, o MESMO que vai pra ClickSign quando ele aprova ("o contrato é o
 * mesmo"). Renderizado no navegador (docx-preview): nada sai pra visualizador
 * de terceiro.
 *
 * ⛔ Marca do TENANT, resolvida pelo domínio (`/public/branding`): nenhuma cor
 * nem nome de empresa escrito aqui. O rodapé vem da config do tenant, o mesmo
 * dos e-mails.
 *
 * Todas as chamadas usam skipAuth (endpoints @Public no backend).
 */

interface AceiteItem {
  produtoNome: string;
  descricao?: string | null;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  total: number;
}

interface Resumo {
  numero: string;
  criadaEm: string;
  validoAte: string | null;
  cliente: { razaoSocial: string; cnpj: string | null; endereco: string };
  signatarioNome: string | null;
  quadros: Array<{
    quadro: string;
    principal: boolean;
    tensaoV: number | null;
    correnteA: number | null;
    modelo: string;
    aluguelMensal: number;
  }>;
  aluguelMensalTotal: number;
  condicoes: {
    vigenciaMeses: number;
    diaVencimento: number;
    primeiroAluguelNoMes: number;
    garantiaMeses: number;
  };
  servicos: {
    customizacao: { quantidade: number; unitario: number; total: number } | null;
    total: number | null;
    parcelas: number;
    valorParcela: number | null;
  };
  prazos: {
    entregaDias: number | null;
    instalacaoDias: number | null;
    verificacaoDias: number | null;
    softwareDias: number | null;
  };
}

interface AceitePreview {
  numero: string;
  empresaNome: string;
  clienteNome: string;
  status: string;
  validoAte: string | null;
  formaPagamento: string;
  condicaoPagamento: string | null;
  subtotal: number;
  descontoGeral: number;
  valor: number;
  observacoes: string | null;
  jaRespondida: boolean;
  itens: AceiteItem[];
  resumo?: Resumo | null;
  anexos?: Array<{ id: string; nome: string; mime: string; tamanho: number }>;
  rodape?: string | null;
  /** Há contrato congelado pra ler (`aceite/:token/contrato`). */
  temContrato?: boolean;
}

/** Data "pura" (validade: 00:00 UTC) — no fuso de Brasília ela mostrava o dia anterior. */
export function dataPura(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
}

/** Instante real (criação) — no fuso de Brasília. */
function dataDoInstante(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const dias = (n: number | null) => (n == null ? '—' : `${n} dia${n === 1 ? '' : 's'}`);
const dois = (n: number) => String(n).padStart(2, '0');

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Texto sobre um fundo: escuro em cor clara (ex.: laranja), branco em cor escura. */
export function textoSobre(hex: string): string {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return '#ffffff';
  const canal = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  return lum > 0.18 ? '#0B1620' : '#ffffff';
}

function estilos(m: Marca): string {
  const { primaria, secundaria, acao } = m.cores;
  return `
  .ac { min-height:100vh; background:#e9eef3; color:#0B1620; padding:24px 12px 40px;
        font-family:'Source Sans 3','Segoe UI',Roboto,Arial,sans-serif; font-size:15px; line-height:1.45; }
  .ac * { box-sizing:border-box; }
  .ac-doc { max-width:860px; margin:0 auto; background:#fff; box-shadow:0 8px 30px rgba(0,0,0,.08); }
  .ac-topo { background:${escurecer(primaria, 0.35)}; padding:22px 32px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px; }
  .ac-topo img { height:44px; width:auto; display:block; }
  .ac-topo .nome { color:#fff; font-family:'Poppins',sans-serif; font-weight:600; font-size:20px; }
  .ac-ref { text-align:right; color:#fff; font-family:'Poppins',sans-serif; }
  .ac-ref .num { font-size:22px; font-weight:600; letter-spacing:-.01em; }
  .ac-eyebrow { font-family:'Poppins',sans-serif; font-weight:600; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:${primaria}; }
  .ac-ref .ac-eyebrow { color:#9ED6F0; }
  .ac-corpo { padding:8px 32px 28px; }
  .ac h1 { font-family:'Poppins',sans-serif; font-weight:600; font-size:28px; letter-spacing:-.02em; line-height:1.1; margin:26px 0 4px; color:${primaria}; }
  .ac .sub { color:#636363; margin:0 0 18px; }
  .ac section { margin-bottom:22px; }
  .ac-grade { display:grid; grid-template-columns:1.4fr 1fr; gap:10px 28px; margin-top:10px; }
  .ac-campo .rot { font-size:12px; color:#636363; }
  .ac-campo .val { font-weight:600; }
  .ac table { width:100%; border-collapse:collapse; margin-top:10px; }
  .ac th { font-family:'Poppins',sans-serif; font-weight:600; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#fff; background:${primaria}; text-align:left; padding:9px 12px; }
  .ac td { padding:9px 12px; border-bottom:1px solid #D0D0D0; vertical-align:top; }
  .ac td.n, .ac th.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ac-tabela { overflow-x:auto; }
  .ac-tag { display:inline-block; font-size:11px; font-weight:600; color:${escurecer(secundaria, 0.25)}; border:1px solid ${secundaria}; border-radius:3px; padding:0 6px; margin-left:6px; }
  .ac-total { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:12px; padding:14px 20px; background:#F5F5F5; border-left:8px solid ${acao}; }
  .ac-total .rot { font-family:'Poppins',sans-serif; font-weight:600; color:${primaria}; }
  .ac-total .val { font-family:'Poppins',sans-serif; font-weight:600; font-size:26px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ac-total .val small { font-size:13px; font-weight:500; color:#636363; }
  .ac-cond { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:12px; }
  .ac-cond > div { border-top:2px solid ${secundaria}; padding-top:8px; }
  .ac-cond .v { font-family:'Poppins',sans-serif; font-weight:600; font-size:18px; font-variant-numeric:tabular-nums; color:${primaria}; }
  .ac-cond .r { font-size:13px; color:#636363; }
  .ac-nota { font-size:13px; color:#636363; margin-top:8px; }
  .ac-anexo { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border:1px solid #D0D0D0; margin-top:8px; }
  .ac-anexo .nome { font-weight:600; word-break:break-all; }
  .ac-anexo .tam { font-size:12px; color:#636363; }
  .ac-btn { border:none; cursor:pointer; font-family:'Poppins',sans-serif; font-weight:600; font-size:15px; padding:14px 22px; border-radius:6px; }
  .ac-btn:disabled { opacity:.6; cursor:default; }
  .ac-btn.acao { background:${acao}; color:${textoSobre(acao)}; }
  .ac-btn.sec { background:#fff; color:${primaria}; border:1px solid ${primaria}; }
  .ac-btn.leve { background:#fff; color:#636363; border:1px solid #D0D0D0; }
  .ac-btn.perigo { background:#c43c3c; color:#fff; }
  .ac-decisao { border-top:3px solid ${primaria}; margin-top:8px; padding-top:18px; }
  .ac-decisao .linha { display:flex; gap:10px; margin-top:12px; }
  .ac-decisao .linha > * { flex:1; }
  .ac-decisao .linha > .acao { flex:2; }
  .ac-aviso { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; padding:12px 14px; font-size:14px; margin:18px 0 0; }
  .ac-erro { color:#c43c3c; font-size:14px; margin-top:10px; }
  .ac-rodape { border-top:3px solid ${primaria}; padding:16px 32px; font-size:12px; color:#636363; white-space:pre-line; }
  .ac-centro { text-align:center; padding:48px 20px; }
  .ac-contrato-acoes { display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
  .ac-contrato-leitor { margin-top:12px; border:1px solid #D0D0D0; background:#f3f3f3; max-height:75vh; overflow:auto; }
  .ac-contrato-leitor .docx-wrapper { padding:16px !important; background:#f3f3f3 !important; }
  .ac-contrato-leitor .docx-wrapper > section.docx { box-shadow:0 2px 8px rgba(0,0,0,.08); margin-bottom:16px !important; }
  @media (max-width: 640px) {
    .ac { padding:0 0 24px; }
    .ac-topo, .ac-corpo, .ac-rodape { padding-left:16px; padding-right:16px; }
    .ac-grade { grid-template-columns:1fr; }
    .ac-cond { grid-template-columns:repeat(2,1fr); }
    .ac h1 { font-size:24px; }
    .ac-total .val { font-size:22px; }
    .ac-contrato-leitor .docx-wrapper { padding:0 !important; }
    .ac-contrato-leitor .docx-wrapper > section.docx { width:100% !important; min-height:0 !important; padding:20px 16px !important; }
  }`;
}

export default function PropostaAceitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [m, setM] = useState<Marca>(marca());
  const [data, setData] = useState<AceitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<'ACEITA' | 'RECUSADA' | null>(null);
  const [confirmarRecusa, setConfirmarRecusa] = useState(false);
  const [contrato, setContrato] = useState<'fechado' | 'carregando' | 'aberto'>('fechado');
  const leitor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A marca vem pelo domínio; no 1º acesso (sem cache) ela chega depois do render.
    void carregarMarca()
      .then(setM)
      .catch(() => undefined);
    // Tipografia do documento (títulos e números / corpo).
    const id = 'fontes-proposta';
    if (!document.getElementById(id)) {
      const l = document.createElement('link');
      l.id = id;
      l.rel = 'stylesheet';
      l.href =
        'https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Source+Sans+3:wght@400;600&display=swap';
      document.head.appendChild(l);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AceitePreview>(`/propostas/aceite/${token}`, { skipAuth: true })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function decidir(decisao: 'ACEITA' | 'RECUSADA') {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/propostas/aceite/${token}/decidir`, { decisao }, { skipAuth: true });
      setResultado(decisao);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function abrirProjeto(anexoId: string) {
    setAbrindo(anexoId);
    setError(null);
    try {
      const r = await api.get<{ url: string }>(`/propostas/aceite/${token}/anexos/${anexoId}`, {
        skipAuth: true,
      });
      window.open(r.url, '_blank', 'noopener');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setAbrindo(null);
    }
  }

  /** Busca o .docx congelado (link temporário) — pra ler aqui ou baixar. */
  async function arquivoDoContrato(): Promise<{ blob: Blob; nome: string }> {
    const l = await api.get<{ url: string; nome: string }>(`/propostas/aceite/${token}/contrato`, {
      skipAuth: true,
    });
    const resp = await fetch(l.url);
    if (!resp.ok) throw new Error('Não consegui abrir o contrato. Tente de novo.');
    return { blob: await resp.blob(), nome: l.nome };
  }

  async function lerContrato() {
    if (contrato === 'aberto') {
      setContrato('fechado');
      return;
    }
    setContrato('carregando');
    setError(null);
    try {
      const [{ blob }, { renderAsync }] = await Promise.all([
        arquivoDoContrato(),
        import('docx-preview'),
      ]);
      setContrato('aberto');
      // O leitor só existe depois do 'aberto' renderizar.
      await new Promise((ok) => setTimeout(ok, 0));
      if (leitor.current) {
        leitor.current.innerHTML = '';
        await renderAsync(blob, leitor.current, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true });
      }
    } catch (err) {
      setContrato('fechado');
      setError(apiErrorMessage(err));
    }
  }

  async function baixarContrato() {
    setError(null);
    try {
      const { blob, nome } = await arquivoDoContrato();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const r = data?.resumo ?? null;
  const logo = m.logoNegativoUrl ?? m.logoUrl;

  return (
    <div className="ac">
      <style>{estilos(m)}</style>
      <div className="ac-doc">
        <header className="ac-topo">
          {logo ? (
            <img src={logo} alt={data?.empresaNome ?? m.nome} />
          ) : (
            <span className="nome">{data?.empresaNome ?? m.nome}</span>
          )}
          {data && (
            <div className="ac-ref">
              <div className="ac-eyebrow">{r ? 'Proposta de locação' : 'Proposta'}</div>
              <div className="num" data-testid="aceite-numero">
                {data.numero}
              </div>
            </div>
          )}
        </header>

        <div className="ac-corpo">
          {loading && <p className="ac-centro">Carregando proposta…</p>}

          {!loading && error && !data && (
            <div className="ac-centro">
              <h1>Link inválido ou expirado</h1>
              <p className="sub">{error}</p>
            </div>
          )}

          {resultado && (
            <div className="ac-centro" data-testid="aceite-resultado">
              <h1>{resultado === 'ACEITA' ? 'Proposta aprovada' : 'Proposta recusada'}</h1>
              <p className="sub">
                {resultado === 'ACEITA'
                  ? 'Obrigado! Em seguida você recebe o contrato para assinar eletronicamente.'
                  : 'Tudo bem. O responsável foi avisado da sua decisão.'}
              </p>
            </div>
          )}

          {data && !resultado && (
            <>
              {data.jaRespondida && (
                <div className="ac-aviso" data-testid="aceite-ja-respondida">
                  Esta proposta já foi respondida ou o link expirou. Caso precise, peça um novo link
                  ao responsável.
                </div>
              )}

              {r ? (
                <>
                  <h1>Levantamento técnico de projeto</h1>
                  <p className="sub">
                    Medição feita quadro a quadro. O modelo de cada quadro é definido pela corrente
                    medida.
                  </p>

                  <section>
                    <div className="ac-eyebrow">Cliente</div>
                    <div className="ac-grade">
                      <Campo rot="Razão social" val={r.cliente.razaoSocial} />
                      <Campo rot="CNPJ" val={r.cliente.cnpj ?? '—'} />
                      <Campo rot="Endereço" val={r.cliente.endereco || '—'} />
                      <Campo rot="Quem assina pelo cliente" val={r.signatarioNome ?? '—'} />
                      <Campo rot="Data do levantamento" val={dataDoInstante(r.criadaEm)} />
                      <Campo rot="Proposta válida até" val={dataPura(r.validoAte)} />
                    </div>
                  </section>

                  <section>
                    <div className="ac-eyebrow">Quadros medidos</div>
                    <div className="ac-tabela">
                      <table data-testid="aceite-quadros">
                        <thead>
                          <tr>
                            <th>Quadro / painel</th>
                            <th className="n">Tensão</th>
                            <th className="n">Corrente</th>
                            <th>Modelo</th>
                            <th className="n">Aluguel mensal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.quadros.map((q, i) => (
                            <tr key={i}>
                              <td>
                                {q.quadro}
                                {q.principal && <span className="ac-tag">principal</span>}
                              </td>
                              <td className="n">{q.tensaoV != null ? `${q.tensaoV} V` : '—'}</td>
                              <td className="n">{q.correnteA != null ? `${q.correnteA} A` : '—'}</td>
                              <td>{q.modelo}</td>
                              <td className="n">{fmtBRL(q.aluguelMensal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {r.quadros.some((q) => q.principal) && (
                      <p className="ac-nota">
                        Com acompanhamento, o quadro principal recebe o concentrador de dados e os
                        demais se comunicam com ele.
                      </p>
                    )}
                    <div className="ac-total" data-testid="aceite-total-mensal">
                      <span className="rot">Aluguel mensal total</span>
                      <span className="val">
                        {fmtBRL(r.aluguelMensalTotal)} <small>/ mês</small>
                      </span>
                    </div>
                  </section>

                  <section>
                    <div className="ac-eyebrow">Condições da locação</div>
                    <div className="ac-cond" data-testid="aceite-condicoes">
                      <Cartao v={`${r.condicoes.vigenciaMeses} meses`} r="vigência do contrato" />
                      <Cartao v={`dia ${dois(r.condicoes.diaVencimento)}`} r="vencimento mensal" />
                      <Cartao
                        v={`${r.condicoes.primeiroAluguelNoMes}º mês`}
                        r="1º aluguel, após o término da instalação"
                      />
                      <Cartao
                        v={`${r.condicoes.garantiaMeses} meses`}
                        r="garantia, a partir do término da instalação"
                      />
                    </div>
                  </section>

                  {r.servicos.total != null && (
                    <section>
                      <div className="ac-eyebrow">
                        Serviços de implantação · pagamento único, fora do aluguel
                      </div>
                      <div className="ac-tabela">
                        <table data-testid="aceite-servicos">
                          <thead>
                            <tr>
                              <th>Serviço</th>
                              <th className="n">Qtd</th>
                              <th className="n">Valor unitário</th>
                              <th className="n">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.servicos.customizacao && (
                              <tr>
                                <td>Customização do software</td>
                                <td className="n">{r.servicos.customizacao.quantidade}</td>
                                <td className="n">{fmtBRL(r.servicos.customizacao.unitario)}</td>
                                <td className="n">{fmtBRL(r.servicos.customizacao.total)}</td>
                              </tr>
                            )}
                            <tr>
                              <td>
                                <b>Instalação, materiais e customização</b> (total)
                              </td>
                              <td className="n" />
                              <td className="n" />
                              <td className="n">
                                <b>{fmtBRL(r.servicos.total)}</b>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {r.servicos.valorParcela != null && (
                        <p className="ac-nota">
                          Pago em {r.servicos.parcelas} parcelas de {fmtBRL(r.servicos.valorParcela)}.
                        </p>
                      )}
                    </section>
                  )}

                  <section>
                    <div className="ac-eyebrow">Prazos combinados</div>
                    <div className="ac-cond" data-testid="aceite-prazos">
                      <Cartao v={dias(r.prazos.entregaDias)} r="entrega" />
                      <Cartao v={dias(r.prazos.instalacaoDias)} r="instalação" />
                      <Cartao
                        v={dias(r.prazos.verificacaoDias)}
                        r="verificação, depois do fim da obra"
                      />
                      <Cartao v={dias(r.prazos.softwareDias)} r="software" />
                    </div>
                  </section>
                </>
              ) : (
                !data.jaRespondida && (
                  <>
                    <h1>Proposta {data.numero}</h1>
                    <p className="sub">Válida até {dataPura(data.validoAte)}</p>
                    <section>
                      <div className="ac-tabela">
                        <table data-testid="aceite-itens">
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th className="n">Qtd</th>
                              <th className="n">Preço</th>
                              <th className="n">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.itens.map((it, i) => (
                              <tr key={i}>
                                <td>
                                  {it.produtoNome}
                                  {it.descricao && <div className="ac-nota">{it.descricao}</div>}
                                </td>
                                <td className="n">{it.quantidade}</td>
                                <td className="n">{fmtBRL(it.precoUnitario)}</td>
                                <td className="n">{fmtBRL(it.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="ac-total">
                        <span className="rot">Total</span>
                        <span className="val">{fmtBRL(data.valor)}</span>
                      </div>
                    </section>
                  </>
                )
              )}

              {!data.jaRespondida && (data.anexos?.length ?? 0) > 0 && (
                <section data-testid="aceite-projeto">
                  <div className="ac-eyebrow">Levantamento técnico de projeto · arquivo</div>
                  <p className="ac-nota">
                    É o que você aprova: onde entra cada equipamento, em qual quadro.
                  </p>
                  {data.anexos!.map((a) => (
                    <div className="ac-anexo" key={a.id}>
                      <div>
                        <div className="nome">{a.nome}</div>
                        <div className="tam">{tamanhoLegivel(a.tamanho)}</div>
                      </div>
                      <button
                        type="button"
                        className="ac-btn sec"
                        data-testid={`aceite-abrir-projeto-${a.id}`}
                        disabled={abrindo !== null}
                        onClick={() => void abrirProjeto(a.id)}
                      >
                        {abrindo === a.id ? 'Abrindo…' : 'Abrir projeto'}
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {!data.jaRespondida && data.temContrato && (
                <section data-testid="aceite-contrato">
                  <div className="ac-eyebrow">Contrato</div>
                  <p className="ac-nota">
                    Leia antes de aprovar. É exatamente este contrato que você recebe para assinar.
                  </p>
                  <div className="ac-contrato-acoes">
                    <button
                      type="button"
                      className="ac-btn sec"
                      data-testid="aceite-ler-contrato"
                      disabled={contrato === 'carregando'}
                      onClick={() => void lerContrato()}
                    >
                      {contrato === 'carregando'
                        ? 'Abrindo…'
                        : contrato === 'aberto'
                          ? 'Fechar contrato'
                          : 'Ler o contrato'}
                    </button>
                    <button
                      type="button"
                      className="ac-btn leve"
                      data-testid="aceite-baixar-contrato"
                      onClick={() => void baixarContrato()}
                    >
                      Baixar
                    </button>
                  </div>
                  {contrato === 'aberto' && (
                    <div className="ac-contrato-leitor" ref={leitor} data-testid="aceite-contrato-leitor" />
                  )}
                </section>
              )}

              {error && <p className="ac-erro">{error}</p>}

              {!data.jaRespondida && (
                <div className="ac-decisao" data-testid="aceite-decisao">
                  <div className="ac-eyebrow">Aprovação</div>
                  <p className="ac-nota">
                    Ao aprovar, você recebe o contrato para assinar eletronicamente.
                  </p>
                  {!confirmarRecusa ? (
                    <div className="linha">
                      <button
                        type="button"
                        className="ac-btn leve"
                        onClick={() => setConfirmarRecusa(true)}
                        disabled={busy}
                      >
                        Recusar
                      </button>
                      <button
                        type="button"
                        className="ac-btn acao"
                        data-testid="aceite-aprovar"
                        onClick={() => void decidir('ACEITA')}
                        disabled={busy}
                      >
                        {busy ? 'Enviando…' : 'Aprovar proposta'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: '12px 0 0' }}>
                        Tem certeza que deseja recusar esta proposta?
                      </p>
                      <div className="linha">
                        <button
                          type="button"
                          className="ac-btn leve"
                          onClick={() => setConfirmarRecusa(false)}
                          disabled={busy}
                        >
                          Voltar
                        </button>
                        <button
                          type="button"
                          className="ac-btn perigo"
                          onClick={() => void decidir('RECUSADA')}
                          disabled={busy}
                        >
                          {busy ? 'Enviando…' : 'Confirmar recusa'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {data?.rodape && (
          <footer className="ac-rodape" data-testid="aceite-rodape">
            {data.rodape}
          </footer>
        )}
      </div>
    </div>
  );
}

function Campo({ rot, val }: { rot: string; val: string }) {
  return (
    <div className="ac-campo">
      <div className="rot">{rot}</div>
      <div className="val">{val}</div>
    </div>
  );
}

function Cartao({ v, r }: { v: string; r: string }) {
  return (
    <div>
      <div className="v">{v}</div>
      <div className="r">{r}</div>
    </div>
  );
}
