# Plano do módulo Qualidade

A ordem de construção é a do [ROADMAP.md](ROADMAP.md) (raia Q). Aqui ficam as decisões, o que existe e o
roteiro da entrevista com a área.

## Decisão

Em 30/10/2026 o proprietário decidiu criar o módulo Qualidade, com várias seções. A primeira é Não
conformidades. A SARA da Qualidade evolui junto com as seções, e os detalhes vêm da entrevista com o
pessoal da Qualidade.

## Não conformidades (Q-01)

O registro nasce na conversa com a SARA do módulo:

1. a pessoa tira ou anexa a foto e explica por voz ou texto;
2. a SARA diz o que vê, usa o que já foi dito e pergunta o que falta, uma coisa por vez;
3. a SARA classifica pelos tipos da área e prepara o cartão;
4. o "Permitir" grava a NC-n com as fotos.

Dois caminhos (ajuste do proprietário, 03/11/2026):

- **Pela SARA do módulo:** foto sem texto → a SARA diz em uma frase o que aparece e pergunta o que fazer, com os
  botões **Registrar não conformidade** e **Descartar** (descartar apaga a foto na hora). Daí segue o fluxo acima.
- **Pela tela:** o botão "Registrar não conformidade" abre a janela padrão com **Tirar foto** (câmera do celular)
  e **Escolher foto**. A SARA lê a foto, a pessoa conta por texto ou voz o que aconteceu, onde e quando, e a
  SARA devolve o resumo com a hora e o local informados. Fechar sem registrar descarta a foto.

A hora do ocorrido é dita pela pessoa ("agora" vale a hora atual) e fica no registro (`ocorrido_em`); dá para
corrigir na tela. A tela mostra a lista, as fotos, a descrição, a leitura da SARA e o histórico. Corrigir, encerrar, reabrir e
cancelar ficam na tela. Nada se apaga.

| Decisão | Como ficou |
|---|---|
| Onde aparece | Dentro do ECOS, com login e permissão; sem painel de TV (proprietário, 30/10) |
| Quem registra | Só quem for liberado, começando pelo Ricardo (proprietário, 30/10) |
| Permissões | `qualidade.nao_conformidades`: ver, operar (registra, corrige, encerra), aprovar (Regras); `qualidade.sara` |
| Foto | Fica guardada desde a mensagem; quem liga à NC é o servidor, pelas fotos pendentes daquela conversa. Pendente com mais de 7 dias é apagada |
| Sem foto | A SARA pede uma vez; se a pessoa seguir, registra e o cartão avisa |
| Descrição × leitura da SARA | Descrição é o que a pessoa disse. O que o modelo leu na foto fica separado, marcado e com a confiança |
| Tipos e gravidade | Configuração em Qualidade › Regras. Lista provisória até a área revisar; gravidade desligada |
| Setor | Lista real de departamentos |
| Modelo | Sonnet nesta SARA: pouco volume, o julgamento pesa |
| Respostas | Curtas, sem palestra; a confiança na leitura da foto vai só no registro, não na conversa |
| Voz | A SARA da Qualidade recebe áudio e responde só em texto (decisão do proprietário, 30/10: só a central e o WhatsApp falam) |

Ainda não feito: tratamento (causa, ação, prazo, eficácia), reprovação da Forja virar NC, fila sem rede e
registro pelo WhatsApp.

## Como a SARA evolui

| Camada | Onde | Quem alimenta |
|---|---|---|
| O que cada seção faz | `lib/sara/agentes/qualidade.ts`, um bloco por seção em `SECOES` | Construção |
| Conhecimento técnico | Tema `qualidade` em `lib/sara/temas.ts` | Construção |
| Como a Pecsil trabalha | Documentos do setor Qualidade (`buscar_documentos_do_setor`) | Área de Qualidade |
| O que a área ensina | Lições aprovadas | Área de Qualidade |
| Tipos e gravidade | Qualidade › Regras | Quem aprova |

## Roteiro da entrevista com a Qualidade

**Não conformidades**
1. Quais tipos de ocorrência vocês registram hoje? A lista provisória serve?
2. Vocês classificam por gravidade? Quais níveis, e o que muda em cada um?
3. Que informação falta na ficha para ela servir de verdade?
4. Quem pode registrar, e quem precisa ser avisado?
5. Quem trata cada tipo, em que prazo, e o que encerra uma ocorrência?
6. Existe formulário, numeração ou registro exigido por cliente ou por norma?
7. Há ponto da fábrica sem Wi-Fi onde se registra?

**Módulo**
8. Quais são as outras rotinas da área (inspeção, calibração, auditoria, reclamação de cliente, plano de ação)?
9. Quais indicadores vocês acompanham?
10. A empresa tem ou busca certificação (ISO 9001 ou outra)?
11. Que procedimentos e instruções existem por escrito? (Entram nos documentos do setor, para a SARA ler.)
12. O que a SARA precisa saber sobre defeitos típicos das peças da Pecsil?
