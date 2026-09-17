import { Input, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * EXTRAIR_VARIAVEIS — lê o que o lead ESCREVEU e preenche as variáveis do fluxo,
 * sem falar com ninguém e sem chamar modelo.
 *
 * Existe porque o único nó que extraía era o "Conversar com IA", e ele só extrai
 * quando FALA. Todo caminho do grafo que chega a uma condição sem ter passado
 * por um nó de IA lê o campo vazio e repergunta o que a pessoa acabou de dizer.
 * Este bloco entra ANTES da condição, nesse caminho.
 */
export function ExtrairVariaveisForm({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  const variaveis = Array.isArray(data.config.variaveis)
    ? (data.config.variaveis as string[])
    : [];

  return (
    <>
      <Field
        label="Variáveis a preencher"
        hint={
          'Mesma sintaxe do nó de IA: separe por vírgula e use "nome: A | B | C" pra ' +
          'travar os valores aceitos. O nó só preenche o que estiver VAZIO — nunca ' +
          'sobrescreve o que o lead já tem.'
        }
      >
        <Input
          value={variaveis.join(', ')}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: {
                ...d.config,
                variaveis: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            }))
          }
          placeholder="tensao_rede: 127V | 220V | 380V | 440V, corrente_quadro"
          data-testid="extrair-variaveis"
        />
      </Field>

      {variaveis.length === 0 && (
        <p className="text-xs text-red-500" data-testid="extrair-variaveis-vazio">
          ⚠️ Sem variável declarada o nó não tem o que gravar — e ele FALHA de propósito em vez
          de fechar verde sem ter feito nada.
        </p>
      )}

      <Field
        label="Quantas mensagens do lead ler"
        hint={
          'Padrão 3. A leitura vai da mais nova pra mais velha, e a mais nova ganha. ' +
          'Aumentar não melhora muito: fala antiga quase nunca é a resposta, e alarga a ' +
          'janela por onde entra número de outro assunto.'
        }
      >
        <Input
          type="number"
          min={1}
          max={10}
          value={(data.config.mensagens as number | undefined) ?? 3}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, mensagens: Number(e.target.value) || 3 },
            }))
          }
          data-testid="extrair-variaveis-mensagens"
        />
      </Field>
    </>
  );
}
