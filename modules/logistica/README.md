# Logística (entregas e frota)

Entregas com a frota própria, da OS ou do pedido até o cliente, com os caminhões no mapa em tempo real.

O motor das entregas é o **Fleetbase**, que roda como serviço separado (AGPL-3.0) e é consumido só pela API.
Desenho, decisões e aceite estão em [`docs/PLANO-LOGISTICA.md`](../../docs/PLANO-LOGISTICA.md); a ordem das etapas
fica na raia L do [ROADMAP](../../docs/ROADMAP.md).

- **Telas:** Ao vivo (mapa), Entregas, Frota e Origem.
- **Servidor:** `lib/logistica/` (cliente do Fleetbase, geocodificação, conferência das entregas abertas).
- **Banco:** migração `202610200001_logistica_entregas.sql`.
- **Simulador para testar sem motorista:** `scripts/fleetbase-simular-rota.mjs`, só no Fleetbase local.
