# Fontes da Sentinela (testadas em 25/10/2026)

Cada URL abaixo foi aberta em 25/10/2026. "Acesso": **S** = sem bloqueio; **S\*** = funciona, mas
exige cookie, User-Agent de navegador ou cadastro; **N** = bloqueado ou os termos impedem.
Regras de uso: User-Agent identificado com contato, no máximo 1 requisição por segundo, só dados
públicos. Texto de imprensa serve para alertar; não fica guardado nem alimenta modelo.

## Federal: leis, DOU, Receita

| Fonte | URL | Formato | Acesso | Cadência | Observações |
|---|---|---|---|---|---|
| DOU, busca | `https://www.in.gov.br/consulta/-/buscar/dou?q=...&s=do1&exactDate=dia&sortType=0` | HTML com JSON embutido (`jsonArray` no `<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params">`) | S\* | Diária, dias úteis | Campos: `urlTitle, title, pubName, pubDate, content, classPK, displayDateSortable, hierarchyList, hierarchyStr, artType`. `leiturajornal?data=DD-MM-AAAA&secao=do1` tem a mesma estrutura. Sem RSS. **Em 25/10 deu timeout/502 de duas redes: validar de outra rede antes de implementar.** |
| DOU, INLABS | `https://inlabs.in.gov.br/` (repo oficial `github.com/Imprensa-Nacional/inlabs`) | ZIP com um XML por matéria (DO1, DO2, DO3, extras) | S\* (cadastro gratuito; o download automatizado é o propósito) | Diária; retém 4 meses | Melhor fonte bruta. **Recusou conexão em 25/10**; validar de outra rede. |
| dados.gov.br, DOU | `https://dados.gov.br/dados/conjuntos-dados/diario-oficial-da-uniao` | API CKAN (401 sem chave) | S\* | Mensal (histórico) | Só histórico; não serve para alerta. |
| Querido Diário | `https://api.queridodiario.org.br/gazettes?territory_ids=3550308&sort_by=descending_date` | JSON | S | Depende do município | Cobertura fraca em SP (capital parou em 03/2025). Não usar. |
| Planalto | `https://legislacao.presidencia.gov.br/` | HTML | S | Contínua | Sem feed. **Recusou conexão durante toda a pesquisa.** |
| LexML SRU | `https://www.lexml.gov.br/busca/SRU?operation=searchRetrieve&query=...` | XML | **N** | — | Desafio JS do Senado; inviável sem navegador. |
| normas.leg.br | `https://normas.leg.br/?urn=urn:lex:br:federal:lei:...` | HTML | S | — | Sem API (`/api` 404). |
| Senado, legislação | `https://legis.senado.leg.br/dadosabertos/legislacao/lista.json?tipo=LEI&ano=2026` (também LCP, MPV, DEC) | JSON/XML, sem chave | S | Dias úteis | Campos: `id, tipo, numero, norma, normaNome, ementa`. **Melhor "feed" de leis federais novas.** |
| Senado, tramitação | `https://legis.senado.leg.br/dadosabertos/processo?sigla=PLP&numero=108&ano=2024` (Swagger em `/dadosabertos/docs/`) | JSON | S | Contínua | `codigoMateria, dataUltimaAtualizacao, dataSituacaoAtual, ementa`. |
| Câmara, tramitação | `https://dadosabertos.camara.leg.br/api/v2/proposicoes?siglaTipo=PLP&numero=108&ano=2024` → `/proposicoes/{id}/tramitacoes?dataInicio=AAAA-MM-DD` | JSON | S | Contínua | `id, siglaTipo, numero, ano, ementa, dataApresentacao`. |
| Agência Senado / Câmara | `https://www12.senado.leg.br/noticias/rss` · `https://www.camara.leg.br/noticias/rss/ultimas-noticias` | RSS 2.0 | S | Várias por dia | — |
| RFB, notícias | `https://www.gov.br/receitafederal/pt-br/assuntos/noticias/RSS` (também `/noticias/sped/RSS`, `/ultimas-noticias/RSS`) | RSS 1.0/RDF | S | Diária | `title, link, description, content:encoded, dc:date`. Traz itens de pasta (ruído): filtrar. |
| RFB, normas (sijut2) | `https://normas.receita.fazenda.gov.br/` | SPA Angular; backend `/api/...` (`tipoPesquisa:"atosDia"`, `tipoData:"dataPublicacao"`, `dataInicio/dataFim`, `anoAto`, `numeroAto`; resposta `{atos, refinos}`; exporta CSV) | S\* | Dias úteis, após o DOU | `/api` direto dá **403** sem os cabeçalhos do app: precisa de navegador headless ou captura do token. É onde saem IN, ADE, Soluções de Consulta COSIT e Portarias. **Fora da v1.** |
| RFB, Agenda Tributária | `https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria/2026/Outubro` (mês com inicial maiúscula; `/agenda-tributaria` redireciona ao mês vigente; `/RSS` da pasta responde) | HTML calendário + XLSX + link ao ADE | S | Mensal (outubro saiu em 29/09) | O mês seguinte fica privado até publicar: "deixou de pedir login" é o sinal. Diff do XLSX. |
| RFB, perguntas e respostas | `https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/perguntas-frequentes` | HTML | S | Esporádica | Diff. |
| RFB, reforma tributária | `https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria-do-consumo` (+ `/legislacao`, notícias, manuais) · APIs de apuração da CBS: `https://docs.receitafederal.gov.br/apuracao-cbs/` | HTML | S | Esporádica | A página do MF (`gov.br/fazenda/.../reforma-tributaria`) exige login. |
| SPED, por projeto | `http://sped.rfb.gov.br/projeto/show/{id}`: ECD 273 · ECF 269 · EFD-Contribuições 268 · EFD ICMS/IPI 274 · EFD-Reinf 1196 · eSocial 1048 · NF-e 271 · NFS-e 272 · CT-e 267 · DeRE 2918 | HTML (notícias com `class="data">(dd/mm/aaaa)`) | S | Semanal/irregular | Sem RSS: diff da lista. Tabelas: CFOP `arquivo/show/1681`; códigos EFD ICMS/IPI `pagina/show/1578`. |
| eSocial | `https://www.gov.br/esocial/pt-br/documentacao-tecnica` · feed: `https://www.gov.br/esocial/pt-br/@@search_rss?SearchableText=*&sort_on=modified&sort_order=reverse&path=/esocial/pt-br/documentacao-tecnica` | HTML / Atom-RDF | S | Irregular | O `@@search_rss` é função padrão do Plone e funciona em qualquer site gov.br (testado: pgfn, nfse, fazenda, trabalho-e-emprego, carf); pode mudar sem aviso. |
| FGTS Digital | `https://www.gov.br/trabalho-e-emprego/pt-br/@@search_rss?SearchableText=FGTS%20Digital&sort_on=Date&sort_order=reverse` | Atom-RDF | S | Irregular | — |
| DCTFWeb | `https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/DCTFWeb` | HTML | S | Esporádica | Diff. |

