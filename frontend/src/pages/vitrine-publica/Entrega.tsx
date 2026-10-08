import { useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';

/**
 * Entrega do "Enviar pedido" (Checkout, itens 4 e 5): CEP que preenche o
 * endereço, número e complemento, a cotação do Melhor Envio e a escolha do
 * envio. Retirada em mãos (R$ 0) só a partir do mínimo de peças.
 *
 * O preço que aparece aqui é só pra o cliente decidir: o servidor cota de novo
 * na hora do pedido.
 */
export interface Endereco {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface FretePub {
  /** null = sem retirada pra ninguém. */
  retiradaMinimoPecas: number | null;
  retiradaEndereco?: string | null;
  retiradaHorario?: string | null;
}

export type EscolhaFrete =
  | { tipo: 'servico'; id: number; preco: number; volumes: number }
  | { tipo: 'retirada' }
  /** Não deu pra cotar: a empresa combina o frete no WhatsApp. */
  | { tipo: 'aCombinar' }
  | null;

interface CotacaoPub {
  ativo: boolean;
  indisponivel?: string | null;
  volumes?: Array<{ embalagem: string; pecas: number; pesoKg: number }>;
  opcoes?: Array<{ id: number; nome: string; transportadora: string; preco: number; prazoDias: number | null }>;
}

type Item = { corId: string; tamanhoId: string; quantidade: number };

export const soDigitos = (v: string) => v.replace(/\D/g, '');

export function mascararCep(v: string): string {
  const d = soDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Endereço pronto pra entrega (o que o servidor exige). */
export function enderecoCompleto(e: Endereco): boolean {
  return (
    soDigitos(e.cep).length === 8 &&
    e.endereco.trim().length >= 2 &&
    e.numero.trim().length >= 1 &&
    e.cidade.trim().length >= 2 &&
    /^[A-Z]{2}$/i.test(e.uf.trim())
  );
}

/** Pode enviar, do ponto de vista do frete? */
export function freteResolvido(e: Endereco, escolha: EscolhaFrete): boolean {
  if (escolha?.tipo === 'retirada') return true;
  return enderecoCompleto(e) && (escolha?.tipo === 'servico' || escolha?.tipo === 'aCombinar');
}

/** Corpo do envio: `entrega` (quando há endereço) e `frete` (o que foi escolhido). */
export function freteParaEnvio(e: Endereco, escolha: EscolhaFrete) {
  const entrega = enderecoCompleto(e)
    ? {
        cep: soDigitos(e.cep),
        endereco: e.endereco.trim(),
        numero: e.numero.trim(),
        complemento: e.complemento.trim(),
        bairro: e.bairro.trim(),
        cidade: e.cidade.trim(),
        uf: e.uf.trim().toUpperCase(),
      }
    : undefined;
  const frete =
    escolha?.tipo === 'servico'
      ? { servicoId: escolha.id }
      : escolha?.tipo === 'retirada'
        ? { retirada: true as const }
        : undefined;
  return { entrega, frete };
}

export function Entrega({
  slug,
  empresa,
  frete,
  pecas,
  itens,
  endereco: e,
  onEndereco,
  escolha,
  onEscolha,
}: {
  slug: string;
  empresa: string;
  frete: FretePub;
  pecas: number;
  itens: Item[];
  endereco: Endereco;
  onEndereco: (patch: Partial<Endereco>) => void;
  escolha: EscolhaFrete;
  onEscolha: (e: EscolhaFrete) => void;
}) {
  const podeRetirar = frete.retiradaMinimoPecas !== null && pecas >= frete.retiradaMinimoPecas;
  const retirando = escolha?.tipo === 'retirada';
  const cep = soDigitos(e.cep);
  const [cotacao, setCotacao] = useState<CotacaoPub | null>(null);
  const [cotando, setCotando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const cepBuscado = useRef(cep.length === 8 ? cep : '');
  const chaveItens = JSON.stringify(itens);

  // CEP completo e novo: preenche rua, bairro, cidade e UF.
  useEffect(() => {
    if (cep.length !== 8 || cep === cepBuscado.current) return;
    cepBuscado.current = cep;
    let vivo = true;
    api
      .get<{ endereco: string; bairro: string; cidade: string; uf: string } | null>(
        `/public/vitrine/cep/${cep}`,
        { skipAuth: true },
      )
      .then((r) => {
        if (vivo && r) onEndereco({ endereco: r.endereco, bairro: r.bairro, cidade: r.cidade, uf: r.uf });
      })
      .catch(() => undefined); // sem o serviço: a pessoa digita
    return () => {
      vivo = false;
    };
  }, [cep, onEndereco]);

  // Cota quando o CEP fecha (ou o carrinho muda). A escolha anterior cai.
  useEffect(() => {
    if (retirando || cep.length !== 8) {
      setCotacao(null);
      return;
    }
    let vivo = true;
    setCotando(true);
    setErro(null);
    onEscolha(null);
    const t = setTimeout(() => {
      api
        .post<CotacaoPub>(
          `/public/vitrine/${encodeURIComponent(slug)}/frete`,
          { cep, itens: JSON.parse(chaveItens) as Item[] },
          { skipAuth: true },
        )
        .then((r) => {
          if (!vivo) return;
          setCotacao(r);
          const mais = r.opcoes?.[0];
          if (mais) onEscolha({ tipo: 'servico', id: mais.id, preco: mais.preco, volumes: r.volumes?.length ?? 1 });
          else onEscolha({ tipo: 'aCombinar' });
        })
        .catch((err: unknown) => {
          if (!vivo) return;
          setErro(apiErrorMessage(err));
          onEscolha(null);
        })
        .finally(() => vivo && setCotando(false));
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [cep, chaveItens, slug, retirando, tentativa, onEscolha]);

  const nVolumes = cotacao?.volumes?.length ?? 0;
  return (
    <div className="vt-entrega" data-testid="vt-entrega">
      {podeRetirar && (
        <div className="vt-modo" role="radiogroup" aria-label="Como receber">
          <button
            type="button"
            role="radio"
            aria-checked={!retirando}
            className={!retirando ? 'on' : ''}
            onClick={() => retirando && onEscolha(null)}
            data-testid="vt-modo-entregar"
          >
            Entregar
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={retirando}
            className={retirando ? 'on' : ''}
            onClick={() => onEscolha({ tipo: 'retirada' })}
            data-testid="vt-modo-retirar"
          >
            Retirar em mãos · R$ 0
          </button>
        </div>
      )}

      {retirando ? (
        <p className="vt-retirada" data-testid="vt-retirada">
          Retire na {empresa}
          {frete.retiradaEndereco ? `: ${frete.retiradaEndereco}` : ''}
          {frete.retiradaHorario ? <small>{frete.retiradaHorario}</small> : null}
        </p>
      ) : (
        <>
          <div className="vt-dupla vt-dupla-cep">
            <label>
              CEP
              <input
                value={mascararCep(e.cep)}
                onChange={(x) => onEndereco({ cep: x.target.value })}
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="00000-000"
                data-testid="vt-f-cep"
              />
            </label>
            <label>
              Número
              <input
                value={e.numero}
                onChange={(x) => onEndereco({ numero: x.target.value })}
                maxLength={20}
                data-testid="vt-f-numero"
              />
            </label>
          </div>
          <label>
            Rua
            <input
              value={e.endereco}
              onChange={(x) => onEndereco({ endereco: x.target.value })}
              autoComplete="address-line1"
              maxLength={160}
              data-testid="vt-f-rua"
            />
          </label>
          <div className="vt-dupla">
            <label>
              <span>
                Complemento <small>(opcional)</small>
              </span>
              <input
                value={e.complemento}
                onChange={(x) => onEndereco({ complemento: x.target.value })}
                autoComplete="address-line2"
                maxLength={80}
                data-testid="vt-f-complemento"
              />
            </label>
            <label>
              Bairro
              <input
                value={e.bairro}
                onChange={(x) => onEndereco({ bairro: x.target.value })}
                maxLength={80}
                data-testid="vt-f-bairro"
              />
            </label>
          </div>
          <div className="vt-dupla vt-dupla-uf">
            <label>
              Cidade
              <input
                value={e.cidade}
                onChange={(x) => onEndereco({ cidade: x.target.value })}
                autoComplete="address-level2"
                maxLength={80}
                data-testid="vt-f-cidade"
              />
            </label>
            <label>
              UF
              <input
                value={e.uf}
                onChange={(x) =>
                  onEndereco({
                    uf: x.target.value
                      .replace(/[^a-z]/gi, '')
                      .slice(0, 2)
                      .toUpperCase(),
                  })
                }
                autoComplete="address-level1"
                data-testid="vt-f-uf"
              />
            </label>
          </div>

          <div className="vt-frete" aria-live="polite" data-testid="vt-frete">
            {cep.length !== 8 ? (
              <p className="vt-muted">Digite o CEP pra calcular o frete.</p>
            ) : cotando ? (
              <p className="vt-muted">Calculando o frete…</p>
            ) : erro ? (
              <p className="vt-aviso">
                {erro}{' '}
                <button type="button" className="vt-link" onClick={() => setTentativa((n) => n + 1)}>
                  tentar de novo
                </button>
              </p>
            ) : cotacao?.indisponivel || (cotacao && !cotacao.opcoes?.length) ? (
              <p className="vt-muted" data-testid="vt-frete-combinar">
                Não conseguimos calcular o frete agora. A {empresa} combina o frete com você no WhatsApp.{' '}
                <button type="button" className="vt-link" onClick={() => setTentativa((n) => n + 1)}>
                  tentar de novo
                </button>
              </p>
            ) : cotacao?.opcoes?.length ? (
              <>
                <div className="vt-frete-titulo">
                  <span>Frete</span>
                  <span>
                    {nVolumes} {nVolumes === 1 ? 'volume' : 'volumes'}
                  </span>
                </div>
                <div role="radiogroup" aria-label="Forma de envio" className="vt-frete-opcoes">
                  {cotacao.opcoes.map((o) => {
                    const on = escolha?.tipo === 'servico' && escolha.id === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={on ? 'on' : ''}
                        onClick={() => onEscolha({ tipo: 'servico', id: o.id, preco: o.preco, volumes: nVolumes })}
                        data-testid={`vt-frete-${o.id}`}
                      >
                        <span>
                          <b>{o.transportadora}</b> {o.nome}
                          {o.prazoDias !== null && <small>{o.prazoDias} dias úteis</small>}
                        </span>
                        <strong>{formatMoeda(o.preco)}</strong>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
