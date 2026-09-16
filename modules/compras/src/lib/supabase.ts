import { lazySupabaseBrowserClient } from '../../../../lib/supabase/lazy-browser-client';

// Cliente compartilhado do Pecsil Business OS: carrega a sessão do usuário
// logado, passa pelo gateway `/sb` e respeita o RLS com a identidade real.
export const supabase = lazySupabaseBrowserClient;
