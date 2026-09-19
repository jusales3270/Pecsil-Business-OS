import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { ModuleAccessContext } from '@/modules/access';
import { levelRank, type AccessLevel } from '@/modules/access-catalog';
import { supabase } from "../lib/supabase";

export type UserRole = 'super_admin' | 'admin' | 'user';

export type AreaPortaria = 'visitas' | 'terceiros' | 'recebidos' | 'veiculos';

export interface Perfil {
  id: string;
  nome: string;
  /** super_admin = proprietário; os demais são `user` e valem pelas áreas. */
  role: UserRole;
  /** Nível liberado em cada área (ver / operar / aprovar = gerenciar). */
  areas: Record<AreaPortaria, AccessLevel | null>;
  foto_base64?: string;
}

const AREAS: AreaPortaria[] = ['visitas', 'terceiros', 'recebidos', 'veiculos'];

/** A pessoa pode `nivel` na área? Proprietário pode tudo. */
export function podePortaria(perfil: Perfil | null, area: AreaPortaria, nivel: AccessLevel = 'ver'): boolean {
  if (!perfil) return false;
  if (perfil.role === 'super_admin') return true;
  return levelRank(perfil.areas[area]) >= levelRank(nivel);
}

/** Gerencia alguma área (detalhamentos do painel). */
export function gerenciaAlgumaArea(perfil: Perfil | null): boolean {
  return AREAS.some((area) => podePortaria(perfil, area, 'aprovar'));
}

interface AuthContextType {
  user: User | null;
  perfil: Perfil | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshPerfil: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  perfil: null,
  loading: true,
  signOut: async () => {},
  refreshPerfil: async () => {},
});

/** Perfil da Portaria derivado do acesso do usuário no Business OS. */
function perfilFromAccess(access: ModuleAccessContext, userId: string): Perfil {
  return {
    id: userId,
    nome: access.name || 'Operador Portaria',
    role: access.isOwner ? 'super_admin' : 'user',
    areas: Object.fromEntries(
      AREAS.map((area) => [area, access.isOwner ? 'aprovar' : access.grants[`portaria.${area}`] ?? null]),
    ) as Record<AreaPortaria, AccessLevel | null>,
  };
}

/**
 * A identidade vem do Business OS: a sessão Supabase é a mesma da plataforma
 * (cliente compartilhado) e o papel sai das credenciais `access`. A antiga
 * tabela `perfis` do app standalone não existe no banco da Pecsil.
 */
export function AuthProvider({ children, access }: { children: ReactNode; access?: ModuleAccessContext }) {
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apply = (sessionUser: User | null) => {
      if (access) {
        const resolvedUser = sessionUser ?? ({
          id: access.userId,
          email: '',
          user_metadata: { name: access.name },
        } as unknown as User);
        setUser(resolvedUser);
        setPerfil(perfilFromAccess(access, resolvedUser.id));
      } else {
        setUser(sessionUser);
        setPerfil(null);
      }
      setLoading(false);
    };

    let unsubscribe = () => {};
    try {
      supabase.auth.getSession()
        .then(({ data: { session } }) => apply(session?.user ?? null))
        .catch(() => apply(null));
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user ?? null));
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      // Supabase não configurado (modo demonstrativo): identidade só pelas credenciais do OS.
      apply(null);
    }

    return () => unsubscribe();
  }, [access]);

  const refreshPerfil = async () => {
    if (access && user) setPerfil(perfilFromAccess(access, user.id));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, perfil, loading, signOut, refreshPerfil }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
