import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';

export interface EnderecoParaTiny {
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

export interface ContatoParaTiny {
  nome: string;
  /** CPF ou CNPJ — a única chave que não muda. */
  cpfCnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  /**
   * ENDEREÇO — sem ele o ERP não calcula frete nem emite etiqueta.
   *
   * O contato nascia só com nome, documento, e-mail e telefone; o endereço
   * ficava no app e nunca atravessava. O efeito só aparece lá na frente, na
   * expedição: o Tiny recusa a etiqueta com um genérico "Não foi possível
   * enviar a lista de postagem", e ninguém liga esse erro ao cadastro.
   */
  endereco?: EnderecoParaTiny | null;
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
    if (existente) {
      await this.completarEndereco(empresaId, existente, contato.endereco);
      return existente;
    }
    return this.criar(empresaId, contato);
  }

  /**
   * PREENCHE o endereço do contato que está sem — e só isso.
   *
   * Nunca sobrescreve: o cadastro do ERP é a fonte da verdade do fiscal, e
   * quem mexe nele é o financeiro. Aqui a gente só tapa o buraco que a gente
   * mesmo criou, nos contatos que o app cadastrou sem endereço nenhum.
   */
  private async completarEndereco(
    empresaId: string,
    idContato: number,
    endereco?: EnderecoParaTiny | null,
  ): Promise<void> {
    const cep = (endereco?.cep ?? '').replace(/\D/g, '');
    if (!cep) return;
    try {
      const atual = await this.client.get<{ endereco?: { cep?: string } }>(
        empresaId,
        `/contatos/${idContato}`,
      );
      if ((atual?.endereco?.cep ?? '').replace(/\D/g, '')) return; // já tem — não toca
      await this.client.put(empresaId, `/contatos/${idContato}`, {
        endereco: this.enderecoTiny(endereco),
      });
      this.logger.log(`[tiny] endereço preenchido no contato ${idContato}`);
    } catch (err) {
      // Cadastro incompleto não pode derrubar a venda: o pedido sobe e a
      // etiqueta é que vai reclamar depois, com o cadastro na mão de quem
      // resolve.
      this.logger.warn(
        `[tiny] não consegui completar o endereço do contato ${idContato}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private enderecoTiny(e?: EnderecoParaTiny | null): Record<string, string> | undefined {
    const cep = (e?.cep ?? '').replace(/\D/g, '');
    if (!cep) return undefined;
    return {
      cep,
      ...(e?.endereco ? { endereco: e.endereco } : {}),
      ...(e?.numero ? { numero: e.numero } : {}),
      ...(e?.complemento ? { complemento: e.complemento } : {}),
      ...(e?.bairro ? { bairro: e.bairro } : {}),
      ...(e?.cidade ? { municipio: e.cidade } : {}),
      ...(e?.uf ? { uf: e.uf } : {}),
      pais: 'Brasil',
    };
  }

  /** Procura sem criar — devolve `null` quando não acha. */
  async achar(empresaId: string, contato: ContatoParaTiny): Promise<number | null> {
    const doc = (contato.cpfCnpj ?? '').replace(/\D/g, '');
    if (doc) {
      // O Tiny guarda o documento FORMATADO e a busca compara texto: procurar
      // só por dígitos não acha ninguém, e o efeito é pior que um "não achei" —
      // o passo seguinte tenta CRIAR e o ERP recusa com "contato já existe",
      // derrubando o pedido inteiro de um cliente que estava lá o tempo todo.
      // Por isso as duas formas, e a conferência sempre por dígitos.
      for (const busca of [this.formatarDocumento(doc), doc]) {
        const achado = await this.client
          .get<{ itens?: Array<{ id: number; cpfCnpj?: string }> }>(empresaId, '/contatos', {
            cpfCnpj: busca,
            limit: 20,
          })
          .catch(() => ({ itens: [] }));
        const exato = (achado.itens ?? []).find(
          (c) => (c.cpfCnpj ?? '').replace(/\D/g, '') === doc,
        );
        if (exato) return exato.id;
      }
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

  /** 11 dígitos → CPF, 14 → CNPJ; qualquer outro tamanho volta como veio. */
  private formatarDocumento(doc: string): string {
    if (doc.length === 11) {
      return `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`;
    }
    if (doc.length === 14) {
      return (
        `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/` +
        `${doc.slice(8, 12)}-${doc.slice(12)}`
      );
    }
    return doc;
  }

  /**
   * O contato por trás de um VENDEDOR.
   *
   * O pedido do Tiny traz `vendedor.id` e o nome, mas nem sempre o contato — e
   * é o contato que o app guarda (`Usuario.contatoErpId`). Sem esta ponte, o
   * casamento cai no NOME, que erra: "REP TESTE" no ERP e "TESTE · Automação"
   * no app são a mesma pessoa e não casam por texto.
   */
  async acharContatoDoVendedor(empresaId: string, vendedorId: number): Promise<number | null> {
    try {
      const r = await this.client.get<{
        itens?: Array<{ id: number; contato?: { id?: number } }>;
      }>(empresaId, '/vendedores', { limit: 100 });
      return (r.itens ?? []).find((v) => v.id === vendedorId)?.contato?.id ?? null;
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
      ...(this.enderecoTiny(contato.endereco)
        ? { endereco: this.enderecoTiny(contato.endereco) }
        : {}),
      situacao: 'A',
    });
    this.logger.log(`[tiny] contato criado id=${criado?.id} (${contato.nome})`);
    return criado.id;
  }
}
