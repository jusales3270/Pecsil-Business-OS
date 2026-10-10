# Convenções deste repositório

## Modelo de decisão (Jev / Clef) fala em azul

Quando um julgamento vier de um **modelo de decisão**, ele precisa estar visualmente
separado do que é do Claude. Regra combinada com o proprietário. Vale para:

- o **Jev** (modelo System One da TypeSafe), usado até agora;
- o **Clef** (Cloudflare, `clef-flash` / `clef`), que substitui o Jev desde a decisão de
  03/10/2026 (ver `docs/PLANO-JEV.md`).

- **No terminal:** toda consulta ao modelo passa por um utilitário que imprime a
  resposta em **azul**: hoje `scripts/jev.mjs` (Jev), e o equivalente do Clef quando a
  base comum for construída. Texto do Claude fica na cor normal; erro de rede ou de chave
  também sai sem azul, porque é falha do serviço, não julgamento do modelo.
- **Nas mensagens do chat** (onde não há cor): a resposta do modelo aparece sempre em
  citação começando por `🔵 Jev:` ou `🔵 Clef:`, conforme quem respondeu, nunca diluída
  no texto do Claude.
- **Na interface da plataforma** (sugestões dos módulos e da SARA): o que vier do modelo é
  marcado como tal, com a confiança à vista. Nunca apresentar julgamento do modelo
  como se fosse dado apurado.

Uso do utilitário do Jev:

```bash
node scripts/jev.mjs "<texto/estado>" \
  "noul:nome=pergunta" \
  "choice:nome=pergunta|opcao:descrição,outra:descrição" \
  "score:nome=pergunta|baixa,média,alta"
```

A chave do Jev vem de `TYPESAFE_API_KEY`. As do Clef serão `CLOUDFLARE_ACCOUNT_ID` e um
token só de Workers AI. Todas ficam no `.env.local` e, em produção, em variável no
Coolify. Nunca prefixar com `NEXT_PUBLIC_`, senão vai para o navegador.

**Cuidado com o que é enviado:** TypeSafe e Cloudflare são serviços externos. Mandar só o mínimo
necessário (dois nomes de fornecedor, a descrição de um gasto) e nunca dado pessoal
como CPF, PIS ou documento de colaborador.
