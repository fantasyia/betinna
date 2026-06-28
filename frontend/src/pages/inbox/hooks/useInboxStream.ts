import { useEffect, useRef, useState } from 'react';
import { getSession, getStoredEmpresaId } from '@/lib/auth-store';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const STREAM_URL = `${BASE_URL}/api/v1/inbox/stream`;

export interface InboxEvento {
  empresaId: string;
  conversationId: string;
  tipo: 'mensagem' | 'status' | 'atribuicao';
  proprietarioId: string | null;
  atribuidoId: string | null;
  canal: string;
}

// ─── Conexão SSE ÚNICA compartilhada (refcounted) ───────────────────────────────
// Vários componentes (lista + thread) assinam o MESMO stream → 1 conexão por usuário,
// não N. Abre quando o 1º assinante monta, fecha quando o último desmonta.
const assinantes = new Set<(e: InboxEvento) => void>();
const statusAssinantes = new Set<(c: boolean) => void>();
let refs = 0;
let controller: AbortController | null = null;
let tentativa = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let conectadoGlobal = false;

function setStatus(c: boolean): void {
  if (c === conectadoGlobal) return;
  conectadoGlobal = c;
  statusAssinantes.forEach((fn) => fn(c));
}

function processarFrame(frame: string): void {
  let evento = 'message';
  let data = '';
  for (const linha of frame.split('\n')) {
    if (linha.startsWith('event:')) evento = linha.slice(6).trim();
    else if (linha.startsWith('data:')) data += linha.slice(5).trim();
  }
  if (!data || evento === 'ping') return; // heartbeat — ignora
  try {
    const parsed = JSON.parse(data) as InboxEvento;
    if (parsed?.conversationId) assinantes.forEach((fn) => fn(parsed));
  } catch {
    // payload malformado — ignora
  }
}

async function loop(): Promise<void> {
  if (refs === 0) return;
  const sess = getSession();
  const token = sess?.accessToken;
  if (!token) {
    agendarReconexao(); // sem sessão ainda
    return;
  }
  const empresaId = sess.user?.empresaIdAtiva ?? getStoredEmpresaId();
  controller = new AbortController();
  try {
    const resp = await fetch(STREAM_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        ...(empresaId ? { 'X-Empresa-Id': empresaId } : {}),
      },
      signal: controller.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`SSE status ${resp.status}`);
    tentativa = 0;
    setStatus(true);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        processarFrame(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    throw new Error('stream encerrado'); // servidor fechou → reconecta
  } catch {
    setStatus(false);
    agendarReconexao();
  }
}

function agendarReconexao(): void {
  if (refs === 0) return; // ninguém mais ouvindo
  tentativa += 1;
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, tentativa)); // 2s..30s
  reconnectTimer = setTimeout(() => void loop(), delay);
}

function abrir(): void {
  refs += 1;
  if (refs === 1) {
    tentativa = 0;
    void loop();
  }
}

function fechar(): void {
  refs -= 1;
  if (refs === 0) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (controller) {
      controller.abort();
      controller = null;
    }
    setStatus(false);
  }
}

/**
 * Assina o stream SSE do Inbox (push-to-invalidate). Chama `onEvento` a cada mudança; o caller
 * decide o que refetchar. `conectado` permite DESACELERAR o poll fallback quando o push está ativo.
 * A conexão é COMPARTILHADA entre todos os usos do hook (1 por usuário).
 */
export function useInboxStream(onEvento: (e: InboxEvento) => void): { conectado: boolean } {
  const [conectado, setConectado] = useState(conectadoGlobal);
  const ref = useRef(onEvento);
  ref.current = onEvento;

  useEffect(() => {
    const assinante = (e: InboxEvento): void => ref.current(e);
    const statusAssinante = (c: boolean): void => setConectado(c);
    assinantes.add(assinante);
    statusAssinantes.add(statusAssinante);
    setConectado(conectadoGlobal);
    abrir();
    return () => {
      assinantes.delete(assinante);
      statusAssinantes.delete(statusAssinante);
      fechar();
    };
  }, []);

  return { conectado };
}
