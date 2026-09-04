---
updatedAt: 2026-05-27T10:43:21.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# FAQ: Dúvidas comuns

Principais dúvidas sobre a API e como resolver os problemas mais frequentes

Encontre aqui respostas rápidas para as dúvidas mais comuns sobre a API da Clicksign. Se algo não estiver claro ou se você está enfrentando um problema específico, este é o lugar certo para começar.

<br />

## Primeiros Passos

### 1. Como começo a integração com a API 3.0?

Crie uma conta em Sandbox, gere um Access Token e faça uma requisição de autenticação para validar o ambiente.

### 2. Qual a diferença entre Sandbox e Produção?

Sandbox é um ambiente para testes (sem validade jurídica). Produção é o ambiente real (documentos com validade legal).

### 3. Preciso autenticar todas as requisições?

Sim. Envie o Access Token no header Authorization; sem ele, a API retornará um erro 401.

<br />

## Documentos e Envelopes

### 4. Posso enviar múltiplos documentos em um mesmo Envelope?

Sim. A 3.0 permite agrupar vários documentos e signatários em uma única transação, diferenciando quais signatários devem assinar quais documentos.

### 5. Qual o limite de tamanho para documentos enviados?

Até 10 MB por arquivo e 100 MB por Envelope (soma dos arquivos).

### 6. O que acontece se eu precisar atualizar ou substituir um documento já enviado?

É possível atualizar enquanto o Envelope estiver em andamento; mudanças de status são restritas.

<br />

## Signatários e Requisitos

### 7. Posso adicionar ou remover signatários depois de criar o Envelope?

Sim, enquanto o Envelope estiver em rascunho (draft). Após ativo (running), as alterações são limitadas.

### 8. Quais requisitos de assinatura posso configurar?

**Qualificação** (papel do signatário), **Autenticação** (ex.: token, biometria facial, selfie com documento, etc) e **Rubrica** (opcional).

### 9. Quais tipos de autenticação estão disponíveis?

Token (E-mail/SMS/WhatsApp), Assinatura Manuscrita (posicionada ou não), Comprovante de Endereço, Selfie Dinâmica, Selfie com Documento, Documento Oficial, Biometria Facial (Normal ou Serpro), Documentoscopia, PIX, Certificado Digital (ICP-Brasil), e Assinatura Automática.

### 17. Existe algum custo para autenticações avançadas (ex.: biometria facial)?

Sim, autenticações como Biometria Facial Serpro e Documentoscopia têm cobrança por uso.

<br />

## Notificações e Eventos

### 10. Quais notificações os signatários recebem?

Solicitação de Assinatura, Lembrete e Confirmação de Documento Assinado; e também é possível disparar via endpoints.

### 11. É possível personalizar o conteúdo dos e-mails enviados pela Clicksign?

Sim. É possível ajustar conteúdo e layout das notificações.

### 14. Como monitorar o andamento de um processo de assinatura?

Use Eventos e/ou Webhooks para acompanhar status de documentos, envelopes e signatários em tempo real.

<br />

## Limites e Erros

### 12. Quais são os limites de requisições?

Produção: 50 req/conta/10s. Sandbox: 20 req/conta/10s. Excedendo, será retornado um erro 429 (Too Many Requests).

### 13. Como interpreto os erros retornados pela API?

400 (requisição inválida), 401 (token ausente/inválido), 404 (não encontrado), 422 (validação), 429 (rate limit), 500 (erro interno).

<br />

## Segurança

### 15. Quais protocolos de segurança a Clicksign utiliza?

HTTPS com TLS 1.2+ e cifras modernas.

<br />

## Operações Avançadas

### 16. Posso usar a API em massa para automatizar operações?

Sim. Há endpoints e fluxos que suportam operações em lote.

### 18. Onde encontro exemplos de integração?

No [Passo a Passo](https://developers.clicksign.com/update/recipes) você terá alguns exemplos de código, e poderá até mesmo simular o envio do seu primeiro envelope.

<br />

## Suporte e Versionamento

### 19. Como sei se estou usando a versão correta da API?

Confira a URL da chamada, e se o caminho inicia com `/v3` (versões antigas, como 1.9 (v1), estão em descontinuação).

### 20. Preciso de suporte adicional. Como entro em contato?

[Entre em contato com o Suporte](https://www.clicksign.com/suporte) e forneça alguns detalhes como ambiente, endpoint, payload, resposta/erro e logs relevantes.

<br />

# Dúvidas esclarecidas?

Ficamos felizes em ajudar. Se precisar de mais suporte, nossa equipe está pronta para atender você.

Para mais informações, consulte o rodapé abaixo.

<Footer3 />