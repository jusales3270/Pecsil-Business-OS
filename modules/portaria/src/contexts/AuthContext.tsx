import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseAdmin } from "../lib/supabase";

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

export function AuthProvider({ children, access }: { children: ReactNode; access?: any }) {
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchPerfil(session.user.id);
      } else if (access) {
        // Integração nativa com sessão autenticada do Pecsil Business OS
        const isSuperAdmin = access.roleCode === 'owner' || access.roleCode === 'director' || access.role === 'Proprietário';
        const isManager = access.roleCode === 'manager' || access.role === 'Gestor';
        const simulatedUser: any = {
          id: access.account?.id || 'pecsil-user-01',
          email: access.account?.email || 'portaria@pecsil.com.br',
          user_metadata: { name: access.account?.name || 'Operador Portaria' },
        };
        const simulatedPerfil: Perfil = {
          id: simulatedUser.id,
          nome: access.account?.name || 'Operador Portaria',
          role: isSuperAdmin ? 'super_admin' : isManager ? 'admin' : 'user',
        };
        setUser(simulatedUser);
        setPerfil(simulatedPerfil);
        setLoading(false);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        fetchPerfil(session.user.id);
      } else if (access) {
        const isSuperAdmin = access.roleCode === 'owner' || access.roleCode === 'director' || access.role === 'Proprietário';
        const isManager = access.roleCode === 'manager' || access.role === 'Gestor';
        setUser({
          id: access.account?.id || 'pecsil-user-01',
          email: access.account?.email || 'portaria@pecsil.com.br',
          user_metadata: { name: access.account?.name || 'Operador Portaria' },
        } as any);
        setPerfil({
          id: access.account?.id || 'pecsil-user-01',
          nome: access.account?.name || 'Operador Portaria',
          role: isSuperAdmin ? 'super_admin' : isManager ? 'admin' : 'user',
        });
        setLoading(false);
      } else {
        setPerfil(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [access]);

  const fetchPerfil = async (userId: string) => {
    try {
      // Usa admin client para bypassar RLS e evitar recursão infinita na policy
      const client = supabaseAdmin ?? supabase;
      const { data, error } = await client
        .from('perfis')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) setPerfil(data as Perfil);
    } catch (err) {
      console.error('Erro ao buscar perfil', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshPerfil = async () => {
    if (user) await fetchPerfil(user.id);
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
