import { useState } from 'react';
import { useStore } from '@/store';
import type { UserRole } from '@/types';
import {
  Briefcase,
  Shield,
  ArrowRight,
  Lock,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { supabase } from '@/lib/supabase';
import { TextEffect } from '@/components/ui/text-effect';

export default function LoginPage() {
  const { login } = useStore();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  
  // Password authentication states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showWelcome, setShowWelcome] = useState(false);
  const [loggedInName, setLoggedInName] = useState('');

  const handleLogin = () => {
    if (selectedRole) {
      if (selectedRole === 'GESTOR') {
        setIsModalOpen(true);
        setPassword('');
        setErrorMsg('');
      } else {
        login(selectedRole);
      }
    }
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMsg('Por favor, digite a senha.');
      return;
    }

    setIsVerifying(true);
    setErrorMsg('');

    try {
      // Check for Domingo Duque's password first
      if (password === 'Pecsil10') {
        setIsModalOpen(false);
        setIsVerifying(false);
        setLoggedInName('Domingo Duque');
        setShowWelcome(true);
        
        // Wait for welcome animation
        setTimeout(() => {
          login('GESTOR', 'Domingo Duque');
        }, 2200);
        return;
      }

      const { data, error } = await supabase.rpc('verify_gestor_password', {
        entered_password: password
      });

      if (error) {
        console.error('Erro na chamada RPC:', error);
        setErrorMsg('Erro de conexão com o banco de dados.');
        setIsVerifying(false);
        return;
      }

      if (data === true) {
        setIsModalOpen(false);
        setIsVerifying(false);
        setLoggedInName('Ricardo');
        setShowWelcome(true);
        
        // Wait for welcome animation
        setTimeout(() => {
          login('GESTOR', 'Ricardo');
        }, 2200);
      } else {
        setErrorMsg('Senha incorreta. Tente novamente.');
        setIsVerifying(false);
      }
    } catch (err) {
      console.error('Erro inesperado:', err);
      setErrorMsg('Ocorreu um erro inesperado.');
      setIsVerifying(false);
    }
  };

  if (showWelcome) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-500">
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 md:p-10 max-w-sm w-full text-center space-y-6 animate-in zoom-in-95 duration-500">
          {/* Circular logo container */}
          <div className="w-24 h-24 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <img 
              src="/logo-pecsil.png" 
              alt="Pecsil Logo" 
              className="h-14 w-14 object-contain animate-bounce-short" 
            />
          </div>
          
          {/* Welcome Text */}
          <div className="space-y-2">
            <TextEffect 
              per="char" 
              preset="slide" 
              as="h2" 
              className="text-2xl font-bold tracking-tight text-slate-900 font-sans"
            >
              {`Bem-vindo ${loggedInName}`}
            </TextEffect>
            <p className="text-slate-500 text-xs font-semibold animate-pulse">
              Acessando o painel do gestor...
            </p>
          </div>
          
          {/* Simple animated loading indicator */}
          <div className="w-20 h-1 bg-slate-100 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-primary animate-pulse w-full rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo-pecsil.png" alt="Pecsil Logo" className="h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900">Sistema de Gestão de Cotações</h1>
          <p className="text-sm text-slate-500 mt-2">Selecione seu perfil para acessar o painel</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 md:p-8">
          <h2 className="text-lg font-semibold text-slate-900 text-center mb-1">
            Acesso Restrito
          </h2>
          <p className="text-sm text-slate-500 text-center mb-6">
            Escolha como deseja acessar o sistema
          </p>

          {/* Role selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {/* Orçamentista */}
            <button
              onClick={() => setSelectedRole('ORCAMENTISTA')}
              className={`relative flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all duration-200 ${
                selectedRole === 'ORCAMENTISTA'
                  ? 'border-primary bg-primary/5 shadow-md scale-[1.02]'
                  : 'border-transparent bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                selectedRole === 'ORCAMENTISTA'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                <Briefcase size={22} />
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm text-slate-900">Orçamentista</p>
                <p className="text-xs text-slate-500 mt-0.5">Criar cotações</p>
              </div>
              {selectedRole === 'ORCAMENTISTA' && (
                <span className="absolute -top-2 -right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center text-primary-foreground">
                  <CheckIcon />
                </span>
              )}
            </button>

            {/* Gestor */}
            <button
              onClick={() => setSelectedRole('GESTOR')}
              className={`relative flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all duration-200 ${
                selectedRole === 'GESTOR'
                  ? 'border-primary bg-primary/5 shadow-md scale-[1.02]'
                  : 'border-transparent bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                selectedRole === 'GESTOR'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                <Shield size={22} />
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm text-slate-900">Gestor</p>
                <p className="text-xs text-slate-500 mt-0.5">Aprovar cotações</p>
              </div>
              {selectedRole === 'GESTOR' && (
                <span className="absolute -top-2 -right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center text-primary-foreground">
                  <CheckIcon />
                </span>
              )}
            </button>
          </div>

          {/* Login button */}
          <button
            onClick={handleLogin}
            disabled={!selectedRole}
            className={`w-full h-12 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 ${
              selectedRole
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            Entrar no Sistema
            {selectedRole && <ArrowRight size={16} />}
          </button>

          <p className="text-center text-xs text-slate-400 mt-4">
            Acesso restrito a usuários autorizados
          </p>
        </div>
      </div>

      {/* Password Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-slate-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900 font-bold">
              <Lock size={18} className="text-primary" />
              Autenticação do Gestor
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Digite a senha do gestor para acessar o painel de aprovação.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleVerifyPassword} className="space-y-4 py-2">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Digite a senha..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isVerifying}
                autoFocus
                className="w-full text-slate-900 border-slate-200"
              />
              {errorMsg && (
                <p className="text-xs font-semibold text-destructive mt-1">
                  {errorMsg}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0 mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                disabled={isVerifying}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isVerifying || !password} className="gap-2 font-semibold">
                {isVerifying && <Spinner className="text-white" />}
                Entrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
