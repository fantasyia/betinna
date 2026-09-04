---
updatedAt: 2026-05-12T12:36:31.000Z
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

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Campo
      </th>

      <th>
        Descrição
      </th>

      <th>
        Tipo
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **email**
      </td>

      <td>
        Email do observador e onde será notificado.
      </td>

      <td>
        **string**
      </td>
    </tr>

    <tr>
      <td>
        **kind**
      </td>

      <td>
        Define se o observador será notificado em todo o processo ou apenas na conclusão. Os valores possíveis são: `all_steps` ou `on_finished`.
      </td>

      <td>
        **string**
      </td>
    </tr>

    <tr>
      <td>
        **communicate_events**
      </td>

      <td>
        Objeto responsável por comunicar eventos ao observador.

        Para saber mais sobre os atributos desse objeto, acesse a seção **Comunicação de eventos**.
      </td>

      <td>
        **json¹**
      </td>
    </tr>

    <tr>
      <td>
        **attach_documents_enabled**
      </td>

      <td>
        Determina se o observador deve receber os documentos finalizados.
      </td>

      <td>
        **boolean**
      </td>
    </tr>
  </tbody>
</Table>

<br />

*Valor padrão para communicate\_events¹ quando kind for all\_steps*

```json

{
  "signature_watcher_document_sent":"email",
  "signature_watcher_document_signed":"email",
  "signature_watcher_document_deadline":"email",
  "signature_watcher_document_canceled":"email",
  "signature_watcher_envelope_closed":"email"
} 
```

## Comunicação de Eventos

Vamos detalhar os tipos de comunicações possíveis para um observador e em qual momento nós realizamos as comunicações, desta forma é possível controlar os eventos de notificação desejados.

* **signature\_watcher\_document\_sent**: Indica como a Clicksign deve comunicar ao observador que ele irá acompanhar a assinatura do documento.
* **signature\_watcher\_document\_signed**: Indica como a Clicksign deve comunicar ao observador que o documento foi assinado por um dos signatários.
* **signature\_watcher\_document\_deadline**: Indica como a Clicksign deve comunicar ao observador que o documento está próximo de atingir a data limite de assinatura.
* **signature\_watcher\_document\_canceled**: Indica como a Clicksign deve comunicar ao observador que o documento foi cancelado.
* **signature\_watcher\_envelope\_closed**: Indica como a Clicksign deve comunicar ao observador que o documento foi finalizado.

<br />

## Regras de Negócio para os campos

<Table align={["left","left"]}>
  <thead>
    <tr>
      <th>
        Campo
      </th>

      <th>
        Regras de Negócio
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **kind**
      </td>

      <td>
        Valores possíveis:

        * all_steps
        * on_finished
      </td>
    </tr>
  </tbody>
</Table>

<br />

## Regras dos campos para a Criação

<Table align={["left","left","left","left"]}>
  <thead>
    <tr>
      <th>
        Campo
      </th>

      <th>
        Obrigatório
      </th>

      <th>
        Disponível
      </th>

      <th>
        Valor Padrão
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        **email**
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        * <br />
      </td>
    </tr>

    <tr>
      <td>
        **kind**
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        * <br />
      </td>
    </tr>

    <tr>
      <td>
        **communicate_events**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        * <br />
      </td>
    </tr>

    <tr>
      <td>
        **attach_documents_enabled**
      </td>

      <td>
        <span class="red-tag"> NÃO </span>
      </td>

      <td>
        <span class="green-tag"> SIM </span>
      </td>

      <td>
        `false`
      </td>
    </tr>
  </tbody>
</Table>

<br />

# Conte com a nossa ajuda!

Estamos comprometidos em fornecer a você todas as ferramentas necessárias para simplificar e aprimorar seus processos de assinatura eletrônica. Não hesite em nos contatar se tiver alguma dúvida ou precisar de assistência adicional. Se precisar, [entre em contato com nosso Time de Suporte](https://www.clicksign.com/suporte).