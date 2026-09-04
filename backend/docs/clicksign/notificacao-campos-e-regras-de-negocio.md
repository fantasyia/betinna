---
updatedAt: 2026-02-11T16:09:49.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Campos e Regras de Negócio

Esta seção da documentação descreve detalhadamente os campos utilizados nas requisições e respostas da API, juntamente com as regras de negócio associadas a cada um deles. Aqui, você encontrará informações sobre:

* **Definições dos campos:** Nome, tipo de dado e formato esperado.
* **Validações aplicadas:** Regras obrigatórias, valores permitidos, e limites de tamanho ou intervalo.
* **Dependências e relações:** Campos que dependem de outros ou influenciam o comportamento da API.
* **Comportamento padrão:** Valores atribuídos automaticamente e tratamento de dados opcionais.

Nosso objetivo é garantir que você tenha uma compreensão clara de como interagir com os campos da API e evitar erros comuns durante a integração. Certifique-se de consultar esta seção ao construir ou validar suas requisições.

# Campos e Regras de Negócio:

## Descrição dos Campos

| Campo                                  | Descrição                                                                                               | Tipo        |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------ | :---------- |
| **message**                            | Determina a mensagem personalizada que será enviada ao signatário.                                      | **string**  |
| **email\_customization**               | Determina atributos que customizam a notificação por email                                              | **json**    |
| **email\_customization.subject**       | Determina assunto do email. (Máx: 998 chars).                                                           | **string**  |
| **email\_customization.head**          | Determina o cabeçalho da notificação, presente no corpo do email. (Máx: 3000 chars).                    | **string**  |
| **email\_customization.greeting**      | Determina a saudação da notificação, presente no corpo do email. (Máx: 3000 chars).                     | **string**  |
| **email\_customization.principal**     | Determina a mensagem principal da notificação, presente no corpo do email. (Máx: 3000 chars).           | **string**  |
| **email\_customization.button**        | Determina o texto no botão que direciona o signatário à assinatura. (Máx: 50 chars).                    | **string**  |
| **email\_customization.final**         | Determina a mensagem final após o botão, presente no corpo do email. (Máx: 3000 chars).                 | **string**  |
| **email\_customization.align**         | Determina o alinhamento dos elementos do email.                                                         | **string**  |
| **email\_customization.show\_token**   | Determina se o Token é exibido no corpo do email (quando existir autenticação por token)                | **boolean** |
| **email\_customization.show\_qrcode**  | Determina se é adicionado um QR Code ao corpo do email, o conteúdo do QR Code é o link para assinatura. | **boolean** |
| **email\_customization.show\_details** | Determina se devem ser exibidos detalhes do processo de assinatura, impresso após todas as mensagens.   | **boolean** |

## Regras de Negócio para os campos

| Campo                          | Regras de Negócio                                                                                                                                                                                                                                                                                                                                                    |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **message**                    | Esse atributo pode ser customizado em caso de notificações por `email`. Em casos de notificações por `whatsapp` ou `sms`, o campo `message` é desconsiderado.<br /> - Quando nenhuma mensagem for enviada, será utilizado o dado existente no [`#default_message` do envelope](/v3.0/reference/envelope-campos-e-regras-de-negocio#descri%C3%A7%C3%A3o-dos-campos) . |
| **email\_customization**       | Esse atributo pode ser customizado em caso de notificações por `email`. Em casos de notificações por `whatsapp` ou `sms`, o campo `message` é desconsiderado.                                                                                                                                                                                                        |
| **email\_customization.align** | Aceita os valores `left`, `center`, `right`, `justify`                                                                                                                                                                                                                                                                                                               |

## Regras dos campos para a Criação

| Campo                                  | Obrigatório                        | Disponível                           | Valor Padrão              |
| :------------------------------------- | :--------------------------------- | :----------------------------------- | :------------------------ |
| **message**                            | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **null**                  |
| **email\_customization**               | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **\{}**                   |
| **email\_customization.subject**       | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **null**                  |
| **email\_customization.head**          | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **null**                  |
| **email\_customization.greeting**      | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **null**                  |
| **email\_customization.principal**     | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **null**                  |
| **email\_customization.button**        | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | 'Visualizar para assinar' |
| **email\_customization.final**         | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **null**                  |
| **email\_customization.align**         | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **center**                |
| **email\_customization.show\_token**   | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **false**                 |
| **email\_customization.show\_qrcode**  | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **false**                 |
| **email\_customization.show\_details** | <span class="red-tag"> NÃO </span> | <span class="green-tag"> SIM </span> | **true**                  |

<Footer3 />