import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { ModuleAccessContext } from '@/modules/access';
import { supabase } from "../lib/supabase";

export type UserRole = 'super_admin' | 'admin' | 'user';

export interface Perfil {
  id: string;
  nome: string;
  role: UserRole;
  foto_base64?: string;
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

/** Papel da Portaria derivado das credenciais do Business OS. */
function perfilFromAccess(access: ModuleAccessContext, userId: string): Perfil {
  const isSuperAdmin = access.roleCode === 'owner' || access.roleCode === 'director' || access.role === 'Proprietário';
  const isManager = access.roleCode === 'manager' || access.role === 'Gestor';
  return {
    id: userId,
    nome: access.name || 'Operador Portaria',
    role: isSuperAdmin ? 'super_admin' : isManager ? 'admin' : 'user',
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
