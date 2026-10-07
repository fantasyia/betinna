import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import { copiarTexto } from './kit';

/**
 * Pagar o pedido pela vitrine (Asaas). Regra do Léo (07/10): Pix e cartão à
 * vista = preço da vitrine; parcelado = o cliente paga a taxa. O Pix é pago
 * aqui mesmo (QR + copia-e-cola); o cartão, na página segura do Asaas — o
 * número do cartão nunca passa pela vitrine. A confirmação chega sozinha.
 */

export interface AcessoPagamento {
  pedidoId: string;
  token: string;
}

interface OpcaoCartao {
  parcelas: number;
  total: number;
  parcela: number;
}

interface PagamentoAberto {
  metodo: 'PIX' | 'CARTAO';
  parcelas: number;
  valorCobrado: number;
  status: string;
  pix: { payload: string; imagem: string; expiraEm: string } | null;
  invoiceUrl: string | null;
}

interface Opcoes {
  pedido: { numero: string; status: string; total: number };
  disponivel: boolean;
  motivo: string | null;
  pix: { valor: number };
  cartao: OpcaoCartao[];
  pagamento: PagamentoAberto | null;
}

/** CPF (11) ou CNPJ (14) — só a contagem; o Asaas confere o dígito. */
export function documentoOk(v: string): boolean {
  const n = v.replace(/\D/g, '').length;
  return n === 11 || n === 14;
}

/** "3x de R$ 345,00" + o total, e o "sem acréscimo" do à vista. */
export function rotuloParcela(o: OpcaoCartao): { linha: string; detalhe: string } {
  if (o.parcelas === 1)
    return { linha: `À vista ${formatMoeda(o.total)}`, detalhe: 'sem acréscimo' };
  return {
    linha: `${o.parcelas}x de ${formatMoeda(o.parcela)}`,
    detalhe: `total ${formatMoeda(o.total)}`,
  };
}

const INTERVALO_STATUS_MS = 5_000;

