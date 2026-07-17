# Recursos Humanos

Módulo de referência do Pecsil Business OS. Não inclui folha de pagamento nesta versão.

Consome identidade, estrutura organizacional, documentos, notificações, auditoria e busca da Fundação. O acesso de entrada exige `rh.view`; ações adicionais exigem as permissões declaradas em `permissions.ts` e um escopo compatível.

Até a conexão do Supabase, a aplicação usa `demoOwnerAccess`. Depois, o mesmo contrato receberá permissões e escopos da sessão autenticada, enquanto o PostgreSQL aplicará a proteção definitiva por RLS.
