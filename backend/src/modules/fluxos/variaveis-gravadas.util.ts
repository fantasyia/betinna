/**
 * Variáveis que a IA pode gravar no nó CONVERSAR_IA — com VALORES ACEITOS
 * opcionais por variável.
 *
 * O problema que isto resolve: o roteador do fluxo compara a variável gravada
 * por TEXTO LITERAL. No T1, `classificacao_final` tem "Não é lead" (com acento e
 * cedilha) e `perfil_energia` tem "Nao industrial" (sem acento nenhum).
 * Qualquer variação — "nao é lead", "Não Industrial", "não-industrial" — não
 * casa com saída alguma e cai no `default`, que naquele fluxo é o ramo de "bug
 * de classificação": gera tarefa e para o lead. Um erro de acento vira falso
 * alarme de bug.
 *
 * Até aqui isso estava garantido só por súplica no texto do prompt ("copie
 * literalmente da lista"). Funciona quase sempre — e "quase sempre" numa
 * decisão entre locação e compra direta não é garantia. Declarando os valores,
 * eles viram `enum` no structured output: o modelo deixa de PODER responder
 * fora da lista.
 *
 * SINTAXE (no mesmo campo de sempre, pra não quebrar o que já existe):
 *   `classificacao_final: Interesse comercial | Representante | Não é lead`
 *   `regiao`                        ← sem `:` = valor livre, como antes
 */
export interface VariavelGravavel {
  nome: string;
  /** Valores aceitos. Vazio/ausente = livre. */
  valores?: string[];
}

/**
 * Lê a lista crua do nó (compatível com o formato antigo: só nomes).
 * Entradas inválidas são descartadas em silêncio — config de fluxo é editada à
 * mão e por MCP, e uma vírgula sobrando não pode derrubar a execução.
 */
export function parseVariaveisGravadas(entradas: unknown): VariavelGravavel[] {
  if (!Array.isArray(entradas)) return [];
  const out: VariavelGravavel[] = [];
  for (const bruto of entradas) {
    if (typeof bruto !== 'string') continue;
    const linha = bruto.trim();
    if (!linha) continue;
    // Split no PRIMEIRO ':' só — valor pode conter ':' (raro, mas de graça).
    const corte = linha.indexOf(':');
    if (corte < 0) {
      out.push({ nome: linha });
      continue;
    }
    const nome = linha.slice(0, corte).trim();
    if (!nome) continue;
    const valores = linha
      .slice(corte + 1)
      .split('|')
      .map((v) => v.trim())
      .filter(Boolean);
    out.push(valores.length ? { nome, valores } : { nome });
  }
  return out;
}

/** Só os NOMES — é o que a allowlist de gravação sempre usou. */
export function nomesDasVariaveis(entradas: unknown): string[] {
  return parseVariaveisGravadas(entradas).map((v) => v.nome);
}

/**
 * Monta o JSON Schema do turno da IA pro structured output da OpenAI.
 *
 * Devolve `null` quando NENHUMA variável declara valores: sem enum pra travar,
 * ligar structured output só mudaria o comportamento de todo fluxo existente
 * sem ganho nenhum.
 *
 * Detalhes que fazem funcionar em `strict: true`:
 * - todo campo declarado precisa estar em `required` e `additionalProperties`
 *   precisa ser `false`;
 * - por isso os opcionais são NULÁVEIS em vez de ausentes. Sem isso o modelo
 *   seria obrigado a inventar uma classificação antes de ter informação — o
 *   oposto do que o nó pede ("classificou: false e continue a conversa").
 */
export function montarSchemaDoTurno(variaveis: VariavelGravavel[]): Record<string, unknown> | null {
  const comValores = variaveis.filter((v) => v.valores?.length);
  if (comValores.length === 0) return null;

  const props: Record<string, unknown> = {};
  for (const v of variaveis) {
    props[v.nome] = v.valores?.length
      ? { type: ['string', 'null'], enum: [...v.valores, null] }
      : { type: ['string', 'null'] };
  }

  return {
    name: 'turno_ia',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['resposta', 'classificou', 'classificacao', 'variaveis'],
      properties: {
        resposta: { type: 'string' },
        classificou: { type: 'boolean' },
        classificacao: { type: ['string', 'null'] },
        variaveis: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(props),
          properties: props,
        },
      },
    },
  };
}
