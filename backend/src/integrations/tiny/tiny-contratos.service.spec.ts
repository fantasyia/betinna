import { describe, expect, it, vi } from 'vitest';
import { TinyContratosService, type ContratoParaErp } from './tiny-contratos.service';
import { TinyV2ClientService } from './tiny-v2-client.service';

/**
 * Contrato de locação vive na API v2 do Tiny — a v3 não tem o objeto (sondado
 * contra a API real em 05/09). O que estes testes travam é o que essa API cobra
 * caro se sair errado: o contrato NÃO tem DELETE, então prazo errado vira
 * cobrança mensal eterna, e dado fiscal chutado vira imposto errado em NFS-e.
 */

const BASE: ContratoParaErp = {
  inicio: new Date(Date.UTC(2026, 8, 15)), // 15/09/2026
  descricao: 'Locação Master Block — PROP-0007',
  cliente: { nome: 'Indústria X', cpfCnpj: '12.345.678/0001-90' },
  valorMensal: 121,
  diaVencimento: 5,
  prazoMeses: 12,
};

const montar = (
  retorno: Record<string, unknown> = { registros: [{ registro: { id: 338242389 } }] },
) => {
  const chamar = vi.fn().mockResolvedValue(retorno);
  const svc = new TinyContratosService({ chamar, configurado: true } as never);
  return { svc, chamar };
};

/** O objeto viaja como STRING JSON dentro do campo `contrato` — é o mais fácil de errar. */
const corpoEnviado = (chamar: ReturnType<typeof vi.fn>) =>
  JSON.parse(chamar.mock.calls[0][1].contrato).contrato as Record<string, unknown>;

describe('TinyContratosService.incluir', () => {
  it('12 meses a partir de setembro terminam em AGOSTO — o que encerra é mes/ano_termino', async () => {
    // `nro_parcelas` NÃO limita nada (medido: valia 3 e o ERP gerou 5 cobranças).
    // Sem término, o contrato cobra para sempre.
    const { svc, chamar } = montar();

    await svc.incluir(BASE);

    const c = corpoEnviado(chamar);
    expect(c.mes_termino).toBe('08');
    expect(c.ano_termino).toBe('2027');
  });

  it('manda a data em dd/mm/yyyy e o valor com 2 casas — a v2 recusa o resto', async () => {
    const { svc, chamar } = montar();

    await svc.incluir(BASE);

    const c = corpoEnviado(chamar);
    expect(c.data).toBe('15/09/2026');
    expect(c.valor).toBe('121.00');
    expect(c.periodicidade).toBe(1);
    expect(c.vencimento).toBe('S');
    expect(c.dia_vencimento).toBe(5);
  });

  it('SEM dados fiscais o contrato entra sem emitir nota — não inventa ISS', async () => {
    const { svc, chamar } = montar();

    await svc.incluir(BASE);

    const c = corpoEnviado(chamar);
    expect(c.emite_nota).toBe('N');
    expect(c.nota).toBeUndefined();
  });

  it('com o bloco fiscal do tenant, emite nota com o código de lista dele', async () => {
    const { svc, chamar } = montar();

    await svc.incluir({
      ...BASE,
      nota: {
        codigoListaServico: '14.01',
        naturezaOperacao: 'Locação mensal de equipamento',
        percentualIss: 5,
        servicoCodigo: 'LOC-MB',
        servicoNome: 'Locação mensal Master Block IoT',
      },
    });

    const c = corpoEnviado(chamar);
    expect(c.emite_nota).toBe('S');
    expect(c.nota).toMatchObject({ codigo_lista_servico: '14.01', percentual_iss: '5.00' });
  });

  it('devolve o id que veio em registros[0].registro', async () => {
    const { svc } = montar();

    await expect(svc.incluir(BASE)).resolves.toEqual({ id: '338242389' });
  });

  it('retorno sem id NÃO passa por sucesso — senão o app acha que subiu', async () => {
    const { svc } = montar({ registros: [] });

    await expect(svc.incluir(BASE)).rejects.toThrow(/sem id no retorno/);
  });

  it('alterar manda o contrato INTEIRO com o id — a v2 substitui, não faz merge', async () => {
    const { svc, chamar } = montar({ status: 'OK' });

    await svc.alterar('338242389', BASE);

    const c = corpoEnviado(chamar);
    expect(c.id).toBe('338242389');
    expect(c.valor).toBe('121.00');
    expect(chamar.mock.calls[0][0]).toBe('contrato.alterar.php');
  });
});

describe('TinyV2ClientService', () => {
  const build = (data: unknown, token = 'tk-v2') => {
    const post = vi.fn().mockResolvedValue({ data });
    const svc = new TinyV2ClientService(
      { get: (k: string) => (k === 'TINY_V2_TOKEN' ? token : 5000) } as never,
      { post } as never,
    );
    return { svc, post };
  };

  it('erro da v2 vem dentro de HTTP 200 — quem olhasse só o status acharia que gravou', async () => {
    const { svc } = build({
      retorno: { status: 'Erro', erros: [{ erro: 'cliente nao informado' }] },
    });

    await expect(svc.chamar('contrato.incluir.php')).rejects.toThrow(/cliente nao informado/);
  });

  it('sem TINY_V2_TOKEN a integração está desligada e diz isso', async () => {
    const { svc, post } = build({ retorno: { status: 'OK' } }, '');

    expect(svc.configurado).toBe(false);
    await expect(svc.chamar('contrato.obter.php')).rejects.toThrow(/TINY_V2_TOKEN/);
    expect(post).not.toHaveBeenCalled();
  });

  it('manda form-urlencoded com token e formato json (não é JSON como a v3)', async () => {
    const { svc, post } = build({ retorno: { status: 'OK', contrato: { id: '1' } } });

    await svc.chamar('contrato.obter.php', { id: '1' });

    const body = post.mock.calls[0][1].body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('token')).toBe('tk-v2');
    expect(body.get('formato')).toBe('json');
    expect(body.get('id')).toBe('1');
  });
});
