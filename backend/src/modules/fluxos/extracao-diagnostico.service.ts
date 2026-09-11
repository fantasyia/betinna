import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { conviteDaPergunta, extrairDeterministico } from './extracao-deterministica';
import { parseVariaveisGravadas } from './variaveis-gravadas.util';
import type { ExtracaoDiagDto } from './fluxos.dto';

/**
 * Pergunta à rede determinística o que ela faria com uma frase — sem conversa,
 * sem modelo, sem escrever nada.
 *
 * ## Por que isto precisou existir
 *
 * A rede é uma REDE: ela só age quando o modelo falha. E o modelo falha ~1 vez
 * em 10, de forma não-determinística. Então a única maneira de vê-la trabalhar
 * em produção era esperar uma falha acontecer com um cliente de verdade.
 *
 * ⚠️ Isso deixava a verificação no pior lugar possível: **"conferir o código" em
 * vez de "conferir o efeito"** — a distinção que custou três investigações neste
 * repo (ver o card do reaper mudo, que estava certo no arquivo e inerte em
 * campo). Uma rede de segurança que ninguém consegue ver disparar é
 * indistinguível de uma rede desligada.
 *
 * Aqui a frase entra pela porta de serviço e a resposta sai na hora.
 *
 * ## O que ela testa de VERDADE
 *
 * Passando `noId`, a declaração vem da config real do nó em produção — enum,
 * nomes, tudo. Não é um cenário escrito por quem já sabe a resposta: é o
 * contrato que está no ar. Se alguém editar o nó e quebrar a extração, este
 * diagnóstico passa a falhar junto, sem ninguém precisar lembrar de atualizar.
 *
 * ## O que ela NÃO faz
 *
 * Não chama o modelo, não toca no lead, não cria execução, não manda mensagem.
 * Lê UM nó e roda uma função pura. É ADMIN-only mesmo assim, porque expõe a
 * configuração de fluxo de um tenant.
 */
@Injectable()
export class ExtracaoDiagnosticoService {
  constructor(private readonly prisma: PrismaService) {}

  async simular(user: AuthenticatedUser, dto: ExtracaoDiagDto) {
    const declaracaoCrua = await this.resolverDeclaracao(user, dto);
    const declaradas = parseVariaveisGravadas(declaracaoCrua);
    const jaTem = (dto.jaTem ?? {}) as Record<string, unknown>;
    const convite = conviteDaPergunta(dto.perguntaAnterior);
    const resgatadas = extrairDeterministico(declaradas, dto.texto, jaTem, convite);

    return {
      texto: dto.texto,
      // `convite` é o que decide se número solto vale — sai explícito porque é
      // a parte menos óbvia da regra, e a primeira a suspeitar quando o
      // resultado surpreende.
      convite,
      declaradas: declaradas.map((d) => ({ nome: d.nome, valores: d.valores ?? null })),
      jaTem,
      resgatadas,
      // Vazio é resposta legítima (a rede é conservadora de propósito), então o
      // diagnóstico diz isso com todas as letras em vez de devolver `{}` mudo —
      // que foi exatamente o problema que a instrumentação deste módulo veio
      // resolver.
      resumo:
        Object.keys(resgatadas).length === 0
          ? 'A rede não afirmaria nada com esta frase — na dúvida ela não grava.'
          : `A rede preencheria: ${Object.entries(resgatadas)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}`,
    };
  }

  /** Do nó real (preferido) ou da lista passada à mão. */
  private async resolverDeclaracao(
    user: AuthenticatedUser,
    dto: ExtracaoDiagDto,
  ): Promise<unknown> {
    if (!dto.noId) return dto.declaradas ?? [];
    // Mesmo gate do resto do módulo: sem empresa ativa não há tenant a ler.
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const empresaId = user.empresaIdAtiva;
    const no = await this.prisma.fluxoNo.findFirst({
      where: { id: dto.noId, fluxo: { empresaId } },
      select: { config: true },
    });
    if (!no) {
      throw new NotFoundException('Nó não encontrado nesta empresa', ErrorCode.NOT_FOUND);
    }
    const cfg = (no.config ?? {}) as { variaveisGravadas?: unknown };
    return cfg.variaveisGravadas ?? [];
  }
}
