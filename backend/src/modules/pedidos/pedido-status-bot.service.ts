import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';

/** Palavras que indicam pergunta sobre pedido — o gate que evita puxar dado à toa. */
const GATILHOS = [
  'pedido',
  'compra',
  'entrega',
  'entregue',
  'chegou',
  'rastrei',
  'código de rastreio',
  'codigo de rastreio',
  'transportadora',
  'nota fiscal',
  'nf',
  'enviado',
  'despach',
  'prazo',
  'saiu pra entrega',
  'saiu para entrega',
];

/** Como cada status aparece pro CLIENTE (o interno não diz nada pra ele). */
const TEXTO_STATUS: Record<string, string> = {
  RASCUNHO: 'em preparação',
  AGUARDANDO_APROVACAO: 'em análise',
  APROVADO: 'aprovado',
  ENVIADO_ERP: 'confirmado, em processamento',
  PAGO: 'pago',
  EM_SEPARACAO: 'em separação',
  ENVIADO: 'a caminho',
  ENTREGUE: 'entregue',
  CANCELADO: 'cancelado',
};

/**
 * O status do pedido no contexto do bot.
 *
 * Antes, "cadê meu pedido?" caía no atendimento humano — a informação existia
 * no app e o bot não a enxergava. Agora ela entra no contexto da IA, que
 * responde com o número, a situação e o rastreio.
 *
 * **Só entra quando a mensagem é sobre pedido.** Anexar isto em toda conversa
 * gastaria token à toa e, pior, colocaria dado de compra num papo que não pediu
 * — o cliente não espera ouvir o histórico dele porque disse "bom dia".
 *
 * **Só o pedido de QUEM está falando**, casado pelo telefone (sufixo de 8
 * dígitos, D18). Sem casar, devolve vazio: é melhor o bot dizer que não achou
 * do que contar o pedido de outra pessoa.
 */
@Injectable()
export class PedidoStatusBotService {
  private readonly logger = new Logger(PedidoStatusBotService.name);

  /** A mensagem pergunta sobre pedido? */
  ehPerguntaDePedido(mensagem: string): boolean {
    const t = (mensagem ?? '').toLowerCase();
    return GATILHOS.some((g) => t.includes(g));
  }

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bloco de texto pro prompt — vazio quando não há pedido (ou não é a hora).
   *
   * Devolver vazio é resposta legítima: o prompt não ganha seção nenhuma e a IA
   * segue como antes, em vez de receber "nenhum pedido encontrado" e repetir
   * isso pro cliente numa conversa que não era sobre pedido.
   */
  async contextoPorTelefone(empresaId: string, telefone: string): Promise<string> {
    const sufixo = (telefone ?? '').replace(/\D/g, '').slice(-8);
    if (sufixo.length < 8) return '';
    try {
      const linhas = await this.prisma.$queryRaw<
        Array<{
          numero: string;
          numeroSite: string | null;
          status: string;
          total: unknown;
          rastreioCodigo: string | null;
          rastreioUrl: string | null;
          criadoEm: Date;
        }>
      >`
        SELECT p."numero", p."numeroSite", p."status", p."total",
               p."rastreioCodigo", p."rastreioUrl", p."criadoEm"
        FROM "Pedido" p
        JOIN "Cliente" c ON c."id" = p."clienteId"
        WHERE p."empresaId" = ${empresaId}
          AND RIGHT(REGEXP_REPLACE(COALESCE(c."telefone", ''), '[^0-9]', '', 'g'), 8) = ${sufixo}
        ORDER BY p."criadoEm" DESC
        LIMIT 3`;
      if (linhas.length === 0) return '';

      const itens = linhas.map((p) => {
        const quando = p.criadoEm.toLocaleDateString('pt-BR');
        const situacao = TEXTO_STATUS[p.status] ?? p.status.toLowerCase();
        const rastreio = p.rastreioCodigo
          ? ` · rastreio ${p.rastreioCodigo}${p.rastreioUrl ? ` (${p.rastreioUrl})` : ''}`
          : '';
        // O número que o cliente conhece é o do SITE quando a compra veio de lá.
        const numero = p.numeroSite ?? p.numero;
        return `- Pedido ${numero} de ${quando}: ${situacao}${rastreio}`;
      });

      return [
        'PEDIDOS DESTE CLIENTE (dados reais do sistema — use-os para responder;',
        'não invente prazo, código de rastreio nem data que não estejam aqui):',
        ...itens,
      ].join('\n');
    } catch (err) {
      // Fail-open: bot sem o contexto responde pior, mas responde. Derrubar a
      // conversa por causa de uma consulta é troca ruim.
      this.logger.warn(
        `[bot] status de pedido não carregou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }
}