export function Pagamento({
  slug,
  acesso,
  docInicial,
  empresa,
  onPago,
  onComecou,
}: {
  slug: string;
  acesso: AcessoPagamento;
  docInicial: string;
  empresa: string;
  onPago: () => void;
  /** Cobrança gerada: a reserva das peças ganhou mais tempo. */
  onComecou: () => void;
}) {
  const base = `/public/vitrine/${encodeURIComponent(slug)}/pedidos/${encodeURIComponent(acesso.pedidoId)}/pagamento`;
  const q = `?t=${encodeURIComponent(acesso.token)}`;
  const [op, setOp] = useState<Opcoes | null>(null);
  const [falhaLeitura, setFalhaLeitura] = useState(false);
  const [metodo, setMetodo] = useState<'PIX' | 'CARTAO'>('PIX');
  const [parcelas, setParcelas] = useState(1);
  const [doc, setDoc] = useState(docInicial);
  const [email, setEmail] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<PagamentoAberto | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pago, setPago] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .get<Opcoes>(base + q, { skipAuth: true })
      .then((r) => {
        if (!vivo) return;
        setOp(r);
        if (r.pedido.status === 'PAGO') setPago(true);
        if (r.pagamento?.status === 'PENDENTE') {
          setAberto(r.pagamento);
          setMetodo(r.pagamento.metodo);
          setParcelas(r.pagamento.parcelas);
        }
      })
      .catch(() => vivo && setFalhaLeitura(true));
    return () => {
      vivo = false;
    };
  }, [base, q]);

  // Com cobrança aberta, pergunta se já caiu (o aviso do Asaas confirma no servidor).
  const conferir = useCallback(async () => {
    try {
      const s = await api.get<{ pago: boolean }>(`${base}/status${q}`, { skipAuth: true });
      if (s.pago) {
        setPago(true);
        onPago();
      }
    } catch {
      /* rede oscilou: tenta na próxima volta */
    }
  }, [base, q, onPago]);

  useEffect(() => {
    if (!aberto || pago) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void conferir();
    }, INTERVALO_STATUS_MS);
    const aoVoltar = () => document.visibilityState === 'visible' && void conferir();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [aberto, pago, conferir]);

  async function gerar() {
    if (gerando || !documentoOk(doc)) return;
    setGerando(true);
    setErro(null);
    try {
      const r = await api.post<PagamentoAberto>(
        base,
        {
          token: acesso.token,
          metodo,
          parcelas: metodo === 'PIX' ? 1 : parcelas,
          cpfCnpj: doc,
          email: email.trim() || null,
        },
        { skipAuth: true },
      );
      setAberto(r);
      onComecou();
      if (r.metodo === 'CARTAO' && r.invoiceUrl) window.open(r.invoiceUrl, '_blank', 'noopener');
    } catch (e) {
      setErro(
        e instanceof ApiError && e.status === 429
          ? 'Muitas tentativas seguidas. Espere alguns minutos.'
          : apiErrorMessage(e),
      );
    } finally {
      setGerando(false);
    }
  }

  if (pago) {
    return (
      <div className="vt-pag vt-pag-ok" data-testid="vt-pago">
        <b>Pagamento confirmado ✓</b>
        <span>
          Suas peças estão garantidas. A {empresa} te chama no WhatsApp pra combinar o envio.
        </span>
      </div>
    );
  }
  // Sem online (erro de leitura ou indisponível): segue o combinado pelo WhatsApp.
  if (falhaLeitura || !op) return null;
  if (!op.disponivel && !aberto) {
    return op.motivo && op.motivo !== 'Pagamento online desligado' ? (
      <p className="vt-muted">{op.motivo}</p>
    ) : null;
  }

  if (aberto?.metodo === 'PIX' && aberto.pix) {
    const pix = aberto.pix;
    return (
      <div className="vt-pag" data-testid="vt-pix">
        <div className="vt-pag-tit">
          Pix de <b>{formatMoeda(aberto.valorCobrado)}</b>
        </div>
        <img
          className="vt-pix-qr"
          src={`data:image/png;base64,${pix.imagem}`}
          alt="QR Code do Pix"
          width={200}
          height={200}
        />
        <button
          type="button"
          className="vt-cta"
          data-testid="vt-pix-copiar"
          onClick={() => {
            void copiarTexto(pix.payload).then((ok) => {
              setCopiado(ok);
              if (ok) window.setTimeout(() => setCopiado(false), 2500);
            });
          }}
        >
          {copiado ? 'Código copiado ✓' : 'Copiar código Pix'}
        </button>
        <span className="vt-pag-espera">
          Aguardando o pagamento… a confirmação aparece aqui sozinha.
        </span>
        <button type="button" className="vt-pag-link" onClick={() => setAberto(null)}>
          Prefiro pagar com cartão
        </button>
      </div>
    );
  }

  if (aberto?.metodo === 'CARTAO' && aberto.invoiceUrl) {
    const url = aberto.invoiceUrl;
    return (
      <div className="vt-pag" data-testid="vt-cartao-aberto">
        <div className="vt-pag-tit">
          Cartão {aberto.parcelas > 1 ? `em ${aberto.parcelas}x` : 'à vista'} ·{' '}
          <b>{formatMoeda(aberto.valorCobrado)}</b>
        </div>
        <button
          type="button"
          className="vt-cta"
          data-testid="vt-cartao-abrir"
          onClick={() => window.open(url, '_blank', 'noopener')}
        >
          Abrir página de pagamento
        </button>
        <span className="vt-pag-espera">
          Pagamento em ambiente seguro do Asaas. Depois de pagar, volte aqui: a confirmação aparece
          sozinha.
        </span>
        <button type="button" className="vt-pag-link" onClick={() => setAberto(null)}>
          Trocar forma de pagamento
        </button>
      </div>
    );
  }

  return (
    <div className="vt-pag" data-testid="vt-pagar">
      <div className="vt-pag-tit">Pague agora e garanta as peças</div>
      <div className="vt-pag-abas" role="tablist">
        {(['PIX', 'CARTAO'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={metodo === m}
            className={metodo === m ? 'on' : ''}
            onClick={() => setMetodo(m)}
            data-testid={`vt-pag-${m.toLowerCase()}`}
          >
            {m === 'PIX' ? 'Pix' : 'Cartão'}
          </button>
        ))}
      </div>
      {metodo === 'PIX' ? (
        <div className="vt-pag-valor">
          <b>{formatMoeda(op.pix.valor)}</b>
          <span>sem acréscimo</span>
        </div>
      ) : (
        <div className="vt-parcelas" role="radiogroup" aria-label="Parcelas">
          {op.cartao.map((o) => {
            const r = rotuloParcela(o);
            return (
              <label key={o.parcelas} className={parcelas === o.parcelas ? 'on' : ''}>
                <input
                  type="radio"
                  name="vt-parcelas"
                  checked={parcelas === o.parcelas}
                  onChange={() => setParcelas(o.parcelas)}
                />
                <span>{r.linha}</span>
                <small>{r.detalhe}</small>
              </label>
            );
          })}
        </div>
      )}
      <div className="vt-form vt-pag-form">
        <label>
          CPF ou CNPJ de quem paga
          <input
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            inputMode="numeric"
            maxLength={20}
            data-testid="vt-pag-doc"
          />
        </label>
        {metodo === 'CARTAO' && (
          <label>
            <span>
              E-mail <small>(opcional, pro comprovante)</small>
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              maxLength={120}
              data-testid="vt-pag-email"
            />
          </label>
        )}
      </div>
      {erro && (
        <p className="vt-aviso" role="alert">
          {erro}
        </p>
      )}
      <button
        type="button"
        className="vt-cta"
        disabled={gerando || !documentoOk(doc)}
        onClick={() => void gerar()}
        data-testid="vt-pag-gerar"
      >
        {gerando ? 'Gerando…' : metodo === 'PIX' ? 'Gerar Pix' : 'Pagar com cartão'}
      </button>
      <span className="vt-pag-espera">O frete a {empresa} combina com você no WhatsApp.</span>
    </div>
  );
}
