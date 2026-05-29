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
    // CL2 (Lote 7): score removido. risco/criticos passam a usar o campo Status.
    it('risco — status RISCO', () => {
      const where = service.whereFor('risco');
      expect(where).toEqual({ status: 'RISCO' });
    });

    it('criticos — status CRITICO', () => {
      const where = service.whereFor('criticos');
      expect(where).toEqual({ status: 'CRITICO' });
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

    it('nenhuma definição usa o campo score (removido no Lote 7)', () => {
      for (const def of service.definicoes) {
        expect(JSON.stringify(def.where)).not.toContain('score');
      }
    });

    it('chave desconhecida → retorna where vazio', () => {
      const where = service.whereFor('inexistente' as never);
      expect(where).toEqual({});
    });
  });

  describe('definicoes', () => {
    it('tem 5 definições', () => {
      expect(service.definicoes).toHaveLength(5);
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

    it('contém as chaves esperadas (sem vip/top10 — removidas no Lote 7)', () => {
      const keys = service.definicoes.map((d) => d.key);
      expect(keys).toContain('risco');
      expect(keys).toContain('criticos');
      expect(keys).toContain('novos');
      expect(keys).toContain('horeca');
      expect(keys).toContain('inadimplentes');
      expect(keys).not.toContain('vip');
      expect(keys).not.toContain('top10');
    });
  });
});
