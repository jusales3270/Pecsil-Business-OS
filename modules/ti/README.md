# TI

Módulo de TI do Business OS (T-06 do roadmap, escopo em [docs/PLANO-TI.md](../../docs/PLANO-TI.md) §5).

- **Painel:** o servidor, o backup diário e os testes de fora, lidos do vigia externo na nuvem (T-03 e T-02).
- **Incidentes:** as quedas do vigia são copiadas para `ti_incidentes` (pelo sinal de vida, a cada minuto,
  e ao abrir a tela). A TI confirma a causa e registra à mão o que o vigia não vê.
- **Chamados:** qualquer pessoa abre e acompanha os seus pelo menu da conta ("Chamados de TI"); a TI
  atende na fila do módulo.
- **Inventário:** servidores, estações, rede, coletores das CNCs e sistemas.
- **Regras:** categorias e prazos dos chamados, do supervisor de TI (semeados como provisórios).

Fica para depois: os acessos remotos auditados (dependem da ferramenta do T-05) e o nobreak (T-01).

Banco: `supabase/migrations/202610190001_ti_base.sql`. Nuvem: `infra/vigia/003_painel.sql`.
