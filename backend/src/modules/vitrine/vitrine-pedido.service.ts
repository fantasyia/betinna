import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { SequenceService } from '@shared/utils/sequence.service';
import type { PedidoVitrineDto } from './vitrine.dto';

type Faixa = 'entrada' | 'volume' | 'atacadao';
type Precos = {
  precoEntrada: Prisma.Decimal | null;
  precoVolume: Prisma.Decimal | null;
  precoAtacadao: Prisma.Decimal | null;
};

const ROTULO_FAIXA: Record<Faixa, string> = {
  entrada: 'Entrada',
  volume: 'Volume',
  atacadao: 'Atacadão',
};

/** Mesma regra da tela (`calculo.ts`): faixa pelo TOTAL de peças do pedido. */
export function faixaDoTotal(
  total: number,
  f: { minimoVolume: number | null; minimoAtacadao: number | null },
): Faixa {
  if (f.minimoAtacadao && total >= f.minimoAtacadao) return 'atacadao';
  if (f.minimoVolume && total >= f.minimoVolume) return 'volume';
  return 'entrada';
}

/** Faixa melhor sem preço usa a de baixo; null = "sob consulta". */
export function precoNaFaixa(l: Precos, faixa: Faixa): number | null {
  const ordem: Faixa[] =
    faixa === 'atacadao'
      ? ['atacadao', 'volume', 'entrada']
      : faixa === 'volume'
        ? ['volume', 'entrada']
        : ['entrada'];
  for (const fx of ordem) {
    const v =
      fx === 'atacadao' ? l.precoAtacadao : fx === 'volume' ? l.precoVolume : l.precoEntrada;
    if (v !== null && v !== undefined) return Number(v);
  }
  return null;
}