## Documentos fiscais, CONFAZ, São Paulo, Comitê Gestor

| Fonte | URL | Formato | Acesso | Cadência | Observações |
|---|---|---|---|---|---|
| NF-e, Notas Técnicas e avisos | `https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=tW+YMyk/50s=` · avisos `informe.aspx?ehCTG=false` · espelho `https://dfe-portal.svrs.rs.gov.br/NFe/Documentos` | HTML ASP.NET | S\* (exige cookie jar; sem cookie entra em loop de redirect) | Semanal/irregular | Texto do tipo "Publicado no dia 01/10/26 o Ato Conjunto RFB/CGIBS nº 8"; PDFs em `exibirArquivo.aspx?conteudo=...`. CT-e segue o mesmo padrão em `cte.fazenda.gov.br`. |
| NFS-e nacional | `https://www.gov.br/nfse/pt-br/noticias` · `.../biblioteca/documentacao-tecnica` · `@@search_rss` | HTML / Atom | S | Irregular | — |
| CONFAZ | `https://www.confaz.fazenda.gov.br/legislacao/convenios` (`/ajustes`, `/protocolos`; itens `/convenios/2026/CV121_26`) · feed `https://www.confaz.fazenda.gov.br/@@search_rss?SearchableText=*&sort_on=Date&sort_order=reverse&path=/confaz/legislacao` | HTML Plone / Atom | S | Após as reuniões | A página do item traz "Publicado no DOU de dd.mm.aa" e a ratificação nacional. |
| Sefaz-SP, legislação | `https://legislacao.fazenda.sp.gov.br/Paginas/vejamais.aspx` (atos recentes) · `Paginas/Atos.aspx?Tipo=Comunicados%20CAT/SRE` · `Paginas/vejamaisRCRecentes.aspx` (respostas de consulta) | HTML SharePoint (lista por JS) | S | Diária | Agenda Tributária Paulista = Comunicado SRE mensal, publicado por volta do dia 28–30 do mês anterior. |
| Sefaz-SP, notícias | `https://www.sfp.sp.gov.br/sefaz/noticias` | HTML | S | Diária | Sem RSS. |
| DOE-SP, API | `https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications?Terms=ICMS&FromDate=2026-10-20&ToDate=2026-10-25&PageSize=50&PageNumber=1[&PublicationTypeId=...]` · detalhe `/v2/publications/{id}` · tipos `/v2/publication-types` | JSON (API do próprio site, não documentada) | S | Diária, por volta de 01h | Lista: `id, date, title, slug, excerpt, hierarchy, publicationTypeId, termsFound`. Detalhe: `journal, section, publicationType, content`. Sem `Terms` + datas devolve vazio. **Melhor fonte estadual.** |
| TIT-SP | `https://portal.fazenda.sp.gov.br/servicos/tit` | HTML | S | — | Sem feed; baixa prioridade. |
| CGIBS | `https://www.cgibs.gov.br/rss` · `/resolucoes` · `/atos-conjuntos` · `/atos-tecnicos-conjuntos` · `/regulamentos` | RSS 2.0 (10 itens: `title, link, description, dc:date`, enclosure) / HTML | S | 2 a 4 itens por semana | O RSS é de notícias (cita os atos); as listas de atos são HTML (diff). |

