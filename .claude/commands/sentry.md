---
description: Inicia sessão de triagem de erros do Sentry (somatec-web + betinna-api + betinna-front): ler, entender a causa e propor/executar o conserto
---

Esta sessão é dedicada a **TRIAGEM DE ERROS EM PRODUÇÃO** via Sentry, nos três projetos: `somatec-web`, `betinna-api` e `betinna-front`.

Faça o seguinte, nesta ordem:

0. **Leia PRIMEIRO `C:/Users/TechD/.claude/sentry-triagem/ULTIMO.md`** — é o relatório que a
   rotina diária das 03:00 deixou, com os problemas do dia e o conserto proposto de cada um.
   ⚠️ **Confira a DATA no topo.** Se for de ontem, a rotina não rodou (ela roda com o app aberto);
   trabalhar em cima de relatório velho é consertar erro que já foi consertado.
   Se o arquivo não existir, tudo bem: siga sem ele e leia o Sentry direto.
1. Leia `C:/Users/TechD/Clientes/SOMATEC-BLOCKING/sessoes/triagem-sentry/CONTEXT.md` (bootstrap) — se o diretório de trabalho já for a raiz do repo, o caminho é `C:/Users/TechD/Clientes/SOMATEC-BLOCKING/sessoes/triagem-sentry/CONTEXT.md`.
2. Leia o desenho de referência do filtro de dado pessoal, que é o que impede exportar lead pro Sentry — e o que já quebrou duas vezes:
   - `C:\Users\TechD\.claude\github\somatec_web\src\lib\observabilidade\sentry-limpeza.ts`
   - `C:\Users\TechD\.claude\github\somatec_web\tests\sentry-limpeza.test.ts`
3. Leia o `CLAUDE.md` do repositório que o erro do dia tocar (`somatec_web` ou `betinna`) antes de propor conserto nele.
4. Assuma o papel descrito no CONTEXT: ler o que quebrou, separar ruído de problema, achar a causa raiz e propor o conserto com arquivo e linha.
5. **Escopo:** só erro em produção e o conserto dele. Copy, layout, ads, conteúdo e estratégia são de outras sessões — se eu pedir algo fora, avise e confirme.
6. **GUARDRAILS:**
   - ⛔ **não pushar na `main`** de nenhum dos dois repositórios sem meu OK explícito — `main` é deploy automático nos dois.
   - ⛔ **token da API do Sentry é segredo** — nunca em chat, nunca em arquivo do repositório, nunca em card. Se faltar, me avise e trabalhe com o erro que eu colar.
   - ✅ conserto pequeno e óbvio: faz, testa e me mostra. Conserto que muda comportamento: propõe primeiro.
   - ✅ consertar a **raiz**. `try/catch` que só cala o erro limpa o Sentry e esconde o problema — é pior que não fazer nada.

Ao terminar de carregar, me diga em 2-3 linhas o que consegue ler agora (tem token? tem erro na fila?) e me proponha o 1º movimento.

**Importante:** abra esta sessão na pasta do repositório `C:\Users\TechD\.claude\github\leo-Skills-master`.
