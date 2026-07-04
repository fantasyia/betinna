import { Injectable, Logger } from '@nestjs/common';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { GoogleOAuthService } from './google-oauth.service';
import type {
  GoogleEvent,
  GoogleEventCreateParams,
  GoogleEventsListResponse,
  GoogleTask,
  GoogleTaskListsResponse,
  GoogleTasksListResponse,
} from './google.types';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';
const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Wrapper do Google Calendar API v3 (calendar `primary` do usuário).
 *
 * Todas operações usam o access_token resolvido via GoogleOAuthService
 * (que faz refresh automático quando necessário).
 *
 * Cobre o caso de uso "agenda do rep": criar/listar/atualizar/cancelar visitas.
 * Não toca em outros calendários do usuário.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly oauth: GoogleOAuthService,
  ) {}

  async criarEvento(usuarioId: string, params: GoogleEventCreateParams): Promise<GoogleEvent> {
    if (params.fim <= params.inicio) {
      throw new IntegrationException('fim deve ser depois de inicio', ErrorCode.INTEGRATION_ERROR);
    }
    const token = await this.oauth.getAccessToken(usuarioId);
    const tz = params.timezone ?? DEFAULT_TZ;
    const body: GoogleEvent = {
      summary: params.titulo,
      description: params.descricao,
      location: params.local,
      start: { dateTime: params.inicio.toISOString(), timeZone: tz },
      end: { dateTime: params.fim.toISOString(), timeZone: tz },
      attendees: params.participantes?.map((p) => ({ email: p.email, displayName: p.nome })),
      reminders: this.montarReminders(params.alertas),
    };
    return this.call<GoogleEvent>('POST', `${CALENDAR_BASE}/events`, token, body);
  }

  async atualizarEvento(
    usuarioId: string,
    eventId: string,
    params: Partial<GoogleEventCreateParams>,
  ): Promise<GoogleEvent> {
    const token = await this.oauth.getAccessToken(usuarioId);
    const tz = params.timezone ?? DEFAULT_TZ;
    const body: Partial<GoogleEvent> = {};
    if (params.titulo !== undefined) body.summary = params.titulo;
    if (params.descricao !== undefined) body.description = params.descricao;
    if (params.local !== undefined) body.location = params.local;
    if (params.inicio) body.start = { dateTime: params.inicio.toISOString(), timeZone: tz };
    if (params.fim) body.end = { dateTime: params.fim.toISOString(), timeZone: tz };
    if (params.participantes) {
      body.attendees = params.participantes.map((p) => ({ email: p.email, displayName: p.nome }));
    }
    if (params.alertas !== undefined) body.reminders = this.montarReminders(params.alertas);
    return this.call<GoogleEvent>(
      'PATCH',
      `${CALENDAR_BASE}/events/${encodeURIComponent(eventId)}`,
      token,
      body,
    );
  }

  async deletarEvento(usuarioId: string, eventId: string): Promise<void> {
    const token = await this.oauth.getAccessToken(usuarioId);
    try {
      await this.http.delete(`${CALENDAR_BASE}/events/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        integration: 'google',
        retries: 1,
      });
    } catch (err) {
      // 404/410 — evento já não existe, considerar idempotente
      if (err instanceof HttpClientError && (err.status === 404 || err.status === 410)) {
        return;
      }
      throw this.wrapError(err);
    }
  }

  /**
   * Busca UM evento por id. Retorna `null` quando ele não existe mais no Google
   * — apagado (404/410) OU cancelado (status 'cancelled'). Usado na reconciliação
   * mão-dupla: excluir no Google reflete na Agenda da Betinna. Não usa `callRaw`
   * de propósito (ele embrulha o erro e perde o status HTTP).
   */
  async obterEvento(usuarioId: string, eventId: string): Promise<GoogleEvent | null> {
    const token = await this.oauth.getAccessToken(usuarioId);
    try {
      const res = await this.http.request<GoogleEvent>(
        'GET',
        `${CALENDAR_BASE}/events/${encodeURIComponent(eventId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          integration: 'google',
          redactKeys: ['authorization'],
          retries: 1,
        },
      );
      return res.data?.status === 'cancelled' ? null : res.data;
    } catch (err) {
      if (err instanceof HttpClientError && (err.status === 404 || err.status === 410)) {
        return null;
      }
      throw this.wrapError(err);
    }
  }

  async listarEventos(
    usuarioId: string,
    inicio: Date,
    fim: Date,
    maxResults = 50,
  ): Promise<GoogleEvent[]> {
    const token = await this.oauth.getAccessToken(usuarioId);
    const params = new URLSearchParams({
      timeMin: inicio.toISOString(),
      timeMax: fim.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: maxResults.toString(),
    });
    const res = await this.callRaw<GoogleEventsListResponse>(
      'GET',
      `${CALENDAR_BASE}/events?${params}`,
      token,
    );
    return res.items ?? [];
  }

  /**
   * Lista as TAREFAS do usuário (Google Tasks — API separada de tasks.googleapis.com)
   * com vencimento na faixa [inicio, fim]. Tarefas NÃO aparecem no Calendar Events
   * API — por isso esta chamada dedicada. Só as NÃO concluídas e COM data (due).
   * Precisa do escopo `tasks.readonly` (403 se o usuário não reconectou concedendo).
   */
  async listarTarefas(usuarioId: string, inicio: Date, fim: Date): Promise<GoogleTask[]> {
    const token = await this.oauth.getAccessToken(usuarioId);
    const lists = await this.tasksGet<GoogleTaskListsResponse>('/users/@me/lists', token);
    const out: GoogleTask[] = [];
    for (const l of lists.items ?? []) {
      const params = new URLSearchParams({
        dueMin: inicio.toISOString(),
        dueMax: fim.toISOString(),
        showCompleted: 'false',
        showHidden: 'false',
        maxResults: '100',
      });
      const res = await this.tasksGet<GoogleTasksListResponse>(
        `/lists/${encodeURIComponent(l.id)}/tasks?${params}`,
        token,
      );
      for (const t of res.items ?? []) {
        if (t.id && t.due && t.status !== 'completed') out.push(t);
      }
    }
    return out;
  }

  // ─── Internos ──────────────────────────────────────────────────────────

  private async tasksGet<T>(path: string, token: string): Promise<T> {
    try {
      const res = await this.http.request<T>('GET', `${TASKS_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        integration: 'google',
        redactKeys: ['authorization'],
        retries: 1,
      });
      return res.data;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * Alertas (minutos antes) → `reminders` do Google. Vazio = usa os defaults do
   * calendário do usuário; com alertas = overrides popup (Google aceita até 5).
   */
  private montarReminders(alertas?: number[]): GoogleEvent['reminders'] {
    if (!alertas || alertas.length === 0) return { useDefault: true };
    return {
      useDefault: false,
      overrides: alertas.slice(0, 5).map((minutes) => ({ method: 'popup' as const, minutes })),
    };
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    return this.callRaw<T>(method, url, token, body);
  }

  private async callRaw<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const res = await this.http.request<T>(method, url, {
        headers: { Authorization: `Bearer ${token}` },
        body,
        integration: 'google',
        redactKeys: ['authorization'],
        retries: 1,
      });
      return res.data;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private wrapError(err: unknown): Error {
    if (err instanceof HttpClientError) {
      const detail =
        typeof err.body === 'object' && err.body !== null
          ? JSON.stringify(err.body).slice(0, 300)
          : String(err.body ?? '').slice(0, 300);
      return new IntegrationException(
        `Google Calendar HTTP ${err.status}: ${detail}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (err instanceof Error) return err;
    return new Error(String(err));
  }
}