## Tribunais e PGFN

| Fonte | URL | Formato | Acesso | Cadência | Observações |
|---|---|---|---|---|---|
| STF, notícias | `https://noticias.stf.jus.br/feed/` | RSS 2.0 | S | Horária | `title, link, pubDate, category, content:encoded`; filtrar por categoria. |
| STF, repercussão geral | `https://portal.stf.jus.br/jurisprudenciaRepercussao/listarProcesso.asp` · tema: `tema.asp?num=118` | HTML (tema, título, leading case, situação, tese) | S\* (403 com UA de curl; OK com UA de navegador) | Contínua | Sem JSON: diff da tabela. |
| STF, pauta e Informativo | Pauta `https://portal.stf.jus.br/pauta/` → **403** · Informativo `https://www.stf.jus.br/arquivo/informativo/documento/informativo.htm` | HTML | Pauta: **N** | Semanal | Usar Informativo + notícias. |
| STJ | Notícias `https://res.stj.jus.br/hrestp-c-portalp/RSS.xml` · Informativo `https://processo.stj.jus.br/jurisprudencia/externo/InformativoFeed` · Teses `https://scon.stj.jus.br/SCON/JurisprudenciaEmTesesFeed` | RSS 2.0 | S\* (WAF rejeita curl) | Diária / quinzenal | `pubDate` em português. **robots proíbe `/repetitivos` e `/SCON/`: não raspar temas repetitivos.** |
| CARF | Notícias `https://carf.economia.gov.br/noticias/ultimas-noticias/RSS` · súmulas `/jurisprudencia/sumulas-carf` · pautas (SINCON, JSF com ViewState) · acórdãos `https://acordaos.economia.gov.br/` | RSS / HTML / JSF | S | Pautas mensais | Diff da página de súmulas; pautas pelas notícias. |
| TST | `https://www.tst.jus.br/rss` · súmulas `https://jurisprudencia.tst.jus.br/?tipoJuris=SUM` | RSS 2.0 / SPA | S | Diária | — |
| PGFN | Lista de dispensa `https://www.gov.br/pgfn/pt-br/assuntos/representacao-judicial/lista-dispensa-contestar-recorrer` · temas `.../temas-com-dispensa-de-contestar-e-recorrer/temas-com-dispensa-de-contestar-e-recorrer` · pareceres `https://www.gov.br/pgfn/pt-br/acesso-a-informacao/atos-da-pgfn-1/pareceres-da-pgfn-aprovados-pelo-ministro-da-fazenda` · feed `https://www.gov.br/pgfn/pt-br/@@search_rss?SearchableText=*&sort_on=Date&sort_order=reverse` | HTML / Atom | S | Irregular | Diff das listas. |

## Dados para cálculo

