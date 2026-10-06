import { dinheiroParaNumero, type Modelo } from './tipos';

/**
 * O que falta num modelo pra ele aparecer CERTO na vitrine. Dois níveis:
 * - `bloqueia`: o modelo (ou a cor) não aparece na vitrine;
 * - `aviso`: aparece, mas incompleto (ex.: "preço sob consulta").
 */
export interface Pendencia {
  nivel: 'bloqueia' | 'aviso';
  texto: string;
  /** Aba do editor onde se resolve. */
  aba: 'dados' | 'cores' | 'grades' | 'kit';
}

export function pendenciasDoModelo(m: Modelo): Pendencia[] {
  const p: Pendencia[] = [];
  if (!m.ativo) p.push({ nivel: 'bloqueia', texto: 'Modelo inativo', aba: 'dados' });
  if (!m.categoria) p.push({ nivel: 'aviso', texto: 'Sem categoria', aba: 'dados' });

  if (m.cores.length === 0) {
    p.push({ nivel: 'bloqueia', texto: 'Nenhuma cor marcada', aba: 'cores' });
  } else {
    const semFoto = m.cores.filter((c) => c.fotos.length === 0);
    if (semFoto.length === m.cores.length) {
      p.push({ nivel: 'bloqueia', texto: 'Sem nenhuma foto', aba: 'cores' });
    } else if (semFoto.length) {
      p.push({
        nivel: 'aviso',
        texto: `${semFoto.length} cor(es) sem foto: ${semFoto.map((c) => c.cor.nome).join(', ')}`,
        aba: 'cores',
      });
    }
  }

  if (m.linhas.length === 0) {
    p.push({ nivel: 'bloqueia', texto: 'Sem grade (linha e tamanhos)', aba: 'grades' });
  } else {
    const semPreco = m.linhas.filter((l) => dinheiroParaNumero(l.precoEntrada) === null);
    if (semPreco.length) {
      p.push({
        nivel: 'aviso',
        texto: `Preço sob consulta em: ${semPreco.map((l) => l.linha.nome).join(', ')}`,
        aba: 'grades',
      });
    }
    const semSugerido = m.linhas.filter((l) => dinheiroParaNumero(l.precoSugerido) === null);
    if (semSugerido.length) {
      p.push({
        nivel: 'aviso',
        texto: `Sem revenda sugerida (não mostra o lucro): ${semSugerido.map((l) => l.linha.nome).join(', ')}`,
        aba: 'grades',
      });
    }
  }

  if (!m.tituloMarketplace?.trim() || !m.descricaoMarketplace?.trim()) {
    p.push({ nivel: 'aviso', texto: 'Material de divulgação sem título ou descrição', aba: 'kit' });
  }
  return p;
}

/** Modelo aparece na vitrine? (nenhuma pendência que bloqueia) */
export function apareceNaVitrine(m: Modelo): boolean {
  return !pendenciasDoModelo(m).some((x) => x.nivel === 'bloqueia');
}
