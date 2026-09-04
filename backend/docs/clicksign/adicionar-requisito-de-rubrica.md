---
updatedAt: 2026-05-27T12:19:47.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Tipos de Requisito de Rubrica

Nesta página, você encontrará informações detalhadas sobre o requisito opcional de rubrica na plataforma Clicksign. A rubrica é uma marcação que o signatário faz em uma ou mais páginas do documento para indicar que concorda com o seu conteúdo.

## O que é a rubrica?

A rubrica é uma assinatura abreviada, geralmente composta pelas iniciais do signatário. Ela pode ser utilizada como uma forma adicional de autenticação e para reforçar a validade jurídica do documento.

## Como funciona o requisito de rubrica?

Ao adicionar um requisito de rubrica a um documento, você define que o signatário deverá rubricar as páginas especificadas antes de finalizar a assinatura.

## Tipos de rubrica

A plataforma Clicksign oferece duas opções de rubrica:

* **Rubrica de Iniciais:** Permite que o signatário insira suas iniciais de forma eletrônica no documento, assegurando conformidade com o conteúdo assinado.
* **Rubrica Manuscrita:** O signatário utiliza o mouse, touchpad ou tela sensível ao toque para desenhar sua rubrica manuscrita diretamente no documento.

## Localização da Rubrica

A plataforma Clicksign oferece total flexibilidade na configuração do requisito de rubrica. Você pode definir se todas as páginas devem ser rubricadas, apenas algumas delas, ou se deseja utilizar a rubrica posicionada, que permite determinar o local exato onde a rubrica será aplicada no corpo do documento.

### Uso Combinado e Regras de Compatibilidade

As modalidades de localização rubrica por páginas e rubrica posicionada podem ser utilizadas em conjunto, permitindo uma personalização avançada do processo de assinatura. Por exemplo, você pode exigir que um signatário rubrique todas as páginas com suas iniciais e, simultaneamente, utilize a rubrica manuscrita posicionada em uma cláusula específica.

Entretanto, para garantir a integridade do fluxo, existem algumas regras de uso:

Combinação permitida: É possível combinar uma rubrica por página com uma rubrica posicionada, desde que sejam de tipos diferentes (ex: Iniciais em todas as páginas + Manuscrita posicionada).

Restrição: Não é possível adicionar uma rubrica por página e uma rubrica posicionada do mesmo tipo (ambas Iniciais ou ambas Manuscritas) para o mesmo signatário.

| Modalidade 1            | Modalidade 2             | Permitido? |
| :---------------------- | :----------------------- | :--------- |
| Iniciais (Por página)   | Manuscrita (Posicionada) | ✅ Sim      |
| Manuscrita (Por página) | Iniciais (Posicionada)   | ✅ Sim      |
| Iniciais (Por página)   | Iniciais (Posicionada)   | ❌ Não      |
| Manuscrita (Por página) | Manuscrita (Posicionada) | ❌ Não      |

<br />

Dica: Para utilizar a rubrica posicionada, lembre-se de inserir a tag `{{~position_sign_ID}}` no seu modelo de documento antes de realizar o upload. Para saber mais consulte a documentação sobre <Anchor label="Modelos" target="_blank" href="https://developers.clicksign.com/docs/docs-modelos">Modelos</Anchor>

## Observações

* O requisito de rubrica é opcional. Você pode adicioná-lo a qualquer documento, mas não é obrigatório.
* A rubrica não substitui a assinatura eletrônica principal. Ela é apenas uma camada adicional de segurança e autenticação.
* A plataforma Clicksign armazena as rubricas de forma segura e garante a sua integridade.

<Footer3 />

<br />