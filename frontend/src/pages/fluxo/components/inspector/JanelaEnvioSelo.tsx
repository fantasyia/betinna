import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { TriggerTipo } from '@/pages/fluxo/lib/types';

/**
 * Selo de REGRA DE ENVIO no nó que fala com o lead pelo WhatsApp.
 *
 * A janela de horário e o teto diário moram no pacing, não no nó — decisão
 * certa (uma regra cobre todo outbound, e ponto de envio novo que esqueça de
 * checar quebra alto em vez de mandar de madrugada calado). Só que isso deixa
 * a regra INVISÍVEL pra quem monta o fluxo: você abre o C2 e não tem como
 * saber que aquela mensagem pode esperar até as 8h.
 *
 * Este selo devolve a informação sem devolver a decisão pro nó.
 *
 * ⚠️ O texto vem do endpoint que RESOLVE a config (`/empresas/config/envio-whatsapp`),
 * o mesmo caminho que o motor usa — nunca de string escrita à mão aqui. Se o
 * horário estiver escrito na tela e o motor aplicar outro, o selo vira mentira,
 * que é o defeito exato do rótulo do PAUSAR_IA.
 */

interface RegrasEnvio {
  janela: { ativa: boolean; horaInicio: number; horaFim: number; dias: number[] };
  tetoDiario: { ativo: boolean; maxPorDia: number };
  conversaVivaHoras: number;
}

/** Os mesmos gatilhos que o executor trata como resposta sem consultar nada. */
const GATILHOS_ISENTOS: TriggerTipo[] = ['MENSAGEM_CANAL', 'LEAD_RESPONDEU'];

const h = (n: number) => `${String(n).padStart(2, '0')}h`;

export function JanelaEnvioSelo({ gatilho }: { gatilho?: TriggerTipo | null }) {
  const { data } = useApiQuery<RegrasEnvio>('/empresas/config/envio-whatsapp');

  const isento = !!gatilho && GATILHOS_ISENTOS.includes(gatilho);

  if (isento) {
    return (
      <div
        data-testid="selo-janela"
        className="mt-3 rounded-[10px] border border-border bg-bg px-3 py-2 text-[11px] text-muted"
      >
        <span className="font-semibold" style={{ color: 'var(--text)' }}>
          ⚡ Responde a qualquer hora
        </span>
        <p className="m-0 mt-1">
          O fluxo dispara por mensagem do lead, então o que sai daqui é resposta — não espera
          horário nem gasta cota diária.
        </p>
      </div>
    );
  }

  // Sem a config carregada (ou com resposta em formato inesperado): não inventa
  // horário. Melhor não dizer nada do que dizer 8h–20h e o tenant ter salvo
  // outro — selo que mente é pior que selo ausente.
  if (!data?.janela || !data?.tetoDiario) return null;

  const { janela, tetoDiario, conversaVivaHoras } = data;
  const semFimDeSemana = !janela.dias.includes(0) && !janela.dias.includes(6);

  if (!janela.ativa && !tetoDiario.ativo) {
    return (
      <div
        data-testid="selo-janela"
        className="mt-3 rounded-[10px] border border-border bg-bg px-3 py-2 text-[11px] text-muted"
      >
        <span className="font-semibold" style={{ color: 'var(--text)' }}>
          📤 Envia a qualquer hora
        </span>
        <p className="m-0 mt-1">
          Janela de horário e teto diário estão desligados nesta empresa.{' '}
          <LinkConfig>Rever</LinkConfig>
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="selo-janela"
      className="mt-3 rounded-[10px] border border-border bg-bg px-3 py-2 text-[11px] text-muted"
    >
      <span className="font-semibold" style={{ color: 'var(--text)' }}>
        🌙 Este envio é abordagem — respeita a janela
      </span>
      <ul className="m-0 mt-1 pl-4 flex flex-col gap-0.5">
        {janela.ativa && (
          <li>
            Sai entre <strong>{h(janela.horaInicio)}</strong> e{' '}
            <strong>{h(janela.horaFim)}</strong>
            {semFimDeSemana ? ', só em dia útil' : ', todos os dias'}. Fora disso espera a próxima
            abertura — <strong>nada é descartado</strong>.
          </li>
        )}
        {tetoDiario.ativo && (
          <li>
            Conta no teto de <strong>{tetoDiario.maxPorDia} abordagens/dia</strong>; o excedente
            vai pro dia seguinte.
          </li>
        )}
        <li>
          Exceção: se o lead mandou mensagem nas últimas <strong>{conversaVivaHoras}h</strong>, é
          conversa viva e sai na hora.
        </li>
      </ul>
      <p className="m-0 mt-1">
        <LinkConfig>Ajustar em Configurações → Ritmo de envio</LinkConfig>
      </p>
    </div>
  );
}

function LinkConfig({ children }: { children: React.ReactNode }) {
  return (
    <Link
      to="/configuracoes?tab=avancado#ritmo-envio"
      data-testid="selo-janela-link"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </Link>
  );
}
