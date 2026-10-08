import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';

/** Entrega do "Enviar pedido": CEP preenche, cota, escolhe; retirada só no mínimo. */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  apiErrorMessage: (e: unknown) => String(e),
}));

import {
  Entrega,
  enderecoCompleto,
  freteParaEnvio,
  freteResolvido,
  mascararCep,
  type Endereco,
  type EscolhaFrete,
} from './Entrega';

const vazio: Endereco = {
  cep: '',
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
};
const cheio: Endereco = {
  cep: '88350-000',
  endereco: 'Rua Azambuja',
  numero: '100',
  complemento: '',
  bairro: 'Centro',
  cidade: 'Brusque',
  uf: 'SC',
};

describe('regras', () => {
  it('máscara do CEP', () => {
    expect(mascararCep('88350000')).toBe('88350-000');
    expect(mascararCep('883')).toBe('883');
  });

  it('endereço completo pede CEP, rua, número, cidade e UF', () => {
    expect(enderecoCompleto(cheio)).toBe(true);
    expect(enderecoCompleto({ ...cheio, numero: ' ' })).toBe(false);
    expect(enderecoCompleto({ ...cheio, cep: '8835' })).toBe(false);
  });

  it('pode enviar: retirada sempre; entrega só com endereço E envio escolhido (ou a combinar)', () => {
    expect(freteResolvido(vazio, { tipo: 'retirada' })).toBe(true);
    expect(freteResolvido(cheio, null)).toBe(false);
    expect(freteResolvido(vazio, { tipo: 'servico', id: 1, preco: 30, volumes: 1 })).toBe(false);
    expect(freteResolvido(cheio, { tipo: 'servico', id: 1, preco: 30, volumes: 1 })).toBe(true);
    expect(freteResolvido(cheio, { tipo: 'aCombinar' })).toBe(true);
  });

  it('corpo do envio: só o id do serviço (o preço quem decide é o servidor)', () => {
    expect(freteParaEnvio(cheio, { tipo: 'servico', id: 2, preco: 58.9, volumes: 1 })).toEqual({
      entrega: {
        cep: '88350000',
        endereco: 'Rua Azambuja',
        numero: '100',
        complemento: '',
        bairro: 'Centro',
        cidade: 'Brusque',
        uf: 'SC',
      },
      frete: { servicoId: 2 },
    });
    expect(freteParaEnvio(vazio, { tipo: 'retirada' })).toEqual({
      entrega: undefined,
      frete: { retirada: true },
    });
    expect(freteParaEnvio(cheio, { tipo: 'aCombinar' }).frete).toBeUndefined();
  });
});

function Montado({ inicial = vazio, pecas = 60, minimo = 1000 as number | null }) {
  const [e, setE] = useState(inicial);
  const [escolha, setEscolha] = useState<EscolhaFrete>(null);
  const onEndereco = useCallback((p: Partial<Endereco>) => setE((x) => ({ ...x, ...p })), []);
  return (
    <>
      <Entrega
        slug="atacado-ribelt"
        empresa="Ribelt"
        frete={{ retiradaMinimoPecas: minimo, retiradaEndereco: 'Rua da Fábrica, 10', retiradaHorario: '8h–17h' }}
        pecas={pecas}
        itens={[{ corId: 'c1', tamanhoId: 'p', quantidade: pecas }]}
        endereco={e}
        onEndereco={onEndereco}
        escolha={escolha}
        onEscolha={setEscolha}
      />
      <output data-testid="escolha">{JSON.stringify(escolha)}</output>
      <output data-testid="rua">{e.endereco}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
});

describe('<Entrega>', () => {
  it('CEP completo: preenche a rua, cota e já marca o mais barato', async () => {
    apiGet.mockResolvedValue({ endereco: 'Rua Azambuja', bairro: 'Centro', cidade: 'Brusque', uf: 'SC' });
    apiPost.mockResolvedValue({
      ativo: true,
      indisponivel: null,
      volumes: [{ embalagem: 'Caixa', pecas: 60, pesoKg: 18.8 }],
      opcoes: [
        { id: 1, nome: 'PAC', transportadora: 'Correios', preco: 32.5, prazoDias: 6 },
        { id: 2, nome: 'SEDEX', transportadora: 'Correios', preco: 58.9, prazoDias: 2 },
      ],
    });
    render(<Montado />);
    fireEvent.change(screen.getByTestId('vt-f-cep'), { target: { value: '88350000' } });
    await waitFor(() => expect(screen.getByTestId('rua').textContent).toBe('Rua Azambuja'));
    expect(apiGet.mock.calls[0][0]).toBe('/public/vitrine/cep/88350000');
    await waitFor(() => expect(screen.getByTestId('vt-frete-1')).toBeTruthy());
    expect(apiPost.mock.calls[0][0]).toBe('/public/vitrine/atacado-ribelt/frete');
    expect(JSON.parse(screen.getByTestId('escolha').textContent!)).toMatchObject({ tipo: 'servico', id: 1 });
    fireEvent.click(screen.getByTestId('vt-frete-2'));
    expect(JSON.parse(screen.getByTestId('escolha').textContent!)).toMatchObject({ id: 2, preco: 58.9 });
    // Retirada não aparece abaixo do mínimo.
    expect(screen.queryByTestId('vt-modo-retirar')).toBeNull();
  });

  it('cotação indisponível: avisa que o frete é combinado e libera o envio', async () => {
    apiGet.mockResolvedValue(null);
    apiPost.mockResolvedValue({ ativo: true, indisponivel: 'Melhor Envio fora', opcoes: [], volumes: [] });
    render(<Montado />);
    fireEvent.change(screen.getByTestId('vt-f-cep'), { target: { value: '88350000' } });
    await waitFor(() => expect(screen.getByTestId('vt-frete-combinar')).toBeTruthy());
    expect(JSON.parse(screen.getByTestId('escolha').textContent!)).toEqual({ tipo: 'aCombinar' });
  });

  it('a partir do mínimo: dá pra retirar em mãos (R$ 0), sem CEP', () => {
    render(<Montado pecas={1200} />);
    fireEvent.click(screen.getByTestId('vt-modo-retirar'));
    expect(JSON.parse(screen.getByTestId('escolha').textContent!)).toEqual({ tipo: 'retirada' });
    expect(screen.getByTestId('vt-retirada').textContent).toContain('Rua da Fábrica, 10');
    expect(screen.queryByTestId('vt-f-cep')).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('endereço salvo no aparelho: não busca o CEP de novo (não sobrescreve a rua)', async () => {
    apiPost.mockResolvedValue({ ativo: true, indisponivel: null, volumes: [], opcoes: [] });
    render(<Montado inicial={cheio} />);
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiGet).not.toHaveBeenCalled();
  });
});
