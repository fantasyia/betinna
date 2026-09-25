import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import PizZip from 'pizzip';
import {
  dadosDoDocumento,
  renderizarDocumento,
  type DadosDocumentoContrato,
  type DocumentoContratoEntrada,
} from '@modules/propostas/contrato-documento.util';

/**
 * Validação de um MODELO de contrato subido pela tela (Léo, 24/09).
 *
 * 🔴 Quem sobe edita no Word, e o Word estraga marcação sem avisar: quebra
 * `{{prazo_entrega}}` em pedaços quando o corretor passa, apaga uma chave
 * junto com a vírgula, "corrige" `{{cliente_cnpj}}` pra `{{Cliente_cnpj}}`.
 * Um modelo assim, ativado, sairia com um campo EM BRANCO num documento que o
 * cliente assina — ou quebraria só no primeiro aceite, na frente dele.
 *
 * Por isso o modelo é recusado ANTES de virar opção, com a lista do que está
 * errado, e só é aceito se preenche um exemplo completo (40 quadros).
 */

/** As marcações simples que o documento TEM que ter. */
export const MARCACOES: ReadonlyArray<
  Exclude<keyof DadosDocumentoContrato, 'quadros' | 'locacao'>
> = [
  'proposta_numero',
  'data_emissao_extenso',
  'validade',
  'cliente_razao_social',
  'cliente_cnpj',
  'cliente_endereco',
  'locacao_mensal_total',
  'custom_unitario',
  'custom_quantidade',
  'custom_total',
  'servicos_total',
  'servicos_parcela',
  'prazo_entrega',
  'prazo_instalacao',
  'prazo_verificacao',
  'prazo_software',
  'vigencia_meses',
  'dia_vencimento',
  'carencia_mes_inicio',
  'periodo_remanescente',
];

/** As duas listas que viram LINHAS de tabela — e o que cada linha tem. */
export const LISTAS: Readonly<Record<'quadros' | 'locacao', readonly string[]>> = {
  quadros: ['item', 'tag', 'corrente', 'tensao', 'modelo', 'iot'],
  locacao: ['descricao', 'unitario', 'quantidade', 'total'],
};

/**
 * O teto de um .docx de contrato. O atual tem ~2,2 MB, quase tudo imagem.
 * 14 MB e não mais: em base64 isso já dá ~18,7 MB, e o corpo JSON da API
 * aceita 20 MB (main.ts) — acima disso o upload morreria antes de chegar aqui,
 * com um erro genérico em vez da mensagem certa.
 */
export const TAMANHO_MAX_MODELO = 14 * 1024 * 1024;

/** Proposta fictícia, completa, com `n` quadros — é o que o exemplo mostra. */
export function entradaDeExemplo(n = 40): DocumentoContratoEntrada {
  const skus = ['MB-04_D.S.', 'MB-04_E.P.', 'MB-02', 'MB-01'];
  const precos: Record<string, number> = {
    'MB-04_D.S.': 874,
    'MB-04_E.P.': 700,
    'MB-02': 310,
    'MB-01': 250,
  };
  return {
    numero: 'PROP-EXEMPLO',
    emitidaEm: new Date(),
    validoAte: new Date(Date.now() + 30 * 86_400_000),
    clienteNome: 'CLIENTE EXEMPLO INDÚSTRIA LTDA',
    cnpj: '12345678000195',
    endereco: {
      logradouro: 'Rua Exemplo',
      numero: '100',
      complemento: 'Galpão 2',
      bairro: 'Distrito Industrial',
      cidade: 'São Paulo',
      uf: 'SP',
    },
    linhas: Array.from({ length: n }, (_, i) => {
      const sku = i === 0 ? skus[0] : skus[1 + (i % 3)];
      return {
        // Nome único e fácil de achar no XML — é por ele que se confere que
        // cada quadro caiu numa LINHA de tabela própria.
        quadroPainel: `Q-EXEMPLO-${String(i + 1).padStart(2, '0')}`,
        tensaoV: 380,
        correnteA: 100,
        sku,
        quantidade: 1,
        total: precos[sku],
      };
    }),
    customUnitario: 3000,
    customQuantidade: 1,
    servicosTotal: 12000,
    prazoEntregaDias: 10,
    prazoInstalacaoDias: 15,
    prazoVerificacaoDias: 5,
    prazoSoftwareDias: 20,
    prazoMeses: 60,
    diaVencimento: 5,
    carenciaMeses: 1,
  };
}

export type ValidacaoModelo = { ok: true; exemplo: Buffer } | { ok: false; problemas: string[] };

