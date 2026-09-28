import { useState } from 'react';
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Lock, Mail, AlertTriangle } from 'lucide-react';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    } catch (err: any) {
      setError(err.message || 'Erro ao fazer login. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-6">
            <img src="/logo-pecsil.png" alt="Pecsil Logo" className="h-16 object-contain mx-auto" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Sistema de Controle</h1>
          <p className="text-gray-500 mt-2">Faça login para acessar o painel</p>
        </div>

        <Card className="shadow-xl border-0 ring-1 ring-gray-200/50">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl text-center">Acesso Restrito</CardTitle>
            <CardDescription className="text-center">
              Insira suas credenciais abaixo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="email"
                    placeholder="Seu e-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 bg-gray-50/50 border-gray-200 focus:bg-white"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="password"
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 bg-gray-50/50 border-gray-200 focus:bg-white"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all mt-6"
                disabled={loading}
              >
                {loading ? 'Entrando...' : 'Entrar no Sistema'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
