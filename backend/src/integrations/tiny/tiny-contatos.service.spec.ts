import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyContatosService } from './tiny-contatos.service';

/**
 * Achar-ou-criar contato no Tiny — a regra que o PEDIDO e o cadastro de
 * REPRESENTANTE compartilham.
 *
 * Contato duplicado é o defeito caro aqui: espalha histórico, cobrança e nota
 * por cadastros diferentes, e ninguém percebe até alguém procurar o cliente e
 * achar dois.
 */
function build(achados: Array<{ id: number; nome?: string; cpfCnpj?: string }> = []) {
  const client = {
    get: vi.fn().mockResolvedValue({ itens: achados }),
    post: vi.fn().mockResolvedValue({ id: 555 }),
  };
  return { svc: new TinyContatosService(client as never), client };
}

describe('contatos no Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('acha pelo DOCUMENTO, ignorando máscara dos dois lados', async () => {
    const { svc, client } = build([{ id: 77, cpfCnpj: '12.345.678/9000-99' }]);

    const id = await svc.garantir('emp-1', { nome: 'Somatec', cpfCnpj: '12345678900099' });

    expect(id).toBe(77);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('procura pelo documento FORMATADO (é assim que o Tiny guarda)', async () => {
    // Bug real de produção (29/08): buscando só por dígitos, o Tiny não achava
    // o contato existente; o passo seguinte tentava criar e o ERP respondia
    // "Contato com CPF ... já existe" — derrubando o pedido de um cliente que
    // estava cadastrado lá o tempo todo.
    const client = {
      get: vi.fn(async (_e: string, _c: string, q: Record<string, unknown>) =>
        q.cpfCnpj === '111.444.777-35'
          ? { itens: [{ id: 91, cpfCnpj: '111.444.777-35' }] }
          : { itens: [] },
      ),
      post: vi.fn().mockResolvedValue({ id: 555 }),
    };
    const svc = new TinyContatosService(client as never);

    const id = await svc.garantir('emp-1', { nome: 'Cliente', cpfCnpj: '11144477735' });

    expect(id).toBe(91);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('CNPJ também é procurado formatado', async () => {
    const client = {
      get: vi.fn(async (_e: string, _c: string, q: Record<string, unknown>) =>
        q.cpfCnpj === '16.774.052/0001-55'
          ? { itens: [{ id: 92, cpfCnpj: '16.774.052/0001-55' }] }
          : { itens: [] },
      ),
      post: vi.fn().mockResolvedValue({ id: 555 }),
    };
    const svc = new TinyContatosService(client as never);

    expect(await svc.garantir('emp-1', { nome: 'Somatec', cpfCnpj: '16774052000155' })).toBe(92);
  });

  it('com documento que não existe lá, CRIA — não cai pro nome', async () => {
    // Cair pro nome aqui juntaria duas pessoas diferentes num cadastro só:
    // "Marcelo" da empresa A e "Marcelo" da empresa B viram o mesmo contato.
    const { svc, client } = build([]);

    const id = await svc.garantir('emp-1', { nome: 'Marcelo', cpfCnpj: '52998224725' });

    expect(id).toBe(555);
    const buscas = client.get.mock.calls.map((c) => c[2] as Record<string, unknown>);
    expect(buscas.some((b) => b.nome)).toBe(false);
  });

  it('sem documento, o nome EXATO é o que sobra', async () => {
    const { svc, client } = build([{ id: 88, nome: 'Somatec Blocking' }]);

    const id = await svc.garantir('emp-1', { nome: 'somatec blocking' });

    expect(id).toBe(88);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('nome PARECIDO não conta como o mesmo contato', async () => {
    const { svc } = build([{ id: 88, nome: 'Somatec Blocking LTDA' }]);

    const id = await svc.garantir('emp-1', { nome: 'Somatec' });

    expect(id).toBe(555); // criou
  });

  it('11 dígitos = pessoa física; 14 = jurídica', async () => {
    const { svc, client } = build([]);

    await svc.criar('emp-1', { nome: 'Pessoa', cpfCnpj: '529.982.247-25' });
    expect((client.post.mock.calls[0][2] as { tipoPessoa: string }).tipoPessoa).toBe('F');

    await svc.criar('emp-1', { nome: 'Empresa', cpfCnpj: '12.345.678/0001-99' });
    expect((client.post.mock.calls[1][2] as { tipoPessoa: string }).tipoPessoa).toBe('J');
  });

  it('busca que falha não derruba: segue e cria', async () => {
    // Fila de contatos não pode parar por causa de um 500 na busca — o pior
    // caso é um contato a mais, e isso o documento resolve na próxima.
    const { svc, client } = build([]);
    client.get.mockRejectedValueOnce(new Error('500'));

    const id = await svc.garantir('emp-1', { nome: 'Alguém', cpfCnpj: '52998224725' });

    expect(id).toBe(555);
  });
});
