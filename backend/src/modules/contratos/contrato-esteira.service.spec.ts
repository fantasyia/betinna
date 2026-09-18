import { describe, expect, it, vi } from 'vitest';
import { ContratoEsteiraService } from './contrato-esteira.service';

/**
 * A esteira pós-assinatura: contrato assinado abre um card com os dados do
 * contrato/cliente, e cada etapa é uma coluna pro diretor comercial acompanhar
 * visualmente.
 *
 * 📌 As etapas são as do quadro **Diretoria**, que o Léo montou à mão e mandou
 * em foto (18/09) — não as seis que eu tinha suposto no dia anterior.
 *
 * ⚠️ Descongela de propósito o que ficou congelado em 14/09 ("pós-contrato é
 * manual do Leandro até o primeiro contrato subir"). O Léo confirmou em 17/09:
 * nenhum contrato subiu ainda, e mesmo assim ele quer as etapas funcionando.
 */
const CONTRATO = {
  id: 'ct-1',
  empresaId: 'emp-1',
  valorMensal: '2961.00',
  prazoMeses: 36,
  assinadoEm: new Date('2026-09-17T12:00:00Z'),
  cliente: { nome: 'Metalúrgica Alfa', cnpj: '12.345.678/0001-90', cidade: 'Joinville', uf: 'SC' },
  proposta: { numero: 'PROP-0042' },
  representante: { nome: 'Marcelo Harada' },
};

function build(
  opts: {
    cardExistente?: boolean;
    quadro?: boolean;
    quadroDoDiretor?: boolean;
    dono?: boolean;
  } = {},
) {
  const listasCriadas: Array<{ nome: string }> = [];
  const prisma = {
    contrato: { findUnique: vi.fn().mockResolvedValue(CONTRATO) },
    kanbanCard: {
      findFirst: vi
        .fn()
        // 1ª chamada = guarda de idempotência; 2ª = última posição da lista.
        .mockResolvedValueOnce(opts.cardExistente ? { id: 'card-velho' } : null)
        .mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'card-novo' }),
    },
    kanbanBoard: {
      // 1ª chamada = quadro já marcado como esteira; 2ª = adoção pelo nome.
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(opts.quadro ? { id: 'board-1' } : null)
        .mockResolvedValue(opts.quadroDoDiretor ? { id: 'board-diretoria' } : null),
      create: vi.fn().mockResolvedValue({ id: 'board-novo' }),
      update: vi.fn().mockResolvedValue({ id: 'board-diretoria' }),
    },
    kanbanLista: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn((args: { data: { nome: string } }) => {
        listasCriadas.push({ nome: args.data.nome });
        return Promise.resolve({ id: `lista-${listasCriadas.length}` });
      }),
    },
    usuario: {
      findFirst: vi.fn().mockResolvedValue(opts.dono === false ? null : { id: 'leandro' }),
    },
  };
  return { svc: new ContratoEsteiraService(prisma as never), prisma, listasCriadas };
}

