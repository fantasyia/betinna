---
updatedAt: 2026-05-27T10:41:03.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Regras de finalização de Envelopes

Defina o que acontece com envelopes que atingem a data limite

Muitas vezes, fluxos de contratação e acordos comerciais são interrompidos pelo simples vencimento de um prazo. Em processos tradicionais, quando um envelope expira sem que todos os signatários tenham assinado, o esforço de quem já concluiu sua parte é perdido. Isso gera a necessidade de reenviar o documento, solicitar novas assinaturas e lidar com o retrabalho operacional, o que pode causar fricção no relacionamento com o cliente e atrasos em receitas esperadas.

Por outro lado, em muitos casos a data da expiração do documento é um marco importante: se todas as partes não concluíram suas assinaturas a tempo, dentro daquele contexto, o documento não é considerado válido.

Para resolver esse problema, a Clicksign permite que você defina o destino de documentos com assinaturas pendentes após a expiração da data limite através do atributo `deadline_partial_signature_action`. Com essa configuração, você decide se o sistema deve **finalizar o documento automaticamente**, aproveitando as assinaturas que já foram coletadas, ou **cancelar o documento**, invalidando as assinaturas anteriores.

<br />

## Casos de uso

### **Validade do documento após expiração da data limite**

* **Abaixo-assinados ou Listas de presença:** Situações onde o número total de signatários é variável e o que importa são as adesões feitas até determinada data.
* **Acordos de múltiplas partes:** Se o fórum mínimo já foi atingido, o documento pode ser encerrado na data limite sem a necessidade de reenviar o documento aos signatários remanescentes.

### **Não validade do documento após expiração da data limite**

* **Contratos com obrigatoriedade de todas as assinaturas:** Situações onde o documento só é válido se todos os signatários concluírem a assinatura; caso contrário, deve ser invalidado ao expirar.
* **Termos de compliance ou regulatórios:** Documentos que exigem a concordância integral de todas as partes para atender requisitos legais ou internos

<br />

## Segurança e conformidade

Independentemente da escolha de finalizar ou cancelar o documento, a Clicksign mantém o rigor de conformidade com a **LGPD** e garante a **validade jurídica** do processo. Se o documento for finalizado com assinaturas parciais, o LOG de Assinaturas refletirá exatamente quem assinou e o estado final do documento, preservando a integridade da evidência digital e a trilha de auditoria.

<br />

## Como começar

Para implementar essa configuração em sua integração, utilize o atributo `deadline_partial_signature_action` na criação de envelopes via API.

```json
# Exemplo 
{
  "data": {
    "type": "envelopes",
    "attributes": {
      "deadline_partial_signature_action": "closed"
    }
  }
}
```

### **Valores aceitos:**

* `closed`: (Padrão) Finaliza o documento com as assinaturas coletadas até o momento da data limite.
* `canceled`: Cancela o documento automaticamente ao atingir o prazo, caso ele não possua todas as assinaturas.

**Confira os detalhes técnicos e exemplos de requisição em nossa documentação:**

* <Anchor label="Guia de API: Criação de Envelopes" target="_blank" href="https://developers.clicksign.com/docs/introducao-a-documentacao">Guia de API: Criação de Envelopes</Anchor>
* <Anchor label="Referência do Atributo: deadline_partial_signature_action" target="_blank" href="https://developers.clicksign.com/reference/envelope-campos-e-regras-de-negocio">Referência do Atributo: deadline\_partial\_signature\_action</Anchor>

<br />