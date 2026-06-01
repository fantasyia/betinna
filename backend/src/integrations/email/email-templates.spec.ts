import { describe, expect, it } from 'vitest';
import {
  templateAmostraFollowup,
  templateAprovacaoResolvida,
  templateBoasVindas,
  templateComissaoFechada,
  templateOcorrenciaCritica,
} from './email-templates';

describe('Email templates', () => {
  describe('templateBoasVindas', () => {
    it('inclui nome e empresa no corpo', () => {
      const r = templateBoasVindas({
        nome: 'João',
        empresaNome: 'Minha Empresa',
        loginUrl: 'https://app.betinna.ai/login',
      });
      expect(r.assunto).toContain('João');
      expect(r.html).toContain('João');
      expect(r.html).toContain('Minha Empresa');
      expect(r.html).toContain('https://app.betinna.ai/login');
    });

    it('escapa HTML em nome (XSS)', () => {
      const r = templateBoasVindas({
        nome: '<script>alert(1)</script>',
        empresaNome: 'X',
        loginUrl: 'https://x.com',
      });
      expect(r.html).not.toContain('<script>');
      expect(r.html).toContain('&lt;script&gt;');
    });

    it('é HTML válido (doctype + tags balanceadas básicas)', () => {
      const r = templateBoasVindas({
        nome: 'Test',
        empresaNome: 'X',
        loginUrl: 'https://x.com',
      });
      expect(r.html.startsWith('<!doctype html>')).toBe(true);
      expect(r.html).toContain('</html>');
      // <table> abre e fecha
      const opens = (r.html.match(/<table/g) ?? []).length;
      const closes = (r.html.match(/<\/table>/g) ?? []).length;
      expect(opens).toBe(closes);
    });
  });

  describe('templateAprovacaoResolvida', () => {
    it('APROVADA mostra cor verde + mensagem positiva', () => {
      const r = templateAprovacaoResolvida({
        repNome: 'Rep',
        pedidoNumero: 'PED-0042',
        status: 'APROVADA',
        comentario: 'OK pra cliente VIP',
        pedidoUrl: 'https://app/pedidos/p1',
      });
      expect(r.assunto).toContain('aprovado');
      expect(r.html).toContain('PED-0042');
      expect(r.html).toContain('OK pra cliente VIP');
    });

    it('REJEITADA mostra mensagem de orientação', () => {
      const r = templateAprovacaoResolvida({
        repNome: 'Rep',
        pedidoNumero: 'PED-99',
        status: 'REJEITADA',
        comentario: null,
        pedidoUrl: 'https://app/pedidos/p1',
      });
      expect(r.assunto).toContain('rejeitado');
      expect(r.html).toContain('cancelado');
    });

    it('omite bloco de motivo quando comentario=null', () => {
      const r = templateAprovacaoResolvida({
        repNome: 'R',
        pedidoNumero: 'P1',
        status: 'APROVADA',
        comentario: null,
        pedidoUrl: 'https://x',
      });
      expect(r.html).not.toContain('Motivo:');
    });
  });

  describe('templateComissaoFechada', () => {
    it('formata valores em pt-BR', () => {
      const r = templateComissaoFechada({
        repNome: 'Rep',
        mes: 5,
        ano: 2026,
        totalVendas: 12345.67,
        totalComissao: 432.1,
        comissoesUrl: 'https://app/comissoes',
      });
      expect(r.html).toContain('Maio');
      expect(r.assunto).toContain('Maio/2026');
      // Number formatting pt-BR usa vírgula como decimal
      expect(r.html).toContain('12.345,67');
      expect(r.html).toContain('432,10');
    });

    it('mes inválido cai pro número', () => {
      const r = templateComissaoFechada({
        repNome: 'R',
        mes: 13 as never,
        ano: 2026,
        totalVendas: 0,
        totalComissao: 0,
        comissoesUrl: 'https://x',
      });
      expect(r.assunto).toContain('13/2026');
    });
  });

  describe('templateOcorrenciaCritica', () => {
    it('inclui número + severidade no assunto', () => {
      const r = templateOcorrenciaCritica({
        destinatarioNome: 'Gerente',
        numero: 'OC-0021',
        titulo: 'Entrega atrasada cliente X',
        severidade: 'CRITICA',
        slaHoras: 2,
        ocorrenciaUrl: 'https://app/ocorrencias/o1',
      });
      expect(r.assunto).toContain('[CRITICA]');
      expect(r.assunto).toContain('OC-0021');
      expect(r.html).toContain('2 horas');
    });

    it('trunca título longo no assunto', () => {
      const r = templateOcorrenciaCritica({
        destinatarioNome: 'X',
        numero: 'OC-1',
        titulo: 'a'.repeat(200),
        severidade: 'ALTA',
        slaHoras: 4,
        ocorrenciaUrl: 'https://x',
      });
      expect(r.assunto.length).toBeLessThan(120);
      expect(r.assunto).toContain('…');
    });

    it('SLA 1h escrito sem plural', () => {
      const r = templateOcorrenciaCritica({
        destinatarioNome: 'X',
        numero: 'OC-1',
        titulo: 'X',
        severidade: 'CRITICA',
        slaHoras: 1,
        ocorrenciaUrl: 'https://x',
      });
      expect(r.html).toContain('1 hora');
      expect(r.html).not.toContain('1 horas');
    });
  });

  describe('templateAmostraFollowup', () => {
    it('inclui nome do cliente e produto', () => {
      const r = templateAmostraFollowup({
        repNome: 'R',
        clienteNome: 'Padaria do Zé',
        produtoNome: 'Açúcar Refinado 5kg',
        diasDesdeEnvio: 7,
        amostrasUrl: 'https://app/amostras',
      });
      expect(r.html).toContain('Padaria do Zé');
      expect(r.html).toContain('Açúcar Refinado 5kg');
      expect(r.html).toContain('7 dias');
    });
  });
});
