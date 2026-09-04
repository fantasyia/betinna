---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Guia de criação: O passo a passo padrão

Para colocar um envelope "em progresso", você passará por 5 etapas obrigatórias e uma etapa final de ativação.

## 💡 O fluxo lógico:

1. Criar o Envelope (A pasta)
2. Adicionar documentos (Os arquivos dentro da pasta)
3. Adicionar signatários (As pessoas que assinarão)
4. Criar requisitos (A regra: "Quem assina qual documento")
5. Ativar (O gatilho de envio)

## 1️⃣ Criando o Envelope

O primeiro passo é gerar o "envelope". Aqui você define o nome do projeto e configurações básicas.

Destaque: Guardar o id retornado; você precisará dele em todos os próximos passos.

Página de referência: <Anchor label="Clique aqui" target="_blank" href="/reference/api-envelope">Clique aqui</Anchor>.

```json
# Exemplo de criação de rascunho
{
  "data": {
    "type": "envelopes",
    "attributes": {
      "name": "Contrato de Prestação de Serviços - Março 2026"
    }
  }
}
```

## 2️⃣ Adicionando documentos

Com o envelope criado, agora você faz o upload do arquivo PDF (em Base64) ou utiliza um modelo (Template) já existente na sua conta.

Endpoint: `POST /api/v3/envelopes/:envelope_id/documents`

Vínculo: Você deve enviar o envelope\_id no corpo da requisição.

Página de referência: <Anchor label="Clique aqui" target="_blank" href="/reference/api-documentos">Clique aqui</Anchor>.

## 3️⃣ Cadastrando signatários

Agora, informe quem são as pessoas envolvidas. Você pode identificar o signatário por E-mail ou WhatsApp.

Endpoint: `POST /api/v3/envelopes/:envelope_id/signers`

Vínculo: Você deve enviar o envelope\_id no corpo da requisição.

Página de referência: <Anchor label="Clique aqui" target="_blank" href="/reference/api-signatarios">Clique aqui</Anchor>.

## 4️⃣ Criando requisitos

Este é o passo mais importante. O signatário só conseguirá assinar se houver um requisito vinculado a ele e ao documento.

É aqui que você define:

* Qual documento a pessoa assina.
* Qual o papel dela (Assinante, Testemunha, Interveniente).
* Qual o método de autenticação (Token, Pix, Biometria, etc).

Endpoint: `POST /api/v3/envelopes/:envelope_id/requirements`

Página de referência: <Anchor label="Clique aqui" target="_blank" href="/reference/api-requisitos">Clique aqui</Anchor>.

## 5️⃣ Ativação

Seu envelope está montado, mas ainda está em modo Rascunho (Draft). Para que as notificações sejam enviadas aos signatários, você precisa ativá-lo.

Qual método escolher?
Para este guia padrão, utilizaremos o método de atualização direta:

Endpoint: `PATCH /api/v3/envelopes/{id}`

Ação: Alterar o atributo status para active.

Página de referência: <Anchor label="Clique aqui" target="_blank" href="/reference/api-editar-envelope">Clique aqui</Anchor>.

```json
{
  "data": {
    "id": "ID_DO_ENVELOPE",
    "type": "envelopes",
    "attributes": {
      "status": "running"
    }
  }
}
```

## ✅ Check-list de sucesso

* [ ] Recebi o status 200 OK na ativação?
* [ ] Verifiquei se todos os documentos possuem pelo menos dois requisitos?

## Próximo passo ➡️

Sua operação cresceu e você precisa de escala? O método PATCH acima vai sofrer lentidão.

Aprenda como escalar sua operação com a Ativação Assíncrona (202 Accepted):

<Anchor label="Ativação em Larga Escala" target="_blank" href="/docs/ativacao-escala-performatica">Ativação em Larga Escala</Anchor>.