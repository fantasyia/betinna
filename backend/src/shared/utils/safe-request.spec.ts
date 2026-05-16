import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as dnsPromises from 'node:dns/promises';
import { assertSafeUrl, SsrfBlockedError } from './safe-request';

// Mock do dns/promises pra controlar resolves nos testes
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));
const dnsLookup = dnsPromises.lookup as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  dnsLookup.mockReset();
});

describe('SSRF protection — safe-request', () => {
  describe('schemes inválidas', () => {
    it.each([
      'file:///etc/passwd',
      'ftp://example.com/file',
      'gopher://evil.com',
      'javascript:alert(1)',
      'data:text/html,malicious',
    ])('bloqueia scheme: %s', async (url) => {
      await expect(assertSafeUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  });

  describe('hostnames bloqueados diretos', () => {
    it.each([
      'http://localhost/admin',
      'http://localhost:8080',
      'https://127.0.0.1/secret',
      'http://0.0.0.0/',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata.azure.com/',
    ])('bloqueia: %s', async (url) => {
      await expect(assertSafeUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  });

  describe('IPs privados literais', () => {
    it.each([
      'http://10.0.0.1/',
      'http://10.255.255.255/',
      'http://172.16.0.1/',
      'http://172.20.0.1/',
      'http://172.31.255.255/',
      'http://192.168.0.1/',
      'http://192.168.255.255/',
      'http://127.1.2.3/',
      'http://100.64.0.1/', // carrier-grade NAT
    ])('bloqueia IP privado: %s', async (url) => {
      await expect(assertSafeUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it('permite IP público (8.8.8.8)', async () => {
      // IP literal não dispara DNS lookup
      const result = await assertSafeUrl('https://8.8.8.8/');
      expect(result.hostname).toBe('8.8.8.8');
    });
  });

  describe('IPv6 privados', () => {
    it.each([
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[fd00::1]/',
    ])('bloqueia IPv6 privado: %s', async (url) => {
      await expect(assertSafeUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  });

  describe('DNS rebinding protection', () => {
    it('bloqueia hostname público que resolve para IP privado (rebinding)', async () => {
      dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(assertSafeUrl('https://malicious-rebind.example.com/')).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    });

    it('bloqueia hostname que resolve para 169.254.169.254 (metadata)', async () => {
      dnsLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      await expect(assertSafeUrl('https://aws-rebind.example.com/')).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    });

    it('permite hostname público que resolve para IP público', async () => {
      dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]); // example.com
      const result = await assertSafeUrl('https://api.example.com/webhook');
      expect(result.hostname).toBe('api.example.com');
    });

    it('bloqueia quando DNS falha (fail-closed)', async () => {
      dnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(assertSafeUrl('https://nao-existe.invalid/')).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    });

    it('bloqueia quando QUALQUER resolved é privado (mesmo se houver públicos)', async () => {
      // Multi-resolve: 1 público + 1 privado. Resposta correta é BLOQUEAR
      // pra evitar race no resolve (DNS pinning attack).
      dnsLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
      await expect(assertSafeUrl('https://api.example.com/')).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    });
  });

  describe('happy path', () => {
    it('aceita https://api.example.com', async () => {
      dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const url = await assertSafeUrl('https://api.example.com/webhook');
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('api.example.com');
    });

    it('aceita http://api.example.com (http permitido, não só https)', async () => {
      dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const url = await assertSafeUrl('http://api.example.com/');
      expect(url.protocol).toBe('http:');
    });

    it('rejeita URL malformada', async () => {
      await expect(assertSafeUrl('not a url')).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(assertSafeUrl('')).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  });
});
