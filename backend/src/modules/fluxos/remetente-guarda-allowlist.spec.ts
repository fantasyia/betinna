import { describe, expect, it, vi } from 'vitest';
import { FluxosService } from './fluxos.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * A allowlist de remetente valida O QUE MUDA, não o que já existe.
 *
 * Medido em 15/09, antes do push que leva esta guarda pra produção: a lista
 * `emailTransacional.dominiosRemetente` está AUSENTE na empresa, e E1, E2 e E3
 * já têm `remetenteEmail` gravado de antes da guarda existir.
 *
 * Sem a comparação com o valor atual, qualquer update que CARREGUE o campo —
 * inclusive um que só quer mexer no grafo e manda o remetente junto, que é
 * exatamente o que o editor faz — cairia em "lista vazia", e os três fluxos
 * virariam somente-leitura. O pior não é o bloqueio, é o diagnóstico: a
 * mensagem fala de domínio de e-mail pra quem estava salvando um nó.
 */
type Guarda = (
  user: AuthenticatedUser,
  empresaId: string,
  remetenteEmail: string | null | undefined,
  atual?: string | null,
) => Promise<void>;

const ADMIN = { role: 'ADMIN' } as AuthenticatedUser;
const REP = { role: 'REP' } as AuthenticatedUser;

function guardaCom(dominios?: string[]) {
  const config =
    dominios === undefined ? {} : { emailTransacional: { dominiosRemetente: dominios } };
  const ctx = {
    prisma: { empresa: { findUnique: vi.fn().mockResolvedValue({ config }) } },
  };
  const fn = (FluxosService.prototype as unknown as { assertRemetenteEmail: Guarda })
    .assertRemetenteEmail;
  return (remetente: string | null | undefined, atual?: string | null, user = ADMIN) =>
    fn.call(ctx, user, 'emp-1', remetente, atual) as Promise<void>;
}

describe('lista VAZIA (o estado de hoje, no push)', () => {
  it('🔴 salvar o fluxo com o MESMO remetente que já estava gravado PASSA', async () => {
    const guarda = guardaCom(undefined);
    await expect(
      guarda('contato@mkt.somatecblocking.com.br', 'contato@mkt.somatecblocking.com.br'),
    ).resolves.toBeUndefined();
  });

  it('caixa e espaço não fazem o mesmo endereço parecer mudança', async () => {
    const guarda = guardaCom(undefined);
    await expect(
      guarda('  Contato@MKT.somatecblocking.com.br ', 'contato@mkt.somatecblocking.com.br'),
    ).resolves.toBeUndefined();
  });

  it('remetente NOVO continua barrado — a allowlist não virou decoração', async () => {
    const guarda = guardaCom(undefined);
    await expect(guarda('outro@dominio-qualquer.com.br', null)).rejects.toThrow(/VAZIA/);
  });

  it('TROCAR o remetente de um fluxo que já tinha um também é barrado', async () => {
    const guarda = guardaCom(undefined);
    await expect(
      guarda('novo@outrodominio.com.br', 'contato@mkt.somatecblocking.com.br'),
    ).rejects.toThrow(/VAZIA/);
  });

  it('o erro de lista vazia diz O QUE FAZER, não só que falhou', async () => {
    const guarda = guardaCom(undefined);
    await expect(guarda('x@y.com.br', null)).rejects.toThrow(/dominiosRemetente/);
  });
});

describe('lista preenchida', () => {
  const DOMINIOS = ['mkt.somatecblocking.com.br', 'somatecblocking.com.br'];

  it('domínio da lista passa', async () => {
    await expect(
      guardaCom(DOMINIOS)('contato@mkt.somatecblocking.com.br', null),
    ).resolves.toBeUndefined();
  });

  it('domínio de fora é barrado, e o erro mostra os permitidos', async () => {
    await expect(guardaCom(DOMINIOS)('x@gmail.com', null)).rejects.toThrow(
      /mkt\.somatecblocking\.com\.br/,
    );
  });
});

describe('o que não mudou', () => {
  it('sem remetente (o caso da maioria dos fluxos) nem consulta a empresa', async () => {
    await expect(guardaCom(undefined)(null)).resolves.toBeUndefined();
    await expect(guardaCom(undefined)(undefined)).resolves.toBeUndefined();
  });

  it('REP não DEFINE remetente — trocar é barrado', async () => {
    await expect(
      guardaCom(['mkt.x.com.br'])('novo@mkt.x.com.br', 'a@mkt.x.com.br', REP),
    ).rejects.toThrow(/DIRECTOR\/ADMIN/);
  });

  it('…mas REP salvando o fluxo com o remetente INALTERADO passa', async () => {
    // Escolha deliberada: a checagem de papel guarda o ato de DEFINIR o
    // remetente. Quem não mudou nada não definiu nada — barrar aqui traria de
    // volta o bloqueio que este arquivo inteiro existe pra evitar, só que pro
    // dono do fluxo pessoal, e com uma mensagem sobre permissão de e-mail
    // aparecendo pra quem estava mexendo num nó.
    await expect(
      guardaCom(['mkt.x.com.br'])('a@mkt.x.com.br', 'a@mkt.x.com.br', REP),
    ).resolves.toBeUndefined();
  });
});
