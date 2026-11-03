import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@database/prisma.service';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { listaDaResposta } from './magis5-pedidos';
import { Magis5ClientService } from './magis5.client';

/** Situação da conexão com o Magis5: prova que a chave responde. Só leitura. */
@ApiTags('magis5')
@ApiBearerAuth()
@Controller('magis5')
export class Magis5Controller {
  constructor(
    private readonly client: Magis5ClientService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Testa a chave do Magis5 e mostra o que já foi lido' })
  async status(@CurrentUser() user: AuthenticatedUser) {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin vê o Magis5');
    }
    const empresaId = user.empresaIdAtiva;
    const [canais, conexao, pedidos] = await Promise.all([
      this.client.get(empresaId, '/channels', { limit: 100, page: 1 }),
      this.prisma.integracaoConexao.findUnique({
        where: { empresaId_servico: { empresaId, servico: 'magis5' } },
        select: { ultimoSync: true },
      }),
      this.prisma.magis5Pedido.count({ where: { empresaId } }),
    ]);
    return {
      chaveOk: true,
      canais: listaDaResposta(canais).length,
      pedidosLidos: pedidos,
      ultimoSync: conexao?.ultimoSync ?? null,
    };
  }
}
