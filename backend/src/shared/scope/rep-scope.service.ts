import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * Resolve quais "representantes" um usuário pode enxergar (filtro de carteira).
 *
 * Hierarquia:
 *   - ADMIN / DIRECTOR       → null (sem restrição, vê todo mundo)
 *   - GERENTE                → ids dos REPs com `gerenteId = user.id` + REPs órfãos
 *                              (sem gerente) **NÃO** entram aqui — quem cuida de órfão é
 *                              o DIRECTOR. Se o gerente não tem rep abaixo, retorna `[]`
 *                              (=> filtro vazio, não vê nada de carteira).
 *   - SAC                    → null (SAC não é filtrado por carteira em geral)
 *   - REP                    → [user.id]
 *
 * Convenção do retorno:
 *   - `null`       → não aplicar filtro (acesso amplo)
 *   - `string[]`   → restringir `representanteId IN (...)`. Array vazio = nega tudo.
 */
@Injectable()
export class RepScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async getRepIds(user: AuthenticatedUser): Promise<string[] | null> {
    if (user.role === 'ADMIN' || user.role === 'DIRECTOR' || user.role === 'SAC') {
      return null;
    }
    if (user.role === 'REP') {
      return [user.id];
    }
    // GERENTE: ids dos REPs sob sua gerência
    const reps = await this.prisma.usuario.findMany({
      where: { gerenteId: user.id, role: 'REP' },
      select: { id: true },
    });
    return reps.map((r) => r.id);
  }
}
