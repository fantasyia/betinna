import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { TinyClientService } from './tiny-client.service';

interface ContatoTiny {
  id: number;
  nome?: string;
  cpfCnpj?: string;
  /**
   * ⚠️ Os códigos NÃO são intuitivos (documentação da API v3):
   *   B = Ativo · A = Ativo com acesso ao sistema · I = Inativo · E = Excluído
   * Ler "A = ativo, resto = bloqueado" marcaria como BLOQUEADO justamente os
   * contatos ativos normais, que são a maioria.
   */
  situacao?: string;
  dataAtualizacao?: string;
}

export interface ResultadoSyncClientes {
  contatosLidos: number;
  clientes: number;
  vinculados: number;
  atualizados: number;
  bloqueados: number;
}

const PAGINA = 100;
const MAX_CONTATOS = 2000;

/** Situações que o ERP considera gente com quem dá pra vender. */
const SITUACOES_ATIVAS = new Set(['A', 'B']);

/**
 * Traz do ERP a SITUAÇÃO do cliente — quem está bloqueado lá.
 *
 * É o que faltava pro `Cliente.erpStatus` (D2) deixar de ser um campo que
 * ninguém alimenta: hoje todo cliente é ATIVO no app, mesmo o que o financeiro
 * bloqueou no ERP. O rep descobre no pedido recusado, na frente do cliente.
 *
 * **Não importa contato em massa de propósito.** A listagem do Tiny não devolve
 * o TIPO do contato (cliente/fornecedor/transportadora/vendedor) e não dá pra
 * filtrar por isso — puxar tudo encheria o CRM de transportadora e dos próprios
 * representantes. Cliente novo entra pela porta que já existe: o pedido do ERP
 * cria o cliente quando chega. Aqui a gente só ATUALIZA quem já é cliente.
 *
 * Uma passada só (uma listagem paginada, índice em memória) em vez de uma
 * consulta por cliente: 300 clientes seriam 300 chamadas e o rate limit é por
 * minuto.
 */
@Injectable()
export class TinyClientesSyncService {
  private readonly logger = new Logger(TinyClientesSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TinyClientService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  async sincronizar(empresaId: string): Promise<ResultadoSyncClientes> {
    const r: ResultadoSyncClientes = {
      contatosLidos: 0,
      clientes: 0,
      vinculados: 0,
      atualizados: 0,
      bloqueados: 0,
    };

    const porId = new Map<string, ContatoTiny>();
    const porDocumento = new Map<string, ContatoTiny>();
    let offset = 0;
    for (;;) {
      const pagina = await this.client.get<{ itens?: ContatoTiny[] }>(empresaId, '/contatos', {
        limit: PAGINA,
        offset,
      });
      const itens = pagina.itens ?? [];
      r.contatosLidos += itens.length;
      for (const c of itens) {
        porId.set(String(c.id), c);
        const doc = (c.cpfCnpj ?? '').replace(/\D/g, '');
        if (doc) porDocumento.set(doc, c);
      }
      if (itens.length < PAGINA || r.contatosLidos >= MAX_CONTATOS) break;
      offset += PAGINA;
    }
    if (r.contatosLidos === 0) return r;

    const clientes = await this.prisma.cliente.findMany({
      where: { empresaId },
      select: {
        id: true,
        nome: true,
        cnpj: true,
        codigoErp: true,
        erpStatus: true,
        representanteId: true,
      },
    });
    r.clientes = clientes.length;

    for (const cliente of clientes) {
      const doc = (cliente.cnpj ?? '').replace(/\D/g, '');
      const contato =
        (cliente.codigoErp ? porId.get(cliente.codigoErp) : undefined) ??
        (doc ? porDocumento.get(doc) : undefined);
      // Cliente que não existe no ERP fica como está: ausência aqui é "ainda não
      // cadastrado lá", não "bloqueado". Bloquear por omissão travaria a venda
      // de quem só não foi cadastrado ainda.
      if (!contato) continue;

      const novoStatus = SITUACOES_ATIVAS.has((contato.situacao ?? 'B').toUpperCase())
        ? 'ATIVO'
        : 'BLOQUEADO';
      const precisaVincular = !cliente.codigoErp;
      const mudouStatus = novoStatus !== cliente.erpStatus;
      if (!precisaVincular && !mudouStatus) continue;

      await this.prisma.cliente.update({
        where: { id: cliente.id },
        data: {
          ...(precisaVincular ? { codigoErp: String(contato.id) } : {}),
          ...(mudouStatus ? { erpStatus: novoStatus as never } : {}),
        },
      });
      if (precisaVincular) r.vinculados += 1;
      if (mudouStatus) {
        r.atualizados += 1;
        if (novoStatus === 'BLOQUEADO') {
          r.bloqueados += 1;
          await this.avisarBloqueio(empresaId, cliente);
        }
      }
    }

    this.logger.log(
      `[erp] situação de clientes: ${r.contatosLidos} contatos lidos, ` +
        `${r.vinculados} vinculados, ${r.atualizados} com status novo ` +
        `(${r.bloqueados} bloqueado(s))`,
    );
    return r;
  }

  /**
   * Avisa quem tem o cliente na carteira.
   *
   * Bloqueio descoberto no meio da negociação é o pior jeito de descobrir — o
   * rep monta o pedido, o ERP recusa, e ele explica pro cliente uma coisa que a
   * empresa já sabia.
   */
  private async avisarBloqueio(
    empresaId: string,
    cliente: { id: string; nome: string; representanteId: string | null },
  ): Promise<void> {
    const link = `/clientes/${cliente.id}`;
    const mensagem = `${cliente.nome} foi BLOQUEADO no ERP. Novos pedidos vão ser recusados até o financeiro liberar.`;
    if (cliente.representanteId) {
      await this.notificacoes
        .criarParaUsuario({
          empresaId,
          usuarioId: cliente.representanteId,
          tipo: 'CLIENTE_BLOQUEADO',
          prioridade: 'ALTA',
          titulo: 'Cliente bloqueado no ERP',
          mensagem,
          link,
          metadata: { clienteId: cliente.id },
        })
        .catch(() => undefined);
      return;
    }
    // Sem dono na carteira, quem precisa saber é a gestão — senão o aviso morre.
    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['ADMIN', 'DIRECTOR'],
        tipo: 'CLIENTE_BLOQUEADO',
        prioridade: 'ALTA',
        titulo: 'Cliente bloqueado no ERP',
        mensagem,
        link,
        metadata: { clienteId: cliente.id },
      })
      .catch(() => 0);
  }
}
