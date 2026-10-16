"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, EscolherArquivo, Status } from "../../../packages/design-system";
import { api, cnpjFormatado, dataHora } from "./comum";

/**
 * Fiscal › Configuração. Os dados da empresa que emite (o emitente é dado da organização, nunca
 * fixo no código), o certificado digital A1 (o proprietário ou quem tem "Certificado digital"; o
 * arquivo e a senha vão para o cofre e ninguém os lê), o ambiente, a série e a numeração, e a busca das notas recebidas na SEFAZ.
 */

type Config = Record<string, string | number | boolean | null> & {
  ambiente: "homologacao" | "producao"; dfe_ativo: boolean; ciencia_automatica: boolean;
  cert_titular: string | null; cert_cnpj: string | null; cert_validade: string | null; cert_enviado_por_nome: string | null; cert_enviado_em: string | null;
};
type Dados = { config: Config | null; series: { serie: number; proximo_numero: number }[]; podeEditar: boolean; podeProducao: boolean; podeCertificado: boolean; transmissor: boolean; carregadoEm: number };

const EMITENTE: { campo: string; rotulo: string; largo?: boolean; max?: number; ajuda?: string }[] = [
  { campo: "razao_social", rotulo: "Razão social", largo: true, max: 60 },
  { campo: "nome_fantasia", rotulo: "Nome fantasia", max: 60 },
  { campo: "cnpj", rotulo: "CNPJ" },
  { campo: "ie", rotulo: "Inscrição estadual", ajuda: "Só números, ou ISENTO" },
  { campo: "im", rotulo: "Inscrição municipal", max: 15 },
  { campo: "cnae", rotulo: "CNAE principal", ajuda: "7 dígitos" },
  { campo: "logradouro", rotulo: "Logradouro", largo: true, max: 60 },
  { campo: "numero", rotulo: "Número", max: 60 },
  { campo: "complemento", rotulo: "Complemento", max: 60 },
  { campo: "bairro", rotulo: "Bairro", max: 60 },
  { campo: "municipio", rotulo: "Município", max: 60 },
  { campo: "codigo_municipio", rotulo: "Código IBGE do município", ajuda: "7 dígitos" },
  { campo: "uf", rotulo: "UF", max: 2 },
  { campo: "cep", rotulo: "CEP" },
  { campo: "telefone", rotulo: "Telefone" },
  { campo: "email", rotulo: "E-mail fiscal", max: 60 },
];
/** O que sai nos documentos para fornecedores (Ordem de Compra), além do emitente. */
const DOCUMENTOS: { campo: string; rotulo: string; max: number; ajuda?: string }[] = [
  { campo: "doc_telefones", rotulo: "Telefones", max: 120, ajuda: "como devem sair impressos" },
  { campo: "doc_site", rotulo: "Site", max: 120 },
  { campo: "doc_email_nfe", rotulo: "E-mail para receber NF-e e XML", max: 120 },
];
const CRT = [["", "—"], ["1", "1 · Simples Nacional"], ["2", "2 · Simples Nacional, excesso de sublimite"], ["3", "3 · Regime normal"], ["4", "4 · MEI"]];

const diasAte = (iso: string | null, agora: number) => (iso ? Math.floor((new Date(iso).getTime() - agora) / 86_400_000) : null);

