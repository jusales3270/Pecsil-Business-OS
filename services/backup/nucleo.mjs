/**
 * Núcleo do backup externo (T-02): configuração, horário, nomes e partes.
 * Sem rede nem disco — testado em tests/ti-backup.test.mjs.
 */

export const LIMITE_PARTE = 45 * 1024 * 1024; // abaixo dos 50 MB por arquivo do plano gratuito

const obrigatorias = ["BACKUP_PG_URL_PECSIL", "BACKUP_AGE_DESTINATARIO", "VIGIA_URL", "VIGIA_CHAVE", "BACKUP_EMAIL", "BACKUP_SENHA", "BACKUP_TOKEN"];

/** Lê e confere as variáveis. Nunca devolve nem mostra os valores secretos nos erros. */
export function lerConfig(env) {
  const faltam = obrigatorias.filter((k) => !String(env[k] ?? "").trim());
  if (faltam.length) throw new Error(`Variáveis ausentes: ${faltam.join(", ")}`);
  const destinatario = env.BACKUP_AGE_DESTINATARIO.trim();
  if (!/^age1[0-9a-z]{58}$/.test(destinatario)) throw new Error("BACKUP_AGE_DESTINATARIO não é uma chave pública do age (age1…).");
  const hora = (env.BACKUP_HORA || "02:30").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new Error("BACKUP_HORA deve ser HH:MM.");
  const bancos = [{ nome: "pecsil", url: env.BACKUP_PG_URL_PECSIL.trim() }];
  if (String(env.BACKUP_PG_URL_FORJA ?? "").trim()) bancos.push({ nome: "forja", url: env.BACKUP_PG_URL_FORJA.trim() });
  const arquivos = env.BACKUP_ARQUIVOS_URL && env.BACKUP_ARQUIVOS_CHAVE
    ? { url: env.BACKUP_ARQUIVOS_URL.trim().replace(/\/$/, ""), chave: env.BACKUP_ARQUIVOS_CHAVE.trim(),
        excluir: String(env.BACKUP_EXCLUIR_BUCKETS ?? "").split(",").map((b) => b.trim()).filter(Boolean) }
    : null;
  return {
    bancos, arquivos, destinatario, hora,
    vigia: { url: env.VIGIA_URL.trim().replace(/\/$/, ""), chave: env.VIGIA_CHAVE.trim(), token: env.BACKUP_TOKEN.trim(), alvo: (env.BACKUP_ALVO || "backup-pecsil").trim() },
    acesso: { email: env.BACKUP_EMAIL.trim(), senha: env.BACKUP_SENHA },
  };
}

/** Partes de data e hora no fuso de Brasília. */
export function emBrasilia(data) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(data).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}${p.minute}`, h: Number(p.hour), m: Number(p.minute) };
}

/** Próxima execução no horário HH:MM de Brasília, sempre no futuro. (Brasília não tem horário de verão desde 2019.) */
export function proximaExecucao(agora, hora) {
  const [hh, mm] = hora.split(":").map(Number);
  const b = emBrasilia(agora);
  const hoje = new Date(`${b.dia}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-03:00`);
  return hoje > agora ? hoje : new Date(hoje.getTime() + 86_400_000);
}

/** Caminho no bucket: AAAA-MM-DD/HHMM-<tipo>.<ext>.age */
export function nomeDoArquivo(data, tipo) {
  const b = emBrasilia(data);
  const ext = tipo === "arquivos" ? "tar.gz" : "dump";
  return `${b.dia}/${b.hora}-${tipo}.${ext}.age`;
}

/** Faixas [início, fim) para dividir um arquivo maior que o limite. */
export function partes(tamanho, limite = LIMITE_PARTE) {
  if (tamanho <= limite) return [[0, tamanho]];
  const r = [];
  for (let i = 0; i < tamanho; i += limite) r.push([i, Math.min(i + limite, tamanho)]);
  return r;
}

/** Nome de cada parte (sem sufixo quando é uma só). */
export const nomeDaParte = (nome, i, total) => (total === 1 ? nome : `${nome}.parte-${String(i + 1).padStart(2, "0")}-de-${String(total).padStart(2, "0")}`);
