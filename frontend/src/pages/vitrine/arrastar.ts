import { useState, type DragEvent } from 'react';

/** Move o item da posição `de` pra `para` (puro — devolve lista nova). */
export function moverItem<T>(lista: readonly T[], de: number, para: number): T[] {
  if (de === para || de < 0 || para < 0 || de >= lista.length || para >= lista.length) {
    return [...lista];
  }
  const copia = [...lista];
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);
  return copia;
}

/**
 * Arrastar-e-soltar nativo (HTML5) pra reordenar uma lista de ids. Sem
 * biblioteca: é uma grade de cartões/fotos, sem virtualização.
 * `onSoltar` recebe a ordem NOVA dos ids; quem chama salva no backend.
 */
export function useArrastar(ids: string[], onSoltar: (novaOrdem: string[]) => void) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const props = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox só inicia o arrasto com algum dado no dataTransfer.
      e.dataTransfer.setData('text/plain', id);
      setArrastando(id);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (sobre !== id) setSobre(id);
    },
    onDragLeave: () => setSobre((s) => (s === id ? null : s)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const de = arrastando ? ids.indexOf(arrastando) : -1;
      const para = ids.indexOf(id);
      setArrastando(null);
      setSobre(null);
      if (de >= 0 && para >= 0 && de !== para) onSoltar(moverItem(ids, de, para));
    },
    onDragEnd: () => {
      setArrastando(null);
      setSobre(null);
    },
    'data-arrastando': arrastando === id ? 'true' : undefined,
    'data-sobre': sobre === id && arrastando !== id ? 'true' : undefined,
  });

  return { props, arrastando };
}
