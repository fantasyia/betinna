import { Injectable, Logger } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { conviteDaPergunta, extrairDeterministico } from './extracao-deterministica';
import { parseVariaveisGravadas } from './variaveis-gravadas.util';
import type { ExecucaoContexto, ExtrairVariaveisConfig } from './fluxo-executor.types';

/** Quantas mensagens do lead o nó lê quando a config não diz. */
const MENSAGENS_PADRAO = 3;
const MENSAGENS_MAX = 10;

/**
 * EXTRAIR_VARIAVEIS — lê o que o lead ESCREVEU e preenche as variáveis do fluxo
 * **sem falar e sem chamar modelo**.
 *
 * 🔴 O buraco que isto fecha (card de 17/09, achado pela Testadora): quem VOLTA
 * e já diz a tensão na primeira mensagem é perguntado assim mesmo. No C1, o
 * único nó que extrai é a "IA — acolhe", e o caminho de retorno pula ela pela
 * tag `mb-explicado`:
 *
 * ```
 * "Já explicamos o MB?" ─ Não ─► IA acolhe (extrai) ─► tag ─┐
 *                       └ Sim ───────────────────────────────┴─► "Já sabemos a tensão?"
 * ```
 *
 * No ramo **Sim** não existe nó nenhum entre a condição e o portão. O portão lê
 * `custom.tensao_rede` vazio e o TEXTO FIXO pergunta o que a pessoa acabou de
 * dizer.
 *
 * ⚠️ **Não dava pra resolver com os nós que existiam.** O CONVERSAR_IA só extrai
 * quando FALA; com `naoFalarPrimeiro: true` ele sai antes da geração ("nó que
 * não fala não gasta token") e não lê nada no `iniciar` — declarar as variáveis
 * lá dentro não adianta. E os outros 11 `FluxoAcaoTipo` não escrevem variável.
 * Faltava, literalmente, **um nó que extraia sem falar**.
 *
 * 📌 Por que DETERMINÍSTICO e não mais uma chamada de IA: porque a rede de
 * `extracao-deterministica.ts` já existe, lê por regra ("220V" é 220V), custa
 * zero token e não reintroduz a fração de falha do modelo que 11/09 passou o
 * dia fechando — 1 em 10 primeiros contatos ouvia de novo a pergunta que tinha
 * acabado de responder. Um nó de IA aqui também obrigaria o bot a FALAR no
 * retorno, e derrubaria a decisão de 04/09 de a pergunta do padrão de energia
 * ser frase fixa e sempre idêntica.
 *
 * ⛔ **Este nó nunca pode derrubar um fluxo que funciona sem ele.** Ele é rede
 * de segurança: sem lead, sem conversa ou sem mensagem ele sai `pulado`, e o
 * portão seguinte só volta a se comportar como hoje (pergunta). A única coisa
 * que ele trata como ERRO é o nó sem variável declarada — aí ele não faz nada
 * por construção, e concluir verde sem ter feito nada é pior que falhar.
 */
@Injectable()
export class ExtrairVariaveisService {
  private readonly logger = new Logger(ExtrairVariaveisService.name);

  constructor(private readonly prisma: PrismaService) {}