describe('esteira pós-assinatura', () => {
  /**
   * 🔴 Os nomes vão LITERAIS aqui de propósito.
   *
   * A versão anterior deste teste comparava `listasCriadas` com a própria
   * constante `ETAPAS` — asserção circular: eu troquei as seis etapas pelas oito
   * do quadro real e os seis testes continuaram verdes, sem vigiar nada.
   *
   * O `garantirColunas` casa coluna por NOME. Um emoji, um acento ou um espaço
   * a mais aqui não renomeia a coluna do diretor: cria uma SEGUNDA ao lado, e o
   * quadro dele amanhece com o dobro de colunas.
   */
  const ETAPAS_DO_QUADRO = [
    'Contrato Assinado',
    'Consulta Serasa',
    'Gerar Proposta + Pedido de Venda ERP',
    'Enviar Para Produção',
    'Emissão Fiscal Comodato',
    'Expedição',
    'Aguardando Instalação',
    'Instalado',
  ];

  it('as colunas são as do quadro Diretoria, escritas igual', () => {
    expect([...ContratoEsteiraService.ETAPAS]).toEqual(ETAPAS_DO_QUADRO);
  });

  it('contrato assinado entra em "Contrato Assinado", não já no Serasa', async () => {
    const { svc, prisma, listasCriadas } = build();

    const r = await svc.entrarNaEsteira('ct-1');

    expect(r).toBe('criado');
    expect(listasCriadas.map((l) => l.nome)).toEqual(ETAPAS_DO_QUADRO);
    // A coluna de ENTRADA é a primeira. O card nasce ali e o diretor arrasta
    // pro Serasa quando começa — nascer já em consulta diria que uma etapa
    // aconteceu sem ninguém ter feito nada.
    expect(prisma.kanbanCard.create.mock.calls[0][0].data.listaId).toBe('lista-1');
    expect(listasCriadas[0].nome).toBe('Contrato Assinado');
  });

  /**
   * 🔴 O diretor montou o quadro à mão. Se a esteira criasse um paralelo, ele
   * teria DOIS lugares: aquele onde arrasta os cards, e outro onde os contratos
   * assinados apareceriam de verdade. Nada acusaria — os dois existiriam.
   */
  it('ADOTA o quadro que o diretor já montou em vez de criar outro', async () => {
    const { svc, prisma } = build({ quadroDoDiretor: true });

    await svc.entrarNaEsteira('ct-1');

    expect(prisma.kanbanBoard.create).not.toHaveBeenCalled();
    expect(prisma.kanbanBoard.update).toHaveBeenCalledWith({
      where: { id: 'board-diretoria' },
      data: { tipoSistema: 'contratos_esteira' },
    });
  });

  it('a adoção só pega quadro SEM tipoSistema', async () => {
    const { svc, prisma } = build({ quadroDoDiretor: true });

    await svc.entrarNaEsteira('ct-1');

    // Sem esta guarda, um quadro de sistema com nome parecido (o espelho
    // `diretor_tarefas`) poderia ser sequestrado, e os contratos cairiam no meio
    // das tarefas espelhadas dos reps.
    const filtro = prisma.kanbanBoard.findFirst.mock.calls[1][0].where;
    expect(filtro.tipoSistema).toBeNull();
    expect(filtro.nome).toBe('Diretoria');
  });

  /**
   * 🔴 A ClickSign REENTREGA o webhook — é o comportamento certo dela. Sem esta
   * guarda o mesmo contrato viraria dois cards e o Leandro faria o trabalho duas
   * vezes (duas consultas Serasa, duas ordens de produção).
   */
  it('reentrega do webhook NÃO cria card duplicado', async () => {
    const { svc, prisma } = build({ cardExistente: true });

    const r = await svc.entrarNaEsteira('ct-1');

    expect(r).toBe('repetido');
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });

  it('o card leva o que o Leandro precisa pra agir sem abrir o app', async () => {
    const { svc, prisma } = build();

    await svc.entrarNaEsteira('ct-1');

    const card = prisma.kanbanCard.create.mock.calls[0][0].data as {
      titulo: string;
      descricao: string;
    };
    expect(card.titulo).toContain('Metalúrgica Alfa');
    expect(card.titulo).toContain('PROP-0042');
    // O CNPJ é o insumo da primeira etapa: sem ele não dá pra consultar o Serasa.
    expect(card.descricao).toContain('12.345.678/0001-90');
    expect(card.descricao).toContain('Marcelo Harada');
  });

  it('quadro que já existe é reaproveitado, não recriado', async () => {
    const { svc, prisma } = build({ quadro: true });

    await svc.entrarNaEsteira('ct-1');

    expect(prisma.kanbanBoard.create).not.toHaveBeenCalled();
  });

  /**
   * O dono do quadro é o DIRETOR — é ele quem opera a esteira. Sem diretor nem
   * admin ativo o quadro não nasce, e isso sai como `pulado` em vez de estourar:
   * quem chama é o handler de assinatura, e lá o contrato já está assinado.
   */
  it('empresa sem DIRECTOR/ADMIN ativo: pula, não quebra', async () => {
    const { svc, prisma } = build({ dono: false });

    const r = await svc.entrarNaEsteira('ct-1');

    expect(r).toBe('pulado');
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });

  it('contrato que não existe: pula limpo', async () => {
    const { svc, prisma } = build();
    prisma.contrato.findUnique.mockResolvedValueOnce(null);

    expect(await svc.entrarNaEsteira('sumiu')).toBe('pulado');
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });
});
