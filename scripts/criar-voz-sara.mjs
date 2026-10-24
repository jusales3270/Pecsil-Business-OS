#!/usr/bin/env node
/**
 * Cria a VOZ PERSONALIZADA da SARA na xAI a partir da gravação de uma brasileira nativa (sotaque do Brasil na
 * raiz: as vozes prontas da xAI são "multilíngues" e carregam sotaque estrangeiro no português).
 *
 *   node --env-file=.env.local scripts/criar-voz-sara.mjs <gravacao.wav> [nome]
 *
 * - A gravação: até 120 s, WAV, só a voz (sem música nem ruído), fala natural em português do Brasil, de
 *   alguém que AUTORIZOU por escrito o uso da própria voz pela empresa.
 * - Sai o `voice_id`. Para usar: XAI_VOZ_SARA=<voice_id> no Coolify (e no .env.local) e Deploy. A voz vale
 *   para a SARA na plataforma (Realtime), nas ligações e nas mensagens de voz de WhatsApp (TTS).
 * - A chave XAI_API_KEY fica só no servidor; este script roda na máquina de quem administra.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [arquivo, nome = "SARA Pecsil pt-BR"] = process.argv.slice(2);
const chave = process.env.XAI_API_KEY?.trim();
if (!arquivo || !chave) { console.error("Uso: node --env-file=.env.local scripts/criar-voz-sara.mjs <gravacao.wav> [nome]  (precisa de XAI_API_KEY)"); process.exit(1); }
const form = new FormData();
form.append("name", nome);
form.append("language", "pt-BR");
form.append("file", new Blob([readFileSync(arquivo)], { type: "audio/wav" }), basename(arquivo));
const r = await fetch("https://api.x.ai/v1/custom-voices", { method: "POST", headers: { Authorization: `Bearer ${chave}` }, body: form });
const j = await r.json().catch(() => null);
if (!r.ok || !j?.voice_id) { console.error("A xAI não criou a voz:", r.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
console.log(`Voz criada: ${j.voice_id}\nPara usar: XAI_VOZ_SARA=${j.voice_id} no Coolify (e no .env.local), depois Deploy.`);
