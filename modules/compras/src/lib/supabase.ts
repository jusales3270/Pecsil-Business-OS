import { createClient } from '@supabase/supabase-js';

const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Prioriza as variáveis de ambiente oficiais do Pecsil Business OS
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://supabase.pecsil.com.br';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg4MTk4OTgwLCJleHAiOjE5NDU4Nzg5ODB9.daHxX0Wmh4lwJmmw8OZDnt-pCIvA4qCS4Lj_C-hPMV4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
