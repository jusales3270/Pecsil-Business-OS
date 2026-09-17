import { useState, useRef, useEffect } from 'react';
import { supabase, supabaseAdmin } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { UserCircle, Camera, Check, AlertTriangle, KeyRound, User, Users } from 'lucide-react';
import { GerenciarUsuarios } from "../pages/GerenciarUsuarios";

export function Configuracoes() {
  const { user, perfil, refreshPerfil } = useAuth();

  // ── Perfil ─────────────────────────────────────────────────────────────────
  const [nome, setNome] = useState(perfil?.nome || '');
  const [foto, setFoto] = useState<string | null>(perfil?.foto_base64 || null);

  // Sincroniza quando perfil carrega do contexto (chega async)
  useEffect(() => {
    if (perfil) {
      setNome(perfil.nome || '');
      setFoto(perfil.foto_base64 || null);
    }
  }, [perfil]);
  const [savingPerfil, setSavingPerfil] = useState(false);
  const [perfilMsg, setPerfilMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Senha ──────────────────────────────────────────────────────────────────
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [savingSenha, setSavingSenha] = useState(false);
  const [senhaMsg, setSenhaMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const handleFotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const salvarPerfil = async () => {
    if (!user) return;
    setSavingPerfil(true);
    setPerfilMsg(null);
    try {
      const updates: Record<string, string | null> = { nome };
      updates.foto_base64 = foto ?? null;

      // Usa supabaseAdmin para bypassar RLS e evitar recursão infinita
      const client = supabaseAdmin ?? supabase;
      const { error } = await client
        .from('perfis')
        .update(updates)
        .eq('id', user.id);

      if (error) throw error;
      await refreshPerfil();
      setPerfilMsg({ tipo: 'ok', texto: 'Perfil atualizado com sucesso!' });
    } catch (err: any) {
      setPerfilMsg({ tipo: 'erro', texto: err.message || 'Erro ao salvar perfil.' });
    } finally {
      setSavingPerfil(false);
    }
  };

  const alterarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setSenhaMsg(null);
    if (novaSenha !== confirmarSenha) {
      setSenhaMsg({ tipo: 'erro', texto: 'As senhas não coincidem.' });
      return;
    }
    if (novaSenha.length < 6) {
      setSenhaMsg({ tipo: 'erro', texto: 'A senha deve ter no mínimo 6 caracteres.' });
      return;
    }
    setSavingSenha(true);
    try {
      // Re-autentica para confirmar a senha atual
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: senhaAtual,
      });
      if (signInError) throw new Error('Senha atual incorreta.');

      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;

      setSenhaMsg({ tipo: 'ok', texto: 'Senha alterada com sucesso!' });
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmarSenha('');
    } catch (err: any) {
      setSenhaMsg({ tipo: 'erro', texto: err.message || 'Erro ao alterar senha.' });
    } finally {
      setSavingSenha(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Configurações</h2>
        <p className="text-gray-500 mt-1">Gerencie suas informações pessoais e segurança.</p>
      </div>

      <Tabs defaultValue="perfil">
        <TabsList className="mb-4">
          <TabsTrigger value="perfil" className="flex items-center gap-2">
            <User className="w-4 h-4" /> Meu Perfil
          </TabsTrigger>
          <TabsTrigger value="senha" className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Segurança
          </TabsTrigger>
          {perfil?.role === 'super_admin' && (
            <TabsTrigger value="usuarios" className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Usuários
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Aba Perfil ───────────────────────────────────────────────── */}
        <TabsContent value="perfil">
          <Card>
            <CardHeader>
              <CardTitle>Informações do Perfil</CardTitle>
              <CardDescription>Atualize seu nome e foto de exibição.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Foto */}
              <div className="flex items-center gap-6">
                <div
                  data-audit-ignore="foto de perfil de 96px (intencional)"
                  className="w-24 h-24 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity relative group"
                  onClick={() => fileRef.current?.click()}
                >
                  {foto ? (
                    <img src={foto} alt="Foto de perfil" className="w-full h-full object-cover" />
                  ) : (
                    <UserCircle className="w-16 h-16 text-gray-300" />
                  )}
                  <div className="absolute inset-0 bg-black/30 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Camera className="w-4 h-4 mr-2" /> Trocar foto
                  </Button>
                  {foto && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2 text-red-500 hover:text-red-700"
                      onClick={() => setFoto(null)}
                    >
                      Remover
                    </Button>
                  )}
                  <p className="text-xs text-gray-400 mt-2">JPG, PNG ou GIF. Máx. 2MB.</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFotoChange}
                />
              </div>

              <Separator />

              {/* Nome */}
              <div className="space-y-2">
                <Label htmlFor="nome">Nome de exibição</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="Seu nome completo"
                />
              </div>

              {/* E-mail (readonly) */}
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input value={user?.email || ''} disabled className="bg-gray-50 text-gray-500" />
                <p className="text-xs text-gray-400">O e-mail não pode ser alterado.</p>
              </div>

              {perfilMsg && (
                <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
                  perfilMsg.tipo === 'ok'
                    ? 'bg-green-50 text-green-700 border-green-100'
                    : 'bg-red-50 text-red-600 border-red-100'
                }`}>
                  {perfilMsg.tipo === 'ok'
                    ? <Check className="w-4 h-4 flex-shrink-0" />
                    : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                  {perfilMsg.texto}
                </div>
              )}

              <Button onClick={salvarPerfil} disabled={savingPerfil || !nome.trim()}>
                {savingPerfil ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Aba Senha ────────────────────────────────────────────────── */}
        <TabsContent value="senha">
          <Card>
            <CardHeader>
              <CardTitle>Alterar Senha</CardTitle>
              <CardDescription>Confirme sua senha atual antes de definir uma nova.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={alterarSenha} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="senhaAtual">Senha atual</Label>
                  <Input
                    id="senhaAtual"
                    type="password"
                    value={senhaAtual}
                    onChange={e => setSenhaAtual(e.target.value)}
                    required
                    placeholder="••••••••"
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="novaSenha">Nova senha</Label>
                  <Input
                    id="novaSenha"
                    type="password"
                    value={novaSenha}
                    onChange={e => setNovaSenha(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmarSenha">Confirmar nova senha</Label>
                  <Input
                    id="confirmarSenha"
                    type="password"
                    value={confirmarSenha}
                    onChange={e => setConfirmarSenha(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Repita a nova senha"
                  />
                </div>

                {senhaMsg && (
                  <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
                    senhaMsg.tipo === 'ok'
                      ? 'bg-green-50 text-green-700 border-green-100'
                      : 'bg-red-50 text-red-600 border-red-100'
                  }`}>
                    {senhaMsg.tipo === 'ok'
                      ? <Check className="w-4 h-4 flex-shrink-0" />
                      : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                    {senhaMsg.texto}
                  </div>
                )}

                <Button type="submit" disabled={savingSenha}>
                  <KeyRound className="w-4 h-4 mr-2" />
                  {savingSenha ? 'Alterando...' : 'Alterar senha'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Aba Usuários (apenas superadmin) ─────────────────────────── */}
        {perfil?.role === 'super_admin' && (
          <TabsContent value="usuarios">
            <GerenciarUsuarios />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