  async executar(
    cfg: ExtrairVariaveisConfig,
    ctx: ExecucaoContexto,
    empresaId: string,
  ): Promise<Record<string, unknown>> {
    const declaradas = parseVariaveisGravadas(cfg?.variaveis);
    if (declaradas.length === 0) {
      // Nó sem variável = nó que não faz nada. Mesma régua do CONVERSAR_IA com
      // "não falar primeiro" + "não aguardar resposta": falhar é melhor que
      // fechar verde sem ter feito nada, porque o defeito que isso esconde
      // (portão lendo vazio) é invisível do lado de cá.
      throw new Error(
        'Configuração inválida no nó "Extrair variáveis": nenhuma variável declarada — ' +
          'o nó não teria o que gravar.',
      );
    }

    const leadId = typeof ctx['leadId'] === 'string' ? (ctx['leadId'] as string) : null;
    if (!leadId) {
      return this.pulado('nó sem lead no contexto (gatilho não carrega lead)');
    }

    const conversationId =
      (typeof ctx['conversationId'] === 'string' ? (ctx['conversationId'] as string) : null) ??
      (await this.conversaDaEmpresaDoLead(empresaId, leadId));
    if (!conversationId) {
      return this.pulado('lead ainda não tem conversa no WhatsApp da empresa');
    }

    const quantas = Math.min(
      MENSAGENS_MAX,
      Math.max(1, Math.trunc(Number(cfg?.mensagens ?? MENSAGENS_PADRAO)) || MENSAGENS_PADRAO),
    );

    // Puxa uma JANELA maior que `quantas` porque o que interessa não é só o que
    // o lead escreveu: é onde está a última fala do BOT. Ela define o `convite`
    // (ver abaixo) e separa "a pessoa está respondendo à pergunta" de "a pessoa
    // escreveu isso numa conversa antiga".
    const janela = await this.prisma.message
      .findMany({
        // `empresaId` no filtro é defesa em profundidade, igual ao montarHistorico:
        // este é um ponto que LÊ conversa e ESCREVE no lead — id trocado aqui
        // gravaria dado de conversa alheia no cadastro de outro tenant.
        where: { conversationId, conversation: { empresaId } },
        orderBy: { criadoEm: 'desc' },
        take: Math.max(quantas * 2, quantas + 5),
        select: { direction: true, conteudo: true },
      })
      .catch(() => [] as Array<{ direction: MessageDirection; conteudo: string }>);

    // `janela` vem do mais novo pro mais velho — é a ordem em que a gente quer
    // percorrer mesmo: mensagem mais nova tem prioridade sobre a mais velha.
    const doLead: Array<{ texto: string; depoisDoBot: boolean }> = [];
    let aindaNoBurst = true;
    let ultimaFalaDoBot: string | undefined;
    for (const m of janela) {
      if (m.direction === MessageDirection.OUTBOUND) {
        // A primeira OUTBOUND que aparece descendo é a última fala do bot: tudo
        // que veio DEPOIS dela é resposta a ela; o que vier antes já é assunto
        // de outra rodada.
        if (aindaNoBurst) ultimaFalaDoBot = m.conteudo;
        aindaNoBurst = false;
        continue;
      }
      if (doLead.length >= quantas) break;
      doLead.push({ texto: m.conteudo, depoisDoBot: aindaNoBurst });
    }

    if (doLead.length === 0) {
      return this.pulado('nenhuma mensagem do lead na conversa');
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId },
      select: { variaveis: true },
    });
    const atuais: Record<string, unknown> =
      lead?.variaveis && typeof lead.variaveis === 'object' && !Array.isArray(lead.variaveis)
        ? { ...(lead.variaveis as Record<string, unknown>) }
        : {};

    /**
     * O `convite` é o que a última pergunta do bot AUTORIZA a ler solto: depois
     * de "110V, 220V ou 380V?", um "220" pelado é tensão. Sem essa autorização a
     * rede exige pista ("220 volts", "disjuntor de 63") — deliberadamente, porque
     * foi por número solto que "sao 220 clientes por dia" virou 220V nas
     * varreduras de 11/09.
     *
     * 📌 Por isso ele vale SÓ pras mensagens que chegaram depois da última fala
     * do bot. Mensagem de antes não é resposta a pergunta nenhuma, e tratá-la
     * como se fosse é reabrir exatamente a porta que aquele dia fechou.
     */
    const convite = conviteDaPergunta(ultimaFalaDoBot);

    const resgatadas: Record<string, string> = {};
    const estado: Record<string, unknown> = { ...atuais };
    for (const msg of doLead) {
      const achadas = extrairDeterministico(
        declaradas,
        msg.texto,
        estado,
        msg.depoisDoBot ? convite : null,
      );
      for (const [chave, valor] of Object.entries(achadas)) {
        // `extrairDeterministico` já só preenche lacuna contra o `estado` que
        // recebeu. Atualizar o estado a cada volta é o que garante que a
        // mensagem MAIS NOVA ganha: a mais velha vê o campo já ocupado e passa.
        resgatadas[chave] = valor;
        estado[chave] = valor;
      }
    }

    if (Object.keys(resgatadas).length === 0) {
      this.logger.log(
        `EXTRAIR_VARIAVEIS: nada a preencher no lead ${leadId} ` +
          `(${doLead.length} msg lidas, ${declaradas.length} variáveis declaradas)`,
      );
      return {
        gravadas: [],
        mensagensLidas: doLead.length,
        motivo: 'nada novo pra extrair — o lead já tem os campos, ou a fala não prova nenhum',
      };
    }

    // MERGE NO BANCO (`jsonb || jsonb`), nunca read-modify-write da coluna
    // inteira: `atuais` foi lido linhas atrás e outro escritor pode ter gravado
    // no meio — dois fluxos no mesmo lead e a janela de rajada colocam turnos
    // concorrentes no caminho NORMAL. O perdedor da corrida ressuscitaria o
    // estado velho e apagaria a resposta que a pessoa acabou de dar, que é o
    // mesmo defeito que este nó existe pra evitar.
    await this.prisma.$executeRaw`
      UPDATE "Lead"
         SET "variaveis" = COALESCE("variaveis", '{}'::jsonb) || ${JSON.stringify(resgatadas)}::jsonb,
             "atualizadoEm" = NOW()
       WHERE "id" = ${leadId}
    `;

    // `warn` de propósito, igual à rede dentro do CONVERSAR_IA: cada linha
    // destas é uma pergunta redundante que NÃO foi feita ao cliente. A contagem
    // é a medida de quanto este nó está segurando — e some do radar se virar
    // `debug`.
    this.logger.warn(
      `EXTRAIR_VARIAVEIS: lead ${leadId} — preenchido sem perguntar: ` +
        Object.entries(resgatadas)
          .map(([k, v]) => `${k}="${v}"`)
          .join(', '),
    );

    return {
      gravadas: Object.keys(resgatadas),
      valores: resgatadas,
      mensagensLidas: doLead.length,
    };
  }

  private pulado(motivo: string): Record<string, unknown> {
    this.logger.log(`EXTRAIR_VARIAVEIS: ${motivo} — nó pulado`);
    return { pulado: true, motivo };
  }

  /**
   * A conversa do WhatsApp DA EMPRESA com este lead. `proprietarioId: null` não
   * é detalhe: o lead pode ter conversa no número da empresa E no pessoal de um
   * rep — ler a do rep aqui puxaria conversa particular dele pro cadastro.
   * Mesma regra do `conversaDaEmpresaDoLead` do CONVERSAR_IA.
   */
  private async conversaDaEmpresaDoLead(empresaId: string, leadId: string): Promise<string | null> {
    const conv = await this.prisma.conversation
      .findFirst({
        where: { empresaId, leadId, canal: 'WHATSAPP', proprietarioId: null },
        orderBy: { ultimaMsgEm: 'desc' },
        select: { id: true },
      })
      .catch(() => null);
    return conv?.id ?? null;
  }
}
