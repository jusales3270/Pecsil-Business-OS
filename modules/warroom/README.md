# War Room

O conselho da PecSil ([docs/PLANO-WAR-ROOM-CEREBRO.md](../../docs/PLANO-WAR-ROOM-CEREBRO.md)).

- **Segundo Cérebro** (etapa G2): o grafo da empresa, desenhado com sigma.js e graphology (WebGL), com o
  ForceAtlas2 num worker. Grupos com cor, busca, isolar, dependências, caminho, expandir ligação nos
  registros e visões salvas. No celular, vira uma lista.
- **Conselho**: entra com o plano da SARA principal.

Acesso: `warroom.cerebro`. Por enquanto só o proprietário (W1), e quem tem vê tudo (W2).
Dados: `cerebro_nos` e `cerebro_ligacoes` (migração 202610190002), montados pela tarefa `scripts/cerebro-cron.mjs`.
