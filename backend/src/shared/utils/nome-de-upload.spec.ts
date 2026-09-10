import { describe, expect, it } from 'vitest';
import { decodificarNomeDeUpload, nomeSeguroParaStorage } from './nome-de-upload';

/**
 * O caso real: em 10/09 um contrato foi anexado num card do Kanban e apareceu
 * na tela como `MODELO_DE_CONTRATO_DE_LOCA____O_...`.
 *
 * O teste reproduz o caminho INTEIRO — bytes UTF-8 lidos como latin1, que é
 * exatamente o que o multer entrega — porque testar só a função de sanitizar
 * teria passado verde com o bug em pé.
 */
const REAL = 'MODELO DE CONTRATO DE LOCAÇÃO MB IoT - GRUPO TARIFÁRIO A.xlsx';

/** O que o `originalname` do multer contém quando o nome tem acento. */
const comoOMulterEntrega = (nome: string) => Buffer.from(nome, 'utf8').toString('latin1');

describe('decodificarNomeDeUpload', () => {
  it('devolve o nome real do arquivo do Léo', () => {
    expect(decodificarNomeDeUpload(comoOMulterEntrega(REAL))).toBe(REAL);
  });

  it('nome só-ASCII passa intacto', () => {
    expect(decodificarNomeDeUpload('contrato-2026.pdf')).toBe('contrato-2026.pdf');
  });

  /**
   * A guarda que importa: nem todo cliente manda latin1. Se o nome JÁ vier
   * decodificado, decodificar de novo o destruiria — e o estrago seria pior
   * que o bug original, porque atingiria quem estava certo.
   */
  it('nome que JÁ veio em UTF-8 não é decodificado duas vezes', () => {
    expect(decodificarNomeDeUpload(REAL)).toBe(REAL);
    expect(decodificarNomeDeUpload('Proposta — versão final.pdf')).toBe(
      'Proposta — versão final.pdf',
    );
  });

  it('emoji e caractere fora do BMP sobrevivem ao round-trip', () => {
    const nome = '📄 relatório 2026.pdf';
    expect(decodificarNomeDeUpload(comoOMulterEntrega(nome))).toBe(nome);
    expect(decodificarNomeDeUpload(nome)).toBe(nome);
  });

  it('vazio e lixo não explodem', () => {
    expect(decodificarNomeDeUpload('')).toBe('');
    expect(decodificarNomeDeUpload('ÿþ')).toBe('ÿþ');
  });
});

describe('nomeSeguroParaStorage', () => {
  it('translitera o acento em vez de comê-lo', () => {
    expect(nomeSeguroParaStorage('LOCAÇÃO')).toBe('LOCACAO');
    expect(nomeSeguroParaStorage('TARIFÁRIO')).toBe('TARIFARIO');
  });

  /**
   * A assinatura do bug antigo: um `_` por BYTE. `Á` dava dois, `ÇÃ` dava
   * quatro. Se voltar, é aqui que aparece.
   */
  it('NÃO produz a sequência de underscores do bug antigo', () => {
    const caminho = nomeSeguroParaStorage(REAL);
    expect(caminho).not.toContain('__');
    expect(caminho).toBe('MODELO_DE_CONTRATO_DE_LOCACAO_MB_IoT_-_GRUPO_TARIFARIO_A.xlsx');
  });

  it('respeita o limite e o default de 80', () => {
    expect(nomeSeguroParaStorage('a'.repeat(200))).toHaveLength(80);
    expect(nomeSeguroParaStorage('a'.repeat(200), 100)).toHaveLength(100);
  });

  /**
   * Nome que sanitiza pra vazio ainda precisa de um caminho — sem o fallback a
   * chave do storage terminaria no separador e o upload viraria erro do
   * Supabase, não do nosso código (mais difícil de diagnosticar).
   */
  it('nome que some inteiro vira "arquivo"', () => {
    expect(nomeSeguroParaStorage('🎉🎉🎉')).toBe('arquivo');
    expect(nomeSeguroParaStorage('')).toBe('arquivo');
    expect(nomeSeguroParaStorage('...')).toBe('arquivo');
  });

  it('não deixa separador de caminho escapar pra chave do storage', () => {
    expect(nomeSeguroParaStorage('../../etc/passwd')).not.toContain('/');
    expect(nomeSeguroParaStorage('..\\segredo.txt')).not.toContain('\\');
    expect(nomeSeguroParaStorage('../../etc/passwd')).toBe('etc_passwd');
  });

  it('o resultado é sempre ASCII — é isso que o storage exige', () => {
    for (const nome of [REAL, 'ação & coração.pdf', 'Über größe.docx', 'ñandú.png']) {
      expect(nomeSeguroParaStorage(nome)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});

/**
 * As duas juntas, na ordem em que o app usa: decodifica no controller,
 * sanitiza só pro caminho, EXIBE o decodificado.
 */
describe('o caminho completo, do multer até a tela', () => {
  it('a pessoa lê o nome que deu; o storage recebe ASCII', () => {
    const doMulter = comoOMulterEntrega(REAL);

    const paraExibir = decodificarNomeDeUpload(doMulter);
    const paraOCaminho = nomeSeguroParaStorage(paraExibir);

    expect(paraExibir).toBe(REAL);
    expect(paraOCaminho).toMatch(/^[A-Za-z0-9._-]+$/);
    // e o que aparecia na tela antes NÃO volta
    expect(paraExibir).not.toContain('_');
  });
});
