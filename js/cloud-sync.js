/* Ponte do CicloFit para o Supabase Auth + Postgres (RLS).
 * Não envia service_role. Criar/apagar aluno usa Edge Functions no projeto.
 */
(function(){
  const cfg = window.CICLOFIT_CLOUD_CONFIG || {};
  const supabaseUrl = String(cfg.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = String(cfg.supabaseAnonKey || cfg.supabaseKey || '');
  const ready = cfg.enabled !== false && !!supabaseUrl && !!supabaseAnonKey && typeof window.supabase?.createClient === 'function';
  const client = ready ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  function asError(error, fallback){
    if(!error) return new Error(fallback);
    if(error instanceof Error) return error;
    return new Error(error.message || error.error_description || fallback);
  }

  async function functionError(error, fallback){
    if(!error) return new Error(fallback);
    try{
      const body = await error.context?.json?.();
      if(body?.error) return new Error(body.error);
    }catch(_){}
    return asError(error, fallback);
  }

  function toPublicUser(row){
    if(!row) return null;
    const extras = row.extras && typeof row.extras === 'object' ? row.extras : {};
    const role = String(row.role || 'student').toLowerCase() === 'admin' ? 'admin' : 'student';
    const profile = {
      name: row.name || '',
      birthDate: row.birth_date || extras.birthDate || '',
      age: extras.age || '',
      phone: row.phone || '',
      weight: row.weight ?? '',
      height: row.height ?? '',
      goal: row.goal || 'Melhorar condicionamento',
      level: row.level || 'Iniciante',
      maxHr: row.max_hr ?? '',
      ftp: row.ftp ?? '',
      photo: row.photo_path || extras.photo || ''
    };
    return {
      id: row.id,
      name: row.name || '',
      email: row.email || '',
      username: row.username || row.email || '',
      role,
      active: row.active !== false,
      profile
    };
  }

  function profilePatch(profile){
    const p = profile && typeof profile === 'object' ? profile : {};
    const num = (v) => {
      if(v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      name: String(p.name || '').trim(),
      phone: p.phone || null,
      birth_date: p.birthDate || null,
      weight: num(p.weight),
      height: num(p.height),
      goal: p.goal || null,
      level: p.level || null,
      max_hr: num(p.maxHr),
      ftp: num(p.ftp),
      photo_path: p.photo || null,
      extras: { age: p.age || '' },
      updated_at: new Date().toISOString()
    };
  }

  async function currentUserId(){
    const { data, error } = await client.auth.getUser();
    if(error || !data?.user?.id) throw asError(error, 'Sessão online ausente.');
    return data.user;
  }

  async function loadProfileRow(userId){
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if(error) throw asError(error, 'Não foi possível carregar o perfil.');
    return toPublicUser(data);
  }

  window.CicloFitCloud = {
    enabled: ready,

    async getSession(){
      if(!ready) return { session: null, error: null };
      try{
        const { data, error } = await client.auth.getSession();
        if(error) throw error;
        const user = data?.session?.user;
        if(!user) return { session: null, error: null };
        const profile = await loadProfileRow(user.id);
        if(!profile) return { session: null, error: new Error('Perfil do usuário não encontrado.') };
        return { session: { user: { ...profile, email: user.email } }, error: null };
      }catch(error){
        return { session: null, error: asError(error, 'Sessão online inválida.') };
      }
    },

    async signIn(email, password){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const login = String(email || '').trim();
        const { data, error } = await client.auth.signInWithPassword({ email: login, password });
        if(error) throw error;
        if(!data?.user?.id) throw new Error('O Supabase não retornou uma sessão válida.');
        const profile = await loadProfileRow(data.user.id);
        return { data: { user: { id: data.user.id, email: data.user.email, ...(profile || {}) } }, error: null };
      }catch(error){
        return { data: null, error: asError(error, 'Usuário ou senha inválidos.') };
      }
    },

    async signUp({ email, password, name, username }){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const { data, error } = await client.auth.signUp({
          email: String(email || '').trim().toLowerCase(),
          password,
          options: { data: { name: String(name || '').trim(), username: String(username || email || '').trim() } }
        });
        if(error) throw error;
        return { data: { user: data.user, session: data.session }, error: null };
      }catch(error){
        return { data: null, error: asError(error, 'Não foi possível criar a conta.') };
      }
    },

    async signOut(){
      if(ready) await client.auth.signOut();
      return { error: null };
    },

    async getProfile(userId){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const user = await currentUserId();
        if(userId != null && String(user.id) !== String(userId)){
          return { data: null, error: new Error('A sessão online não corresponde ao usuário solicitado.') };
        }
        const profile = await loadProfileRow(user.id);
        return { data: profile, error: profile ? null : new Error('Perfil do usuário não encontrado.') };
      }catch(error){
        return { data: null, error: asError(error, 'Não foi possível carregar o perfil.') };
      }
    },

    async getMyProfile(){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const user = await currentUserId();
        const profile = await loadProfileRow(user.id);
        return { data: profile, error: profile ? null : new Error('Perfil do usuário não encontrado.') };
      }catch(error){
        return { data: null, error };
      }
    },

    async updateMyProfile(profile){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const user = await currentUserId();
        const patch = profilePatch(profile);
        if(!patch.name) delete patch.name;
        const { data, error } = await client.from('profiles').update(patch).eq('id', user.id).select('*').single();
        if(error) throw error;
        return { data: toPublicUser(data), error: null };
      }catch(error){
        return { data: null, error: asError(error, 'Não foi possível salvar o perfil.') };
      }
    },

    async createStudent({ name, email, password, username }){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const { data, error } = await client.functions.invoke('create-student', {
          body: { name, email, password, username }
        });
        if(error) throw await functionError(error, 'Não foi possível criar o aluno.');
        if(data?.error) throw new Error(data.error);
        return { data: { profile: toPublicUser(data.profile) || data.profile }, error: null };
      }catch(error){
        return { data: null, error: asError(error, 'Não foi possível criar o aluno.') };
      }
    },

    async deleteStudent(id){
      if(!ready) return { ok: false, error: new Error('Supabase não configurado.') };
      try{
        const { data, error } = await client.functions.invoke('manage-student', {
          body: { action: 'delete', id }
        });
        if(error) throw await functionError(error, 'Não foi possível excluir o aluno.');
        if(data?.error) throw new Error(data.error);
        return { ok: true, error: null };
      }catch(error){
        return { ok: false, error: asError(error, 'Não foi possível excluir o aluno.') };
      }
    },

    async updateStudent(id, payload){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const { data, error } = await client.functions.invoke('manage-student', {
          body: { action: 'update', id, ...payload }
        });
        if(error) throw await functionError(error, 'Não foi possível atualizar o aluno.');
        if(data?.error) throw new Error(data.error);
        return { data: toPublicUser(data.profile) || data.profile, error: null };
      }catch(error){
        return { data: null, error: asError(error, 'Não foi possível atualizar o aluno.') };
      }
    },

    async listStudents(){
      if(!ready) return { data: null, error: new Error('Supabase não configurado.') };
      try{
        const { data, error } = await client.from('profiles')
          .select('*')
          .in('role', ['student', 'aluno'])
          .order('created_at', { ascending: false });
        if(error) throw error;
        return { data: (data || []).map(toPublicUser), error: null };
      }catch(error){
        return { data: null, error: asError(error, 'Não foi possível listar os alunos.') };
      }
    },

    async ping(){
      if(!ready) return { ok: false, error: new Error('Supabase não configurado.') };
      try{
        const { error } = await client.from('app_health').select('id').limit(1);
        if(error) throw error;
        return { ok: true, error: null };
      }catch(error){
        return { ok: false, error: asError(error, 'Banco de dados desligado ou projeto indisponível.') };
      }
    },

    async saveState(_scopeKey, payload){
      if(!ready) return { ok: false, error: new Error('Supabase não configurado.') };
      try{
        const user = await currentUserId();
        const { error } = await client.from('app_state').upsert({
          scope_key: user.id,
          payload: payload || {},
          updated_at: new Date().toISOString()
        });
        if(error) throw error;
        return { ok: true, error: null };
      }catch(error){
        return { ok: false, error: asError(error, 'Falha ao sincronizar dados.') };
      }
    },

    async loadState(_scopeKey){
      if(!ready) return { ok: false, data: null, error: new Error('Supabase não configurado.') };
      try{
        const user = await currentUserId();
        const { data, error } = await client.from('app_state').select('payload, updated_at').eq('scope_key', user.id).maybeSingle();
        if(error) throw error;
        return { ok: true, data: data || null, error: null };
      }catch(error){
        return { ok: false, data: null, error: asError(error, 'Falha ao carregar dados.') };
      }
    },

    async loadSharedState(){
      if(!ready) return { ok: false, data: null, error: new Error('Supabase não configurado.') };
      try{
        await currentUserId();
        const { data, error } = await client.from('app_state').select('payload, updated_at').eq('scope_key', 'shared').maybeSingle();
        if(error) throw error;
        return { ok: true, data: data || null, error: null };
      }catch(error){
        return { ok: false, data: null, error: asError(error, 'Falha ao carregar dados administrativos.') };
      }
    },

    async saveSharedState(payload){
      if(!ready) return { ok: false, error: new Error('Supabase não configurado.') };
      try{
        await currentUserId();
        const { error } = await client.from('app_state').upsert({
          scope_key: 'shared',
          payload: payload || {},
          updated_at: new Date().toISOString()
        });
        if(error) throw error;
        return { ok: true, error: null };
      }catch(error){
        return { ok: false, error: asError(error, 'Falha ao sincronizar dados administrativos.') };
      }
    }
  };
})();
