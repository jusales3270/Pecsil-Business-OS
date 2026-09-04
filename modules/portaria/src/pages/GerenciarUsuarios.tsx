import { useState, useEffect } from 'react';
import { supabase, supabaseAdmin } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { useAuth, type Perfil } from "../contexts/AuthContext";
import { ShieldAlert, UserPlus, Users, Trash2, AlertTriangle, ShieldCheck, Edit3, KeyRound, X, Check } from 'lucide-react';
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";

export function GerenciarUsuarios() {
  const { perfil } = useAuth();
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Criação ────────────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nome, setNome] = useState('');
  const [role, setRole] = useState<'super_admin' | 'admin' | 'user'>('user');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Edição ─────────────────────────────────────────────────────────────────
  const [editando, setEditando] = useState<Perfil | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editRole, setEditRole] = useState<'super_admin' | 'admin' | 'user'>('user');
  const [editSenha, setEditSenha] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  useEffect(() => { fetchUsuarios(); }, []);

  const fetchUsuarios = async () => {
    try {
      const client = supabaseAdmin ?? supabase;
      let query = client.from('perfis').select('*').order('created_at', { ascending: false });
      // admin não enxerga o superadmin
      if (perfil?.role === 'admin') {
        query = query.neq('role', 'super_admin');
      }
      const { data, error } = await query;
      if (error) throw error;
      setUsuarios(data || []);
    } catch (err) {
      console.error('Erro ao buscar usuários:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      if (!supabaseAdmin) throw new Error('Chave VITE_SUPABASE_SERVICE_ROLE_KEY não configurada no .env.');

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome },
      });
      if (authError) throw authError;

      if (role !== 'user' && authData.user) {
        await supabase.from('perfis').update({ role }).eq('id', authData.user.id);
      }

      setSuccess(`Usuário ${nome} criado com sucesso!`);
      setNome(''); setEmail(''); setPassword(''); setRole('user');
      fetchUsuarios();
    } catch (err: any) {
      setError(err.message || 'Erro ao criar usuário');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este usuário?')) return;
    try {
      if (!supabaseAdmin) throw new Error('Chave de admin não configurada. Verifique o .env.');
      // Remove da tabela perfis primeiro (evita conflito de FK)
      await supabase.from('perfis').delete().eq('id', id);
      const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (error) throw error;
      setUsuarios(prev => prev.filter(u => u.id !== id));
    } catch (err: any) {
      alert(err.message || 'Erro ao remover usuário');
    }
  };

  const abrirEdicao = (u: Perfil) => {
    setEditando(u);
    setEditNome(u.nome);
    setEditRole(u.role);
    setEditSenha('');
    setEditError(null);
    setEditSuccess(null);
  };

  const salvarEdicao = async () => {
    if (!editando) return;
    setSaving(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      // Atualiza nome e role na tabela perfis
      const { error: perfilError } = await supabase
        .from('perfis')
        .update({ nome: editNome, role: editRole })
        .eq('id', editando.id);
      if (perfilError) throw perfilError;

      // Atualiza senha se preenchida
      if (editSenha) {
        if (editSenha.length < 6) throw new Error('A nova senha deve ter no mínimo 6 caracteres.');
        if (!supabaseAdmin) throw new Error('Chave de admin não configurada.');
        const { error: senhaError } = await supabaseAdmin.auth.admin.updateUserById(editando.id, {
          password: editSenha,
        });
        if (senhaError) throw senhaError;
      }

      setEditSuccess('Usuário atualizado com sucesso!');
      setUsuarios(prev =>
        prev.map(u => u.id === editando.id ? { ...u, nome: editNome, role: editRole } : u)
      );
    } catch (err: any) {
      setEditError(err.message || 'Erro ao salvar alterações.');
    } finally {
      setSaving(false);
    }
  };

  if (perfil?.role !== 'super_admin' && perfil?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <ShieldAlert className="w-16 h-16 text-red-300" />
        <h2 className="text-xl font-semibold text-gray-700">Acesso Restrito</h2>
        <p className="text-gray-500">Apenas administradores podem gerenciar usuários.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600" /> Gerenciar Usuários
        </h2>
        <p className="text-gray-500 mt-1">Crie, edite e gerencie os acessos ao sistema.</p>
      </div>

      {/* ── Criar Usuário ──────────────────────────────────────────────────── */}
      <Card className="shadow-sm border-blue-100">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" /> Novo Usuário
          </CardTitle>
          <CardDescription>Preencha os dados para criar um novo acesso.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateUser} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm flex items-center gap-2 border border-green-100">
                <ShieldCheck className="w-4 h-4 flex-shrink-0" /> {success}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input placeholder="Nome completo" value={nome} onChange={e => setNome(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>E-mail</Label>
                <Input type="email" placeholder="email@pecsil.com.br" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Senha</Label>
                <Input type="password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="space-y-1">
                <Label>Perfil</Label>
                <Select value={role} onValueChange={(v: string) => setRole(v as 'super_admin' | 'admin' | 'user')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuário</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                    {perfil?.role === 'super_admin' && (
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" disabled={creating} className="bg-blue-600 hover:bg-blue-700">
              <UserPlus className="w-4 h-4 mr-2" />
              {creating ? 'Criando...' : 'Criar Usuário'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Lista de Usuários ──────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-600" /> Usuários Cadastrados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-gray-400 text-sm py-4 text-center">Carregando...</p>
          ) : (
            <div className="divide-y">
              {usuarios.map(u => (
                <div key={u.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                      {u.nome.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{u.nome}</p>
                      <p className="text-xs text-gray-400">{u.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={u.role !== 'user' ? 'default' : 'outline'}
                      className={u.role === 'super_admin' ? 'bg-purple-600' : u.role === 'admin' ? 'bg-blue-600' : ''}
                    >
                      {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'Usuário'}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-blue-600"
                      onClick={() => abrirEdicao(u)} title="Editar usuário">
                      <Edit3 className="w-4 h-4" />
                    </Button>
                    {u.id !== perfil?.id && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600"
                        onClick={() => handleDeleteUser(u.id)} title="Remover usuário">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {usuarios.length === 0 && (
                <p className="text-center text-gray-400 py-6 text-sm">Nenhum usuário encontrado.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Modal de Edição ────────────────────────────────────────────────── */}
      <Dialog open={!!editando} onOpenChange={(open: boolean) => { if (!open) setEditando(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5" /> Editar Usuário
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {editError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {editError}
              </div>
            )}
            {editSuccess && (
              <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm flex items-center gap-2 border border-green-100">
                <Check className="w-4 h-4 flex-shrink-0" /> {editSuccess}
              </div>
            )}

            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={editNome} onChange={e => setEditNome(e.target.value)} placeholder="Nome completo" />
            </div>

            <div className="space-y-1">
              <Label>Perfil</Label>
              <Select value={editRole} onValueChange={(v: string) => setEditRole(v as 'super_admin' | 'admin' | 'user')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                  {perfil?.role === 'super_admin' && (
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-1">
              <Label className="flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5" /> Nova Senha
                <span className="text-gray-400 text-xs font-normal ml-1">(deixe em branco para não alterar)</span>
              </Label>
              <Input
                type="password"
                value={editSenha}
                onChange={e => setEditSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={salvarEdicao} disabled={saving || !editNome.trim()}>
              <Check className="w-4 h-4 mr-1" />
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
