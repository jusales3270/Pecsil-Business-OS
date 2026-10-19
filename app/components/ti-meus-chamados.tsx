"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "../../packages/design-system";
import { DetalheChamado, NovoChamado, TabelaChamados } from "../../modules/ti/src/chamados-ui";
import { type Chamado, type Regras, chamarTi } from "../../modules/ti/src/tipos";

/**
 * "Chamados de TI" do menu da conta: qualquer pessoa da empresa abre um chamado e acompanha os
 * seus, sem precisar do módulo de TI. Os avisos do sino para quem abriu trazem para cá
 * (`/?chamados-ti=<id>`).
 */
export function MeusChamadosTi({ abrirId, onClose, notify }: { abrirId?: string | null; onClose: () => void; notify: (m: string) => void }) {
  const [dados, setDados] = useState<{ chamados: Chamado[]; regras: Regras | null; eu: string | null; podeAtender: boolean } | null>(null);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(abrirId ?? null);

  const carregar = useCallback(async () => {
    const r = await chamarTi<{ chamados: Chamado[]; regras: Regras | null; eu: string | null; podeAtender: boolean }>("/api/ti/chamados?escopo=meus");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  if (novo && dados?.regras) {
    return <NovoChamado regras={dados.regras} onClose={() => setNovo(false)} onCriado={(n) => { setNovo(false); notify(`Chamado #${n} aberto. A TI foi avisada.`); void carregar(); }} />;
  }
  if (aberto) {
    return (
      <DetalheChamado id={aberto} eu={dados?.eu ?? null} podeAtender={Boolean(dados?.podeAtender)} regras={dados?.regras ?? null}
        onClose={() => { setAberto(null); void carregar(); }} onMudou={notify} />
    );
  }
  return (
    <Modal eyebrow="TI" title="Chamados de TI" subtitle="Chame a TI para um problema no computador, na impressora, na internet ou num sistema. Você recebe um aviso a cada resposta." onClose={onClose}>
      <div className="almox-form ti-form">
        {erro ? <p className="almox-erro" role="alert">{erro}</p> : !dados ? <p className="ds-detail-empty">Carregando…</p>
          : !dados.chamados.length ? <p className="ds-detail-empty">Você ainda não abriu nenhum chamado.</p>
          : <TabelaChamados chamados={dados.chamados} onAbrir={(c) => setAberto(c.id)} mostrarSolicitante={false} />}
        <footer>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button onClick={() => setNovo(true)} disabled={!dados?.regras}>Abrir chamado</Button>
        </footer>
      </div>
    </Modal>
  );
}
