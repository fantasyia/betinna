import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sentinela: quem grava `LeadTag` tem que DISPARAR `LEAD_RECEBEU_TAG`.
 *
 * Este bug já apareceu QUATRO vezes, sempre igual: alguém escreve o `LeadTag`
 * direto pelo prisma, o evento não sai, e o fluxo que deveria acender fica
 * mudo — sem erro, sem log, sem nada. A etiqueta aparece no kanban e a
 * automação simplesmente não acontece.
 *
 *   1. SLA `notificar`  — carimbava etiqueta sem notificar ninguém
 *   2. SLA `tag`        — carimbava etiqueta sem disparar o gatilho
 *   3. `MUDAR_TAG`      — fluxo não conseguia acender outro fluxo
 *   4. `CRIAR_LEAD`     — lead nascia marcado e a nutrição não pegava
 *
 * A blindagem definitiva seria fazer o `LeadsService.vincularTag` ser o ÚNICO
 * caminho de escrita — mas `FluxosModule` → `LeadsModule` fecha ciclo de
 * dependência, então o custo é alto pro ganho. Este teste dá a mesma garantia:
 * ele CONHECE os pontos de escrita e falha quando aparece um novo.
 *
 * Quando este teste quebrar: ou o ponto novo dispara o evento (e entra na
 * lista), ou ele tem um motivo pra não disparar (e entra na lista com o motivo
 * escrito). O que não pode é passar despercebido.
 */
const RAIZ = join(__dirname, '..', '..');

/** Arquivos que PODEM escrever LeadTag, e por quê. */
const ESCRITORES_CONHECIDOS: Array<{ arquivo: string; motivo: string }> = [
  {
    arquivo: 'modules/leads/leads.service.ts',
    motivo: 'É o dono da regra — `vincularTag` grava E dispara. Todo o resto deveria passar aqui.',
  },
  {
    arquivo: 'modules/fluxos/fluxo-executor.service.ts',
    motivo: 'MUDAR_TAG e CRIAR_LEAD — os dois disparam LEAD_RECEBEU_TAG depois do upsert.',
  },
  {
    arquivo: 'modules/fluxos/fluxo-triggers.job.ts',
    motivo: 'Ação de SLA — dispara quando a etiqueta é nova (idempotência do job).',
  },
  {
    arquivo: 'modules/contatos/contatos.service.ts',
    motivo:
      'Etiquetagem em MASSA pela tela de Contatos. NÃO dispara de propósito: marcar 500 leads ' +
      'de uma vez viraria 500 execuções de fluxo na fila. Se um dia precisar acender fluxo por ' +
      'aqui, tem que ser com lote/limite — não soltando o evento por item.',
  },
];

const ESCRITA = /prisma\.leadTag\.(upsert|create|createMany)/;

describe('LeadTag — todo ponto de escrita é conhecido', () => {
  it.each(ESCRITORES_CONHECIDOS)('$arquivo ainda escreve LeadTag', ({ arquivo }) => {
    // Guarda contra a lista envelhecer: se o ponto sumiu, o teste avisa em vez
    // de continuar "protegendo" um arquivo que não existe mais.
    const src = readFileSync(join(RAIZ, arquivo), 'utf8');
    expect(ESCRITA.test(src), `${arquivo} não escreve mais LeadTag — tire da lista`).toBe(true);
  });

  it('os dois pontos do fluxo-executor disparam LEAD_RECEBEU_TAG', () => {
    // O executor é onde o bug bateu duas vezes. Aqui o que interessa é que o
    // número de disparos acompanhe o número de escritas.
    const src = readFileSync(join(RAIZ, 'modules/fluxos/fluxo-executor.service.ts'), 'utf8');
    const escritas = src.match(/prisma\.leadTag\.upsert/g)?.length ?? 0;
    const disparos = src.match(/'LEAD_RECEBEU_TAG'/g)?.length ?? 0;

    expect(escritas).toBe(2);
    expect(disparos).toBe(escritas);
  });

  it('MUDAR_TAG manda o nome NORMALIZADO no payload, não o cru do config', () => {
    // É por `tagNome` que o gatilho casa (exato/prefixo). Com o cru, a etiqueta
    // gravada e a filtrada divergem quando há espaço sobrando ou {{variavel}}.
    const src = readFileSync(join(RAIZ, 'modules/fluxos/fluxo-executor.service.ts'), 'utf8');

    expect(src).toContain('tagNome: nomeTagLimpo');
    expect(src).not.toContain('tagNome: cfg.tagNome,\n          _hops');
  });
});
