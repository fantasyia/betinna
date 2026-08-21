import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FluxoTriggerTipo, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { FLUXO_QUEUE, type FluxoStepJobData } from './fluxo-executor.types';
import { matchPalavraChave, type PalavraChaveConfig } from './match-palavra-chave.util';
import { matchFiltroPayload, type FiltroPayload } from './match-payload-filtro.util';
import { normalizarValor } from './normalizar-valor.util';

const toJsonInput = (v: Record<string, unknown>): Prisma.InputJsonObject =>
  v as unknown as Prisma.InputJsonObject;

/**
 * FluxoEventBusService — ponte entre domínio e BullMQ.
 *
 * Uso: outros serviços injetam este bus e chamam `disparar(...)` quando
 * um evento ocorre (lead criado, pedido aprovado, etc).
 *
 * O bus:
 * 1. Localiza fluxos ATIVOS da empresa para o triggerTipo.
 * 2. Para cada fluxo, cria uma `FluxoExecucao` no banco.
 * 3. Enfileira o job BullMQ para o nó TRIGGER de cada fluxo.
 *
 * Falha silenciosa por design: erro no bus não derruba a operação principal.
 */
@Injectable()
export class FluxoEventBusService {
  private readonly logger = new Logger(FluxoEventBusService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(FLUXO_QUEUE) private readonly queue: Queue<FluxoStepJobData>,
  ) {}

