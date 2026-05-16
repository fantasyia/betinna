import { describe, expect, it } from 'vitest';
import { ListasDinamicasService } from './listas-dinamicas.service';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
// ListasDinamicasService é puro (sem injeção de dependências).
// Apenas verifica que `whereFor` retorna condições Prisma corretas
// e que as definições estão consistentes.

describe('ListasDinamicasService', () => {
  const service = new ListasDinamicasService();

  describe('whereFor', () => {
    it('vip — score >= 80 e status ATIVO', () => {
      const where = service.whereFor('vip');
      expect(where).toEqual({ score: { gte: 80 }, status: 'ATIVO' });
    });

    it('risco — inclui status RISCO ou score entre 30 e 60', () => {
      const where = service.whereFor('risco');
      expect(where).toMatchObject({ OR: expect.any(Array) });
      const or = (where as { OR: unknown[] }).OR;
      expect(or).toContainEqual({ status: 'RISCO' });
    });

    it('criticos — score < 30 ou status CRITICO', () => {
      const where = service.whereFor('criticos');
      const or = (where as { OR: unknown[] }).OR;
      expect(or).toContainEqual({ status: 'CRITICO' });
      expect(or).toContainEqual({ score: { lt: 30 } });
    });

    it('novos — status NOVO', () => {
      const where = service.whereFor('novos');
      expect(where).toEqual({ status: 'NOVO' });
    });

    it('horeca — segmento in Restaurante/Buffet/Hotel', () => {
      const where = service.whereFor('horeca');
      expect(where).toMatchObject({
        segmento: { in: expect.arrayContaining(['Restaurante', 'Buffet', 'Hotel']) },
      });
    });

    it('inadimplentes — omieStatus BLOQUEADO', () => {
      const where = service.whereFor('inadimplentes');
      expect(where).toEqual({ omieStatus: 'BLOQUEADO' });
    });

    it('top10 — where vazio (filtro aplicado via orderBy+take no service)', () => {
      const where = service.whereFor('top10');
      expect(where).toEqual({});
    });

    it('chave desconhecida → retorna where vazio', () => {
      const where = service.whereFor('inexistente' as never);
      expect(where).toEqual({});
    });
  });

  describe('definicoes', () => {
    it('tem 7 definições', () => {
      expect(service.definicoes).toHaveLength(7);
    });

    it('cada definição tem key, nome, descricao, cor e where', () => {
      for (const def of service.definicoes) {
        expect(def.key).toBeTruthy();
        expect(def.nome).toBeTruthy();
        expect(def.descricao).toBeTruthy();
        expect(def.cor).toBeTruthy();
        expect(def.where).toBeDefined();
      }
    });

    it('keys são únicos', () => {
      const keys = service.definicoes.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('contém as chaves esperadas', () => {
      const keys = service.definicoes.map((d) => d.key);
      expect(keys).toContain('vip');
      expect(keys).toContain('risco');
      expect(keys).toContain('criticos');
      expect(keys).toContain('novos');
      expect(keys).toContain('horeca');
      expect(keys).toContain('inadimplentes');
      expect(keys).toContain('top10');
    });
  });
});