export function ConfiguracaoFiscal({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await api<Omit<Dados, "carregadoEm">>("/api/fiscal/config");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados({ ...r.data, carregadoEm: Date.now() });
    const c = r.data.config ?? ({} as Config);
    const serie = Number(c.serie_padrao ?? 1);
    const valores: Record<string, string> = {};
    for (const { campo } of EMITENTE) valores[campo] = c[campo] == null ? "" : String(c[campo]);
    for (const { campo } of DOCUMENTOS) valores[campo] = c[campo] == null ? "" : String(c[campo]);
    valores.doc_notas_ordem_compra = c.doc_notas_ordem_compra == null ? "" : String(c.doc_notas_ordem_compra);
    valores.crt = c.crt == null ? "" : String(c.crt);
    valores.serie_padrao = String(serie);
    valores.proximo_numero = String(r.data.series.find((s) => s.serie === serie)?.proximo_numero ?? "");
    setF(valores);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const c = dados?.config;
  const pode = Boolean(dados?.podeEditar);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const gravar = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado("gravar");
    const r = await api("/api/fiscal/config", { method: "PATCH", body: JSON.stringify(corpo) });
    setOcupado(null);
    notify(r.ok ? ok : r.error);
    if (r.ok) void carregar();
    return r.ok;
  };

  const salvarEmitente = (event: React.FormEvent) => {
    event.preventDefault();
    const corpo: Record<string, unknown> = { crt: f.crt };
    for (const { campo } of EMITENTE) corpo[campo] = f[campo] ?? "";
    void gravar(corpo, "Dados do emitente gravados.");
  };

  const salvarEmissao = (event: React.FormEvent) => {
    event.preventDefault();
    void gravar({ serie_padrao: f.serie_padrao, ...(f.proximo_numero ? { proximo_numero: f.proximo_numero } : {}) }, "Série e numeração gravadas.");
  };

  const salvarDocumentos = (event: React.FormEvent) => {
    event.preventDefault();
    const corpo: Record<string, unknown> = { doc_notas_ordem_compra: f.doc_notas_ordem_compra ?? "" };
    for (const { campo } of DOCUMENTOS) corpo[campo] = f[campo] ?? "";
    void gravar(corpo, "Dados dos documentos para fornecedores gravados.");
  };

  const buscarNaSefaz = async () => {
    setOcupado("sefaz");
    const r = await api<{ cadastro: Record<string, string | null> }>("/api/fiscal/config/sefaz", { method: "POST", body: JSON.stringify({ acao: "cadastro", cnpj: f.cnpj, uf: f.uf }) });
    setOcupado(null);
    if (!r.ok) { notify(r.error); return; }
    const cad = r.data.cadastro;
    setF((x) => {
      const novo = { ...x };
      for (const k of ["razao_social", "nome_fantasia", "ie", "cnae", "logradouro", "numero", "complemento", "bairro", "municipio", "codigo_municipio", "cep"]) {
        if (cad[k]) novo[k] = String(cad[k]);
      }
      return novo;
    });
    notify(`Dados da SEFAZ preenchidos${cad.situacao === "nao_habilitado" ? " (atenção: contribuinte NÃO habilitado)" : ""}. Confira e grave.`);
  };

  const testar = async () => {
    setOcupado("testar");
    const r = await api<{ cStat: string | null; motivo: string | null; ambiente: string }>("/api/fiscal/config/sefaz", { method: "POST", body: JSON.stringify({ acao: "status" }) });
    setOcupado(null);
    notify(r.ok ? `SEFAZ (${r.data.ambiente === "producao" ? "produção" : "homologação"}): ${r.data.cStat ?? ""} · ${r.data.motivo ?? "sem resposta"}` : r.error);
  };

  if (erro) return <div className="finance-empty almox-vazio"><b>{erro}</b></div>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;
  const dias = diasAte(c?.cert_validade ?? null, dados.carregadoEm);
  const temCert = Boolean(c?.cert_validade);

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · CONFIGURAÇÃO</p><h1>Configuração fiscal</h1><p>Dados da empresa que emite as notas, o certificado digital, a numeração e a busca das notas recebidas na SEFAZ.</p></div>
      </div>

      {!dados.transmissor && <Callout variant="warning" title="Transmissor ainda não instalado">Os dados podem ser preenchidos já. Enviar o certificado e falar com a SEFAZ dependem do transmissor de NF-e no servidor (instruções em docs/FISCAL-NFE.md).</Callout>}
      {!pode && <Callout variant="info" title="Só leitura">Alterar a configuração fiscal é de quem opera a Configuração do Fiscal.</Callout>}

      <section className="almox-bloco fiscal-config-bloco">
        <header><h2>Certificado digital (A1)</h2>{temCert ? (dias !== null && dias < 30 ? <Status tone="danger">Vence em {Math.max(dias, 0)} dia(s)</Status> : <Status tone="success">Válido</Status>) : <Status tone="attention">Não enviado</Status>}</header>
        {temCert ? (
          <dl className="fiscal-cert">
            <div><dt>Titular</dt><dd>{c?.cert_titular ?? "—"}</dd></div>
            <div><dt>CNPJ</dt><dd>{cnpjFormatado(c?.cert_cnpj)}</dd></div>
            <div><dt>Válido até</dt><dd>{dataHora(c?.cert_validade ?? null)}</dd></div>
            <div><dt>Enviado</dt><dd>{c?.cert_enviado_por_nome ?? "—"} · {dataHora(c?.cert_enviado_em ?? null)}</dd></div>
          </dl>
        ) : <p className="fiscal-nota-ajuda">Sem certificado, a plataforma não emite notas nem recebe as notas da SEFAZ. É o arquivo .pfx do e-CNPJ A1 da empresa (o A3, em cartão ou token, não serve para o servidor).</p>}
        {dados.podeCertificado
          ? <EnviarCertificado temCert={temCert} transmissor={dados.transmissor} notify={notify} onMudou={() => void carregar()} />
          : <p className="fiscal-nota-ajuda">Enviar ou trocar o certificado é do proprietário ou de quem ele autorizar (Certificado digital, em Pessoas e Acessos). O arquivo e a senha ficam guardados cifrados e ninguém os lê pela plataforma.</p>}
        {dados.podeCertificado && <p className="fiscal-nota-ajuda">Cada envio, troca ou remoção fica registrado na auditoria e avisa o proprietário. O arquivo e a senha nunca aparecem para ninguém, nem para quem enviou.</p>}
      </section>

      <form className="almox-bloco fiscal-config-bloco" onSubmit={salvarEmitente}>
        <header><h2>Emitente</h2>{pode && dados.transmissor && temCert && <Button type="button" variant="secondary" compact onClick={() => void buscarNaSefaz()} disabled={ocupado === "sefaz" || f.cnpj?.replace(/\D/g, "").length !== 14 || (f.uf ?? "").length !== 2}>{ocupado === "sefaz" ? "Consultando…" : "Buscar na SEFAZ pelo CNPJ"}</Button>}</header>
        <div className="fiscal-campos">
          {EMITENTE.map(({ campo, rotulo, largo, max, ajuda }) => (
            <label key={campo} className={largo ? "fiscal-largo" : undefined}>
              <span>{rotulo}{ajuda ? <small> · {ajuda}</small> : null}</span>
              <input value={f[campo] ?? ""} onChange={(e) => set(campo, campo === "uf" ? e.target.value.toUpperCase() : e.target.value)} maxLength={max} disabled={!pode} />
            </label>
          ))}
          <label className="fiscal-largo">
            <span>Regime tributário (CRT)</span>
            <select value={f.crt ?? ""} onChange={(e) => set("crt", e.target.value)} disabled={!pode}>{CRT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        {pode && <footer><Button type="submit" disabled={ocupado === "gravar"}>{ocupado === "gravar" ? "Gravando…" : "Gravar emitente"}</Button></footer>}
      </form>

      <form className="almox-bloco fiscal-config-bloco" onSubmit={salvarDocumentos}>
        <header><h2>Documentos para fornecedores</h2></header>
        <p className="fiscal-nota-ajuda">O cabeçalho da Ordem de Compra usa o emitente acima (razão social, endereço, CNPJ e IE) e estes dados. As notas saem no rodapé, uma por linha; o trecho entre **asteriscos duplos** sai em negrito.</p>
        <div className="fiscal-campos">
          {DOCUMENTOS.map(({ campo, rotulo, max, ajuda }) => (
            <label key={campo}>
              <span>{rotulo}{ajuda ? <small> · {ajuda}</small> : null}</span>
              <input value={f[campo] ?? ""} onChange={(e) => set(campo, e.target.value)} maxLength={max} disabled={!pode} />
            </label>
          ))}
          <label className="fiscal-inteiro">
            <span>Notas da Ordem de Compra<small> · uma por linha</small></span>
            <textarea rows={5} value={f.doc_notas_ordem_compra ?? ""} onChange={(e) => set("doc_notas_ordem_compra", e.target.value)} maxLength={3000} disabled={!pode} />
          </label>
        </div>
        {pode && <footer><Button type="submit" disabled={ocupado === "gravar"}>Gravar documentos</Button></footer>}
      </form>

      <form className="almox-bloco fiscal-config-bloco" onSubmit={salvarEmissao}>
        <header><h2>Emissão</h2><Status tone={c?.ambiente === "producao" ? "danger" : "info"}>{c?.ambiente === "producao" ? "Produção" : "Homologação (sem valor fiscal)"}</Status></header>
        <p className="fiscal-nota-ajuda">A emissão começa sempre em homologação, o ambiente de teste da SEFAZ. Passar para produção é decisão de quem aprova NF-e no Fiscal, depois de conferidas as regras fiscais.</p>
        <div className="fiscal-campos">
          <label><span>Série padrão</span><input inputMode="numeric" value={f.serie_padrao ?? ""} onChange={(e) => set("serie_padrao", e.target.value.replace(/\D/g, "").slice(0, 3))} disabled={!pode} /></label>
          <label><span>Próximo número<small> · para continuar a numeração do sistema anterior</small></span><input inputMode="numeric" value={f.proximo_numero ?? ""} onChange={(e) => set("proximo_numero", e.target.value.replace(/\D/g, "").slice(0, 9))} disabled={!pode} /></label>
        </div>
        {pode && <footer><Button type="submit" disabled={ocupado === "gravar"}>Gravar série e numeração</Button></footer>}
      </form>

      <section className="almox-bloco fiscal-config-bloco">
        <header><h2>Notas recebidas (SEFAZ)</h2>{c?.dfe_ativo ? <Status tone="success">Busca ligada</Status> : <Status tone="neutral">Busca desligada</Status>}</header>
        <label className="fiscal-chave">
          <input type="checkbox" checked={Boolean(c?.dfe_ativo)} disabled={!pode || !temCert || ocupado === "gravar"} onChange={(e) => void gravar({ dfe_ativo: e.target.checked }, e.target.checked ? "Busca automática ligada." : "Busca automática desligada.")} />
          <span><b>Buscar sozinho as notas emitidas contra o CNPJ da empresa</b><small>A cada rodada, respeitando a regra da SEFAZ (sem nota nova, só consulta de novo depois de 1 hora).{!temCert ? " Precisa do certificado." : ""}</small></span>
        </label>
        <label className="fiscal-chave">
          <input type="checkbox" checked={Boolean(c?.ciencia_automatica)} disabled={!pode || ocupado === "gravar"} onChange={(e) => void gravar({ ciencia_automatica: e.target.checked }, e.target.checked ? "Ciência automática ligada." : "Ciência automática desligada.")} />
          <span><b>Dar ciência da operação sozinho</b><small>A SEFAZ só entrega o XML completo depois da ciência, que é um evento informativo: não confirma nem recusa a compra. Desligado, a ciência é dada nota a nota em Notas recebidas.</small></span>
        </label>
        {pode && dados.transmissor && temCert && <footer><Button type="button" variant="secondary" onClick={() => void testar()} disabled={ocupado === "testar"}>{ocupado === "testar" ? "Testando…" : "Testar conexão com a SEFAZ"}</Button></footer>}
      </section>
    </div>
  );
}

