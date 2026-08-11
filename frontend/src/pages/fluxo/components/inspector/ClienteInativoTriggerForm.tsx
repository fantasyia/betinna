import { Field, Input } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/** Mesmo default do job/bus quando o campo não está setado. */
const PADRAO_DIAS = 30;

/**
 * CLIENTE_INATIVO_30D (trigger) — a partir de QUANTOS dias sem compra o cliente
 * é considerado inativo.
 *
 * AUDITORIA (#65): o `diasInativo` já existia no backend (job e event bus leem
 * `config.diasInativo`), mas NÃO havia campo nenhum na tela. Quem escolhia o
 * gatilho ficava preso nos 30 dias do nome, e a única forma de mudar era via
 * MCP/API — a ponto de o template de reativação prometer 21 dias e o fluxo
 * rodar em 30, sem o usuário ter como perceber (o card do template dizia uma
 * coisa e a régua fazia outra).
 */
export function ClienteInativoTriggerForm({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (d: NodePayload) => NodePayload) => void;
}) {
  const bruto = data.config.diasInativo;
  const valor = typeof bruto === 'number' ? bruto : '';

  return (
    <Field
      label="Dias sem compra"
      hint={
        valor === '' || valor === PADRAO_DIAS
          ? `Padrão: ${PADRAO_DIAS} dias. O nome do gatilho é fixo, mas o prazo é seu.`
          : `O gatilho vai considerar inativo quem não compra há ${valor} dia(s).`
      }
    >
      <Input
        size="sm"
        type="number"
        min={1}
        max={730}
        value={valor}
        placeholder={String(PADRAO_DIAS)}
        data-testid="trigger-dias-inativo"
        onChange={(e) => {
          // Lê o valor AGORA: o updater roda depois (dentro do setState do
          // editor) e a essa altura o input controlado já voltou ao valor
          // anterior — ler `e.target.value` lá dentro grava sempre vazio.
          const bruto = e.target.value;
          const n = Number(bruto);
          // Campo vazio volta pro default — não grava 0 (que faria TODO cliente
          // virar inativo na primeira varredura).
          const proximo = bruto === '' || !Number.isFinite(n) ? undefined : n;
          onUpdate((d) => ({ ...d, config: { ...d.config, diasInativo: proximo } }));
        }}
      />
    </Field>
  );
}
