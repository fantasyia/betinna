import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { type Observable, Subject } from 'rxjs';
import { RedisService } from '@database/redis.service';

/**
 * Evento LEVE de mudança no Inbox — fan-out via Redis pub/sub pra todas as réplicas, consumido pelo
 * endpoint SSE (`GET /inbox/stream`). NÃO carrega conteúdo de mensagem: só os ids + escopo, pra o
 * front saber QUE refetchar (a query refetchada já é escopada → defesa em profundidade contra vazar).
 */
export interface InboxEvento {
  empresaId: string;
  conversationId: string;
  /** O que mudou — o front pode invalidar queries específicas (lista vs thread). */
  tipo: 'mensagem' | 'status' | 'atribuicao';
  /** Escopo (espelha o where da lista do Inbox): REP só recebe os do próprio WhatsApp. */
  proprietarioId: string | null;
  atribuidoId: string | null;
  canal: string;
}

/** Canal Redis único; o filtro por empresa/escopo é feito no controller (in-process). */
const CANAL_REDIS = 'inbox:events';

@Injectable()
export class InboxEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboxEventsService.name);
  /** Conexão DEDICADA de subscriber — em modo subscribe o ioredis não aceita outros comandos. */
  private subscriber: Redis | null = null;
  /** Stream local alimentado pelo subscriber Redis; o controller assina e filtra por usuário. */
  private readonly eventos$ = new Subject<InboxEvento>();

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    try {
      this.subscriber = this.redis.client.duplicate();
      this.subscriber.on('message', (_canal, payload) => {
        try {
          this.eventos$.next(JSON.parse(payload) as InboxEvento);
        } catch {
          // payload malformado — ignora
        }
      });
      await this.subscriber.subscribe(CANAL_REDIS);
      this.logger.log('Inbox SSE: subscriber Redis ativo');
    } catch (err) {
      // Sem Redis o SSE simplesmente não recebe push — o poll fallback do front cobre.
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Inbox SSE sem Redis (push desligado, poll cobre): ${m}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.eventos$.complete();
    if (this.subscriber) await this.subscriber.quit().catch(() => undefined);
  }

  /** Publica um evento de mudança (fan-out p/ todas as réplicas). Best-effort: nunca lança. */
  async publicar(evento: InboxEvento): Promise<void> {
    try {
      await this.redis.client.publish(CANAL_REDIS, JSON.stringify(evento));
    } catch {
      // best-effort: falha no publish não pode derrubar o fluxo de mensagem
    }
  }

  /** Stream de TODOS os eventos — o controller filtra por empresa + escopo do usuário. */
  get stream$(): Observable<InboxEvento> {
    return this.eventos$.asObservable();
  }
}
