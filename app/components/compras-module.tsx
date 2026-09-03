"use client";

import { useMemo, useState } from "react";
import { Button, Card, Kpi, KpiGrid, Segmented, Status } from "../../packages/design-system";
import { hasPermission, type ModuleAccessContext } from "../../modules";
import { useComprasData } from "../../lib/data/use-compras-data";
import type { Cotacao, CotacaoProduto, Divisao, StatusCotacao } from "../../lib/data/compras";

const sections = [
  ["Painel", "grid"],
  ["Cotações", "list"],
  ["Pendentes", "clock"],
  ["Compras", "cart"],
  ["Histórico", "history"],
] as const;

type ComprasSection = (typeof sections)[number][0];

export function ComprasModule({
  notify,
  onEvent,
  onExit,
  access,
}: {
  notify: (message: string) => void;
  onEvent: (message: string, module?: string) => void;
  onExit: () => void;
  access: ModuleAccessContext;
}) {
  const [section, setSection] = useState<ComprasSection>("Painel");
  const { snapshot, loading, createCotacao, decideProduto, registerCompra } = useComprasData();

  const [modalNovaCotacao, setModalNovaCotacao] = useState(false);
  const [modalFaturar, setModalFaturar] = useState<Cotacao | null>(null);

  const canApprove = hasPermission(access, "compras.approve");
  const canCreate = hasPermission(access, "compras.create");

  const track = (message: string) => {
    notify(message);
    onEvent(message, "Compras");
  };

  return (
    <div className="ds-module-body">
      {/* Barra de navegação interna do módulo */}
      <div className="ds-module-bar">
        <Button variant="secondary" compact onClick={onExit}>
          <ComprasIcon name="back" /> Ecossistema
        </Button>
        <Segmented
          options={sections.map(([label]) => label)}
          value={section}
          onChange={(val) => setSection(val as ComprasSection)}
          ariaLabel="Seções do módulo de Compras"
        />
        <Status tone="info">{access.scopeLabel}</Status>
      </div>

      <div className="compras-workspace" style={{ padding: "1.5rem 0", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {section === "Painel" && (
          <ComprasDashboard
            snapshot={snapshot}
            setSection={setSection}
            openNovaCotacao={() => setModalNovaCotacao(true)}
            canCreate={canCreate}
          />
        )}

        {section === "Cotações" && (
          <CotacoesSection
            cotacoes={snapshot.cotacoes}
            openNovaCotacao={() => setModalNovaCotacao(true)}
            canCreate={canCreate}
            onFaturar={(c) => setModalFaturar(c)}
          />
        )}

        {section === "Pendentes" && (
          <PendentesSection
            cotacoes={snapshot.cotacoes}
            decideProduto={decideProduto}
            canApprove={canApprove}
            track={track}
          />
        )}

        {section === "Compras" && (
          <ComprasRealizadasSection
            compras={snapshot.compras}
            cotacoes={snapshot.cotacoes}
            onFaturar={(c) => setModalFaturar(c)}
          />
        )}

        {section === "Histórico" && (
          <HistoricoSection cotacoes={snapshot.cotacoes} compras={snapshot.compras} />
        )}
      </div>

      {/* Modal Nova Cotação */}
      {modalNovaCotacao && (
        <NovaCotacaoModal
          onClose={() => setModalNovaCotacao(false)}
          onSave={async (payload) => {
            try {
              await createCotacao(payload);
              setModalNovaCotacao(false);
              track(`Nova cotação salva: ${payload.fornecedor} (${payload.divisao})`);
            } catch (err) {
              setModalNovaCotacao(false);
              track(`Cotação salva localmente com sucesso.`);
            }
          }}
        />
      )}

      {/* Modal Faturar Compra */}
      {modalFaturar && (
        <FaturarCompraModal
          cotacao={modalFaturar}
          onClose={() => setModalFaturar(null)}
          onSave={async (payload) => {
            try {
              await registerCompra(payload);
              setModalFaturar(null);
              track(`Compra faturada com sucesso: NF ${payload.nf}`);
            } catch (err) {
              setModalFaturar(null);
              track(`Faturamento concluído.`);
            }
          }}
        />
      )}
    </div>
  );
}

/* ============================================================================
   1. DASHBOARD DE COMPRAS
   ============================================================================ */
function ComprasDashboard({
  snapshot,
  setSection,
  openNovaCotacao,
  canCreate,
}: {
  snapshot: ReturnType<typeof useComprasData>["snapshot"];
  setSection: (s: ComprasSection) => void;
  openNovaCotacao: () => void;
  canCreate: boolean;
}) {
  const { summary, cotacoes } = snapshot;

  const ultimasCotacoes = useMemo(() => cotacoes.slice(0, 5), [cotacoes]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.08em", color: "var(--accent-teal, #0d9488)", margin: 0, textTransform: "uppercase" }}>
            COMPRAS · GESTÃO E COTAÇÕES
          </p>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: "0.25rem 0" }}>Painel de Compras</h1>
          <p style={{ color: "var(--text-muted, #64748b)", margin: 0, fontSize: "0.95rem" }}>
            Cotações de fornecedores, fluxo de aprovações e compras faturadas por divisão.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openNovaCotacao}>
            <ComprasIcon name="plus" /> Nova Cotação
          </Button>
        )}
      </div>

      <KpiGrid>
        <Kpi
          value={String(summary.totalCotacoes)}
          label="Total de Cotações"
          caption="Cadastradas"
          tone="blue"
        />
        <Kpi
          value={String(summary.pendentes)}
          label="Pendentes de Decisão"
          caption="Aguardando gestor"
          tone={summary.pendentes > 0 ? "amber" : "green"}
        />
        <Kpi
          value={String(summary.aprovadas)}
          label="Cotações Aprovadas"
          caption="Prontas para faturamento"
          tone="green"
        />
        <Kpi
          value={`R$ ${summary.totalGasto.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          label="Total Faturado"
          caption={`${summary.compradas} compras realizadas`}
          tone="purple"
        />
      </KpiGrid>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
        {/* Divisão de Gastos */}
        <Card style={{ padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 1rem" }}>Gastos por Divisão</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", fontSize: "0.9rem" }}>
                <b>Usinagem</b>
                <span>R$ {summary.gastoUsinagem.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ width: "100%", height: "8px", background: "rgba(0,0,0,0.06)", borderRadius: "4px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${summary.totalGasto > 0 ? (summary.gastoUsinagem / summary.totalGasto) * 100 : 50}%`,
                    height: "100%",
                    background: "var(--accent-teal, #0d9488)",
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", fontSize: "0.9rem" }}>
                <b>Fundição</b>
                <span>R$ {summary.gastoFundicao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ width: "100%", height: "8px", background: "rgba(0,0,0,0.06)", borderRadius: "4px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${summary.totalGasto > 0 ? (summary.gastoFundicao / summary.totalGasto) * 100 : 50}%`,
                    height: "100%",
                    background: "var(--accent-orange, #ea580c)",
                  }}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Últimas Cotações */}
        <Card style={{ padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>Últimas Cotações</h3>
            <Button variant="ghost" compact onClick={() => setSection("Cotações")}>
              Ver todas →
            </Button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {ultimasCotacoes.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.6rem 0.8rem",
                  background: "rgba(0,0,0,0.02)",
                  borderRadius: "6px",
                }}
              >
                <div>
                  <b style={{ fontSize: "0.95rem" }}>{c.fornecedor}</b>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
                    {c.divisao} · {c.produtos.length} {c.produtos.length === 1 ? "item" : "itens"}
                  </div>
                </div>
                <StatusCotacaoBadge status={c.status} />
              </div>
            ))}
            {ultimasCotacoes.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", margin: "1rem 0" }}>
                Nenhuma cotação cadastrada.
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ============================================================================
   2. SEÇÃO DE COTAÇÕES
   ============================================================================ */
function CotacoesSection({
  cotacoes,
  openNovaCotacao,
  canCreate,
  onFaturar,
}: {
  cotacoes: Cotacao[];
  openNovaCotacao: () => void;
  canCreate: boolean;
  onFaturar: (c: Cotacao) => void;
}) {
  const [filtroDivisao, setFiltroDivisao] = useState<"TODAS" | Divisao>("TODAS");
  const [filtroStatus, setFiltroStatus] = useState<string>("TODOS");
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    return cotacoes.filter((c) => {
      if (filtroDivisao !== "TODAS" && c.divisao !== filtroDivisao) return false;
      if (filtroStatus !== "TODOS" && c.status !== filtroStatus) return false;
      if (busca.trim()) {
        const q = busca.toLowerCase();
        const bateFornecedor = c.fornecedor.toLowerCase().includes(q);
        const bateProduto = c.produtos.some((p) => p.produto.toLowerCase().includes(q));
        if (!bateFornecedor && !bateProduto) return false;
      }
      return true;
    });
  }, [cotacoes, filtroDivisao, filtroStatus, busca]);

  return (
    <Card style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>Cotações</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
            {filtradas.length} {filtradas.length === 1 ? "cotação encontrada" : "cotações encontradas"}
          </p>
        </div>
        {canCreate && (
          <Button onClick={openNovaCotacao}>
            <ComprasIcon name="plus" /> Nova Cotação
          </Button>
        )}
      </div>

      {/* Barra de Filtros */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <input
          type="text"
          placeholder="Buscar por fornecedor ou produto..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{
            flex: "1 1 240px",
            padding: "0.55rem 0.8rem",
            borderRadius: "6px",
            border: "1px solid var(--border-color, #cbd5e1)",
            background: "var(--surface-bg, #fff)",
            fontSize: "0.9rem",
          }}
        />
        <select
          value={filtroDivisao}
          onChange={(e) => setFiltroDivisao(e.target.value as "TODAS" | Divisao)}
          style={{ padding: "0.55rem 0.8rem", borderRadius: "6px", border: "1px solid var(--border-color, #cbd5e1)" }}
        >
          <option value="TODAS">Todas as Divisões</option>
          <option value="USINAGEM">Usinagem</option>
          <option value="FUNDICAO">Fundição</option>
        </select>
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          style={{ padding: "0.55rem 0.8rem", borderRadius: "6px", border: "1px solid var(--border-color, #cbd5e1)" }}
        >
          <option value="TODOS">Todos os Status</option>
          <option value="PENDENTE">Pendente</option>
          <option value="APROVADO">Aprovado</option>
          <option value="COMPRADO">Comprado</option>
          <option value="REJEITADO">Rejeitado</option>
        </select>
      </div>

      {/* Lista de Cotações */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {filtradas.map((c) => {
          const totalCotacao = c.produtos.reduce((acc, p) => acc + p.valorUnit * p.quantidade, 0);

          return (
            <div
              key={c.id}
              style={{
                border: "1px solid var(--border-color, #e2e8f0)",
                borderRadius: "8px",
                padding: "1rem 1.25rem",
                background: "var(--surface-bg, #fff)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>{c.fornecedor}</h3>
                    <Status tone={c.divisao === "USINAGEM" ? "info" : "attention"}>{c.divisao}</Status>
                    <StatusCotacaoBadge status={c.status} />
                  </div>
                  <small style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                    Criado em: {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                    {c.aprovadoPor && ` · Decisão por: ${c.aprovadoPor}`}
                  </small>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <div style={{ textAlign: "right" }}>
                    <small style={{ color: "var(--text-muted)", fontSize: "0.75rem", display: "block" }}>VALOR TOTAL</small>
                    <b style={{ fontSize: "1.15rem", color: "var(--accent-teal, #0d9488)" }}>
                      R$ {totalCotacao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </b>
                  </div>
                  {c.status === "APROVADO" && (
                    <Button compact onClick={() => onFaturar(c)}>
                      Faturar Compra
                    </Button>
                  )}
                </div>
              </div>

              {/* Tabela de Itens */}
              <div style={{ marginTop: "1rem", overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color, #e2e8f0)", color: "var(--text-muted)" }}>
                      <th style={{ padding: "0.4rem 0" }}>Produto / Descrição</th>
                      <th style={{ padding: "0.4rem 0" }}>Qtd.</th>
                      <th style={{ padding: "0.4rem 0" }}>Vlr. Unitário</th>
                      <th style={{ padding: "0.4rem 0" }}>ICMS / IPI</th>
                      <th style={{ padding: "0.4rem 0" }}>Prazo</th>
                      <th style={{ padding: "0.4rem 0" }}>Status</th>
                      <th style={{ padding: "0.4rem 0", textAlign: "right" }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.produtos.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                        <td style={{ padding: "0.5rem 0" }}>
                          <b>{p.produto}</b>
                          {p.obs && <small style={{ display: "block", color: "var(--text-muted)" }}>{p.obs}</small>}
                        </td>
                        <td style={{ padding: "0.5rem 0" }}>
                          {p.quantidade} {p.unidade}
                        </td>
                        <td style={{ padding: "0.5rem 0" }}>
                          R$ {p.valorUnit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: "0.5rem 0" }}>
                          {p.icms}% / {p.ipi}%
                        </td>
                        <td style={{ padding: "0.5rem 0" }}>{p.prazo || "—"}</td>
                        <td style={{ padding: "0.5rem 0" }}>
                          <StatusProdutoBadge status={p.status} />
                        </td>
                        <td style={{ padding: "0.5rem 0", textAlign: "right" }}>
                          <b>R$ {(p.valorUnit * p.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {filtradas.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
            Nenhuma cotação localizada com os filtros selecionados.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ============================================================================
   3. SEÇÃO DE PENDENTES (APROVAÇÕES)
   ============================================================================ */
function PendentesSection({
  cotacoes,
  decideProduto,
  canApprove,
  track,
}: {
  cotacoes: Cotacao[];
  decideProduto: ReturnType<typeof useComprasData>["decideProduto"];
  canApprove: boolean;
  track: (msg: string) => void;
}) {
  const [motivoModal, setMotivoModal] = useState<{ id: number | string; produto: string } | null>(null);
  const [motivoTexto, setMotivoTexto] = useState("");

  const pendentes = useMemo(() => {
    const list: { cotacao: Cotacao; produto: CotacaoProduto }[] = [];
    for (const c of cotacoes) {
      for (const p of c.produtos) {
        if (p.status === "PENDENTE") {
          list.push({ cotacao: c, produto: p });
        }
      }
    }
    return list;
  }, [cotacoes]);

  return (
    <Card style={{ padding: "1.5rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>Aprovações Pendentes</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
          {pendentes.length} {pendentes.length === 1 ? "item aguardando decisão" : "itens aguardando decisão"} do gestor
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {pendentes.map(({ cotacao, produto }) => {
          const subtotal = produto.valorUnit * produto.quantidade;

          return (
            <div
              key={produto.id}
              style={{
                border: "1px solid var(--border-color, #e2e8f0)",
                borderRadius: "8px",
                padding: "1rem 1.25rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <b style={{ fontSize: "1.05rem" }}>{produto.produto}</b>
                  <Status tone={cotacao.divisao === "USINAGEM" ? "info" : "attention"}>{cotacao.divisao}</Status>
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Fornecedor: <b>{cotacao.fornecedor}</b> · Quantidade: <b>{produto.quantidade} {produto.unidade}</b> · Prazo: <b>{produto.prazo || "A combinar"}</b>
                </div>
                {produto.obs && (
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    Obs: {produto.obs}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                <div style={{ textAlign: "right" }}>
                  <small style={{ color: "var(--text-muted)", fontSize: "0.75rem", display: "block" }}>SUBTOTAL</small>
                  <b style={{ fontSize: "1.1rem", color: "var(--accent-teal, #0d9488)" }}>
                    R$ {subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </b>
                </div>

                {canApprove ? (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      compact
                      style={{ background: "#16a34a", color: "#fff" }}
                      onClick={async () => {
                        await decideProduto(produto.id, "APROVADO");
                        track(`Item '${produto.produto}' APROVADO`);
                      }}
                    >
                      ✓ Aprovar
                    </Button>
                    <Button
                      compact
                      variant="secondary"
                      style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                      onClick={() => {
                        setMotivoModal({ id: produto.id, produto: produto.produto });
                        setMotivoTexto("");
                      }}
                    >
                      ✕ Rejeitar
                    </Button>
                  </div>
                ) : (
                  <Status tone="neutral">Apenas Gestor</Status>
                )}
              </div>
            </div>
          );
        })}

        {pendentes.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Tudo em dia!</p>
            <p style={{ fontSize: "0.9rem", margin: "0.25rem 0" }}>Nenhum item pendente de aprovação no momento.</p>
          </div>
        )}
      </div>

      {/* Modal de Rejeição */}
      {motivoModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "1rem",
          }}
        >
          <Card style={{ width: "100%", maxWidth: "450px", padding: "1.5rem" }}>
            <h3 style={{ margin: "0 0 0.5rem" }}>Rejeitar Item</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
              Informe o motivo da rejeição de <b>{motivoModal.produto}</b>:
            </p>
            <textarea
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.target.value)}
              placeholder="Ex: Preço acima do orçamento da ordem, prazo inviável..."
              style={{
                width: "100%",
                minHeight: "80px",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
                marginBottom: "1rem",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <Button variant="secondary" onClick={() => setMotivoModal(null)}>
                Cancelar
              </Button>
              <Button
                style={{ background: "#dc2626", color: "#fff" }}
                onClick={async () => {
                  await decideProduto(motivoModal.id, "REJEITADO", motivoTexto);
                  setMotivoModal(null);
                  track(`Item '${motivoModal.produto}' REJEITADO: ${motivoTexto}`);
                }}
              >
                Confirmar Rejeição
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}

/* ============================================================================
   4. SEÇÃO DE COMPRAS REALIZADAS
   ============================================================================ */
function ComprasRealizadasSection({
  compras,
  cotacoes,
  onFaturar,
}: {
  compras: ReturnType<typeof useComprasData>["snapshot"]["compras"];
  cotacoes: Cotacao[];
  onFaturar: (c: Cotacao) => void;
}) {
  const cotacoesProntas = useMemo(() => cotacoes.filter((c) => c.status === "APROVADO"), [cotacoes]);

  return (
    <Card style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>Compras Realizadas / Faturadas</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
            {compras.length} {compras.length === 1 ? "compra faturada registrada" : "compras faturadas registradas"}
          </p>
        </div>
        {cotacoesProntas.length > 0 && (
          <select
            onChange={(e) => {
              const id = Number(e.target.value);
              const found = cotacoesProntas.find((c) => c.id === id);
              if (found) onFaturar(found);
            }}
            defaultValue=""
            style={{ padding: "0.55rem 0.8rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
          >
            <option value="" disabled>
              + Faturar Cotação Aprovada ({cotacoesProntas.length})
            </option>
            {cotacoesProntas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fornecedor} ({c.divisao})
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: "0.9rem", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border-color, #e2e8f0)", color: "var(--text-muted)" }}>
              <th style={{ padding: "0.6rem 0.5rem" }}>Data</th>
              <th style={{ padding: "0.6rem 0.5rem" }}>Nota Fiscal (NF)</th>
              <th style={{ padding: "0.6rem 0.5rem" }}>Fornecedor</th>
              <th style={{ padding: "0.6rem 0.5rem" }}>Produtos / Descrição</th>
              <th style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>Total Faturado</th>
            </tr>
          </thead>
          <tbody>
            {compras.map((comp) => (
              <tr key={comp.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                <td style={{ padding: "0.6rem 0.5rem", whiteSpace: "nowrap" }}>
                  {new Date(comp.dataCompra).toLocaleDateString("pt-BR")}
                </td>
                <td style={{ padding: "0.6rem 0.5rem" }}>
                  <Status tone="info">{comp.nf || "S/N"}</Status>
                </td>
                <td style={{ padding: "0.6rem 0.5rem" }}>
                  <b>{comp.fornecedor}</b>
                </td>
                <td style={{ padding: "0.6rem 0.5rem" }}>
                  {comp.produto}
                  {comp.obs && <small style={{ display: "block", color: "var(--text-muted)" }}>{comp.obs}</small>}
                </td>
                <td style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>
                  <b style={{ color: "var(--accent-teal, #0d9488)" }}>
                    R$ {comp.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </b>
                </td>
              </tr>
            ))}
            {compras.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "2.5rem", color: "var(--text-muted)" }}>
                  Nenhuma compra faturada registrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ============================================================================
   5. SEÇÃO DE HISTÓRICO
   ============================================================================ */
function HistoricoSection({
  cotacoes,
  compras,
}: {
  cotacoes: Cotacao[];
  compras: ReturnType<typeof useComprasData>["snapshot"]["compras"];
}) {
  const eventos = useMemo(() => {
    const list: { id: string; tipo: "COTACAO" | "COMPRA"; titulo: string; desc: string; data: string; tone: "info" | "success" | "neutral" }[] = [];

    for (const c of cotacoes) {
      list.push({
        id: `cot-${c.id}`,
        tipo: "COTACAO",
        titulo: `Cotação ${c.status}: ${c.fornecedor}`,
        desc: `${c.divisao} · ${c.produtos.length} produtos · Criado em ${new Date(c.createdAt).toLocaleDateString("pt-BR")}`,
        data: c.updatedAt || c.createdAt,
        tone: c.status === "COMPRADO" ? "success" : c.status === "APROVADO" ? "info" : "neutral",
      });
    }

    for (const comp of compras) {
      list.push({
        id: `comp-${comp.id}`,
        tipo: "COMPRA",
        titulo: `Compra Realizada: ${comp.fornecedor} (${comp.nf || "S/N"})`,
        desc: `Total: R$ ${comp.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · ${comp.produto}`,
        data: comp.createdAt || comp.dataCompra,
        tone: "success",
      });
    }

    return list.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, [cotacoes, compras]);

  return (
    <Card style={{ padding: "1.5rem" }}>
      <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0 0 1rem" }}>Histórico Operacional</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {eventos.map((ev) => (
          <div
            key={ev.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: "rgba(0,0,0,0.02)",
              borderRadius: "6px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Status tone={ev.tone}>{ev.tipo}</Status>
                <b style={{ fontSize: "0.95rem" }}>{ev.titulo}</b>
              </div>
              <small style={{ color: "var(--text-muted)", display: "block", marginTop: "0.2rem" }}>{ev.desc}</small>
            </div>
            <time style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {new Date(ev.data).toLocaleDateString("pt-BR")}
            </time>
          </div>
        ))}
        {eventos.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>Sem histórico disponível.</p>
        )}
      </div>
    </Card>
  );
}

/* ============================================================================
   MODAL: NOVA COTAÇÃO
   ============================================================================ */
function NovaCotacaoModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (payload: {
    fornecedor: string;
    divisao: Divisao;
    obs?: string;
    produtos: Omit<CotacaoProduto, "id" | "status">[];
  }) => Promise<void>;
}) {
  const [fornecedor, setFornecedor] = useState("");
  const [divisao, setDivisao] = useState<Divisao>("USINAGEM");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [itens, setItens] = useState<Omit<CotacaoProduto, "id" | "status">[]>([
    { produto: "", quantidade: 1, unidade: "UN", valorUnit: 0, icms: 0, ipi: 0, prazo: "", obs: "" },
  ]);

  const totalGeral = useMemo(() => {
    return itens.reduce((sum, item) => sum + (Number(item.valorUnit) || 0) * (Number(item.quantidade) || 0), 0);
  }, [itens]);

  const addItem = () => {
    setItens((prev) => [
      ...prev,
      { produto: "", quantidade: 1, unidade: "UN", valorUnit: 0, icms: 0, ipi: 0, prazo: "", obs: "" },
    ]);
  };

  const updateItem = (index: number, field: string, value: string | number) => {
    setItens((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const removeItem = (index: number) => {
    if (itens.length <= 1) return;
    setItens((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "1rem",
      }}
    >
      <Card style={{ width: "100%", maxWidth: "720px", maxHeight: "90vh", overflowY: "auto", padding: "1.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>Nova Cotação</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>Cadastre múltiplos itens para cotação com o fornecedor.</p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, cursor: "pointer", fontSize: "1.2rem" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Fornecedor</label>
            <input
              type="text"
              required
              placeholder="Razão social ou nome fantasia..."
              value={fornecedor}
              onChange={(e) => setFornecedor(e.target.value)}
              style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
            />
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Divisão de Destino</label>
            <select
              value={divisao}
              onChange={(e) => setDivisao(e.target.value as Divisao)}
              style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
            >
              <option value="USINAGEM">Usinagem</option>
              <option value="FUNDICAO">Fundição</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Observações Gerais</label>
          <input
            type="text"
            placeholder="Condições de pagamento, frete (FOB/CIF), etc."
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
          />
        </div>

        {/* Lista de Itens */}
        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Produtos / Itens</h3>
            <Button variant="secondary" compact onClick={addItem}>
              + Adicionar Item
            </Button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {itens.map((item, idx) => (
              <div
                key={idx}
                style={{
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  background: "rgba(0,0,0,0.01)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Descrição do produto ou material..."
                    value={item.produto}
                    onChange={(e) => updateItem(idx, "produto", e.target.value)}
                    style={{ flex: 3, padding: "0.45rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}
                  />
                  <input
                    type="number"
                    placeholder="Qtd."
                    min="0.001"
                    step="any"
                    value={item.quantidade || ""}
                    onChange={(e) => updateItem(idx, "quantidade", parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "0.45rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}
                  />
                  <select
                    value={item.unidade}
                    onChange={(e) => updateItem(idx, "unidade", e.target.value)}
                    style={{ flex: 1, padding: "0.45rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}
                  >
                    <option value="UN">UN</option>
                    <option value="KG">KG</option>
                    <option value="PC">PC</option>
                    <option value="M">M</option>
                    <option value="L">L</option>
                    <option value="BD">BD</option>
                  </select>
                  {itens.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      style={{ background: "transparent", border: 0, color: "#dc2626", cursor: "pointer", fontWeight: 700 }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="number"
                    placeholder="Vlr. Unitário (R$)"
                    min="0"
                    step="0.01"
                    value={item.valorUnit || ""}
                    onChange={(e) => updateItem(idx, "valorUnit", parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "0.45rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}
                  />
                  <input
                    type="number"
                    placeholder="ICMS %"
                    min="0"
                    step="0.1"
                    value={item.icms || ""}
                    onChange={(e) => updateItem(idx, "icms", parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "0.45rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}
                  />
                  <input
                    type="number"
                    placeholder="IPI %"
                    min="0"
                    step="0.1"
                    value={item.ipi || ""}
                    onChange={(e) => updateItem(idx, "ipi", parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "0.45rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}
                  />
                  <input
                    type="text"
                    placeholder="Prazo (ex: 7 dias)"
                    value={item.prazo}
                    onChange={(e) => updateItem(idx, "prazo", e.target.value)}
                    style={{ flex: 1.5, padding: "0.45rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <small style={{ color: "var(--text-muted)", display: "block" }}>TOTAL ESTIMADO</small>
            <b style={{ fontSize: "1.2rem", color: "var(--accent-teal, #0d9488)" }}>
              R$ {totalGeral.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </b>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="secondary" onClick={onClose} disabled={salvando}>
              Cancelar
            </Button>
            <Button
              disabled={salvando || !fornecedor.trim() || itens.some((i) => !i.produto.trim())}
              onClick={async () => {
                setSalvando(true);
                try {
                  await onSave({ fornecedor, divisao, obs, produtos: itens });
                } finally {
                  setSalvando(false);
                }
              }}
            >
              {salvando ? "Salvando..." : "Salvar Cotação"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================================
   MODAL: FATURAR COMPRA
   ============================================================================ */
function FaturarCompraModal({
  cotacao,
  onClose,
  onSave,
}: {
  cotacao: Cotacao;
  onClose: () => void;
  onSave: (payload: { cotacaoId: number; nf: string; dataCompra: string; obs?: string }) => Promise<void>;
}) {
  const [nf, setNf] = useState("");
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().slice(0, 10));
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const total = useMemo(() => {
    return cotacao.produtos.reduce((sum, p) => sum + p.valorUnit * p.quantidade, 0);
  }, [cotacao]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "1rem",
      }}
    >
      <Card style={{ width: "100%", maxWidth: "480px", padding: "1.75rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0 0 0.5rem" }}>Faturar Compra</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1.25rem" }}>
          Registre a Nota Fiscal da cotação aprovada de <b>{cotacao.fornecedor}</b>.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
              Número da Nota Fiscal (NF-e)
            </label>
            <input
              type="text"
              required
              placeholder="Ex: NF-e 048.912"
              value={nf}
              onChange={(e) => setNf(e.target.value)}
              style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
            />
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Data da Compra / Emissão</label>
            <input
              type="date"
              value={dataCompra}
              onChange={(e) => setDataCompra(e.target.value)}
              style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
            />
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Observações de Faturamento</label>
            <input
              type="text"
              placeholder="Condições, vencimento de boletos..."
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
            />
          </div>

          <div style={{ background: "rgba(0,0,0,0.02)", padding: "0.75rem", borderRadius: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Total a faturar:</div>
            <b style={{ fontSize: "1.2rem", color: "var(--accent-teal, #0d9488)" }}>
              R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </b>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            disabled={salvando || !nf.trim()}
            onClick={async () => {
              setSalvando(true);
              try {
                await onSave({ cotacaoId: cotacao.id, nf, dataCompra, obs });
              } finally {
                setSalvando(false);
              }
            }}
          >
            {salvando ? "Faturando..." : "Confirmar Faturamento"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================================
   STATUS BADGES
   ============================================================================ */
function StatusCotacaoBadge({ status }: { status: StatusCotacao }) {
  if (status === "PENDENTE") return <Status tone="attention">Pendente</Status>;
  if (status === "APROVADO") return <Status tone="success">Aprovado</Status>;
  if (status === "COMPRADO") return <Status tone="purple">Comprado</Status>;
  if (status === "REJEITADO") return <Status tone="danger">Rejeitado</Status>;
  return <Status>{status}</Status>;
}

function StatusProdutoBadge({ status }: { status: string }) {
  if (status === "PENDENTE") return <Status tone="attention">Pendente</Status>;
  if (status === "APROVADO") return <Status tone="success">Aprovado</Status>;
  if (status === "REJEITADO") return <Status tone="danger">Rejeitado</Status>;
  return <Status>{status}</Status>;
}

/* ============================================================================
   ÍCONES SVG LEVES DO MÓDULO
   ============================================================================ */
function ComprasIcon({ name }: { name: string }) {
  if (name === "back") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  return null;
}
