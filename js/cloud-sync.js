/* Ponte do CicloFit para o Supabase Auth + Postgres (RLS).
 * Não envia service_role. Criar/apagar aluno usa Edge Functions no projeto.
 */
(function(){
  const cfg = window.CICLOFIT_CLOUD_CONFIG || {};
  const supabaseUrl = String(cfg.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = String(cfg.supabaseAnonKey || cfg.supabaseKey || '');

  const ready =
    cfg.enabled !== false &&
    !!supabaseUrl &&
    !!supabaseAnonKey &&
    typeof window.supabase?.createClient === 'function';

  const client = ready
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;


  function asError(error, fallback){
    if(!error) return new Error(fallback);
    if(error instanceof Error) return error;

    return new Error(
      error.message ||
      error.error_description ||
      fallback
    );
  }


  async function functionError(error, fallback){
    if(!error) return new Error(fallback);

    try{
      const body = await error.context?.json?.();

      if(body?.error){
        return new Error(body.error);
      }
    }catch(_){}

    return asError(error, fallback);
  }


  /*
   * Converte o registro real do Supabase para o formato
   * utilizado pelo CicloFit.
   *
   * IMPORTANTE:
   * weight, height, goal, level, maxHr e ftp
   * ficam dentro de profiles.extras.
   */
  function toPublicUser(row){
    if(!row) return null;

    const extras =
      row.extras && typeof row.extras === 'object'
        ? row.extras
        : {};

    const role =
      String(row.role || 'student').toLowerCase() === 'admin'
        ? 'admin'
        : 'student';

    const profile = {
      name: row.name || '',

      birthDate:
        row.birth_date ||
        extras.birthDate ||
        '',

      age:
        extras.age ??
        '',

      phone:
        row.phone ||
        '',

      weight:
        extras.weight ??
        '',

      height:
        extras.height ??
        '',

      goal:
        extras.goal ||
        'Melhorar condicionamento',

      level:
        extras.level ||
        'Iniciante',

      maxHr:
        extras.maxHr ??
        '',

      ftp:
        extras.ftp ??
        '',

      photo:
        row.photo_url ||
        extras.photo ||
        ''
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


  /*
   * Monta os dados que serão enviados ao Supabase.
   *
   * A tabela profiles NÃO possui colunas:
   * weight
   * height
   * goal
   * level
   * max_hr
   * ftp
   *
   * Esses campos são armazenados dentro de profiles.extras.
   */
  function profilePatch(profile, existingExtras){
    const p =
      profile && typeof profile === 'object'
        ? profile
        : {};

    const num = (value) => {
      if(value === '' || value == null){
        return null;
      }

      const number = Number(value);

      return Number.isFinite(number)
        ? number
        : null;
    };

    const currentExtras =
      existingExtras && typeof existingExtras === 'object'
        ? existingExtras
        : {};

    return {
      name: String(p.name || '').trim(),

      phone:
        p.phone ||
        null,

      birth_date:
        p.birthDate ||
        null,

      photo_url:
        p.photo ||
        null,

      /*
       * Campos complementares ficam dentro de extras.
       * Mantemos qualquer outro dado que já exista em extras.
       */
      extras: {
        ...currentExtras,

        age:
          p.age ||
          '',

        weight:
          num(p.weight),

        height:
          num(p.height),

        goal:
          p.goal ||
          '',

        level:
          p.level ||
          '',

        maxHr:
          num(p.maxHr),

        ftp:
          num(p.ftp),

        photo:
          p.photo ||
          ''
      },

      updated_at:
        new Date().toISOString()
    };
  }


  async function currentUserId(){
    const {
      data,
      error
    } = await client.auth.getUser();

    if(error || !data?.user?.id){
      throw asError(
        error,
        'Sessão online ausente.'
      );
    }

    return data.user;
  }


  async function loadProfileRow(userId){
    const {
      data,
      error
    } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if(error){
      throw asError(
        error,
        'Não foi possível carregar o perfil.'
      );
    }

    return toPublicUser(data);
  }


  window.CicloFitCloud = {

    enabled: ready,


    /*
     * Recupera a sessão atual.
     */
    async getSession(){
      if(!ready){
        return {
          session: null,
          error: null
        };
      }

      try{
        const {
          data,
          error
        } = await client.auth.getSession();

        if(error){
          throw error;
        }

        const user =
          data?.session?.user;

        if(!user){
          return {
            session: null,
            error: null
          };
        }

        const profile =
          await loadProfileRow(user.id);

        if(!profile){
          return {
            session: null,
            error: new Error(
              'Perfil do usuário não encontrado.'
            )
          };
        }

        return {
          session: {
            user: {
              ...profile,
              email: user.email
            }
          },
          error: null
        };

      }catch(error){
        return {
          session: null,
          error: asError(
            error,
            'Sessão online inválida.'
          )
        };
      }
    },


    /*
     * Login.
     */
    async signIn(email, password){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const login =
          String(email || '').trim();

        const {
          data,
          error
        } = await client.auth.signInWithPassword({
          email: login,
          password
        });

        if(error){
          throw error;
        }

        if(!data?.user?.id){
          throw new Error(
            'O Supabase não retornou uma sessão válida.'
          );
        }

        const profile =
          await loadProfileRow(data.user.id);

        return {
          data: {
            user: {
              id: data.user.id,
              email: data.user.email,
              ...(profile || {})
            }
          },
          error: null
        };

      }catch(error){
        return {
          data: null,
          error: asError(
            error,
            'Usuário ou senha inválidos.'
          )
        };
      }
    },


    /*
     * Cadastro.
     */
    async signUp({
      email,
      password,
      name,
      username
    }){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const {
          data,
          error
        } = await client.auth.signUp({
          email:
            String(email || '')
              .trim()
              .toLowerCase(),

          password,

          options: {
            data: {
              name:
                String(name || '')
                  .trim(),

              username:
                String(
                  username ||
                  email ||
                  ''
                ).trim()
            }
          }
        });

        if(error){
          throw error;
        }

        return {
          data: {
            user: data.user,
            session: data.session
          },
          error: null
        };

      }catch(error){
        return {
          data: null,
          error: asError(
            error,
            'Não foi possível criar a conta.'
          )
        };
      }
    },


    /*
     * Logout.
     */
    async signOut(){
      if(ready){
        await client.auth.signOut();
      }

      return {
        error: null
      };
    },


    /*
     * Busca perfil.
     */
    async getProfile(userId){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const user =
          await currentUserId();

        if(
          userId != null &&
          String(user.id) !== String(userId)
        ){
          return {
            data: null,
            error: new Error(
              'A sessão online não corresponde ao usuário solicitado.'
            )
          };
        }

        const profile =
          await loadProfileRow(user.id);

        return {
          data: profile,
          error: profile
            ? null
            : new Error(
                'Perfil do usuário não encontrado.'
              )
        };

      }catch(error){
        return {
          data: null,
          error: asError(
            error,
            'Não foi possível carregar o perfil.'
          )
        };
      }
    },


    /*
     * Busca o próprio perfil.
     */
    async getMyProfile(){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const user =
          await currentUserId();

        const profile =
          await loadProfileRow(user.id);

        return {
          data: profile,
          error: profile
            ? null
            : new Error(
                'Perfil do usuário não encontrado.'
              )
        };

      }catch(error){
        return {
          data: null,
          error
        };
      }
    },


    /*
     * Atualiza o próprio perfil.
     *
     * CORREÇÃO PRINCIPAL:
     * weight, height, goal, level, maxHr e ftp
     * são gravados dentro de profiles.extras.
     */
    async updateMyProfile(profile){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const user =
          await currentUserId();


        /*
         * Primeiro recuperamos extras existentes.
         *
         * Isso evita apagar outros dados que já estejam
         * armazenados no JSONB.
         */
        const {
          data: current,
          error: readError
        } = await client
          .from('profiles')
          .select('extras')
          .eq('id', user.id)
          .maybeSingle();

        if(readError){
          throw readError;
        }


        const patch =
          profilePatch(
            profile,
            current?.extras
          );


        /*
         * Não sobrescrevemos o nome com vazio.
         */
        if(!patch.name){
          delete patch.name;
        }


        const {
          data,
          error
        } = await client
          .from('profiles')
          .update(patch)
          .eq('id', user.id)
          .select('*')
          .single();

        if(error){
          throw error;
        }

        return {
          data: toPublicUser(data),
          error: null
        };

      }catch(error){
        return {
          data: null,
          error: asError(
            error,
            'Não foi possível salvar o perfil.'
          )
        };
      }
    },


    /*
     * Cria aluno através da Edge Function.
     */
    async createStudent({
      name,
      email,
      password,
      username
    }){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const {
          data,
          error
        } = await client.functions.invoke(
          'create-student',
          {
            body: {
              name,
              email,
              password,
              username
            }
          }
        );

        if(error){
          throw await functionError(
            error,
            'Não foi possível criar o aluno.'
          );
        }

        if(data?.error){
          throw new Error(data.error);
        }

        return {
          data: {
            profile:
              toPublicUser(data.profile) ||
              data.profile
          },
          error: null
        };

      }catch(error){
        return {
          data: null,
          error: asError(
            error,
            'Não foi possível criar o aluno.'
          )
        };
      }
    },


    /*
     * Exclui aluno.
     */
    async deleteStudent(id){
      if(!ready){
        return {
          ok: false,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const {
          data,
          error
        } = await client.functions.invoke(
          'manage-student',
          {
            body: {
              action: 'delete',
              id
            }
          }
        );

        if(error){
          throw await functionError(
            error,
            'Não foi possível excluir o aluno.'
          );
        }

        if(data?.error){
          throw new Error(data.error);
        }

        return {
          ok: true,
          error: null
        };

      }catch(error){
        return {
          ok: false,
          error: asError(
            error,
            'Não foi possível excluir o aluno.'
          )
        };
      }
    },


    /*
     * Atualiza aluno pelo Admin.
     */
    async updateStudent(id, payload){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const {
          data,
          error
        } = await client.functions.invoke(
          'manage-student',
          {
            body: {
              action: 'update',
              id,
              ...payload
            }
          }
        );

        if(error){
          throw await functionError(
            error,
            'Não foi possível atualizar o aluno.'
          );
        }

        if(data?.error){
          throw new Error(data.error);
        }

        return {
          data:
            toPublicUser(data.profile) ||
            data.profile,
          error: null
        };

      }catch(error){
        return {
          data: null,
          error: asError(
            error,
            'Não foi possível atualizar o aluno.'
          )
        };
      }
    },


    /*
     * Lista alunos.
     */
    async listStudents(){
      if(!ready){
        return {
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const {
          data,
          error
        } = await client
          .from('profiles')
          .select('*')
          .in('role', [
            'student',
            'aluno'
          ])
          .order(
            'created_at',
            {
              ascending: false
            }
          );

        if(error){
          throw error;
        }

        return {
          data:
            (data || [])
              .map(toPublicUser),

          error: null
        };

      }catch(error){
        return {
          data: null,
          error: asError(
            error,
            'Não foi possível listar os alunos.'
          )
        };
      }
    },


    /*
     * Teste de conexão.
     */
    async ping(){
      if(!ready){
        return {
          ok: false,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const {
          error
        } = await client
          .from('app_health')
          .select('id')
          .limit(1);

        if(error){
          throw error;
        }

        return {
          ok: true,
          error: null
        };

      }catch(error){
        return {
          ok: false,
          error: asError(
            error,
            'Banco de dados desligado ou projeto indisponível.'
          )
        };
      }
    },


    /*
     * Salva estado individual do usuário.
     */
    async saveState(_scopeKey, payload){
      if(!ready){
        return {
          ok: false,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const user =
          await currentUserId();

        const {
          error
        } = await client
          .from('app_state')
          .upsert({
            scope_key: user.id,
            payload: payload || {},
            updated_at:
              new Date().toISOString()
          });

        if(error){
          throw error;
        }

        return {
          ok: true,
          error: null
        };

      }catch(error){
        return {
          ok: false,
          error: asError(
            error,
            'Falha ao sincronizar dados.'
          )
        };
      }
    },


    /*
     * Carrega estado individual do usuário.
     */
    async loadState(_scopeKey){
      if(!ready){
        return {
          ok: false,
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        const user =
          await currentUserId();

        const {
          data,
          error
        } = await client
          .from('app_state')
          .select(
            'payload, updated_at'
          )
          .eq(
            'scope_key',
            user.id
          )
          .maybeSingle();

        if(error){
          throw error;
        }

        return {
          ok: true,
          data: data || null,
          error: null
        };

      }catch(error){
        return {
          ok: false,
          data: null,
          error: asError(
            error,
            'Falha ao carregar dados.'
          )
        };
      }
    },


    /*
     * Carrega estado compartilhado administrativo.
     */
    async loadSharedState(){
      if(!ready){
        return {
          ok: false,
          data: null,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        await currentUserId();

        const {
          data,
          error
        } = await client
          .from('app_state')
          .select(
            'payload, updated_at'
          )
          .eq(
            'scope_key',
            'shared'
          )
          .maybeSingle();

        if(error){
          throw error;
        }

        return {
          ok: true,
          data: data || null,
          error: null
        };

      }catch(error){
        return {
          ok: false,
          data: null,
          error: asError(
            error,
            'Falha ao carregar dados administrativos.'
          )
        };
      }
    },


    /*
     * Salva estado compartilhado administrativo.
     */
    async saveSharedState(payload){
      if(!ready){
        return {
          ok: false,
          error: new Error(
            'Supabase não configurado.'
          )
        };
      }

      try{
        await currentUserId();

        const {
          error
        } = await client
          .from('app_state')
          .upsert({
            scope_key: 'shared',
            payload: payload || {},
            updated_at:
              new Date().toISOString()
          });

        if(error){
          throw error;
        }

        return {
          ok: true,
          error: null
        };

      }catch(error){
        return {
          ok: false,
          error: asError(
            error,
            'Falha ao sincronizar dados administrativos.'
          )
        };
      }
    }

  };

})();