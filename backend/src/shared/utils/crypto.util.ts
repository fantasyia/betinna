import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // Recomendado para GCM
const AUTH_TAG_LEN = 16;

/**
 * Criptografia simétrica para dados sensíveis em repouso
 * (tokens OAuth, chaves de API de cada cliente, etc).
 *
 * Formato do resultado: base64(iv || ciphertext || authTag)
 *
 * A chave (ENCRYPTION_KEY) precisa ter 32 bytes (64 chars hex).
 */
export class CryptoUtil {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error('ENCRYPTION_KEY deve ter exatamente 64 caracteres hexadecimais');
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, enc, tag]).toString('base64');
  }

  decrypt(ciphertextB64: string): string {
    const data = Buffer.from(ciphertextB64, 'base64');
    if (data.length < IV_LEN + AUTH_TAG_LEN) {
      throw new Error('Ciphertext inválido (muito curto)');
    }
    const iv = data.subarray(0, IV_LEN);
    const tag = data.subarray(data.length - AUTH_TAG_LEN);
    const enc = data.subarray(IV_LEN, data.length - AUTH_TAG_LEN);

    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
