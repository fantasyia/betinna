/**
 * Detecção de CANAL de conteúdo a partir do texto de um item de checklist
 * (quadro "Somatec — Conteúdo": cada card = 1 unidade; checklist = canais).
 *
 * Fonte única — usada pela página Calendário de Marketing E pelo módulo M7 do
 * dashboard (resumo). ORDEM IMPORTA (primeira que casa vence): específicos ANTES
 * do blog — "Carrossel do artigo X" é carrossel; blog fica por último.
 */
export interface CanalConteudo {
  key: string;
  label: string;
  cor: string;
  re: RegExp;
}

export const CANAIS_CONTEUDO: CanalConteudo[] = [
  { key: 'carrossel', label: 'Carrossel', cor: '#bd1fbf', re: /carross?el|carousel/i },
  { key: 'reel', label: 'Reel', cor: '#E4405F', re: /reel|v[ií]deo|short|tiktok/i },
  { key: 'email', label: 'E-mail', cor: '#2bcae5', re: /e-?mail|newsletter|resend/i },
  { key: 'ads', label: 'Ads', cor: '#F59E0B', re: /\bads?\b|an[uú]ncio|tr[aá]fego|impuls/i },
  { key: 'blog', label: 'Blog', cor: '#5C88DA', re: /blog|artigo|wordpress|seo/i },
];

export function canalDe(texto: string): CanalConteudo | null {
  return CANAIS_CONTEUDO.find((c) => c.re.test(texto)) ?? null;
}

/**
 * Os 5 PONTOS do M7 (Blog · Visual · Vídeo · E-mail · Ads), na ordem do card.
 * "Visual" = carrossel; "Vídeo" = reel. Ordem FIXA — o progresso do pacote fica
 * legível de relance porque a posição de cada ponto nunca muda.
 */
export const PONTOS_M7: Array<{ key: string; label: string; cor: string }> = [
  { key: 'blog', label: 'Blog', cor: '#5C88DA' },
  { key: 'carrossel', label: 'Visual', cor: '#bd1fbf' },
  { key: 'reel', label: 'Vídeo', cor: '#E4405F' },
  { key: 'email', label: 'E-mail', cor: '#2bcae5' },
  { key: 'ads', label: 'Ads', cor: '#F59E0B' },
];
