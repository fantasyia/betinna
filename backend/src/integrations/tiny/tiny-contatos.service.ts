import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';

export interface ContatoParaTiny {
  nome: string;
  /** CPF ou CNPJ — a única chave que não muda. */
  cpfCnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
}

/**
 * Contatos no Tiny — achar ou criar, num lugar só.
 *
 * Duas frentes precisam disso: o pedido (que exige `idContato`) e o cadastro de
 * representante (que vira contato pra depois virar vendedor). Cada uma com sua
 * cópia significaria duas regras de deduplicação — e a que errasse criaria o
 * contato duplicado que espalha histórico, cobrança e nota por cadastros
 * diferentes.
 *
 * **Documento primeiro, nome só como último recurso.** Nome varia ("Somatec",
 * "Somatec Blocking", "SOMATEC LTDA"; "Marcelo", "M. Harada") e cada variação
 * viraria um contato novo.
 */
@Injectable()
export class TinyContatosService {
  private readonly logger = new Logger(TinyContatosService.name);

  constructor(private readonly client: TinyClientService) {}

  /** Devolve o id do contato no Tiny, criando se ainda não existir. */
  async garantir(empresaId: string, contato: ContatoParaTiny): Promise<number> {
    const existente = await this.achar(empresaId, contato);
    if (existente) return existente;
    return this.criar(empresaId, contato);
  }

  /** Procura sem criar — devolve `null` quando não acha. */
  async achar(empresaId: string, contato: ContatoParaTiny): Promise<number | null> {
    const doc = (contato.cpfCnpj ?? '').replace(/\D/g, '');
    if (doc) {
      const achado = await this.client
        .get<{ itens?: Array<{ id: number; cpfCnpj?: string }> }>(empresaId, '/contatos', {
          cpfCnpj: doc,
          limit: 20,
        })
        .catch(() => ({ itens: [] }));
      const exato = (achado.itens ?? []).find((c) => (c.cpfCnpj ?? '').replace(/\D/g, '') === doc);
      if (exato) return exato.id;
      // Com documento em mãos, NÃO cai pro nome: documento que não existe lá
      // significa contato novo, e casar por nome aqui juntaria duas pessoas
      // diferentes num cadastro só.
      return null;
    }

    const achado = await this.client
      .get<{ itens?: Array<{ id: number; nome?: string }> }>(empresaId, '/contatos', {
        nome: contato.nome,
        limit: 20,
      })
      .catch(() => ({ itens: [] }));
    const exato = (achado.itens ?? []).find(
      (c) => (c.nome ?? '').trim().toLowerCase() === contato.nome.trim().toLowerCase(),
    );
    return exato?.id ?? null;
  }

  /**
   * Acha o VENDEDOR do ERP correspondente a um contato.
   *
   * No Tiny, vendedor é um contato COM o papel de vendedor — e a API só lê esse
   * papel (marcar é no painel). Como o pedido aceita `vendedor.id`, é este mapa
   * que faz a comissão nascer no vendedor certo lá, em vez de o pedido chegar
   * órfão e alguém ter que corrigir à mão depois.
   *
   * `null` quando o contato ainda não foi promovido a vendedor — caso normal
   * logo depois de cadastrar um rep novo.
   */
  async acharVendedorPorContato(empresaId: string, contatoId: number): Promise<number | null> {
    try {
      const r = await this.client.get<{
        itens?: Array<{ id: number; contato?: { id?: number } }>;
      }>(empresaId, '/vendedores', { limit: 100 });
      const alvo = (r.itens ?? []).find((v) => v.contato?.id === contatoId);
      return alvo?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `[tiny] não consegui listar vendedores: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async criar(empresaId: string, contato: ContatoParaTiny): Promise<number> {
    const doc = (contato.cpfCnpj ?? '').replace(/\D/g, '');
    const criado = await this.client.post<{ id: number }>(empresaId, '/contatos', {
      nome: contato.nome,
      // F/J pelo tamanho do documento; sem documento, pessoa física é o padrão
      // menos danoso (não exige inscrição estadual).
      tipoPessoa: doc.length > 11 ? 'J' : 'F',
      ...(doc ? { cpfCnpj: doc } : {}),
      ...(contato.email ? { email: contato.email } : {}),
      ...(contato.telefone ? { celular: contato.telefone } : {}),
      situacao: 'A',
    });
    this.logger.log(`[tiny] contato criado id=${criado?.id} (${contato.nome})`);
    return criado.id;
  }
}
