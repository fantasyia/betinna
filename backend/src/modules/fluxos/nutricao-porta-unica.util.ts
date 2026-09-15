/**
 * Porta ÚNICA de entrada das réguas de nutrição (P6b · caso X.E1 · 14/09).
 *
 * O defeito medido: lead que satisfaz o gatilho de duas réguas entra nas DUAS e
 * recebe as sequências intercaladas — **E1 mandou 5 e-mails e o E6 mandou 3, no
 * mesmo lead, na mesma janela**. Oito e-mails de assuntos desconexos da mesma
 * marca é o padrão que faz marcar como spam, e reclamação de spam pesa muito
 * mais que bounce.
 *
 * A trava precisa de uma ORDEM, e ela é decisão de produto — do Léo, 14/09:
 *
 *   E6 (abandono de checkout) > E1 (chegou sozinho) > E3 (reaquecimento) > E2 (frio)
 *
 * O critério é intenção de compra combinada com VALIDADE do assunto: e-mail de
 * carrinho abandonado que chega três dias depois não serve pra nada, enquanto
 * régua fria pode esperar a vida inteira sem perder nada. O E2 fica por último
 * também por risco: é o de menor intenção e o de maior chance de reclamação.
 *
 * Duas consequências que vêm com a ordem, e são parte da mesma decisão:
 *
 *  - **Só o E6 INTERROMPE** a régua em curso. Quem chegou ao checkout não pode
 *    seguir recebendo nutrição como se não tivesse chegado.
 *  - **Quem perde a vez é DESCARTADO, não fica na fila.** Guardar pra disparar
 *    semanas depois entrega e-mail fora de contexto — exatamente o que gera a
 *    reclamação que esta trava existe pra evitar. Lead que continuar
 *    interagindo reentra sozinho pelos gatilhos.
 *
 * ⛔ Fora da disputa por construção: **E5** (pediu pra sair) e os transacionais
 * **P1/P2/P3** (pagamento, rastreio, pós-venda). Opt-out e aviso de pedido não
 * são nutrição, e bloquear qualquer um dos dois seria muito pior que o defeito.
 * É por isso que a lista é uma ALLOWLIST: fluxo que não está nela passa sempre.
 */

export interface NutricaoConfig {
  /** Réguas em disputa, do MAIS forte pro mais fraco. Código ou id do fluxo. */
  prioridade: string[];
  /** Quem pode interromper a régua em curso (subconjunto de `prioridade`). */
  interrompem: string[];
}

/**
 * Default = a decisão do Léo de 14/09, por CÓDIGO do fluxo.
 *
 * Por código e não por id porque id é dado de tenant: o default precisa valer
 * sem ninguém semear configuração em produção. Quem quiser outra ordem (ou
 * apontar ids explicitamente) sobrescreve em `Empresa.config.nutricao`.
 */
export const NUTRICAO_DEFAULT: NutricaoConfig = {
  prioridade: ['E6', 'E1', 'E3', 'E2'],
  interrompem: ['E6'],
};

export function resolveNutricao(raw: unknown): NutricaoConfig {
  const r = (raw ?? {}) as Partial<NutricaoConfig> & { ativo?: boolean };
  // `ativo: false` desliga a trava inteira (volta ao comportamento anterior).
  if (r.ativo === false) return { prioridade: [], interrompem: [] };
  const lista = (v: unknown, def: string[]): string[] =>
    Array.isArray(v) && v.every((x) => typeof x === 'string')
      ? v.map((x) => x.trim()).filter(Boolean)
      : def;
  const prioridade = lista(r.prioridade, NUTRICAO_DEFAULT.prioridade);
  // `interrompem` só vale pra quem está na disputa — quem não está não tem o que
  // interromper, e deixar passar viraria cancelamento de régua por engano.
  const interrompem = lista(r.interrompem, NUTRICAO_DEFAULT.interrompem).filter((i) =>
    prioridade.includes(i),
  );
  return { prioridade, interrompem };
}

/**
 * Código da régua a partir do nome do fluxo ("E6 · Abandono de checkout" → "E6").
 *
 * Os fluxos seguem a convenção `<CÓDIGO> · <nome>` desde que existem. Se algum
 * dia deixarem de seguir, a saída é apontar os ids em `Empresa.config.nutricao`
 * — e é por isso que `chaveDoFluxo` casa pelos DOIS.
 */
export function codigoDoFluxo(nome: string): string {
  const [cabeca] = nome.split('·');
  return cabeca.trim().toUpperCase();
}

/** Onde este fluxo está na disputa (−1 = fora dela, passa sempre). */
export function postoNaDisputa(fluxo: { id: string; nome: string }, cfg: NutricaoConfig): number {
  const codigo = codigoDoFluxo(fluxo.nome);
  return cfg.prioridade.findIndex((p) => p === fluxo.id || p.toUpperCase() === codigo);
}

