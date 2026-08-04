# Módulo Financeiro

Segundo módulo nativo do Pecsil Business OS. A versão 1.0 funciona com dados
demonstrativos e preserva o contrato central para posterior persistência no
Supabase. A versão 1.3 adiciona o contrato de persistência sem retirar os mocks,
permitindo validar o produto antes de conectar o servidor interno da Pecsil.

## Domínios

- Contas a pagar
- Contas a receber
- Fluxo de caixa
- Bancos e conciliação
- Centros de custo
- Relatórios financeiros
- Homologação

## Rotina operacional v1.2

- Agenda diária por vencimento
- Separação entre previsões e títulos confirmados
- Baixa integral ou parcial preservando o título original
- Relatório de contas pagas para o escritório
- Extrato reservado de retiradas e pró-labore
- Apuração demonstrativa de PIS/Cofins a partir dos recebimentos
- Tratamento separado de exportações e diferenças cambiais

As regras fiscais, os filtros oficiais de competência e os arredondamentos estão
isolados da interface e permanecem provisórios até a validação do Financeiro e
do escritório contábil.

## Persistência v1.3

- Plano de contas e centros de custo por organização
- Contas bancárias e movimentos importáveis com payload bruto preservado
- Títulos a pagar e receber com parcelas independentes
- Aprovação por faixa de valor, nível e papel
- Baixa integral, parcial e reversível sem alterar o valor original
- Conciliação bancária entre movimento e baixa
- RLS por organização, módulo e permissão específica
- Auditoria automática de títulos, aprovações, baixas e conciliações
- API e repositório com fallback demonstrativo enquanto o Supabase estiver offline

As migrations estão prontas para aplicação posterior no Supabase interno. Até
lá, a interface homologada continua operando com dados demonstrativos.

Compras permanece um módulo operacional separado. Pedidos aprovados em Compras
deverão gerar previsões ou títulos no Financeiro quando a integração for
implementada.
