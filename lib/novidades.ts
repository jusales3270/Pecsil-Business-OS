/**
 * Novidades de cada versão, mostradas quando a pessoa clica em "Atualizar".
 *
 * Toda entrega que muda algo visível ganha uma entrada NO TOPO desta lista,
 * escrita para quem usa a plataforma (sem termo técnico). O `id` nunca muda:
 * o app aberto compara os ids que já conhece com os da versão nova no
 * servidor, e mostra só o que é novo para aquela pessoa.
 *
 * A quem interessa (o aviso só vai para quem foi afetado; o proprietário vê tudo):
 * - `funcionalidades`: só quem tem uma delas (o mais preciso; ex.: a coleta só
 *   para quem tem "Coletar arquivos");
 * - senão `modulos`: quem tem acesso a um desses módulos (quem é do RH não é
 *   avisado do Financeiro; quem tem dois módulos recebe as dos dois);
 * - sem nenhum dos dois: todos (mudança da plataforma inteira).
 * O aviso "Nova versão disponível" com o botão Atualizar vai para TODOS, mesmo
 * quando a versão não traz novidade da área da pessoa.
 */
import { FEATURES_DOCUMENTOS_SETOR, hasFeature, hasModuleAccess, type AccessGrants } from "../modules/access-catalog";
import { SETORES_COLETA } from "./coleta/modulos";

/** Quem coleta arquivos em algum setor. */
const COLETA = SETORES_COLETA.map((s) => `${s}.coleta`);
/** Quem vê documentos de algum setor (Fundação › Documentos). */
const DOCUMENTOS = [...FEATURES_DOCUMENTOS_SETOR];

export type Novidade = {
  /** Único e estável (ex.: "2026-09-29-sugestoes"). */
  id: string;
  /** Data da publicação, AAAA-MM-DD. */
  data: string;
  /** Onde mudou (ex.: "Compras", "RH", "Plataforma"). */
  area: string;
  /** Códigos dos módulos a quem interessa (ex.: ["compras"]). Vazio: todos. */
  modulos?: string[];
  /**
   * Mais preciso que `modulos`: só quem tem uma destas funcionalidades (ex.: ["fundacao.sugestoes"]).
   * Mantenha `modulos` junto: o app aberto numa versão antiga só conhece `modulos` e, sem ele,
   * mostraria a novidade para todos.
   */
  funcionalidades?: string[];
  titulo: string;
  itens: string[];
};