export interface DecisaoDeEntrada {
  admitir: boolean;
  /** Execuções a cancelar ANTES de admitir (só o caso do E6 interrompendo). */
  cancelar: string[];
  /** Frase pronta pro log — quem lê o log precisa saber por quê, não só que sim/não. */
  motivo: string;
}

/**
 * Decide se o `candidato` entra, olhando as réguas JÁ EM CURSO no mesmo lead.
 *
 * `emCurso` são execuções ativas do lead em OUTROS fluxos (a re-entrada no mesmo
 * fluxo é outro assunto, com regra própria — o supersede da IA).
 */
export function decidirEntrada(
  candidato: { id: string; nome: string },
  emCurso: Array<{ execucaoId: string; fluxoId: string; fluxoNome: string }>,
  cfg: NutricaoConfig,
): DecisaoDeEntrada {
  const posto = postoNaDisputa(candidato, cfg);
  if (posto < 0) {
    return { admitir: true, cancelar: [], motivo: 'fluxo fora da disputa de nutrição' };
  }
  // ⚠️ A MESMA régua CONTA como concorrente (E2.3, medido em 15/09).
  //
  // Antes eu excluía o próprio fluxo daqui, com o argumento de que re-entrada é
  // assunto do supersede. Não é — o supersede só existe pra fluxo com nó de IA
  // (`nosIa > 0`), e régua de e-mail não tem nenhum. Resultado medido: aplicar a
  // MESMA etiqueta duas vezes, com 60s de intervalo, criava DUAS execuções vivas
  // do E2 no mesmo lead, prontas pra mandar a sequência fria duplicada.
  //
  // E o registro da etiqueta é UM só: o upsert não muda nada e mesmo assim
  // `LEAD_RECEBEU_TAG` é emitido. Então a porta única precisa pegar aqui —
  // a duplicata não chega por outra régua, chega pela mesma.
  //
  // 🔻 Por que isso importa mais do que parece: a etiquetagem é MANUAL e em LOTE
  // (decisão do Léo, 14/09). Reetiquetar não é caso de borda, é o modo normal de
  // errar — repetir um lote, sobrepor duas listas, aplicar a mesma planilha duas
  // vezes. Cada repetição virava uma régua a mais na mesma pessoa.
  const concorrentes = emCurso
    .map((e) => ({ ...e, posto: postoNaDisputa({ id: e.fluxoId, nome: e.fluxoNome }, cfg) }))
    .filter((e) => e.posto >= 0);
  if (concorrentes.length === 0) {
    return { admitir: true, cancelar: [], motivo: 'nenhuma outra régua em curso' };
  }
  const nomes = concorrentes.map((c) => c.fluxoNome).join(', ');
  const soAMesma = concorrentes.every((c) => c.fluxoId === candidato.id);
  // Posto MENOR = mais forte.
  const maisForteEmCurso = Math.min(...concorrentes.map((c) => c.posto));
  if (posto > maisForteEmCurso) {
    return { admitir: false, cancelar: [], motivo: `perde a vez para: ${nomes}` };
  }
  // Mesma régua já rodando e ela NÃO interrompe: recusa direto, com motivo
  // próprio. "perde a vez para: E2" quando o candidato É o E2 leria como bug.
  if (soAMesma) {
    const podeReiniciar = cfg.interrompem.some(
      (i) => i === candidato.id || i.toUpperCase() === codigoDoFluxo(candidato.nome),
    );
    if (!podeReiniciar) {
      return { admitir: false, cancelar: [], motivo: 'o lead JÁ está nesta régua' };
    }
    // Quem interrompe (E6) reinicia a própria régua: abandono de checkout novo
    // merece sequência nova, e cancelar a anterior evita as duas somadas.
    return {
      admitir: true,
      cancelar: concorrentes.map((c) => c.execucaoId),
      motivo: 'reinicia a própria régua (sinal novo)',
    };
  }
  // Mais forte que tudo o que está rodando — mas só entra por cima se puder
  // INTERROMPER. Sem isso, a régua em curso continuaria e as duas se somariam,
  // que é exatamente o defeito.
  const podeInterromper = cfg.interrompem.some(
    (i) => i === candidato.id || i.toUpperCase() === codigoDoFluxo(candidato.nome),
  );
  if (!podeInterromper) {
    return { admitir: false, cancelar: [], motivo: `não interrompe régua em curso: ${nomes}` };
  }
  return {
    admitir: true,
    cancelar: concorrentes.map((c) => c.execucaoId),
    motivo: `interrompe régua em curso: ${nomes}`,
  };
}
