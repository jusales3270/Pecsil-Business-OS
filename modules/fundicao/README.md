# Fundição

Painel da Fundição (Guilherme): pede material ao Compras e acompanha cada pedido
(em cotação, aprovado, comprado, recebido). Decisões do dono em 09/10/2026:

- Quem só tem **Fundição › Pedidos de material** cai direto neste painel ao entrar
  e vê apenas os pedidos feitos pela Fundição (`material_requests.origem = 'FUNDICAO'`).
- Os pedidos vão para a divisão Fundição do Compras, assinados por quem pediu.
- O material chega pelo Almoxarifado (Henrique recebe); o solicitante é avisado.

Banco: `supabase/migrations/202610090002_fundicao_pedidos.sql` (origem, permissão,
`fundicao_criar_pedido`, `fundicao_cancelar_pedido`). Rotas: `app/api/fundicao/pedidos`.