| Fonte | URL | Formato | Acesso | Cadência | Observações |
|---|---|---|---|---|---|
| BCB SGS | `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{11|4390|432|433|188}/dados/ultimos/2?formato=json` | JSON `[{"data":"dd/mm/aaaa","valor":"..."}]` | S | 11 diária (D+1); 4390/433/188 mensal; 432 pós-Copom | Às vezes responde "Requisição inválida" (WAF): repetir. **Sem API de feriados.** |
| ANBIMA feriados | `https://www.anbima.com.br/feriados/arqs/feriados_nacionais.xls` | XLS | S | Anual | — |
| BrasilAPI | `https://brasilapi.com.br/api/feriados/v1/2026` · `/api/taxas/v1` | JSON | S | Sob demanda | Taxas defasadas: preferir o BCB. |
| IBGE SIDRA | IPCA `https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63/p/last%201` · INPC `.../t/1736/n1/all/v/44/p/last%201` | JSON (`V`, `D3C`=AAAAMM) | S | Mensal (~dia 10) | — |
| IBGE municípios | `https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios` | JSON | S | Estática | — |
| Siscomex NCM | `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO` | JSON (`Data_Ultima_Atualizacao_NCM, Ato, Nomenclaturas[...]`) | S\* | A cada Resolução Gecex | Diff do campo `Ato`. |
| TIPI | `https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.pdf` | PDF | S | Por ADE/decreto | Diff por hash do PDF. |

## Imprensa (só como sinal)

| Fonte | URL | Acesso | Observações |
|---|---|---|---|
| JOTA | `https://www.jota.info/feed` | S | Libera bots de IA; parte paywall (o feed traz resumo). |
| Contábeis | `https://www.contabeis.com.br/rss/conteudo/` | S | — |
| Fenacon | `https://fenacon.org.br/feed/` | S | — |
| CFC | `https://cfc.org.br/feed/` | S | — |
| Tributário nos Bastidores | `https://tributarionosbastidores.com.br/feed/` | S | — |
| ConJur | `rss.xml` dá **403** (Cloudflare); robots: `Content-Signal: ai-train=no, use=reference` | N | Ler para alertar é "reference"; não guardar texto. |
| Migalhas | sem RSS; `https://www.migalhas.com.br/news-sitemap.xml` | S\* | — |
| Jusbrasil | robots `Disallow: /`; termos vedam coleta | **N** | Não usar. |
| Bases pagas | Econet "Informativo Completo" R$ 936/mês; LegisWeb, IOB, Checkpoint sob cotação | — | Termos proíbem redistribuir; nenhuma expõe API pública. |

## Canais que não substituem a Sentinela

Sefaz-SP: DEC (certificado digital; alerta por e-mail configurável dentro do DEC). RFB: Caixa Postal
do e-CAC. gov.br: notificações só de serviços, não de legislação.

## Conjunto mínimo da v1 e cadência

| # | Fonte | Poll |
|---|---|---|
| 1 | INLABS (XML do DOU, seções 1 e 1-extra); fallback: busca do in.gov.br com termos ("instrução normativa", "portaria", "convênio ICMS", "ato declaratório") | 06h, 08h, 12h; fallback a cada 2h |
| 2 | Senado `legislacao/lista.json` (LEI, LCP, MPV, DEC do ano) | 2×/dia |
| 3 | RFB Notícias RSS (+ `/sped/RSS`) | 30 min |
| 4 | RFB Agenda Tributária do mês seguinte (+ XLSX) | 1×/dia a partir do dia 20 |
| 5 | NF-e Notas Técnicas + avisos (cookie jar); CT-e | 2×/dia |
| 6 | eSocial documentação técnica (`@@search_rss`) + SPED por projeto (diff) | 1×/dia |
| 7 | CONFAZ convênios e ajustes (`@@search_rss`) | 2×/dia |
| 8 | DOE-SP API (termos: ICMS, "Comunicado SRE", "Portaria SRE", "Decreto") + Sefaz-SP legislação | 1×/dia às 06h |
| 9 | CGIBS RSS + diff das listas de atos | 1 h / 1×/dia |
| 10 | STF notícias RSS + temas RG (diff) · STJ notícias e Informativo · TST RSS, com filtro por palavras | 1 h |
| 11 | PGFN listas + CARF súmulas e notícias + STF temas | 1×/dia |
| 12 | BCB SGS (11, 4390, 432, 433, 188) + SIDRA + NCM Siscomex + TIPI (hash) + feriados | 1×/dia (SGS após 18h) |
| 13 | Câmara/Senado: tramitação dos projetos vigiados (PLP 108/2024 como teste; MP do Imposto Seletivo; Resolução da alíquota da CBS) | 1×/dia |
| 14 | Imprensa com feed (JOTA, Contábeis, Fenacon, CFC, Tributário nos Bastidores), só como sinal | 1 h |

**Diff para páginas sem feed:** normalizar o HTML (remover scripts e timestamps), extrair a lista de
títulos e datas, guardar o hash por item; alerta só em item novo, nunca em mudança de layout.

**Alarme de silêncio:** fonte sem item novo por mais tempo que o normal vira chamado de TI.
