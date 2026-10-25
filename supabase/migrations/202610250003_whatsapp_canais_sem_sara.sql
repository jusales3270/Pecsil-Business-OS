-- WhatsApp: a SARA deixou de ser do número (25/10/2026, migração 202610250002): é de cada pessoa da allowlist
-- (whatsapp_contatos.sara_modulo). Depois do Deploy que parou de ler whatsapp_canais.sara_modulo, a coluna sai.
alter table public.whatsapp_canais drop column if exists sara_modulo;
