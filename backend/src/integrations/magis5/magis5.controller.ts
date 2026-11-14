import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@database/prisma.service';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Audit } from '@shared/decorators/audit.decorator';
import { ForbiddenException } from '@shared/errors/app-exception';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  type ChaveReservaMagis5Dto,
  chaveReservaMagis5Schema,
  Magis5EstoqueService,
} from './magis5-estoque.service';
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
    private readonly estoque: Magis5EstoqueService,
  ) {}

  private empresaDoDiretor(user: AuthenticatedUser): string {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin vê o Magis5');
    }
    return user.empresaIdAtiva;
  }

  @Get('estoque')
  @ApiOperation({
    summary: 'Reserva até a NF: chave, ledger e prévia do saldo que iria pro Magis5 (só leitura)',
  })
  estoqueSituacao(@CurrentUser() user: AuthenticatedUser) {
    return this.estoque.situacao(this.empresaDoDiretor(user));
  }

  @Put('estoque')
  @Audit({ action: 'update_config', resource: 'empresa' })
  @ApiOperation({
    summary:
      'Liga/desliga a reserva até a NF + baixa na nota + envio do saldo ao Magis5. **DIRETOR/ADMIN**',
  })
  estoqueChave(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(chaveReservaMagis5Schema)) dto: ChaveReservaMagis5Dto,
  ) {
    return this.estoque.salvarChave(this.empresaDoDiretor(user), dto);
  }

  @Get('sessao-teste')
  @ApiOperation({ summary: 'Testa o login do usuário no Magis5 (sem expor credencial)' })
  sessaoTeste(@CurrentUser() user: AuthenticatedUser) {
    if (!['ADMIN', 'DIRECTOR'].includes(user.role) || !user.empresaIdAtiva) {
      throw new ForbiddenException('Só diretor ou admin vê o Magis5');
    }
    return this.client.testarSessao(user.empresaIdAtiva);
  }

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
