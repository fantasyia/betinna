import { describe, expect, it } from 'vitest';
import { whatsappDaVitrine } from './contato.service';
import { contatoConfigSchema } from './vitrine.dto';

/** Ícone do WhatsApp no topo da vitrine (Léo, 14/10). */
describe('whatsappDaVitrine', () => {
  const com = (whatsapp: string) => ({ contato: { whatsapp } });

  it('DDD + número (com ou sem máscara) ganha o 55', () => {
    expect(whatsappDaVitrine(com('(11) 99752-4483'))).toBe('5511997524483');
    expect(whatsappDaVitrine(com('1133334444'))).toBe('551133334444');
  });

  it('já com 55 fica como está', () => {
    expect(whatsappDaVitrine(com('+55 11 99752-4483'))).toBe('5511997524483');
  });

  it('sem número, número curto ou estrangeiro: null (o ícone some)', () => {
    expect(whatsappDaVitrine(null)).toBeNull();
    expect(whatsappDaVitrine({})).toBeNull();
    expect(whatsappDaVitrine(com(''))).toBeNull();
    expect(whatsappDaVitrine(com('99752-4483'))).toBeNull();
    expect(whatsappDaVitrine(com('+1 415 555 0100 22'))).toBeNull();
  });
});

describe('contatoConfigSchema', () => {
  it('aceita vazio (tira o ícone) e número com DDD; recusa número sem DDD', () => {
    expect(contatoConfigSchema.safeParse({ whatsapp: '' }).success).toBe(true);
    expect(contatoConfigSchema.safeParse({ whatsapp: '(11) 99752-4483' }).success).toBe(true);
    expect(contatoConfigSchema.safeParse({ whatsapp: '99752-4483' }).success).toBe(false);
  });
});
