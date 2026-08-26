/**
 * Resposta do token endpoint do Tiny (Keycloak — `accounts.tiny.com.br`).
 *
 * `refresh_expires_in` é o campo que muda o desenho em relação aos outros
 * OAuth do sistema: no Tiny o REFRESH vence em ~1 dia, não em meses. Por isso
 * ele é persistido e vigiado por cron (ver `TinyTokenRefreshJob`).
 */
export interface TinyTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Segundos de validade do access_token (documentado: 4h). */
  expires_in: number;
  /** Segundos de validade do refresh_token (documentado: 1 dia). */
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
}

/** O que fica cifrado em `IntegracaoConexao(servico='tiny')`. */
export interface TinyCredenciais {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms em que o access_token expira. */
  expiresAt: number;
  /**
   * Epoch ms em que o REFRESH expira. Passou disso, não há renovação possível
   * — só reconectar pelo navegador. É o que o cron e a tela usam pra avisar
   * ANTES de virar problema.
   */
  refreshExpiresAt: number;
  /** Quando a última renovação bem-sucedida aconteceu (diagnóstico). */
  renovadoEm?: number;
}