/** Mensagens do docxtemplater em português pra quem editou no Word. */
function explicarErroDoWord(err: unknown): string[] {
  const causas =
    (err as { properties?: { errors?: Array<{ properties?: Record<string, unknown> }> } })
      .properties?.errors ?? [];
  const lista = causas.length ? causas : [err as { properties?: Record<string, unknown> }];
  return lista.map((c) => {
    const p = c.properties ?? {};
    const trecho = typeof p.xtag === 'string' ? `"${p.xtag}"` : '';
    switch (p.id) {
      case 'unclosed_tag':
      case 'unopened_tag':
        return `marcação ${trecho} está aberta sem fechar (ou fechada sem abrir) — confira as chaves {{ }}`;
      case 'duplicate_open_tag':
      case 'duplicate_close_tag':
        return `marcação ${trecho} com chave duplicada`;
      case 'unclosed_loop':
      case 'unopened_loop':
      case 'closing_tag_does_not_match_opening_tag':
        return `a lista ${trecho} não abre e fecha certo — {{#quadros}} precisa de {{/quadros}} (e o mesmo pra locacao)`;
      default:
        return `o Word deixou uma marcação que não dá pra ler${trecho ? ` (${trecho})` : ''}`;
    }
  });
}

/** Em qual `<w:tr>` do XML cada texto caiu (-1 = fora de tabela). */
function linhaDaTabela(xml: string, texto: string): number {
  const linhas = xml.split(/<w:tr[ >]/);
  // O pedaço 0 é o que vem ANTES da primeira linha de tabela.
  for (let i = 1; i < linhas.length; i++) {
    const fim = linhas[i].indexOf('</w:tr>');
    if (linhas[i].slice(0, fim === -1 ? undefined : fim).includes(texto)) return i;
  }
  return -1;
}

export function validarModelo(arquivo: Buffer): ValidacaoModelo {
  if (arquivo.length > TAMANHO_MAX_MODELO) {
    return {
      ok: false,
      problemas: [
        `o arquivo tem ${(arquivo.length / 1024 / 1024).toFixed(1)} MB — o limite é 14 MB`,
      ],
    };
  }

  let zip: PizZip;
  try {
    zip = new PizZip(arquivo);
  } catch {
    return { ok: false, problemas: ['não é um arquivo .docx (salve como "Documento do Word")'] };
  }
  if (!zip.file('word/document.xml')) {
    return { ok: false, problemas: ['não é um arquivo .docx (salve como "Documento do Word")'] };
  }

  // 1. Dá pra ler as marcações? (o Word quebrando chave aparece aqui)
  const inspecao = new InspectModule();
  try {
    new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      // Sem isto o docxtemplater imprime o erro INTEIRO (com stack) no console
      // a cada upload quebrado — a mensagem útil já vai pra tela.
      errorLogging: false,
      modules: [inspecao],
    });
  } catch (err) {
    return { ok: false, problemas: explicarErroDoWord(err) };
  }

  // 2. Tem TODAS as que o contrato precisa, e SÓ essas?
  const problemas: string[] = [];
  const achadas = inspecao.getAllTags() as Record<string, Record<string, unknown>>;
  const conhecidas = new Set<string>([...MARCACOES, ...Object.keys(LISTAS)]);
  for (const m of MARCACOES) {
    if (!(m in achadas)) problemas.push(`falta a marcação {{${m}}}`);
  }
  for (const [lista, campos] of Object.entries(LISTAS)) {
    const dentro = achadas[lista];
    if (!dentro) {
      problemas.push(`falta a lista {{#${lista}}}…{{/${lista}}}`);
      continue;
    }
    for (const c of campos) {
      if (!(c in dentro)) problemas.push(`falta {{${c}}} dentro da lista ${lista}`);
    }
    for (const c of Object.keys(dentro)) {
      if (!campos.includes(c)) {
        problemas.push(`{{${c}}} dentro da lista ${lista} não existe — erro de digitação?`);
      }
    }
  }
  for (const m of Object.keys(achadas)) {
    if (!conhecidas.has(m)) problemas.push(`{{${m}}} não existe — erro de digitação?`);
  }
  if (problemas.length) return { ok: false, problemas };

  // 3. Preenche um exemplo completo — e a lista de quadros vira LINHAS?
  const entrada = dadosDoDocumento(entradaDeExemplo());
  if (!entrada.ok) throw new Error(`exemplo inválido: ${entrada.faltando.join('; ')}`);
  let exemplo: Buffer;
  try {
    exemplo = renderizarDocumento(arquivo, entrada.dados);
  } catch (err) {
    return {
      ok: false,
      problemas: [
        `o modelo não conseguiu ser preenchido (${err instanceof Error ? err.message : String(err)})`,
      ],
    };
  }
  const xml = new PizZip(exemplo).file('word/document.xml')!.asText();
  const l1 = linhaDaTabela(xml, 'Q-EXEMPLO-01');
  const l2 = linhaDaTabela(xml, 'Q-EXEMPLO-02');
  if (l1 === -1 || l2 === -1 || l1 === l2) {
    problemas.push(
      'a lista {{#quadros}} precisa estar numa LINHA de tabela (abrindo na 1ª célula e fechando na última) — ' +
        'senão os quadros não viram linhas do item 06',
    );
  }
  if (!xml.includes('Q-EXEMPLO-40')) {
    problemas.push('o exemplo com 40 quadros não saiu inteiro — a lista está cortando linhas');
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, exemplo };
}