export const NOVIDADES: Novidade[] = [
  {
    id: "2026-10-14-quadro-terceiros",
    data: "2026-10-14",
    area: "RH e Portaria",
    funcionalidades: ["rh.terceiros", "portaria.terceiros"],
    modulos: ["rh", "portaria"],
    titulo: "O RH inclui e exclui pessoas do quadro de terceiros",
    itens: [
      "Em RH › Colaboradores › Terceiros, o novo \"Quadro de terceiros\" mostra quem a Portaria pode escolher ao registrar a entrada.",
      "Com \"Terceiros\" em Operar, o RH inclui e exclui pessoas do quadro. A Portaria é avisada e a lista dela se atualiza sozinha.",
      "Excluir tira a pessoa da lista; as horas já apontadas continuam no histórico e no relatório mensal.",
    ],
  },
  {
    id: "2026-10-14-compras-diretas",
    data: "2026-10-14",
    area: "Compras e Almoxarifado",
    funcionalidades: ["compras.cotacoes", "compras.aprovacoes", "compras.realizadas", "almoxarifado.recebimento"],
    modulos: ["compras", "almoxarifado"],
    titulo: "Compras diretas e o nome pela fase: Cotação nº até a aprovação, OC nº depois",
    itens: [
      "Uma compra é \"Cotação nº\" enquanto espera a aprovação e passa a ser \"OC nº\" depois de aprovada, com o mesmo número do começo ao fim.",
      "Nova aba \"Compras diretas\" no Compras e no Almoxarifado, com a mesma lista e os mesmos números: compras autorizadas sem cotação, que já nascem como OC.",
      "No Almoxarifado, a \"Nota sem pedido\" vem com \"É compra direta (gerar OC)\" marcado: ao gravar, a OC nasce preenchida com os dados da nota e o Compras é avisado, sem digitar de novo. Desmarque para remessa, conserto, devolução ou amostra.",
      "Todo recebimento agora informa o tipo e o centro (Fundição, Usinagem, Administrativo): a nota entra completa no Painel do ICMS.",
      "No Compras, \"Nova compra direta\" registra a compra pedida pela diretoria: a OC sai na hora para o fornecedor e o material aparece em \"A caminho\" para o Almoxarifado.",
    ],
  },
  {
    id: "2026-10-13-auditoria-central",
    data: "2026-10-13",
    area: "Plataforma",
    funcionalidades: ["fundacao.auditoria"],
    modulos: ["fundacao"],
    titulo: "Auditoria central: quem entrou, abriu, fez e aprovou o quê",
    itens: [
      "Fundação › Auditoria mostra numa trilha só as ações (lançou, alterou, excluiu, aprovou), os eventos dos módulos, as entradas no sistema e as telas abertas, com filtros por pessoa, módulo, período e busca.",
      "O histórico vale desde 01/09/2026; as telas abertas passam a ser registradas agora. Nos cadastros e orçamentos, a alteração mostra o que mudou (antes → depois).",
      "\"Caminho\" mostra tudo o que aconteceu com um registro (um orçamento, um título, uma nota). Exporta em CSV. Pessoas e Acessos passa a mostrar o último acesso de cada um.",
    ],
  },
  {
    id: "2026-10-13-orcamentos",
    data: "2026-10-13",
    area: "Comercial",
    funcionalidades: ["comercial.orcamentos", "comercial.produtos", "producao.entrada", "fiscal.nfe"],
    modulos: ["comercial", "producao", "fiscal"],
    titulo: "Orçamentos, produtos, entrada de produção e faturamento pelo pedido",
    itens: [
      "Comercial › Vendas: cadastro de produtos (código interno no formato do GRV, NCM, desenho, material), com \"Clonar\" para a peça parecida.",
      "Orçamentos com itens, o pedido de compra do cliente e a cotação anexados (exigidos para marcar como ganho), anotações das mudanças e histórico de preço. Ganho, vira previsão a receber.",
      "Produção › Entrada de produção: as peças prontas dos orçamentos ganhos, nunca acima do pedido.",
      "Fiscal › A faturar: escolha quanto faturar de cada item e a nota nasce preenchida, com o pedido do cliente. Em várias notas, se precisar, mas nunca acima do pedido; nota cancelada devolve. Por enquanto no treino.",
    ],
  },
  {
    id: "2026-10-13-nfe-cliente-preenche",
    data: "2026-10-13",
    area: "Fiscal",
    funcionalidades: ["fiscal.nfe"],
    modulos: ["fiscal"],
    titulo: "Destinatário da nota preenchido pelo cadastro e pelo CNPJ",
    itens: [
      "Escolher o cliente na nota preenche o destinatário com o que o cadastro tem: CNPJ, inscrição estadual, endereço, código IBGE, telefone e e-mail.",
      "\"Buscar pelo CNPJ\" traz da Receita a razão social, o endereço e o código IBGE; digitar o CEP completa a rua, o bairro e o município. A inscrição estadual continua digitada.",
      "Ao salvar a nota, os dados do destinatário vão para o cadastro do cliente: cada cliente é preenchido uma vez só.",
    ],
  },
  {
    id: "2026-10-13-nfe-treino",
    data: "2026-10-13",
    area: "Fiscal",
    funcionalidades: ["fiscal.nfe"],
    modulos: ["fiscal"],
    titulo: "Treino de emissão de NF-e",
    itens: [
      "Nova tela Fiscal › Notas emitidas, por enquanto só para TREINO: monte a nota como faria de verdade, sem nada ir para a SEFAZ e sem valor fiscal.",
      "A plataforma calcula ICMS, IPI, PIS e COFINS por item e confere as regras (CFOP, CST, duplicatas, destinatário) e o esquema oficial da SEFAZ antes de liberar.",
      "Quem monta envia para aprovação; quem aprova transmite (simulado), e saem o DANFE e o XML marcados como sem valor fiscal. Dá para treinar também cancelamento, carta de correção e inutilização.",
    ],
  },
  {
    id: "2026-10-13-notas-de-servico",
    data: "2026-10-13",
    area: "Fiscal",
    funcionalidades: ["fiscal.icms", "almoxarifado.recebimento"],
    modulos: ["fiscal", "almoxarifado"],
    titulo: "Notas de serviço (NFS-e) no Painel do ICMS e no recebimento",
    itens: [
      "O Painel do ICMS e o recebimento do Almoxarifado aceitam também a nota de serviço (NFS-e), em XML ou PDF, além da NF-e de produto.",
      "Os formatos reconhecidos são o nacional, o das prefeituras (padrão ABRASF) e o da Prefeitura de São Paulo. A nota entra com tipo \"Serviço\", sem ICMS nem IPI, e com o ISS (e se foi retido) na observação.",
      "Do PDF, o que não for lido fica indicado para completar. Nota de serviço repetida (mesmo prestador e número) não entra duas vezes.",
    ],
  },
  {
    id: "2026-10-13-entrar-com-digital",
    data: "2026-10-13",
    area: "Plataforma",
    titulo: "Entrar com a digital no celular",
    itens: [
      "No celular, depois de entrar com a senha, a plataforma oferece ativar a digital (ou o rosto). Da próxima vez, é só tocar em \"Entrar com a digital\".",
      "A biometria fica só no seu aparelho: a plataforma nunca a recebe. A senha continua valendo.",
      "No painel da sua conta você vê os celulares com digital ativa e pode remover qualquer um.",
    ],
  },
  {
    id: "2026-10-12-portal-escritorio",
    data: "2026-10-12",
    area: "Fiscal",
    funcionalidades: ["fiscal.escritorio", "fiscal.portal"],
    modulos: ["fiscal"],
    titulo: "Portal do escritório de contabilidade",
    itens: [
      "Fechamento de cada mês com o escritório num lugar só: checklist com os números da plataforma e a situação (em preparação, enviada, conferida, fechada).",
      "Malote registrado: o que foi no papel e quando, com a confirmação de recebimento do escritório.",
      "Pendências nos dois sentidos, com mensagens e anexos, no lugar de e-mail e WhatsApp.",
      "O escritório entra com conta própria e vê só o portal e os totais do mês; tudo o que ele abre e baixa fica registrado.",
    ],
  },
  {
    id: "2026-10-12-fiscal-notas-recebidas",
    data: "2026-10-12",
    area: "Fiscal",
    funcionalidades: ["fiscal.icms", "fiscal.nfe", "fiscal.config", "fiscal.certificado"],
    modulos: ["fiscal"],
    titulo: "Notas recebidas da SEFAZ e Configuração fiscal",
    itens: [
      "Nova tela Notas recebidas: as notas que a SEFAZ registra contra o CNPJ da empresa chegam sozinhas, com a conferência do que ainda não está no Painel do ICMS nem foi recebido no Almoxarifado.",
      "Nota cancelada pelo fornecedor na SEFAZ aparece como cancelada, e quem lança no Painel do ICMS é avisado se ela já estava lançada.",
      "Lançar no Painel do ICMS direto da nota recebida, com o XML da SEFAZ (que fica guardado em Documentos).",
      "Nova tela Configuração: dados do emitente, certificado digital, série e numeração. É a base da emissão de NF-e pela plataforma, que vem em seguida.",
      "O certificado digital pode ser enviado pelo proprietário ou por quem ele autorizar (Certificado digital). Ninguém consegue ler o arquivo nem a senha, e cada troca fica na auditoria e avisa o proprietário.",
    ],
  },
  {
    id: "2026-10-12-cnpj-fornecedores",
    data: "2026-10-12",
    area: "Compras",
    funcionalidades: ["compras.fornecedores", "fundacao.cadastros"],
    modulos: ["compras", "fundacao"],
    titulo: "CNPJ dos fornecedores a partir das notas",
    itens: [
      "Cada nota com CNPJ (Painel do ICMS, recebimento ou XML guardado) já se liga sozinha ao fornecedor que tem aquele CNPJ.",
      "Quando o cadastro ainda não tem o CNPJ, ele aparece em \"CNPJ a conferir\", no topo de Fornecedores: grave no fornecedor certo, cadastre o fornecedor novo ou diga qual fornecedor já cadastrado é.",
      "CNPJ que já é de outro fornecedor aparece como possível duplicado, para marcar e unificar depois.",
    ],
  },
  {
    id: "2026-10-11-busca-por-sentido",
    data: "2026-10-11",
    area: "Plataforma",
    funcionalidades: DOCUMENTOS,
    modulos: ["financeiro", "fiscal", "compras", "almoxarifado", "comercial", "fundicao", "producao"],
    titulo: "Busca pelo sentido",
    itens: [
      "A busca de documentos entende o que você quis dizer, não só as palavras: \"conserto da fornalha\" acha o contrato de manutenção dos fornos, e \"conta de luz\" acha o extrato com a energia elétrica.",
      "Esses resultados aparecem depois dos que têm as palavras exatas, marcados como \"Pelo sentido\". Tudo é feito no servidor da PecSil: nenhum documento sai da empresa.",
    ],
  },
  {
    id: "2026-10-11-busca-nos-documentos",
    data: "2026-10-11",
    area: "Plataforma",
    funcionalidades: DOCUMENTOS,
    modulos: ["financeiro", "fiscal", "compras", "almoxarifado", "comercial", "fundicao", "producao"],
    titulo: "Busca dentro dos documentos",
    itens: [
      "A busca de Documentos e a Busca Corporativa procuram no que está escrito dentro dos arquivos, não só no nome: \"manutenção forno\" acha o contrato, mesmo que o arquivo se chame \"documento final\".",
      "Acha variações e palavras sem acento (\"fornos\", \"manutencao\"), aceita \"frase entre aspas\" e -palavra para excluir, e tolera erro de digitação. O trecho achado aparece com a palavra destacada.",
      "Cada pessoa só acha os documentos que pode abrir.",
    ],
  },
  {
    id: "2026-10-11-documentos-ligados",
    data: "2026-10-11",
    area: "Plataforma",
    funcionalidades: [...DOCUMENTOS, "compras.fornecedores", "fundacao.cadastros", "comercial.clientes"],
    modulos: ["financeiro", "fiscal", "compras", "almoxarifado", "comercial", "fundicao", "producao"],
    titulo: "Documentos ligados à nota, ao fornecedor e à cotação",
    itens: [
      "Cada documento guardado é ligado sozinho ao que ele cita: a nota fiscal pela chave de acesso, o fornecedor pelo CNPJ, e, pela nota, a cotação e a conta a pagar.",
      "Os documentos ligados aparecem na nota do Painel do ICMS, no recebimento, na cotação/ordem de compra, no painel do fornecedor (aba Documentos) e no cadastro de fornecedores e clientes.",
      "Quando o documento só cita um número de cotação ou de OS, a ligação aparece como \"a confirmar\": você confirma ou descarta. Cada pessoa só vê ligação para o que pode abrir.",
    ],
  },
  {
    id: "2026-10-11-leitura-documentos",
    data: "2026-10-11",
    area: "Plataforma",
    funcionalidades: [...DOCUMENTOS, ...COLETA],
    modulos: ["financeiro", "fiscal", "compras", "almoxarifado", "comercial", "fundicao", "producao"],
    titulo: "A plataforma lê o conteúdo dos documentos",
    itens: [
      "Na coleta, o conteúdo de PDF, Word, Excel e XML é lido no próprio computador antes da conferência: uma nota com nome genérico é reconhecida pela chave de acesso, e um holerite escondido fica barrado como documento do RH. O texto não sai do computador.",
      "Os documentos guardados têm o texto lido, inclusive os antigos. PDF escaneado e foto passam por leitura de imagem (OCR) no servidor da PecSil, sem sair da empresa.",
      "Em Documentos, cada arquivo mostra se já foi lido. É a base para ligar cada documento ao fornecedor, à nota e à ordem de compra (próxima etapa).",
    ],
  },
  {
    id: "2026-10-10-coleta-por-modulo",
    data: "2026-10-10",
    area: "Plataforma",
    funcionalidades: COLETA,
    modulos: ["financeiro", "fiscal", "compras", "almoxarifado", "comercial", "fundicao", "producao"],
    titulo: "Coletar arquivos dentro de cada módulo",
    itens: [
      "Cada módulo ganhou \"Coletar arquivos\" no menu, para quem o proprietário escolher nos acessos daquele módulo. No Chrome ou no Edge, você concede acesso a uma pasta e encontra extratos, notas, contratos e planilhas esquecidos.",
      "Tudo o que você aprovar fica guardado nos documentos do módulo em que você está coletando. Arquivo que parece de outro setor aparece desmarcado, com aviso. Nada sobe antes de você conferir; ficam de fora pastas de sistema, fotos, vídeos, documentos de colaborador e arquivos pessoais.",
      "O que já está na plataforma é reconhecido e pulado. Cada acesso fica registrado: quem aceitou, quando, o computador e a pasta.",
    ],
  },
  {
    id: "2026-10-10-documentos-setor",
    data: "2026-10-10",
    area: "Plataforma",
    funcionalidades: DOCUMENTOS,
    modulos: ["financeiro", "fiscal", "compras", "almoxarifado", "comercial", "fundicao", "producao"],
    titulo: "Documentos de cada setor guardados na plataforma",
    itens: [
      "Nova tela Fundação › Documentos: cada setor guarda seus arquivos na plataforma, visíveis só para quem tem acesso àquele setor.",
      "Extratos bancários e notas fiscais lançados passam a guardar o arquivo original, ligado ao lançamento de onde vieram.",
      "Dá para enviar documento à mão, baixar, guardar uma nova versão (o histórico fica) e arquivar. O mesmo arquivo não é guardado duas vezes no setor.",
    ],
  },
  {
    id: "2026-10-10-sugestoes-ia",
    data: "2026-10-10",
    area: "Fundação",
    funcionalidades: ["fundacao.sugestoes"],
    modulos: ["fundacao"],
    titulo: "Sugestões da IA: a base para conferir o que o modelo sugere",
    itens: [
      "Nova tela Fundação › Sugestões da IA: o que o modelo de decisão (Clef) sugerir aparece em azul, com a confiança, para alguém aceitar, recusar ou corrigir. A IA só sugere; quem decide é a pessoa.",
      "Antes de qualquer texto sair para o modelo, um filtro procura CPF, PIS, e-mail, telefone e dado de saúde. Se achar, nada é enviado e o bloqueio fica registrado.",
      "Nenhum uso está ligado ainda: cada um é ligado pelo proprietário só depois de uma simulação conferida.",
    ],
  },
  {
    id: "2026-10-09-fundicao-pedidos",
    data: "2026-10-09",
    area: "Fundição",
    modulos: ["fundicao"],
    titulo: "Peça material ao Compras pelo seu painel",
    itens: [
      "Use Pedir material para mandar ao Compras o que a Fundição precisa: itens, quantidade, urgência e observação. O pedido vai com o seu nome.",
      "Cada pedido mostra o andamento: com o Compras, aprovado, comprado e recebido. Você é avisado no sino a cada passo, inclusive quando o material chega no Almoxarifado.",
    ],
  },
  {
    id: "2026-10-09-compras-pedidos-por-divisao",
    data: "2026-10-09",
    area: "Compras",
    modulos: ["compras", "almoxarifado"],
    titulo: "Pedidos de material separados por Usinagem e Fundição",
    itens: [
      "A aba Pedidos do Almoxarifado agora se chama Pedidos de material e tem as abas Usinagem e Fundição, como as cotações.",
      "A Fundição também pede material pelo painel dela: cada cartão mostra de onde veio, Almoxarifado ou Fundição, e quem pediu.",
      "No Almoxarifado, o material comprado para a Fundição aparece em A caminho com \"para a Fundição\" e o nome de quem pediu.",
    ],
  },
  {
    id: "2026-10-09-ordem-de-compra",
    data: "2026-10-09",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Ordem de compra em PDF depois da aprovação",
    itens: [
      "Cotação aprovada ganha o botão Ordem de compra: abre o documento no modelo da PecSil (logo, dados do fornecedor, materiais, ICMS, IPI e totais) para baixar em PDF e mandar ao fornecedor.",
      "O número da ordem de compra é o da cotação, e só os itens aprovados entram.",
      "Na cotação, o novo bloco Entrega e frete guarda frete (CIF, FOB ou sem frete), valor do frete, seguro, outras despesas, prazo de entrega e a observação para o fornecedor; o Ricardo aprova vendo o total do pedido.",
      "No cadastro de fornecedores entrou o CEP, que também sai na ordem de compra.",
    ],
  },
  {
    id: "2026-10-09-arrastar-nota",
    data: "2026-10-09",
    area: "Fiscal e Almoxarifado",
    modulos: ["fiscal", "almoxarifado"],
    titulo: "Arraste a nota para ler",
    itens: [
      "Na Nova nota do Painel do ICMS e no recebimento do Almoxarifado, basta arrastar o XML ou o PDF da nota até o quadro tracejado; clicar continua funcionando.",
      "O CNPJ do fornecedor lido da nota agora aparece no formulário, no resumo do recebimento e em cada linha do Painel do ICMS.",
    ],
  },
  {
    id: "2026-10-09-danfe-mais-modelos",
    data: "2026-10-09",
    area: "Fiscal e Almoxarifado",
    modulos: ["fiscal", "almoxarifado"],
    titulo: "DANFE em PDF: mais modelos de nota lidos",
    itens: [
      "A leitura do PDF agora entende os modelos de DANFE com nomes abreviados (como \"V. TOTAL DA NOTA\"), trazendo base e valor do ICMS, IPI e totais.",
      "As duplicatas da nota (vencimentos e valores) vêm preenchidas no recebimento quando a soma delas fecha com o total da nota; se não fechar, ficam para digitar.",
    ],
  },
  {
    id: "2026-10-08-notas-xml-pdf",
    data: "2026-10-08",
    area: "Fiscal e Almoxarifado",
    modulos: ["fiscal", "almoxarifado"],
    titulo: "Notas fiscais: envie o XML ou o PDF",
    itens: [
      "No Painel do ICMS, o botão Enviar notas aceita vários XML e DANFEs em PDF de uma vez: a plataforma lê, reconhece o fornecedor e mostra o que vai lançar antes de gravar.",
      "Nota que já está no painel não entra de novo, e o mesmo XML e PDF da mesma nota contam uma vez só.",
      "No Almoxarifado, o botão Enviar nota acha o pedido a caminho daquele fornecedor e abre o recebimento já preenchido.",
      "Quando a nota vem do PDF, os valores aparecem para conferência. Se o fornecedor do cadastro ainda não tem CNPJ, ele passa a ter o da nota.",
    ],
  },
  {
    id: "2026-10-08-financeiro-enviar-extrato",
    data: "2026-10-08",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Enviar extrato direto na plataforma",
    itens: [
      "Em Bancos e conciliação, o botão Enviar extrato aceita o OFX de qualquer banco, a planilha do Santander e o PDF do Itaú.",
      "A plataforma descobre o banco e a conta, confere os saldos de cada dia e mostra o que vai fazer antes de gravar: quantos lançamentos são novos, quantos já se conciliam sozinhos e quantos ficam para revisar.",
      "Mandar o mesmo arquivo de novo não duplica nada: ela avisa que o arquivo já foi enviado e grava só o que for novo.",
    ],
  },
  {
    id: "2026-10-06-financeiro-bancos-conciliacao",
    data: "2026-10-06",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Bancos e conciliação com o extrato do Itaú",
    itens: [
      "A aba Bancos e conciliação agora mostra o saldo real da conta e todos os lançamentos do extrato do banco.",
      "Cada lançamento aparece como A conciliar, Conciliado ou Ignorado. Os que já têm pagamento registrado foram ligados sozinhos quando a data e o valor batem.",
      "Em cada pendência: Conciliar (escolhe o pagamento certo entre as sugestões), Criar conta (para tarifas, tributos, folha e o que ainda não foi lançado), Ignorar ou Desfazer.",
      "Nada é ligado sem a sua confirmação. Transferências entre contas da empresa e antecipação de recebíveis ficam à parte e não entram como receita.",
    ],
  },
  {
    id: "2026-10-02-financeiro-historico-a-revisar",
    data: "2026-10-02",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Contas a pagar enxuto e Histórico a revisar",
    itens: [
      "O que foi pago antes de 2026 e não é parcelamento saiu das telas e dos totais. Fica guardado e pode voltar.",
      "Nova aba Histórico a revisar: cada parcelamento ou financiamento vindo do sistema antigo aparece com o início, as parcelas pagas e as que faltam.",
      "Em cada um: Aprovar (sobe para o Contas a pagar), Editar (corrige fornecedor, conta e parcelas) ou Excluir (tira do Financeiro).",
      "Novo filtro de data no Contas a pagar e no Contas a receber: escolha um dia e veja o que vence nele (ou, na aba Pagas/Recebidas, o que foi pago ou recebido naquele dia).",
    ],
  },
  {
    id: "2026-10-01-almoxarifado",
    data: "2026-10-01",
    area: "Almoxarifado",
    modulos: ["almoxarifado"],
    titulo: "Novo módulo Almoxarifado",
    itens: [
      "Peça o material que está faltando direto ao Compras, com urgência quando for o caso. Você acompanha cada passo: em cotação, aprovado, comprado.",
      "Em A caminho ficam as compras já avisadas. Quando o material chegar, clique em Receber, anexe o XML da nota (ou digite) e confira os itens.",
      "Ao confirmar, a nota vira conta a pagar para o Financeiro, com os vencimentos certos, e entra no Painel do ICMS. Sem planilha.",
    ],
  },
  {
    id: "2026-10-01-fiscal-icms",
    data: "2026-10-01",
    area: "Fiscal",
    modulos: ["fiscal"],
    titulo: "Painel do ICMS",
    itens: [
      "As notas de entrada do mês com crédito de ICMS e IPI, por centro (Fundição, Usinagem, Administrativo), no lugar da planilha.",
      "As notas recebidas no Almoxarifado entram sozinhas. As do administrativo e de terceiros entram em Nova nota, com o XML ou digitadas.",
      "Marque XML, lançamento e autorização em um clique, e registre o livro de apuração do mês.",
    ],
  },
  {
    id: "2026-10-01-compras-pedidos-almoxarifado",
    data: "2026-10-01",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Pedidos do Almoxarifado no Compras",
    itens: [
      "Nova aba Pedidos do Almoxarifado: o material que está faltando chega aqui, e Cotar abre a cotação já com os itens.",
      "O Comprar virou Aviso de compra: a nota fiscal não é mais exigida nessa hora, o Almoxarifado lança quando o material chegar.",
      "Ao dar o aviso de compra, o Financeiro e o Almoxarifado são avisados sozinhos.",
    ],
  },
  {
    id: "2026-10-01-avisos-no-sino",
    data: "2026-10-01",
    area: "Plataforma",
    titulo: "Avisos no sino",
    itens: [
      "O sino do topo mostra os avisos dos fluxos em que você participa, com o número de não lidos. Clique no aviso para ir direto à tela certa.",
    ],
  },
  {
    id: "2026-09-30-financeiro-historico-pagar",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Histórico de contas pagas desde 2016",
    itens: [
      "Contas a pagar recebeu o histórico do sistema antigo de 2016 em diante (fornecedores de A até BOL): mais de 10 mil títulos, quase todos já pagos, com data e valor do pagamento.",
      "Nova aba Histórico a conferir: títulos antigos que o sistema antigo ainda mostrava em aberto. Ficam fora do total a pagar, do painel e do fluxo até a equipe conferir cada um: registrar o pagamento, cancelar ou Manter em aberto.",
      "Pagamento feito com desconto aparece quitado, com o desconto registrado.",
    ],
  },
  {
    id: "2026-09-30-financeiro-painel-graficos",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Painel do Financeiro com gráficos",
    itens: [
      "Novo gráfico de pagamentos, recebimentos e resultado mês a mês, comparado com o ano anterior quando houver lançamentos.",
      "Gráfico do que está a receber e a pagar por mês de vencimento. Passe o mouse para ver o valor de cada mês.",
      "Comparação do mês atual com o anterior, com a variação em porcentagem.",
      "O anel de A receber e a pagar foi redesenhado e o saldo agora cabe dentro dele.",
      "Ações que exigem atenção agora ficam abaixo dos gráficos.",
      "As seções do Financeiro (Contas a pagar, Plano de contas, Relatórios…) também aparecem no menu lateral, abaixo de Financeiro.",
      "A aba Plano de contas aparece para todos do Financeiro, para consulta. Incluir, editar, mover e excluir contas continua com quem tem a permissão Plano de contas.",
      "O painel e o relatório de gasto por conta abrem rápido com todos os títulos carregados, e o relatório mostra o ano inteiro.",
    ],
  },
  {
    id: "2026-09-30-financeiro-contas-a-pagar",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Contas a pagar, fluxo de caixa e gasto por conta",
    itens: [
      "Contas a pagar por fornecedor, com as abas A pagar, Previsões e Pagas (por mês). Filtros de situação, mês de vencimento e fornecedor.",
      "Registrar pagamento ou recebimento com data e valor: aceita baixa parcial, e o que passar do valor entra como juros ou tarifa.",
      "Fluxo de caixa do ano, mês a mês: o que já entrou e saiu, o que está em aberto e as previsões à parte.",
      "Novo relatório Gasto por conta do plano: custos, despesas e investimentos por mês, pelo rateio de cada título.",
      "Todo título a pagar pode ser editado por quem opera e excluído por quem aprova.",
    ],
  },
  {
    id: "2026-09-30-financeiro-contas-a-receber",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Contas a receber por cliente, com previsão separada",
    itens: [
      "Contas a receber agrupado por cliente, com total em aberto, vencido e a vencer de cada grupo.",
      "Duas abas: A receber (nota emitida) e Previsões (orçamento sem nota ou duplicata já antecipada). Previsão não entra no total, no painel nem no fluxo de caixa.",
      "Busca por cliente, documento, histórico ou conta; filtros de situação e de grupo.",
      "Cada título abre com histórico, observação e a conta do plano (ou o rateio, quando são duas contas). Quem tem permissão confirma o recebimento ou cancela o título ali mesmo.",
      "Todo título pode ser editado (cliente, valor, vencimento, conta, observação, previsão) por quem opera, e excluído por quem aprova.",
      "A situação Vencido sai da data de vencimento, sem precisar ajustar à mão.",
    ],
  },
  {
    id: "2026-09-30-financeiro-plano-de-contas",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Plano de contas",
    itens: [
      "Nova seção Plano de contas no Financeiro, com as 318 contas do sistema atual e os mesmos códigos.",
      "Busca por código ou nome, grupos que abrem e fecham e o tipo de cada conta (receita, custo, despesa, investimento, repasse).",
      "Quem tem permissão inclui, edita, inativa e exclui contas.",
      "Para realocar, segure a conta e arraste até o grupo: ela assume o próximo código daquele grupo, e as outras contas não mudam.",
    ],
  },
  {
    id: "2026-09-29-janelas-centrais",
    data: "2026-09-29",
    area: "Plataforma",
    titulo: "Janelas que não fecham sozinhas",
    itens: [
      "Fichas, detalhes e cadastros (RH, Financeiro, Compras, Portaria e demais) abrem no centro da tela.",
      "Clicar fora da janela não fecha mais: nada do que está sendo digitado se perde. Para fechar, use o X, Cancelar ou a tecla Esc.",
    ],
  },
  {
    id: "2026-09-29-rh-sst-validade",
    data: "2026-09-29",
    area: "RH",
    modulos: ["rh"],
    titulo: "Exames e treinamentos mudam de situação sozinhos",
    itens: [
      "A situação de ASOs e treinamentos agora sai da data de vencimento, sem precisar ajustar à mão.",
      "Vence em até 60 dias: A vencer · Atenção (mostra quantos dias faltam). Vencido: Crítico. Mais de 60 dias: Conforme · Regular.",
      "Para renovar, use \"Registrar nova validade\" no registro e informe a nova data.",
    ],
  },
  {
    id: "2026-09-29-portaria-facial",
    data: "2026-09-29",
    area: "Portaria",
    modulos: ["portaria"],
    titulo: "Reconhecimento facial corrigido",
    itens: [
      "Buscar Visitante (Auto-preencher) volta a reconhecer a pessoa da foto e preenche nome, empresa, documento e contato.",
      "Quando o rosto parece com mais de uma pessoa, a tela pergunta \"É uma destas?\" para você escolher.",
      "A foto tirada só para buscar não é mais guardada; só a foto de cadastro de quem vem pela primeira vez.",
    ],
  },
  {
    id: "2026-09-29-novidades",
    data: "2026-09-29",
    area: "Plataforma",
    titulo: "O que mudou, a cada atualização",
    itens: [
      "Ao clicar em Atualizar, esta janela mostra o que a nova versão traz antes de recarregar.",
    ],
  },
  {
    id: "2026-09-29-sugestoes",
    data: "2026-09-29",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Sugestões ao digitar fornecedor e produto",
    itens: [
      "Na cotação, a partir da 2ª letra o campo Fornecedor sugere os fornecedores cadastrados; nomes antigos já unificados levam ao nome certo.",
      "O campo Produto sugere as descrições do histórico, na grafia mais usada, com o último preço pago; os produtos que já vieram do fornecedor aparecem primeiro.",
      "Escolher o produto também preenche a unidade.",
      "Em Novo fornecedor, quem já existe aparece na lista e abre o cadastro, sem duplicar.",
    ],
  },
  {
    id: "2026-09-29-fornecedores",
    data: "2026-09-29",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Fornecedores: cadastro e histórico de compras",
    itens: [
      "Nova aba Fornecedores dentro de Compras (também no menu lateral), com total comprado, compras, cotações e última compra de cada fornecedor.",
      "Em cada fornecedor: as compras com NF, as cotações, o preço pago em cada produto ao longo do tempo e o cadastro completo (contato, endereço, prazo de pagamento).",
      "Nomes escritos de jeitos diferentes aparecem como possíveis duplicados, para unificar em um clique.",
    ],
  },
  {
    id: "2026-09-29-compras-oficial",
    data: "2026-09-29",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Compras oficial na plataforma",
    itens: [
      "Todas as cotações e compras do app antigo foram trazidas para cá; o Compras oficial agora é este.",
      "O valor unitário aceita 3 casas decimais (ex.: 17,905).",
      "Diretores veem a tela de Gestor; gerentes, assistentes e estagiários, a de Orçamentista.",
      "Aprovar aparece em verde e rejeitar em vermelho, e o sino de avisos voltou a aparecer.",
    ],
  },
  {
    id: "2026-09-28-visual",
    data: "2026-09-28",
    area: "Plataforma",
    titulo: "Visual",
    itens: [
      "A aba selecionada fica destacada em azul em todos os módulos.",
      "A Portaria acompanha o modo escuro.",
      "Logos novas para o modo claro e o modo escuro.",
    ],
  },
];

/** O que a versão nova traz que esta versão aberta ainda não tem. */
export function novidadesNovas(doServidor: readonly Novidade[], conhecidas: readonly Novidade[]): Novidade[] {
  const ids = new Set(conhecidas.map((n) => n.id));
  return doServidor.filter((n) => !ids.has(n.id));
}

export type AcessoNovidades = { isOwner: boolean; grants: AccessGrants };

/** Só o que interessa a esta pessoa: das funcionalidades e dos módulos a que ela tem acesso. */
export function novidadesPara(lista: readonly Novidade[], acesso: AcessoNovidades): Novidade[] {
  return lista.filter((n) => {
    if (n.funcionalidades?.length) return n.funcionalidades.some((f) => hasFeature(acesso, f));
    if (n.modulos?.length) return n.modulos.some((m) => hasModuleAccess(acesso, m));
    return true;
  });
}
