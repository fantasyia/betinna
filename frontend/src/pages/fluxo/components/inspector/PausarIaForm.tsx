import { Field, Select } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * PAUSAR_IA — pausar OU religar a IA na conversa.
 *
 * O mesmo `acaoTipo` faz as duas coisas opostas, decidido por `config.religar`.
 * E até aqui NÃO existia controle nenhum pra esse campo: o flag só era
 * alcançável escrevendo JSON cru em "Config (avançado)" ou via MCP — que foi
 * como ele entrou no T1. Resultado: um nó que religa aparecia na tela como
 * "Pausar IA", e quem revisasse o fluxo removeria o nó certo achando que estava
 * removendo o errado.
 *
 * Um select em vez de toggle porque as duas opções têm nome próprio e
 * consequência oposta — "ligado/desligado" aqui seria ambíguo ("ligado" é
 * pausar ou religar?).
 */
export function PausarIaForm({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (d: NodePayload) => NodePayload) => void;
}) {
  const religar = data.config.religar === true;

  return (
    <Field
      label="O que este nó faz"
      hint={
        religar
          ? 'Devolve o controle ao bot: liga na conversa, tira a pausa e limpa o "precisa de humano".'
          : 'Cala o bot só nessa conversa. Alguém precisa religar depois — na tela do Inbox ou por um nó "Religar".'
      }
    >
      <Select
        size="sm"
        value={religar ? 'religar' : 'pausar'}
        data-testid="pausar-ia-modo"
        onChange={(e) => {
          const querReligar = e.target.value === 'religar';
          onUpdate((d) => {
            // `acao: "pausar_ia"` é chave MORTA: o backend lê SÓ o `religar`.
            // Ela vinha do default antigo e só confundia quem abria o JSON do
            // nó procurando o que ele faz. Some quando alguém edita o nó — sem
            // migração, sem tocar em fluxo que ninguém abriu.
            const { acao: _morta, ...configLimpa } = d.config;
            return {
            ...d,
            // `religar: false` seria redundante (o backend trata ausente como
            // pausar), mas explícito é melhor num campo que inverte o efeito do
            // nó — quem ler o JSON não precisa saber do default.
            config: { ...configLimpa, religar: querReligar },
            // O título acompanha, senão o nó continua se chamando o contrário
            // do que faz — que é exatamente o bug que este form resolve.
            titulo:
              d.titulo === 'Pausar IA na conversa' || d.titulo === 'Religar IA na conversa'
                ? querReligar
                  ? 'Religar IA na conversa'
                  : 'Pausar IA na conversa'
                : d.titulo,
            };
          });
        }}
      >
        <option value="pausar">⏸ Pausar a IA na conversa</option>
        <option value="religar">▶ Religar a IA na conversa</option>
      </Select>
    </Field>
  );
}