  /**
   * Dispara o bus para um evento.
   *
   * @param empresaId  ID da empresa (multi-tenant)
   * @param triggerTipo  Tipo do evento (ex: LEAD_CRIADO)
   * @param contexto  Dados do evento passados pra execução (clienteId, pedidoId, etc.)
   */
  async disparar(
    empresaId: string,
    triggerTipo: FluxoTriggerTipo,
    contexto: Record<string, unknown>,
  ): Promise<void> {
    // TESTE não acende outro fluxo (auditoria 20/08). As ações de mutação
    // (MUDAR_TAG/MOVER_LEAD_ETAPA/CRIAR_LEAD/LIBERAR_LOTE) rodam de verdade no
    // teste e disparavam eventos SEM a marca — o fluxo downstream nascia como
    // PRODUÇÃO (coluna teste=false) e mandava WhatsApp REAL, exatamente o que o
    // modo seco prometia não fazer. De quebra, o supersede anti-duplicata logo
    // abaixo podia CANCELAR uma execução AGUARDANDO de produção do mesmo lead.
    // A regra é uma só e vale até com enviarDeVerdade: o teste exercita o fluxo
    // TESTADO; o encadeamento fica registrado no log e se valida ativando.
    if (contexto['_teste'] === true) {
      this.logger.log(
        `[teste] ${triggerTipo} suprimido — execução de teste não acende outros fluxos`,
      );
      return;
    }

    // #14 corta-loop: re-disparos internos (LEAD_ETAPA_MUDOU em cadeia entre fluxos sem
    // nó IA) não podem entrar em ping-pong infinito. A entrada externa começa em _hops=0;
    // só os re-disparos internos (executor) acumulam → corta acima de 10.
    const hops = typeof contexto['_hops'] === 'number' ? (contexto['_hops'] as number) : 0;
    if (hops > 10) {
      this.logger.warn(`Cadeia ${triggerTipo} cortada em _hops=${hops} (empresa ${empresaId})`);
      return;
    }
    try {
      // Busca fluxos ATIVOS para este triggerTipo
      const fluxos = await this.prisma.fluxo.findMany({
        where: { empresaId, status: 'ATIVO', triggerTipo },
        include: {
          nos: {
            where: { tipo: 'TRIGGER' },
            select: { id: true, config: true },
          },
        },
      });

      if (fluxos.length === 0) return;

      this.logger.debug(
        `FluxoEventBus: ${triggerTipo} em empresa ${empresaId} → ${fluxos.length} fluxo(s)`,
      );

      for (const fluxo of fluxos) {
        // #6: isola a falha por-fluxo — um fluxo problemático não aborta os demais.
        try {
          const triggerNo = fluxo.nos[0];
          if (!triggerNo) {
            this.logger.warn(`Fluxo ${fluxo.id} (${fluxo.nome}) sem nó TRIGGER — ignorado`);
            continue;
          }

          // Filtro por config do gatilho (LEAD_ETAPA_MUDOU): só dispara quando o lead
          // ENTRA na `paraEtapa` (no `funil` certo) e, se `deEtapa` setado, veio dela.
          if (triggerTipo === 'LEAD_ETAPA_MUDOU') {
            const cfg = (triggerNo.config ?? {}) as Record<string, unknown>;
            const funilCfg = cfg['funil'] as string | undefined;
            const paraEtapa = cfg['paraEtapa'] as string | undefined;
            const deEtapa = cfg['deEtapa'] as string | undefined;
            // Aceita os nomes canônicos (leads.service.moverEtapa) E os legados que os
            // disparadores internos emitem (LIBERAR_LOTE / SLA): para/deEtapaId.
            const funilCtx = contexto['funilId'] as string | undefined;
            const paraCtx = (contexto['paraFunilEtapaId'] ?? contexto['paraEtapaId']) as
              | string
              | undefined;
            const deCtx = (contexto['deFunilEtapaId'] ?? contexto['deEtapaId']) as
              | string
              | undefined;
            // funilId só filtra quando o disparador informou (nem todos enviam); como
            // a etapa-destino já é única por funil, o filtro de paraEtapa cobre o resto.
            if (funilCfg && funilCtx && funilCtx !== funilCfg) continue;
            if (paraEtapa && paraCtx !== paraEtapa) continue;
            if (deEtapa && deCtx !== deEtapa) continue;
          }

          // Filtro do gatilho MENSAGEM_CANAL: canal + palavra-chave + apenasComLead.
          // Compatível com o uso legado (só roteamento por canal): SEM palavrasChave
          // o fluxo dispara como antes; o match textual só restringe quando configurado.
          // Ordem barata→cara: canal/lead/match em memória (resolverLead já rodou no upstream).
          if (triggerTipo === 'MENSAGEM_CANAL') {
            const cfg = (triggerNo.config ?? {}) as PalavraChaveConfig & {
              canais?: string[];
              apenasComLead?: boolean;
              apenasSemLead?: boolean;
              apenasComBotLigado?: boolean;
              escopo?: 'empresa' | 'pessoal' | 'ambos';
            };
            // Case-INSENSITIVE de propósito: o contexto traz o enum do Prisma
            // ("WHATSAPP"), mas a config é escrita à mão (MCP/API — o editor não
            // tem UI pra `canais`) e sai "whatsapp" naturalmente. Sem normalizar,
            // o fluxo NÃO dispara e não sobra erro nenhum — falha 100% silenciosa.
            const canais = Array.isArray(cfg.canais)
              ? cfg.canais.filter(Boolean).map((c) => String(c).trim().toUpperCase())
              : [];
            const canalCtx = (contexto['canal'] as string | undefined)?.toUpperCase();
            if (canais.length > 0 && (!canalCtx || !canais.includes(canalCtx))) continue;
            // `escopo`: dual-owner (D38) — WhatsApp CENTRAL da empresa (proprietarioId
            // null) vs WhatsApp PESSOAL do rep (proprietarioId preenchido). Default
            // "ambos" mantém compatibilidade com fluxo já configurado. "empresa" é o
            // que o T1 (triagem) precisa: mensagem no celular pessoal do rep NÃO pode
            // virar lead na Triagem da empresa.
            // Normalizado como `canais` (auditoria 20/08): config escrita à
            // mão sai "Empresa"/" EMPRESA " e o match exato virava 'ambos' em
            // silêncio — a triagem passava a ouvir o celular pessoal do rep.
            const escopo = String(cfg.escopo ?? 'ambos')
              .trim()
              .toLowerCase();
            if (!['empresa', 'pessoal', 'ambos'].includes(escopo)) {
              this.logger.warn(
                `MENSAGEM_CANAL: escopo "${String(cfg.escopo)}" inválido no fluxo "${fluxo.nome}" ` +
                  `— tratando como 'ambos' (valores válidos: empresa|pessoal|ambos)`,
              );
            }
            const ehPessoal = Boolean(contexto['proprietarioId']);
            if (escopo === 'empresa' && ehPessoal) continue;
            if (escopo === 'pessoal' && !ehPessoal) continue;
            if (cfg.apenasComLead && !contexto['leadId']) continue;
            // Espelho do anterior, pro fluxo de TRIAGEM: só quem AINDA não é lead.
            // Sem ele, todo recado de contato já conhecido reentraria no fluxo de
            // triagem à toa (a ação CRIAR_LEAD é idempotente, mas gastaria execução
            // e poluiria o histórico a cada mensagem).
            if (cfg.apenasSemLead && contexto['leadId']) continue;
            const temPalavras = (cfg.palavrasChave ?? []).some((p) => p.trim());
            if (temPalavras) {
              const texto = typeof contexto['texto'] === 'string' ? contexto['texto'] : '';
              if (!matchPalavraChave(texto, cfg)) continue;
            }
            // `apenasComBotLigado`: o fluxo INTEIRO só roda onde o atendimento
            // automático está ligado (mesma precedência do bot: botLigado da
            // conversa > botWhatsappAtivo da empresa > desligado).
            //
            // Por que no GATILHO e não só no nó de IA: o CRIAR_LEAD roda ANTES da
            // IA, então gatear só lá deixava um rastro de leads de contatos que o
            // dono nunca quis processar (aconteceu em prod — bot ligado só numa
            // conversa e outro contato virou lead na triagem, mudo).
            // Opt-in: sem a flag, nada muda pros fluxos existentes.
            // Anti-reabertura: se JÁ há uma execução VIVA deste fluxo pra esta MESMA
            // conversa (PENDENTE/EM_EXECUCAO/AGUARDANDO), não cria uma 2ª — a resposta
            // do lead é entregue à execução existente por outro caminho, via
            // OrquestracaoLeadEventsService.aoReceberMensagem → ConversarIaService.retomar
            // (LEAD_RESPONDEU + `aguardandoPorLead`).
            //
            // Sem isto: CADA mensagem do WhatsApp republicava MENSAGEM_CANAL, e o bloco
            // anti-duplicata de IA logo abaixo (linha ~200) CANCELAVA a execução AGUARDANDO
            // e recriava do zero — o nó CONVERSAR_IA rodava `iniciar()` de novo a cada
            // resposta do lead, reabrindo a mesma saudação em loop (visto em prod: a
            // triagem repetia "Oi! Aqui é da Somatec..." pra cada mensagem, nunca avançava
            // pra pergunta real nem fechava como Indefinido).
            // O guard existe pra impedir o LOOP DA IA (execução AGUARDANDO
            // cancelada e recriada a cada mensagem). Num fluxo SEM nó de IA ele
            // vira só descarte: qualquer execução viva (um DELAY de 1h, por ex.)
            // fazia a mensagem seguinte do contato ser IGNORADA em silêncio.
            const convIdChk = contexto['conversationId'] as string | undefined;
            const temNoIa =
              convIdChk !== undefined
                ? (await this.prisma.fluxoNo.count({
                    where: { fluxoId: fluxo.id, tipo: 'ACAO', acaoTipo: 'CONVERSAR_IA' },
                  })) > 0
                : false;
            if (convIdChk && temNoIa) {
              const jaViva = await this.prisma.fluxoExecucao.findFirst({
                where: {
                  fluxoId: fluxo.id,
                  empresaId,
                  status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] },
                  contexto: { path: ['conversationId'], equals: convIdChk },
                },
                select: { id: true },
              });
              if (jaViva) {
                this.logger.debug(
                  `Fluxo "${fluxo.nome}": MENSAGEM_CANAL suprimido — já há execução viva ` +
                    `pra conversa ${convIdChk} (a resposta vai pelo retomar da IA)`,
                );
                continue;
              }
            }
            if (cfg.apenasComBotLigado) {
              const convId = contexto['conversationId'] as string | undefined;
              if (!convId) continue;
              const [emp, conv] = await Promise.all([
                this.prisma.empresa.findUnique({
                  where: { id: empresaId },
                  select: { botWhatsappAtivo: true },
                }),
                this.prisma.conversation.findUnique({
                  where: { id: convId },
                  select: { botLigado: true },
                }),
              ]);
              if (!(conv?.botLigado ?? emp?.botWhatsappAtivo ?? false)) continue;
            }
          }

          // Filtro do gatilho LEAD_CRIADO: por QUAL PORTA o lead entrou.
          //
          // Também não existia — todo fluxo ativo de LEAD_CRIADO rodava pra
          // qualquer lead novo da empresa. Um drip de e-mail de boas-vindas
          // saía igual pro lead do site e pras 5.000 linhas de uma planilha
          // importada. O E1 até carregava `{ origem: "inbound" }`, mas ninguém
          // lia — era decoração.
          //
          // `origens` = lista de valores exatos de Lead.origemCadastro.
          // `origem`  = 1 valor OU um grupo: "inbound" (o lead veio até nós:
          //             site, whatsapp, click_to_whatsapp, meta_lead_ads,
          //             google_lead_form) / "outbound" (fomos atrás:
          //             importacao, manual_rep). "api" não entra em grupo
          //             nenhum de propósito — pode ser tanto um formulário
          //             parceiro quanto carga em massa; liste explícito.
          // Sem config = qualquer origem (compatível com o que está no ar).
          if (triggerTipo === 'LEAD_CRIADO') {
            type OrigemCfg = { origens?: string[]; origem?: string };
            const cfgNo = (triggerNo.config ?? {}) as OrigemCfg;
            const cfgFluxo = (fluxo.triggerConfig ?? {}) as OrigemCfg;
            const cfg: OrigemCfg = { ...cfgFluxo, ...cfgNo };

            const GRUPOS: Record<string, string[]> = {
              inbound: [
                'site',
                'whatsapp',
                'click_to_whatsapp',
                'meta_lead_ads',
                'google_lead_form',
              ],
              outbound: ['importacao', 'manual_rep'],
            };
            const brutos = [...(cfg.origens ?? []), ...(cfg.origem ? [cfg.origem] : [])]
              .map((o) => normalizarValor(String(o)))
              .filter(Boolean);
            const aceitas = new Set(brutos.flatMap((o) => GRUPOS[o] ?? [o]));

            if (aceitas.size > 0) {
              const origemCtx = normalizarValor(String(contexto['origemCadastro'] ?? ''));
              // Lead sem origem gravada (base antiga) NÃO entra numa régua
              // filtrada: preferir não disparar a disparar pra quem não devia.
              if (!origemCtx || !aceitas.has(origemCtx)) {
                this.logger.debug(
                  `Fluxo "${fluxo.nome}": LEAD_CRIADO ignorado — origem "${origemCtx || '(vazia)'}" ` +
                    `fora do filtro [${[...aceitas].join(', ')}]`,
                );
                continue;
              }
            }
          }

          // Filtro do gatilho LEAD_RECEBEU_TAG: QUAL etiqueta.
          //
          // Até aqui NÃO existia filtro nenhum — todo fluxo ativo com este gatilho
          // rodava a CADA etiqueta aplicada a qualquer lead. Com etiqueta-DIMENSÃO
          // (`publico:comercio`, `setor:cadeia-do-frio`) isso é fatal: a régua de um
          // setor dispararia pra todos os outros, em silêncio.
          //
          // Operador default = EXATO (`modo` ausente). Sem config nenhuma, segue
          // "qualquer etiqueta" (compatível com o que já está no ar).
          //  - exato   → nome idêntico (normalizado: trim/minúsculas/sem acento)
          //  - prefixo → família inteira de uma dimensão ("setor:")
          //  - contem  → escape hatch; colide entre slugs ("varejo" casa
          //              "varejo-alimentar"), por isso NÃO é o default
          // O `:` não tem tratamento especial em lugar nenhum: é caractere comum.
          if (triggerTipo === 'LEAD_RECEBEU_TAG') {
            type TagTriggerCfg = {
              tagIds?: string[];
              tagNomes?: string[];
              tagNome?: string;
              /** Alias legado: fluxo montado antes do form (E2 usa `tag`). */
              tag?: string;
              modo?: 'exato' | 'prefixo' | 'contem';
            };
            // DUAS moradas pra mesma config: o nó TRIGGER (o que o editor grava) e
            // o `Fluxo.triggerConfig` (o que a master preencheu à mão em fluxo já
            // montado). Ler só uma delas fazia a outra virar decoração.
            //
            // Precedência por FAMÍLIA, não por chave (auditoria 20/08): o spread
            // por chave SOMAVA alias residual — fluxo antigo com `tag: 'x'` no
            // triggerConfig + nó novo com `tagNome: 'y'` disparava pra x E y,
            // porque cada alias vinha de uma morada. Se o NÓ define qualquer
            // chave da família do filtro, só o nó vale; o fluxo é fallback
            // integral. `modo` continua por chave (é modificador, não filtro).
            const cfgNo = (triggerNo.config ?? {}) as TagTriggerCfg;
            const cfgFluxo = (fluxo.triggerConfig ?? {}) as TagTriggerCfg;
            const noTemFiltro =
              (cfgNo.tagIds?.length ?? 0) > 0 ||
              (cfgNo.tagNomes?.length ?? 0) > 0 ||
              Boolean(cfgNo.tagNome) ||
              Boolean(cfgNo.tag);
            const base = noTemFiltro ? cfgNo : cfgFluxo;
            const cfg: TagTriggerCfg = { ...base, modo: cfgNo.modo ?? cfgFluxo.modo };
            const ids = (cfg.tagIds ?? []).map((t) => String(t).trim()).filter(Boolean);
            const nomes = [
              ...(cfg.tagNomes ?? []),
              ...(cfg.tagNome ? [cfg.tagNome] : []),
              ...(cfg.tag ? [cfg.tag] : []),
            ]
              .map((n) => normalizarValor(String(n)))
              .filter(Boolean);

            if (ids.length > 0 || nomes.length > 0) {
              const tagIdCtx =
                typeof contexto['tagId'] === 'string' ? (contexto['tagId'] as string) : undefined;
              // O nome vem no payload; só cai no banco por compatibilidade com
              // eventos antigos ainda em voo (e é 1 SELECT por id, não por fluxo).
              let nomeCtx =
                typeof contexto['tagNome'] === 'string'
                  ? (contexto['tagNome'] as string)
                  : undefined;
              if (nomes.length > 0 && !nomeCtx && tagIdCtx) {
                const t = await this.prisma.tag.findFirst({
                  where: { id: tagIdCtx, empresaId },
                  select: { nome: true },
                });
                nomeCtx = t?.nome;
                if (nomeCtx) contexto['tagNome'] = nomeCtx;
              }
              const alvo = normalizarValor(nomeCtx ?? '');
              const modo = cfg.modo ?? 'exato';
              const casouId = ids.length > 0 && tagIdCtx !== undefined && ids.includes(tagIdCtx);
              const casouNome =
                nomes.length > 0 &&
                alvo.length > 0 &&
                nomes.some((n) =>
                  modo === 'prefixo'
                    ? alvo.startsWith(n)
                    : modo === 'contem'
                      ? alvo.includes(n)
                      : alvo === n,
                );
              if (!casouId && !casouNome) continue;
            }
          }

          // Filtro do gatilho WEBHOOK_RECEBIDO: vincula a UM webhook (webhookId vazio =
          // qualquer webhook da empresa) + filtro opcional por campo do payload.
          if (triggerTipo === 'WEBHOOK_RECEBIDO') {
            const cfg = (triggerNo.config ?? {}) as {
              webhookId?: string;
              filtroPayload?: FiltroPayload;
            };
            if (cfg.webhookId && contexto['webhookId'] !== cfg.webhookId) continue;
            if (!matchFiltroPayload(contexto['payload'], cfg.filtroPayload)) continue;
          }

          // Filtro do gatilho CLIENTE_INATIVO_30D: cada fluxo tem seu próprio `diasInativo`. O job
          // seleciona no MENOR limiar e passa a inatividade REAL do cliente em `diasSemPedido`; aqui
          // só disparamos os fluxos cujo limiar o cliente de fato cruzou. CAÇADA-BUG #37 (revisão):
          // sem isto, um cliente de 35 dias recebia TAMBÉM a régua de um fluxo de 90 dias.
          if (triggerTipo === 'CLIENTE_INATIVO_30D') {
            // ⚠️ REVISÃO (11/08): o bus lia SÓ o config do nó, enquanto o job lê
            // `nó ?? Fluxo.triggerConfig ?? 30`. Com o filtro de limiar novo, um
            // fluxo com `diasInativo` só no `triggerConfig` (montado por
            // MCP/import) passava a NUNCA disparar: o job liberava [90] e o bus
            // pedia 30. Regressão que eu introduzi. As duas pontas agora leem a
            // MESMA coisa, com a mesma precedência.
            const cfgNo = (triggerNo.config ?? {}) as { diasInativo?: number };
            const cfgFluxo = (fluxo.triggerConfig ?? {}) as { diasInativo?: number };
            const bruto = Number(cfgNo.diasInativo ?? cfgFluxo.diasInativo ?? 30);
            const req = Number.isFinite(bruto) && bruto > 0 ? bruto : 30;
            const real = Number(contexto['diasSemPedido'] ?? 0);
            if (real < req) continue;
            // Cooldown POR LIMIAR (ver fluxo-triggers.job): o job já reivindicou
            // no Redis quais limiares deste cliente estão liberados nesta janela.
            // Sem isto, a régua de 90 dias se repetia a cada 30 pro mesmo cliente.
            const liberados = contexto['limiaresLiberados'];
            if (Array.isArray(liberados) && !liberados.includes(req)) continue;
          }

          // Anti-reabertura do LEAD_RESPONDEU: a orquestração dispara este gatilho
          // a CADA mensagem inbound do lead — sem o guard, o supersede logo abaixo
          // cancelava a execução AGUARDANDO e recriava, e o opener da IA repetia em
          // loop (mesmo bug do MENSAGEM_CANAL, outro gatilho). A resposta do lead é
          // entregue à execução viva pelo retomar(), que roda logo depois. NÃO vale
          // pros demais gatilhos: re-entrada por etapa é legítima e o supersede é o
          // comportamento desejado lá.
          if (triggerTipo === 'LEAD_RESPONDEU') {
            const convId = contexto['conversationId'] as string | undefined;
            const leadIdResp =
              typeof contexto['leadId'] === 'string' ? contexto['leadId'] : undefined;
            const filtroCtx = convId
              ? { path: ['conversationId'], equals: convId }
              : leadIdResp
                ? { path: ['leadId'], equals: leadIdResp }
                : null;
            if (filtroCtx) {
              const viva = await this.prisma.fluxoExecucao.findFirst({
                where: {
                  fluxoId: fluxo.id,
                  empresaId,
                  status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] },
                  contexto: filtroCtx,
                },
                select: { id: true },
              });
              if (viva) continue;
            }
          }

