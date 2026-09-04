---
updatedAt: 2026-08-19T20:18:35.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Instalação de Widget para Assinatura Incorporada

Detalhes para assinatura incorporada (embedded_signature/tokenless)

## Introdução

A Clicksign criou uma experiência que não oferece atrito no momento da assinatura dos documentos ao remover as etapas obrigatórias da widget, ao mesmo tempo que manteve a validade jurídica.

## Solicitar Assinatura Incorporada - Ação na API Rest (server-side)

O documento e os signatários devem ser criados através da API Rest para a utilização do Widget Embedded para Assinatura Incorporada:

1. Crie um envelope [Criar envelope](/docs/envelope).

2. Crie um documento através da requisição <Anchor target="_blank" href="/docs/documentos">Criar documento</Anchor>.

3. Crie um signatário com autenticação <Anchor target="_blank" href="/docs/signatarios">Criar signatário</Anchor>.

4. Adicione o signatário o requisito de autenticação **embedded\_signature**.

<Callout icon="👍" theme="okay">
  ### Parâmetro para carregar o Widget

  Utilize o atributo `id` retornado no terceiro passo (Criar signatário) acima para carregar o Widget Embedded.
</Callout>

## Integrações e Testes

Para integrar ou testar o Widget com Assinatura Incorporada, siga as instruções detalhadas no guia:

<Anchor target="_blank" href="https://developers.clicksign.com/docs/assinatura-incorporada-implementacoes-e-testes">Acessar Guia de Implementações e Testes.</Anchor>

Este guia cobre desde a configuração inicial até os testes necessários para garantir o funcionamento correto. Recomendamos a utilização do ambiente Sandbox para testes, disponível em <https://sandbox.clicksign.com>.

Se precisar de ajuda, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).

<Footer3 />