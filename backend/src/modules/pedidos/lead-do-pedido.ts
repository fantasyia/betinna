import type { Logger } from '@nestjs/common';
import type { PrismaService } from '@database/prisma.service';
import type { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { registrarTransicaoEtapa } from '@modules/leads/lead-etapa-historico.util';

/**
 * Ligar o pedido ao LEAD do funil (card cmv8qmn390001nz5ioyc2u4bw — Léo/#01,
 * 14/10). Só age na empresa com `Empresa.config.funilPedidos`; sem ela, nada
 * muda (as outras empresas ficam como estão).
 *
 * - Pedido CRIADO: acha o lead pelo telefone (últimos 8 dígitos, D18) ou cria
 *   na etapa `criadoEtapaId`; liga lead ↔ cliente; move pra `criadoEtapaId`.
 * - Pedido PAGO: lead no MESMO funil de `pagoEtapaId` → move pra lá; sem lead
 *   nenhum (borda) → cria em `pagoSemLeadEtapaId` (ex.: Recompra · 1ª compra).
 *
 * Lead criado aqui NÃO dispara LEAD_CRIADO (o fluxo do formulário do Meta não
 * fala com quem comprou na vitrine); quem conduz é o PEDIDO_CRIADO/PEDIDO_PAGO.
 * Mover dispara LEAD_ETAPA_MUDOU como o MOVER_LEAD_ETAPA dos fluxos.
 * Melhor esforço: erro vira log, o pedido segue.
 */

export interface FunilPedidos {
  criadoEtapaId?: string;
  pagoEtapaId?: string;
  pagoSemLeadEtapaId?: string;
}

export function funilPedidos(config: unknown): FunilPedidos | null {
  const f = ((config ?? {}) as { funilPedidos?: FunilPedidos }).funilPedidos;
  return f && (f.criadoEtapaId || f.pagoEtapaId || f.pagoSemLeadEtapaId) ? f : null;
}

type Deps = {
  prisma: PrismaService;
  bus?: FluxoEventBusService;
  logger: Pick<Logger, 'log' | 'warn' | 'error'>;
};

export async function ligarLeadDoPedido(
  d: Deps,
  pedidoId: string,
  momento: 'CRIADO' | 'PAGO',
): Promise<string | null> {
  try {
    const p = await d.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        empresaId: true,
        numero: true,
        clienteId: true,
        contatoNome: true,
        contatoTelefone: true,
        cliente: { select: { nome: true, telefone: true } },
        empresa: { select: { config: true } },
      },
    });
    if (!p) return null;
    const cfg = funilPedidos(p.empresa.config);
    if (!cfg) return null;
    const telefone = p.contatoTelefone ?? p.cliente?.telefone ?? '';
    const digitos = telefone.replace(/\D/g, '');

    // 1) O lead: o já ligado ao cliente, senão pelo telefone (D18).
    let lead = p.clienteId
      ? await d.prisma.lead.findFirst({
          where: { empresaId: p.empresaId, clienteId: p.clienteId },
          orderBy: { atualizadoEm: 'desc' },
          select: { id: true, funilId: true, funilEtapaId: true, clienteId: true },
        })
      : null;
    if (!lead && digitos.length >= 8) {
      const rows = await d.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Lead"
        WHERE "empresaId" = ${p.empresaId}
          AND "contatoTelefone" IS NOT NULL
          AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${digitos.slice(-8)}
        ORDER BY "atualizadoEm" DESC
        LIMIT 1`;
      if (rows[0]) {
        lead = await d.prisma.lead.findUnique({
          where: { id: rows[0].id },
          select: { id: true, funilId: true, funilEtapaId: true, clienteId: true },
        });
      }
    }

    // 2) Sem lead: cria (CRIADO → etapa do pedido montado; PAGO → borda).
    if (!lead) {
      const etapaId = momento === 'CRIADO' ? cfg.criadoEtapaId : cfg.pagoSemLeadEtapaId;
      if (!etapaId || digitos.length < 8) return null;
      const etapa = await etapaDaEmpresa(d, p.empresaId, etapaId);
      if (!etapa) return null;
      const nome = (p.contatoNome ?? p.cliente?.nome ?? telefone).trim() || telefone;
      const novo = await d.prisma.lead.create({
        data: {
          empresaId: p.empresaId,
          nome,
          contatoNome: nome,
          contatoTelefone: telefone,
          funilId: etapa.funilId,
          funilEtapaId: etapa.id,
          etapa: enumDa(etapa.tipo),
          origemCadastro: 'vitrine',
          canalOrigem: 'SITE',
          clienteId: p.clienteId,
        },
        select: { id: true },
      });
      await registrarTransicaoEtapa(d.prisma, d.logger as Logger, {
        empresaId: p.empresaId,
        leadId: novo.id,
        funilId: etapa.funilId,
        etapaOrigem: null,
        etapaDestino: etapa.id,
        origemMudanca: 'api',
      });
      d.logger.log(`[funil] ${p.numero}: lead ${novo.id} criado em ${etapa.id} (${momento})`);
      return novo.id;
    }

    // 3) Liga lead ↔ cliente (só preenche o vazio).
    if (!lead.clienteId && p.clienteId) {
      await d.prisma.lead.updateMany({
        where: { id: lead.id, clienteId: null },
        data: { clienteId: p.clienteId },
      });
    }

    // 4) Move.
    const destinoId = momento === 'CRIADO' ? cfg.criadoEtapaId : cfg.pagoEtapaId;
    if (destinoId && lead.funilEtapaId !== destinoId) {
      const etapa = await etapaDaEmpresa(d, p.empresaId, destinoId);
      // PAGO só move quem está no funil da venda (quem está em outro funil fica).
      if (etapa && (momento === 'CRIADO' || lead.funilId === etapa.funilId)) {
        await d.prisma.lead.updateMany({
          where: { id: lead.id, empresaId: p.empresaId },
          data: {
            funilId: etapa.funilId,
            funilEtapaId: etapa.id,
            etapa: enumDa(etapa.tipo),
            etapaDesde: new Date(),
          },
        });
        await registrarTransicaoEtapa(d.prisma, d.logger as Logger, {
          empresaId: p.empresaId,
          leadId: lead.id,
          funilId: etapa.funilId,
          etapaOrigem: lead.funilEtapaId ?? null,
          etapaDestino: etapa.id,
          origemMudanca: 'api',
        });
        await d.bus?.disparar(p.empresaId, 'LEAD_ETAPA_MUDOU', {
          leadId: lead.id,
          funilId: etapa.funilId,
          deFunilEtapaId: lead.funilEtapaId ?? undefined,
          paraFunilEtapaId: etapa.id,
          _hops: 1,
        });
        d.logger.log(`[funil] ${p.numero}: lead ${lead.id} → ${etapa.id} (${momento})`);
      }
    }
    return lead.id;
  } catch (err) {
    d.logger.warn(`[funil] pedido ${pedidoId} (${momento}): não ligou o lead — ${String(err)}`);
    return null;
  }
}

async function etapaDaEmpresa(d: Deps, empresaId: string, etapaId: string) {
  return d.prisma.funilEtapa.findFirst({
    where: { id: etapaId, funil: { empresaId } },
    select: { id: true, funilId: true, tipo: true },
  });
}

const enumDa = (tipo: string) =>
  tipo === 'GANHO' ? 'GANHO' : tipo === 'PERDIDO' ? 'PERDIDO' : 'QUALIFICANDO';