          // Anti-duplicata (IA) por SUBSTITUIÇÃO: um fluxo com nó "Conversar com IA"
          // não pode ter duas execuções ativas pro MESMO lead (senão duas IAs conversam
          // em paralelo, cada uma sem o histórico da outra → re-apresenta a empresa).
          // Mas SUPRIMIR o re-disparo bloqueava a re-entrada legítima (lead volta pra
          // etapa de abordagem e o opener não disparava). Então, ao re-entrar, ENCERRAMOS
          // a(s) execução(ões) anterior(es) deste lead nesse fluxo e começamos uma NOVA —
          // re-entrar sempre dispara a abordagem, e nunca há duas em paralelo. Só vale pra
          // fluxos conversacionais (não mexe em fluxos comuns que rodam várias vezes/lead).
          const leadId = typeof contexto['leadId'] === 'string' ? contexto['leadId'] : undefined;
          if (leadId) {
            const nosIa = await this.prisma.fluxoNo.count({
              where: { fluxoId: fluxo.id, tipo: 'ACAO', acaoTipo: 'CONVERSAR_IA' },
            });
            if (nosIa > 0) {
              // Cancela as execuções-RAIZ de IA ativas do lead (re-entrada SUBSTITUI),
              // EXCETO a execução-FILHA do ramo "classificou" (_ramoFilha=true, que está
              // rodando ações terminais).
              // RAW de propósito: o filtro JSON do Prisma (`NOT path equals`) trata a chave
              // AUSENTE como NULL e EXCLUÍA as raízes (que não têm _ramoFilha) → reabria o
              // bug de 2 IAs em paralelo. `IS DISTINCT FROM` trata ausente/NULL como "!= true":
              // mantém a raiz e exclui a filha — e cobre execuções já em voo no deploy (sem
              // depender de backfill da chave).
              const count = await this.prisma.$executeRaw`
                UPDATE "FluxoExecucao"
                SET status = 'CANCELADO', "aguardandoNoId" = NULL, "timeoutEm" = NULL, "terminouEm" = now()
                WHERE "fluxoId" = ${fluxo.id}
                  AND "empresaId" = ${empresaId}
                  AND status IN ('PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO')
                  AND (contexto #>> '{leadId}') = ${leadId}
                  AND (contexto #> '{_ramoFilha}') IS DISTINCT FROM 'true'::jsonb`;
              if (count > 0) {
                this.logger.log(
                  `Fluxo "${fluxo.nome}": ${count} execução(ões) anterior(es) do lead ${leadId} ` +
                    `encerrada(s) — re-entrada (${triggerTipo}) substitui (anti-duplicata IA)`,
                );
              }
            }
          }

