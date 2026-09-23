import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jidDeTelefone, normalizarJid } from './jid.util';

/**
 * O contato que vira DUAS conversas.
 *
 * Medido em produção (04/09): `+5511997524483@s.whatsapp.net` e
 * `5511997524483@s.whatsapp.net` — o mesmo número, na mesma caixa — eram duas
 * linhas de `Conversation`, porque o `upsertConversation` casa por `peerId`
 * EXATO. Resultado: 16 mensagens numa, 5 na outra, e quem abre uma delas jura
 * que o bot não respondeu.
 */
describe('normalizarJid', () => {
  it('tira o + do telefone em E.164 — é o que rachava a conversa em duas', () => {
    expect(normalizarJid('+5511997524483@s.whatsapp.net')).toBe('5511997524483@s.whatsapp.net');
  });

  it('jid já normal passa intacto', () => {
    expect(normalizarJid('5511997524483@s.whatsapp.net')).toBe('5511997524483@s.whatsapp.net');
  });

  it('não mexe em LID nem em grupo (o id ali é opaco, não é telefone)', () => {
    expect(normalizarJid('196348875923652@lid')).toBe('196348875923652@lid');
    expect(normalizarJid('120363429718571062@g.us')).toBe('120363429718571062@g.us');
  });

  it('só o + do INÍCIO some — não sai varrendo o resto da string', () => {
    expect(normalizarJid('5511+997524483@s.whatsapp.net')).toBe('5511+997524483@s.whatsapp.net');
  });

  it('string vazia não quebra', () => {
    expect(normalizarJid('')).toBe('');
  });
});

/**
 * `jidDeTelefone` — a fronteira entre o telefone que o app guarda (E.164, com
 * `+`) e o JID que a rede usa (sempre sem `+`).
 *
 * 🔴 O defeito que isto fecha rachou uma conversa em duas em 23/09: o lead
 * nascido pelo checkout do site tem `+5511997524483`, três lugares colavam isso
 * no `@s.whatsapp.net`, e como a conversa casa por `peerId` EXATO, o inbound
 * (que nunca traz `+`) caía numa conversa e o outbound do fluxo na outra.
 * Com 79% da base em `+55`, depois do G.15 isso seria por lead.
 */
describe('jidDeTelefone', () => {
  it('🔴 telefone em E.164 vira JID SEM o "+"', () => {
    expect(jidDeTelefone('+5511997524483')).toBe('5511997524483@s.whatsapp.net');
  });

  it('sem "+" continua igual — é o formato que o WhatsApp entrega', () => {
    expect(jidDeTelefone('5511997524483')).toBe('5511997524483@s.whatsapp.net');
  });

  it('os dois formatos produzem o MESMO JID — é isso que impede a conversa rachar', () => {
    expect(jidDeTelefone('+5511997524483')).toBe(jidDeTelefone('5511997524483'));
  });

  it('limpa máscara — espaço, parêntese e hífen não podem virar identidade', () => {
    // O `fluxo-executor` colava o telefone CRU no JID: "+55 11 99752-4483@…"
    expect(jidDeTelefone('+55 (11) 99752-4483')).toBe('5511997524483@s.whatsapp.net');
  });

  it('nacional sem DDI ganha 55 — senão o JID é inválido e a 1ª msg não sai', () => {
    expect(jidDeTelefone('11997524483')).toBe('5511997524483@s.whatsapp.net'); // 11 dígitos
    expect(jidDeTelefone('1132224483')).toBe('551132224483@s.whatsapp.net'); // 10 dígitos
  });

  it('🔴 INTERNACIONAL de 10/11 dígitos NÃO ganha 55', () => {
    // É pra isto que o '+' era preservado, e o motivo era legítimo: sem ler o
    // sinal antes de limpar, um americano de 11 dígitos viraria 55155…
    expect(jidDeTelefone('+1 555 123 4567')).toBe('15551234567@s.whatsapp.net');
  });

  it('número já com DDI e 12+ dígitos passa intacto', () => {
    expect(jidDeTelefone('351912345678')).toBe('351912345678@s.whatsapp.net');
  });
});

/**
 * ⚠️ ESTRUTURAL: sem isto, alguém volta a montar o JID à mão em qualquer nó novo
 * e o defeito reaparece — com toda a suíte verde, porque os testes acima só
 * provam que a FUNÇÃO está certa, não que alguém a usa.
 */
describe('fiação: ninguém monta JID à mão no motor de fluxo', () => {
  const dir = join(__dirname, '..', '..', 'modules', 'fluxos');
  const fontes = ['conversar-ia.service.ts', 'fluxo-executor.service.ts'].map((f) =>
    readFileSync(join(dir, f), 'utf8'),
  );

  it('nenhum arquivo do fluxo interpola "@s.whatsapp.net" numa template string', () => {
    for (const src of fontes) {
      expect(src).not.toMatch(/\$\{[^}]*\}@s\.whatsapp\.net`/);
    }
  });

  it('os dois passam pelo jidDeTelefone', () => {
    for (const src of fontes) {
      expect(src).toContain('jidDeTelefone(telefone)');
    }
  });

  it('o normalizarJid do whatsapp-session não devolve mais "+" no retorno cedo', () => {
    const sessao = readFileSync(
      join(__dirname, '..', 'whatsapp', 'whatsapp-session.service.ts'),
      'utf8',
    );
    // Era `if (peerId.includes('@')) return peerId;` — devolvia o '+' intacto.
    expect(sessao).toContain("if (peerId.includes('@')) return normalizarJid(peerId);");
  });
});
