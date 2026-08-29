import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyContatosService } from './tiny-contatos.service';

export interface ResultadoSyncReps {
  candidatos: number;
  criados: number;
  jaExistiam: number;
  semDocumento: number;
  erros: number;
}

/** Teto por rodada — a fila real é de alguns por semana, não de centenas. */
const MAX_POR_RODADA = 100;

/**
 * Sobe os representantes novos como CONTATO no ERP.
 *
 * Regra do Léo (28/08): todo rep que entra no app tem que existir no Tiny. É lá
 * que ele vira **vendedor** — e é o vendedor no pedido que faz o pedido voltar
 * pro rep certo aqui dentro (hoje, sem casar, o pedido entra sem dono e some da
 * tela dele).
 *
 * **Contato o app cria; VENDEDOR não.** A API do Tiny só lê vendedores — virar
 * vendedor é marcar o papel no painel, em Cadastros → Vendedores. Então esta
 * rodada entrega o contato pronto e o resto é um clique do Léo, não uma
 * digitação inteira.
 *
 * **Sem documento, não sobe.** CPF/CNPJ é a chave que evita contato duplicado; o
 * nome varia demais. Rep sem documento entra no contador `semDocumento` — dado
 * faltando é pendência de cadastro, não erro de integração.
 */
@Injectable()
export class TinyRepsSyncService {
  private readonly logger = new Logger(TinyRepsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contatos: TinyContatosService,
  ) {}

  async sincronizar(empresaId: string): Promise<ResultadoSyncReps> {
    const r: ResultadoSyncReps = {
      candidatos: 0,
      criados: 0,
      jaExistiam: 0,
      semDocumento: 0,
      erros: 0,
    };

    const reps = await this.prisma.usuario.findMany({
      where: {
        role: 'REP',
        status: { not: 'INATIVO' },
        contatoErpId: null,
        empresas: { some: { empresaId } },
      },
      select: { id: true, nome: true, email: true, telefone: true, cpfCnpj: true },
      take: MAX_POR_RODADA,
    });
    r.candidatos = reps.length;
    if (reps.length === 0) return r;

    for (const rep of reps) {
      const doc = (rep.cpfCnpj ?? '').replace(/\D/g, '');
      if (doc.length !== 11 && doc.length !== 14) {
        r.semDocumento += 1;
        continue;
      }
      try {
        const jaLa = await this.contatos.achar(empresaId, { nome: rep.nome, cpfCnpj: doc });
        const id =
          jaLa ??
          (await this.contatos.criar(empresaId, {
            nome: rep.nome,
            cpfCnpj: doc,
            email: rep.email,
            telefone: rep.telefone,
          }));
        if (jaLa) r.jaExistiam += 1;
        else r.criados += 1;
        // Guarda o vínculo: sem isso, a rodada de amanhã procuraria de novo — e
        // uma busca que falhe criaria o contato duplicado.
        await this.prisma.usuario.update({
          where: { id: rep.id },
          data: { contatoErpId: String(id) },
        });
      } catch (err) {
        // Um rep que falha não pode travar a fila dos outros.
        r.erros += 1;
        this.logger.warn(
          `[erp] rep ${rep.nome} não subiu como contato: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `[erp] reps → contatos: ${r.criados} criados, ${r.jaExistiam} já existiam, ` +
        `${r.semDocumento} sem CPF/CNPJ, ${r.erros} erros`,
    );
    return r;
  }
}