          // Cria registro da execução
          const execucao = await this.prisma.fluxoExecucao.create({
            data: {
              fluxoId: fluxo.id,
              empresaId,
              status: 'PENDENTE',
              contexto: toJsonInput(contexto),
            },
          });

          // Enfileira job para o nó trigger
          const job = await this.queue.add(
            'step',
            { execucaoId: execucao.id, noId: triggerNo.id },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: { count: 500 },
              removeOnFail: { count: 200 },
            },
          );

          // Salva jobId pra monitoramento
          await this.prisma.fluxoExecucao.update({
            where: { id: execucao.id },
            data: { jobId: job.id },
          });

          this.logger.log(
            `Fluxo "${fluxo.nome}" (${fluxo.id}): execução ${execucao.id} enfileirada (job ${job.id})`,
          );
        } catch (e) {
          // Não suprime os demais fluxos do mesmo evento (antes um erro aqui abortava todos).
          const m = e instanceof Error ? e.message : String(e);
          this.logger.error(
            `Fluxo ${fluxo.id} (${fluxo.nome}) falhou no disparo de ${triggerTipo}: ${m}`,
          );
          continue;
        }
      }
    } catch (err) {
      // Rede de segurança (ex.: falha do findMany inicial) — não derruba a operação principal.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`FluxoEventBus.disparar(${triggerTipo}) falhou: ${msg}`, err);
    }
  }

  /**
   * Enfileira diretamente um job para uma execução já criada (usado em testes manuais).
   */
  /**
   * O job ainda existe na fila (waiting/delayed/active/etc.)? Usado pelo reaper
   * de execuções PENDENTE pra não apagar execução que só está atrasada por
   * backlog do worker. Erro na consulta = assume que existe (fail-safe).
   */
  async jobExiste(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    return Boolean(job);
  }

  /**
   * IDs de execução que AINDA têm algum job vivo na fila.
   *
   * O reaper de PENDENTE usa `jobExiste(execucao.jobId)`, mas `jobId` é gravado
   * uma vez, na CRIAÇÃO — uma execução que já andou alguns passos tem um jobId
   * que há muito saiu da fila (removeOnComplete), então aquele check não serve
   * pra decidir se ela está viva. Aqui a pergunta é feita ao contrário: quais
   * execuções têm job vivo AGORA.
   *
   * `delayed` é o estado que mais importa: um nó DELAY de 3 dias mantém a
   * execução EM_EXECUCAO legitimamente esse tempo todo. Sem olhar os delayed, um
   * reaper por tempo mataria toda espera longa.
   */
  async execucoesComJobVivo(): Promise<Set<string>> {
    const jobs = await this.queue.getJobs([
      'waiting',
      'delayed',
      'active',
      'paused',
      'prioritized',
      'waiting-children',
    ]);
    return new Set(jobs.map((j) => j?.data?.execucaoId).filter((id): id is string => Boolean(id)));
  }

  async dispararDireto(
    execucaoId: string,
    noId: string,
    opts: { tentativas?: number; jobId?: string } = {},
  ): Promise<void> {
    await this.queue.add(
      'step',
      { execucaoId, noId },
      {
        attempts: opts.tentativas ?? 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        // jobId determinístico (cron por slot) → BullMQ dedup de enfileiramento duplicado.
        ...(opts.jobId ? { jobId: opts.jobId } : {}),
      },
    );
  }
}
