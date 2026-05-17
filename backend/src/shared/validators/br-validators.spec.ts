import { describe, expect, it } from 'vitest';
import {
  cepSchema,
  cnpjSchema,
  cpfSchema,
  emailLowerSchema,
  isCnpjValido,
  isCpfValido,
  telefoneBrSchema,
} from './br-validators';

describe('br-validators', () => {
  describe('cpfSchema', () => {
    it('aceita CPF válido com formato', () => {
      const r = cpfSchema.parse('123.456.789-09');
      expect(r).toBe('12345678909');
    });

    it('aceita CPF válido só dígitos', () => {
      expect(cpfSchema.parse('12345678909')).toBe('12345678909');
    });

    it('rejeita CPF com dígito verificador errado', () => {
      expect(() => cpfSchema.parse('123.456.789-00')).toThrow();
    });

    it('rejeita CPF com dígitos repetidos (111.111.111-11)', () => {
      expect(() => cpfSchema.parse('111.111.111-11')).toThrow();
    });

    it('rejeita CPF com menos de 11 dígitos', () => {
      expect(() => cpfSchema.parse('123')).toThrow();
    });

    it('rejeita CPF com mais de 11 dígitos', () => {
      expect(() => cpfSchema.parse('123456789012345')).toThrow();
    });
  });

  describe('cnpjSchema', () => {
    it('aceita CNPJ válido com formato', () => {
      // CNPJ válido conhecido: 11.222.333/0001-81
      expect(cnpjSchema.parse('11.222.333/0001-81')).toBe('11222333000181');
    });

    it('aceita CNPJ válido só dígitos', () => {
      expect(cnpjSchema.parse('11222333000181')).toBe('11222333000181');
    });

    it('rejeita CNPJ com dígito verificador errado', () => {
      expect(() => cnpjSchema.parse('11.222.333/0001-00')).toThrow();
    });

    it('rejeita CNPJ com dígitos repetidos', () => {
      expect(() => cnpjSchema.parse('11.111.111/1111-11')).toThrow();
    });

    it('rejeita CNPJ com menos de 14 dígitos', () => {
      expect(() => cnpjSchema.parse('123')).toThrow();
    });
  });

  describe('telefoneBrSchema', () => {
    it('aceita celular 11 dígitos com formato', () => {
      expect(telefoneBrSchema.parse('(11) 99999-9999')).toBe('11999999999');
    });

    it('aceita fixo 10 dígitos', () => {
      expect(telefoneBrSchema.parse('(11) 3333-4444')).toBe('1133334444');
    });

    it('rejeita DDD inválido (00)', () => {
      expect(() => telefoneBrSchema.parse('(00) 99999-9999')).toThrow();
    });

    it('rejeita telefone com menos de 10 dígitos', () => {
      expect(() => telefoneBrSchema.parse('123456')).toThrow();
    });

    it('rejeita telefone com mais de 11 dígitos', () => {
      expect(() => telefoneBrSchema.parse('1234567890123')).toThrow();
    });
  });

  describe('cepSchema', () => {
    it('aceita CEP com formato', () => {
      expect(cepSchema.parse('01310-100')).toBe('01310100');
    });

    it('aceita CEP só dígitos', () => {
      expect(cepSchema.parse('01310100')).toBe('01310100');
    });

    it('rejeita CEP com 7 dígitos', () => {
      expect(() => cepSchema.parse('0131010')).toThrow();
    });
  });

  describe('emailLowerSchema', () => {
    it('normaliza pra lowercase + trim', () => {
      expect(emailLowerSchema.parse('  Foo@BAR.COM  ')).toBe('foo@bar.com');
    });

    it('rejeita e-mail inválido', () => {
      expect(() => emailLowerSchema.parse('não-é-email')).toThrow();
    });
  });

  describe('helpers puros', () => {
    it('isCpfValido aceita válido', () => {
      expect(isCpfValido('12345678909')).toBe(true);
    });

    it('isCpfValido rejeita inválido', () => {
      expect(isCpfValido('12345678900')).toBe(false);
    });

    it('isCnpjValido aceita válido', () => {
      expect(isCnpjValido('11222333000181')).toBe(true);
    });

    it('isCnpjValido rejeita inválido', () => {
      expect(isCnpjValido('11222333000100')).toBe(false);
    });
  });
});
