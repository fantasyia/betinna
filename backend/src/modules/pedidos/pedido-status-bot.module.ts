import { Module } from '@nestjs/common';
import { PedidoStatusBotService } from './pedido-status-bot.service';

/**
 * Módulo mínimo só pro status de pedido que o BOT lê.
 *
 * Existe pra quebrar um ciclo: o MullerBot precisa deste serviço, mas importar
 * o `PedidosModule` inteiro puxaria Fluxos → ... → MullerBot de volta, e o Nest
 * nem sobe ("Nest cannot create the FluxosModule instance"). Este serviço só
 * depende do Prisma, então merece módulo próprio em vez de `forwardRef`, que
 * esconderia o ciclo em vez de eliminá-lo.
 */
@Module({
  providers: [PedidoStatusBotService],
  exports: [PedidoStatusBotService],
})
export class PedidoStatusBotModule {}
