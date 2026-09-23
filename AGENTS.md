# Convenções deste repositório

## Jev (TypeSafe) fala em azul

Quando um julgamento vier do **Jev** (modelo System One da TypeSafe), ele precisa
estar visualmente separado do que é do Codex. Regra combinada com o proprietário:

- **No terminal:** toda consulta ao Jev passa por `scripts/jev.mjs`, que imprime a
  resposta em **azul**. Texto do Codex fica na cor normal; erro de rede ou de chave
  também sai sem azul, porque é falha do serviço, não julgamento do modelo.
- **Nas mensagens do chat** (onde não há cor): a resposta do Jev aparece sempre em
  citação começando por `🔵 Jev:`, nunca diluída no texto do Codex.
- **Na interface da plataforma** (quando a SARA usar o Jev): o que vier do modelo é
  marcado como tal, com a confiança à vista. Nunca apresentar julgamento do modelo
  como se fosse dado apurado.

Uso do utilitário:

```bash
node scripts/jev.mjs "<texto/estado>" \
  "noul:nome=pergunta" \
  "choice:nome=pergunta|opcao:descrição,outra:descrição" \
  "score:nome=pergunta|baixa,média,alta"
```

A chave vem de `TYPESAFE_API_KEY` (`.env.local`; em produção, variável no Coolify).
Nunca prefixar com `NEXT_PUBLIC_`, senão vai para o navegador.

**Cuidado com o que é enviado:** a TypeSafe é um serviço externo. Mandar só o mínimo
necessário (dois nomes de fornecedor, a descrição de um gasto) e nunca dado pessoal
como CPF, PIS ou documento de colaborador.