function EnviarCertificado({ temCert, transmissor, notify, onMudou }: { temCert: boolean; transmissor: boolean; notify: (m: string) => void; onMudou: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState("");

  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!arquivo || !senha) return;
    setEnviando(true); setErro("");
    const corpo = new FormData();
    corpo.append("arquivo", arquivo);
    corpo.append("senha", senha);
    const r = await api<{ titular: string; validade: string }>("/api/fiscal/config/certificado", { method: "POST", body: corpo });
    setEnviando(false);
    setSenha("");
    if (!r.ok) { setErro(r.error); return; }
    setArquivo(null);
    notify(`Certificado de ${r.data.titular} guardado (válido até ${dataHora(r.data.validade).slice(0, 10)}).`);
    onMudou();
  };

  const remover = async () => {
    setEnviando(true);
    const r = await api("/api/fiscal/config/certificado", { method: "DELETE" });
    setEnviando(false); setRemovendo(false);
    notify(r.ok ? "Certificado removido do cofre. A busca na SEFAZ foi desligada." : r.error);
    if (r.ok) onMudou();
  };

  return (
    <form className="fiscal-cert-form" onSubmit={enviar} autoComplete="off">
      <div className="fiscal-cert-campo">
        <span>Arquivo do certificado (.pfx)</span>
        <EscolherArquivo rotulo="Escolher o certificado (.pfx)" aceita=".pfx,.p12,application/x-pkcs12" arquivo={arquivo?.name} onEscolher={(a) => setArquivo(a[0] ?? null)} desabilitado={!transmissor || enviando} />
      </div>
      <label><span>Senha do certificado</span><input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" disabled={!transmissor} /></label>
      <div className="fiscal-cert-acoes">
        <Button type="submit" disabled={!transmissor || !arquivo || !senha || enviando}>{enviando ? "Conferindo…" : temCert ? "Trocar certificado" : "Enviar certificado"}</Button>
        {temCert && (removendo
          ? <><Button type="button" className="almox-perigo-cheio" onClick={() => void remover()} disabled={enviando}>Confirmar remoção</Button><Button type="button" variant="ghost" onClick={() => setRemovendo(false)}>Cancelar</Button></>
          : <Button type="button" variant="ghost" className="almox-perigo" onClick={() => setRemovendo(true)}>Remover</Button>)}
      </div>
      {erro && <p className="almox-erro" role="alert">{erro}</p>}
    </form>
  );
}