/** WhatsApp só com dígitos e com o 55 (sem ele o envio monta JID inválido). */
export function normalizarWhatsapp(bruto: string): string {
  const d = bruto.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/**
 * Pedido enviado pelo cliente na vitrine pública (`/v/:slug`).
 *
 * 🔒 O PREÇO É DAQUI, não do navegador: o cliente manda só "qual cor, qual
 * tamanho, quantas peças". Faixa e preço por peça são recalculados com o
 * cadastro do momento — o carrinho guardado no celular pode ter dias, e o
 * endpoint é aberto na internet.
 *
 * Entra como RASCUNHO com origem `VITRINE`: a equipe confere, fala com o
 * cliente e só então segue. Não sobe pra ERP nenhum e não gera comissão (não
 * tem representante — é venda de canal).
 */
@Injectable()
export class VitrinePedidoService {
  private readonly logger = new Logger(VitrinePedidoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly bus: FluxoEventBusService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  async enviar(
    slug: string,
    dto: PedidoVitrineDto,
  ): Promise<{ numero: string; totalPecas: number; total: number; duplicado: boolean }> {
    const vitrine = await this.prisma.vitrine.findUnique({
      where: { slug },
      select: {
        ativa: true,
        empresaId: true,
        minimoEntrada: true,
        minimoVolume: true,
        minimoAtacadao: true,
        empresa: { select: { ativo: true } },
      },
    });
    if (!vitrine || !vitrine.ativa || !vitrine.empresa.ativo)
      throw new NotFoundException('Vitrine');
    const empresaId = vitrine.empresaId;

    // Mesma célula repetida no payload soma (não duplica linha do pedido).
    const porCelula = new Map<string, { corId: string; tamanhoId: string; quantidade: number }>();
    for (const i of dto.itens) {
      const k = `${i.corId}|${i.tamanhoId}`;
      const atual = porCelula.get(k);
      if (atual) atual.quantidade += i.quantidade;
      else porCelula.set(k, { ...i });
    }
    const itens = [...porCelula.values()];
    const totalPecas = itens.reduce((s, i) => s + i.quantidade, 0);
    if (vitrine.minimoEntrada && totalPecas < vitrine.minimoEntrada) {
      throw new BusinessRuleException(
        `O pedido mínimo é de ${vitrine.minimoEntrada} peças.`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // Só o que a vitrine MOSTRA pode ser pedido: modelo ativo, cor ativa com
    // foto, linha e tamanho ativos — a mesma régua do endpoint de leitura.
    const variacoes = await this.prisma.catalogoVariacao.findMany({
      where: {
        empresaId,
        ativo: true,
        OR: itens.map((i) => ({ modeloCorId: i.corId, modeloTamanhoId: i.tamanhoId })),
        modelo: { ativo: true },
        modeloCor: { cor: { ativo: true }, fotos: { some: {} } },
        modeloLinha: { linha: { ativo: true } },
        modeloTamanho: { tamanho: { ativo: true } },
      },
      select: {
        modeloCorId: true,
        modeloTamanhoId: true,
        produtoId: true,
        modelo: { select: { nome: true } },
        modeloCor: { select: { cor: { select: { nome: true } } } },
        modeloLinha: {
          select: {
            precoEntrada: true,
            precoVolume: true,
            precoAtacadao: true,
            linha: { select: { nome: true } },
          },
        },
        modeloTamanho: { select: { tamanho: { select: { nome: true } } } },
      },
    });
    const porChave = new Map(variacoes.map((v) => [`${v.modeloCorId}|${v.modeloTamanhoId}`, v]));
    const faltando = itens.filter((i) => !porChave.has(`${i.corId}|${i.tamanhoId}`));
    if (faltando.length > 0) {
      // Carrinho velho com item que saiu da vitrine: recusa inteiro em vez de
      // aceitar meio pedido — a tela recarrega e mostra o que sobrou.
      throw new BusinessRuleException(
        'Alguns itens do seu pedido não estão mais disponíveis. Atualize a página e confira.',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    const faixa = faixaDoTotal(totalPecas, vitrine);
    const linhas = itens.map((i) => {
      const v = porChave.get(`${i.corId}|${i.tamanhoId}`)!;
      const preco = precoNaFaixa(v.modeloLinha, faixa);
      return {
        produtoId: v.produtoId,
        quantidade: i.quantidade,
        preco,
        descricao: `${v.modelo.nome} · ${v.modeloCor.cor.nome} · ${v.modeloLinha.linha.nome} ${v.modeloTamanho.tamanho.nome}`,
      };
    });
    const total = linhas.reduce((s, l) => s + (l.preco ?? 0) * l.quantidade, 0);
    const semPreco = linhas.filter((l) => l.preco === null);
    const whatsapp = normalizarWhatsapp(dto.whatsapp);

    // Clique duplo, rede que caiu depois de gravar, "enviar" de novo: mesmo
    // telefone, mesmo total e mesmas peças em 10 minutos é o MESMO pedido.
    const recente = await this.prisma.pedido.findFirst({
      where: {
        empresaId,
        origem: 'VITRINE',
        contatoTelefone: whatsapp,
        total: new Prisma.Decimal(total.toFixed(2)),
        criadoEm: { gte: new Date(Date.now() - 10 * 60_000) },
      },
      select: { numero: true, itens: { select: { quantidade: true } } },
    });
    if (recente && recente.itens.reduce((s, i) => s + i.quantidade, 0) === totalPecas) {
      return { numero: recente.numero, totalPecas, total, duplicado: true };
    }

    const cliente = await this.acharOuCriarCliente(empresaId, dto, whatsapp);
    const seq = await this.sequence.next(empresaId, 'pedido');
    const numero = `PED-${seq.toString().padStart(4, '0')}`;
    const local = [dto.cidade, dto.uf].filter(Boolean).join('/');

    const pedido = await this.prisma.pedido.create({
      data: {
        empresaId,
        numero,
        clienteId: cliente.id,
        contatoNome: dto.nome,
        contatoTelefone: whatsapp,
        // Venda de canal: sem representante (não gera comissão de rep).
        representanteId: null,
        origem: 'VITRINE',
        status: 'RASCUNHO',
        subtotal: new Prisma.Decimal(total.toFixed(2)),
        total: new Prisma.Decimal(total.toFixed(2)),
        comissao: new Prisma.Decimal(0),
        observacoes: [
          `Pedido da vitrine — ${totalPecas} peças, faixa ${ROTULO_FAIXA[faixa]}`,
          local ? `cliente em ${local}` : '',
          semPreco.length
            ? `PREÇO A CONFIRMAR (sob consulta): ${semPreco.map((l) => l.descricao).join('; ')}`
            : '',
          dto.observacoes ?? '',
        ]
          .filter(Boolean)
          .join(' — '),
        itens: {
          create: linhas.map((l) => ({
            produtoId: l.produtoId,
            quantidade: l.quantidade,
            precoUnitario: new Prisma.Decimal((l.preco ?? 0).toFixed(2)),
            desconto: 0,
            total: new Prisma.Decimal(((l.preco ?? 0) * l.quantidade).toFixed(2)),
          })),
        },
      },
      select: { id: true, numero: true },
    });

    this.logger.log(`[vitrine] ${slug}: pedido ${pedido.numero} (${totalPecas} peças, ${faixa})`);

    // Alguém precisa SABER: é cliente esperando resposta no WhatsApp.
    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['ADMIN', 'DIRECTOR', 'GERENTE'],
        tipo: 'GENERICO',
        titulo: `Novo pedido da vitrine: ${pedido.numero}`,
        mensagem: `${dto.nome}${local ? ` (${local})` : ''} — ${totalPecas} peças, R$ ${total.toFixed(2)}${semPreco.length ? ' + itens sob consulta' : ''}.`,
        prioridade: 'ALTA',
        link: `/pedidos/${pedido.id}`,
        metadata: { pedidoId: pedido.id, origem: 'VITRINE' },
      })
      .catch(() => undefined);

    void this.bus.disparar(empresaId, 'PEDIDO_CRIADO', {
      pedidoId: pedido.id,
      pedido: { id: pedido.id, numero: pedido.numero, total, totalPecas, faixa },
      origem: 'VITRINE',
      clienteId: cliente.id,
      cliente: { id: cliente.id, nome: dto.nome },
      telefone: whatsapp,
      representanteId: null,
    });

    return { numero: pedido.numero, totalPecas, total, duplicado: false };
  }

  /**
   * Documento primeiro, WhatsApp (sufixo de 8, D18) depois — a mesma regra do
   * checkout do site. Cadastro que já existe só ganha o que estava VAZIO: um
   * formulário aberto na internet não sobrescreve dado bom.
   */
  private async acharOuCriarCliente(
    empresaId: string,
    dto: PedidoVitrineDto,
    whatsapp: string,
  ): Promise<{ id: string }> {
    const doc = (dto.cpfCnpj ?? '').replace(/\D/g, '');
    let achado: { id: string } | undefined;
    if (doc) {
      const r = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Cliente"
        WHERE "empresaId" = ${empresaId}
          AND REGEXP_REPLACE(COALESCE("cnpj", ''), '[^0-9]', '', 'g') = ${doc}
        LIMIT 1`;
      achado = r[0];
    }
    if (!achado) {
      const sufixo = whatsapp.slice(-8);
      const r = await this.prisma.$queryRaw<Array<{ id: string; doc: string }>>`
        SELECT "id", REGEXP_REPLACE(COALESCE("cnpj", ''), '[^0-9]', '', 'g') AS doc
        FROM "Cliente"
        WHERE "empresaId" = ${empresaId}
          AND RIGHT(REGEXP_REPLACE(COALESCE("telefone", ''), '[^0-9]', '', 'g'), 8) = ${sufixo}
        LIMIT 1`;
      // Documento diferente veta o casamento por telefone (sufixo ignora DDD).
      if (r[0] && !(doc && r[0].doc && r[0].doc !== doc)) achado = { id: r[0].id };
    }

    if (achado) {
      const atual = await this.prisma.cliente.findUnique({
        where: { id: achado.id },
        select: { cnpj: true, telefone: true, cidade: true, uf: true },
      });
      const data: Prisma.ClienteUpdateInput = {};
      if (!atual?.cnpj && dto.cpfCnpj) data.cnpj = dto.cpfCnpj;
      if (!atual?.telefone) data.telefone = whatsapp;
      if (!atual?.cidade && dto.cidade) data.cidade = dto.cidade;
      if (!atual?.uf && dto.uf) data.uf = dto.uf;
      if (Object.keys(data).length) {
        await this.prisma.cliente.update({ where: { id: achado.id }, data });
      }
      return achado;
    }

    return this.prisma.cliente.create({
      data: {
        empresaId,
        nome: dto.nome,
        cnpj: dto.cpfCnpj ?? null,
        telefone: whatsapp,
        cidade: dto.cidade ?? null,
        uf: dto.uf ?? null,
        segmento: 'Atacado (vitrine)',
      },
      select: { id: true },
    });
  }
}
