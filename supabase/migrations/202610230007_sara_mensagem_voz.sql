-- Mensagem de voz da SARA central para WhatsApp (23/10/2026): o áudio gravado na voz da SARA (API de texto
-- para fala do Grok, voz "luna") fica guardado como um documento do tipo `mensagem_voz`, com o mesmo controle
-- de quem pode abrir (quem criou, quem recebeu, o proprietário e a auditoria). O envio pelo WhatsApp depende do
-- número dedicado (B-04).
alter table public.sara_documentos drop constraint if exists sara_documentos_tipo_check;
alter table public.sara_documentos add constraint sara_documentos_tipo_check check (tipo in ('relatorio', 'carta', 'mensagem_voz'));
