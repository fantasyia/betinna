import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠️ ESTRUTURAL — toda rota de ESCRITA do controller de fluxos deixa rastro.
 *
 * Em 24/09 o R2 saiu de ATIVO pra RASCUNHO no meio de uma certificação e
 * ninguém conseguiu descobrir quem fez: o controller tinha ZERO `@Audit` nas
 * rotas de escrita. O kanban tinha 8. O motor que fala com o cliente, nenhum.
 *
 * Este teste pega a PRÓXIMA rota de escrita que nascer sem `@Audit` — que é
 * como o buraco abriu da primeira vez: ninguém tirou, só nunca foi posto.
 */
const FONTE = readFileSync(join(__dirname, 'fluxos.controller.ts'), 'utf8');

/** Escritas que NÃO são auditadas de propósito: preferência pessoal e leitura. */
const SEM_AUDITORIA = new Set([
  "Put(':id/favorito')",
  "Delete(':id/favorito')",
  "Post('cron/preview')", // só calcula as próximas datas
  "Post('diagnostico/ia-a-frente')", // diagnóstico de leitura (ADMIN)
  "Post('diagnostico/extracao')", // idem
]);

/** Cada rota de escrita com o bloco de decorators que a acompanha. */
function rotas(): Array<{ rota: string; decorators: string }> {
  const out: Array<{ rota: string; decorators: string }> = [];
  const re = /@(Post|Put|Patch|Delete)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(FONTE))) {
    // O bloco vai da linha em branco anterior até a próxima linha em branco.
    const ini = FONTE.lastIndexOf('\n\n', m.index);
    const fim = FONTE.indexOf('\n\n', m.index);
    out.push({ rota: `${m[1]}(${m[2]})`, decorators: FONTE.slice(ini, fim) });
  }
  return out;
}

describe('fluxos.controller — auditoria nas rotas de escrita', () => {
  it('acha as rotas (sanidade do parser)', () => {
    expect(rotas().length).toBeGreaterThanOrEqual(17);
  });

  it.each(rotas().filter((r) => !SEM_AUDITORIA.has(r.rota)))(
    '$rota tem @Audit',
    ({ decorators }) => {
      expect(decorators).toMatch(/@Audit\(\{ action: '[a-z_]+', resource: 'fluxo(_execucao)?'/);
    },
  );

  it('as que mudam PRODUÇÃO identificam o recurso (senão o log não diz qual fluxo)', () => {
    for (const acao of [
      'update',
      'ativar',
      'pausar',
      'arquivar',
      'excluir_permanente',
      'definir_gatilho',
    ]) {
      expect(FONTE).toContain(
        `@Audit({ action: '${acao}', resource: 'fluxo', resourceIdFrom: 'params.id' })`,
      );
    }
    expect(FONTE).toContain(
      "@Audit({ action: 'cancelar', resource: 'fluxo_execucao', resourceIdFrom: 'params.execucaoId' })",
    );
  });

  it('a lista de exceções não esconde rota que não existe mais', () => {
    const existentes = new Set(rotas().map((r) => r.rota));
    for (const r of SEM_AUDITORIA) expect(existentes.has(r)).toBe(true);
  });
});
