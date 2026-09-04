---
updatedAt: 2026-06-04T10:32:51.000Z
---

Fetch the complete documentation index at: https://developers.clicksign.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# 2.1. Envelope

## 📂 Visão Geral: O que é um Envelope?

O Envelope é a unidade fundamental da API v3. Pense nele como uma pasta digital inteligente que agrupa tudo o que é necessário para um processo de assinatura.

Em vez de enviar documentos isolados, você gerencia um "pacote" que contém os arquivos, as pessoas que devem assinar e as regras que conectam cada um deles.

## 🏛️ A Anatomia de um Envelope

Para uma integração de sucesso, você deve visualizar o Envelope como um conjunto de quatro pilares:

* **O Envelope (O Container):** É a caixa que guarda as informações de status, prazos e configurações da transação.
* **Documentos (Os Arquivos):** São os PDFs ou modelos (Templates) que serão assinados. Um único envelope pode conter múltiplos documentos.
* **Signatários (As Pessoas):** São os indivíduos que precisam interagir com o envelope.
* **Requisitos (A Regra de Negócio):** É o "elo" que une tudo. É aqui que você define: "O Signatário A deve assinar o Documento B usando Biometria Facial".

## 🔄 Ciclo de Vida do Envelope

Um envelope passa por diferentes estados desde a sua criação até a finalização. Entender esses status é crucial para a sua automação:

| Status                  | Descrição                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `draft` (Rascunho)      | O envelope foi criado, mas ainda está sendo montado. Você pode adicionar/remover documentos e signatários. Enquanto seu envelope está em rascunho, apenas o usuário da API consegue vê-lo. |
| `running` (Em processo) | O envelope foi "ativado". As notificações podem ser enviadas e os signatários já podem assinar.                                                                                            |
| `closed` (Finalizado)   | Todos os signatários cumpriram seus requisitos. O envelope está fechado e os documentos assinados estão disponíveis.                                                                       |
| `canceled` (Cancelado)  | A transação foi interrompida e o link de assinatura foi invalidado.                                                                                                                        |

## ⚡ O Momento Crítico: A Ativação

A ativação é o gatilho que transforma um rascunho em uma transação real. Na API v3, oferecemos dois caminhos para isso, dependendo da sua necessidade de escala:

* **Fluxo Padrão:** Ideal para envelopes simples. A ativação ocorre via atualização direta (`PATCH`).
* **Fluxo de Larga Escala (Assíncrono):** Desenhado para envelopes com muitos documentos ou alto volume de requisições. Você solicita a ativação via `POST /api/v3/envelopes/:key/activate`, recebe um `202 Accepted` e nós processamos tudo em segundo plano, avisando seu sistema via Webhook quando terminar.
  * **Essa solução está em desenvolvimento e logo será entregue.**

Dica de Performance: Use sempre o Fluxo de Larga Escala, ele é o seu melhor amigo para evitar lentidão na sua aplicação e economizar recurso.

## 💡 Por que este modelo é vantajoso?

* **Flexibilidade:** Você pode reaproveitar um mesmo signatário para assinar vários documentos diferentes no mesmo fluxo, com diferente configurações de requisitos e economizando cliques para o seu cliente.
* **Organização:** Facilita a gestão de contratos complexos que exigem várias partes (ex: um contrato de aluguel + termo de vistoria + seguro fiança), todos em um só lugar.
* **Segurança:** Todas as evidências de todos os documentos do envelope são consolidadas, garantindo uma trilha de auditoria robusta.

## Próximo Passo ➡️

Agora que você já domina os conceitos, vamos criar o seu primeiro envelope na prática:

[**Guia de Criação: O Passo a Passo.**](/docs/guia-de-criacao-o-passo-a-passo-padrao)

**[Página de Referência para Evenlopes](/v3.0/reference/envelope-campos-e-regras-de-negocio)**.

<Footer3 />