---
updatedAt: 2026-05-27T10:41:31.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# FAQ: Migração

Principais dúvidas sobre a migração

<Callout icon="⚠️" theme="warn">
  **Importante:** A API 1.9 é uma API legada, portanto não receberá mais atualizações ou melhorias.
  Todas as evoluções da plataforma estão sendo direcionadas exclusivamente para a versão 3.0 (Envelope).
</Callout>

Migrar para a API 3.0 garante que você aproveite todos os recursos mais recentes da Clicksign!
Reunimos abaixo as dúvidas mais comuns para apoiar sua migração:

<br />

### Por que devo migrar da API 1.9 para a 3.0?

A API 3.0 oferece mais flexibilidade, funcionalidades e recursos atualizados. Além disso, a 1.9 é uma versão legada e deixará de receber melhorias. Migrar garante que você aproveite as novas funcionalidades e tenha suporte contínuo.

<br />

### A API 1.9 continuará funcionando?

Sim, mas ela é considerada legada. Isso significa que não receberá evoluções e pode ser descontinuada no futuro.

<br />

### O que faço na API 3.0 que não consigo fazer na API 1.9?

Na API 3.0 você tem acesso a funcionalidades que não existiam na 1.9, como:

* Enviar múltiplos documentos em um único envio (Envelope), com configuração centralizada.
* Utilizar livremente qualquer autenticação de maneira isolada ou combinada, sem precisar usar autenticações obrigatórias.
* Definir exatamente onde cada pessoa deve assinar seu documento usando a Assinatura Posicionada.
* Validar a identidade do seu signatário de maneira mais avançada, usando a Biometria Facial Serpro, ou obter uma análise mais detalhada do documento dele usando a Documentoscopia.
* Permitir que outra pessoa acompanhe o processo de assinatura sem precisar assinar, com o Usuário Observador.
* Solicitar que o seu signatário envie um Comprovante de Endereço.

Você encontra isso e muito mais somente na API 3.0 Envelope!

<br />

### O que faço na API 1.9 que não consigo fazer na API 3.0?

Esses detalhes estão disponíveis na página [Comparativo Técnico](https://developers.clicksign.com/docs/comparativo-tecnico).

<br />

### Preciso mudar algo na minha integração para usar a API 3.0?

Sim. Algumas rotas e estruturas mudaram. Isso estará descrito na página "Comparativo técnico", que ainda está em construção.

<br />

### Existe um comparativo técnico entre as duas versões?

Conforme mencionado, estamos preparando uma página com um comparativo técnico detalhado, incluindo trechos de código, para facilitar sua integração.

<br />

### O que acontece com meus documentos enviados na API 1.9?

Eles continuam válidos. A migração impacta apenas os novos documentos que enviar a partir do momento em que a nova integração for concluída.

<br />

### Como sei se estou usando a API 1.9 ou a 3.0?

Verifique o caminho das requisições:

`/v1` → API 1.9

`/v3`→ API 3.0

<br />

### Terei suporte para me ajudar na migração?

Sim. Além dessa documentação completa, você também pode [entrar em contato com o Suporte](https://www.clicksign.com/suporte).

<br />

### Há exemplos práticos de implementação na API 3.0?

Sim, em toda a documentação oferecemos exemplos práticos, inclusive, você pode até mesmo simular o envio do seu primeiro envelope na aba [Passo a Passo](https://developers.clicksign.com/recipes).

<br />

### Preciso refazer toda a minha integração de uma vez?

Não. A migração pode ser feita de forma gradual. Você pode começar implementando novos fluxos diretamente na API 3.0 enquanto mantém os existentes na 1.9, e aos poucos mover toda a sua operação. Isso dá flexibilidade para planejar a transição sem interromper o funcionamento atual.

<br />

# Pronto para migrar?

Chegou a hora de realizar sua migração! Acesse a aba "Referências da API" para conferir mais informações técnicas sobre a API e avançar rumo ao futuro das suas assinaturas.

[Comece agora com a API 3.0](https://developers.clicksign.com/reference#/)

<Footer3 />