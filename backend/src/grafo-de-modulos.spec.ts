import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';

/**
 * Import circular entre módulos (Erp → Fluxos → … → Erp) não quebra o build:
 * o `imports: [X]` chega como `undefined` e o Nest só morre NA SUBIDA, em
 * produção. Este teste percorre o grafo a partir do AppModule e acusa o
 * módulo que importou algo que ainda não existia.
 */
describe('grafo de módulos do Nest', () => {
  it(
    'nenhum módulo importa `undefined` (sinal de import circular)',
    { timeout: 120_000 },
    async () => {
      const { AppModule } = await import('./app.module');
      const vistos = new Set<unknown>();
      const furos: string[] = [];
      const andar = (m: unknown, caminho: string) => {
        if (!m || vistos.has(m)) return;
        vistos.add(m);
        // Módulo dinâmico ({ module, imports }) ou classe com @Module.
        const alvo = (m as { module?: unknown }).module ?? m;
        const dinamicos = (m as { imports?: unknown[] }).imports ?? [];
        const imports = [
          ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, alvo as object) as unknown[]) ?? []),
          ...dinamicos,
        ];
        const nome = (alvo as { name?: string }).name ?? '?';
        imports.forEach((i, idx) => {
          if (i === undefined) furos.push(`${caminho} > ${nome} (import #${idx})`);
          else if (typeof (i as { forwardRef?: unknown }).forwardRef !== 'function') {
            andar(i, `${caminho} > ${nome}`);
          }
        });
      };
      andar(AppModule, 'App');
      expect(furos).toEqual([]);
      expect(vistos.size).toBeGreaterThan(20);
    },
  );
});
