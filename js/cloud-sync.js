/* Ponte do CicloFit para o backend online.
 * A autenticação e o isolamento dos estados são feitos pelo JWT no servidor.
 * Este arquivo não escolhe o usuário pelo scopeKey: /api/state sempre usa req.user.id.
 */
(function(){
  const cfg = window.CICLOFIT_CLOUD_CONFIG || {};
  const baseUrl = String(cfg.apiUrl || '').replace(/\/$/, '');
  const ready = cfg.enabled !== false;
  let token = localStorage.getItem('ciclofit_token') || '';

  async function api(path, options={}){
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(token)headers.Authorization=`Bearer ${token}`;
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),5000);
    let response;
    try{
      response=await fetch(baseUrl+path,{...options,headers,cache:'no-store',signal:ctrl.signal});
    }catch(error){
      const aborted=error?.name==='AbortError';
      throw new Error(aborted?'O servidor não respondeu a tempo.':'Servidor ou banco indisponível.');
    }finally{
      clearTimeout(timer);
    }
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      if([404,502,503,504].includes(response.status)||body.database===false){
        throw new Error('Banco de dados desligado ou servidor offline.');
      }
      throw new Error(body.error||'Erro na operação.');
    }
    return body;
  }

  window.CicloFitCloud = {
    enabled: ready,

    async getSession(){
      if(!token)return {session:null,error:null};
      try{
        const data=await api('/api/auth/session');
        if(!data?.user?.id)throw new Error('Sessão online inválida.');
        return {session:{user:data.user},error:null};
      }catch(error){
        token='';
        localStorage.removeItem('ciclofit_token');
        return {session:null,error};
      }
    },

    async signIn(email,password){
      try{
        const data=await api('/api/auth/login',{
          method:'POST',
          body:JSON.stringify({email,password})
        });
        if(!data?.token||!data?.user?.id)throw new Error('O servidor não retornou uma sessão válida.');
        token=data.token;
        localStorage.setItem('ciclofit_token',token);
        return {data:{user:data.user},error:null};
      }catch(error){
        return {data:null,error};
      }
    },

    async signUp({email,password,name,username}){
      try{
        const data=await api('/api/auth/register',{
          method:'POST',
          body:JSON.stringify({email,password,name,username})
        });
        token=data.token;
        localStorage.setItem('ciclofit_token',token);
        return {data:{user:data.user,session:{user:data.user}},error:null};
      }catch(error){
        return {data:null,error};
      }
    },

    async signOut(){
      token='';
      localStorage.removeItem('ciclofit_token');
      return {error:null};
    },

    async getProfile(userId){
      const session=await this.getSession();
      const sessionUser=session.session?.user;
      if(!sessionUser)return {data:null,error:session.error};
      if(userId!=null && String(sessionUser.id)!==String(userId)){
        return {data:null,error:new Error('A sessão online não corresponde ao usuário solicitado.')};
      }
      return {data:sessionUser,error:null};
    },

    async getMyProfile(){
      try{return {data:await api('/api/profile'),error:null}}
      catch(error){return {data:null,error}}
    },

    async updateMyProfile(profile){
      try{return {data:await api('/api/profile',{method:'PUT',body:JSON.stringify({profile})}),error:null}}
      catch(error){return {data:null,error}}
    },

    async createStudent({name,email,password,username}){
      try{
        return {data:{profile:await api('/api/admin/users',{
          method:'POST',
          body:JSON.stringify({name,email,password,username})
        })},error:null};
      }catch(error){return {data:null,error}}
    },

    async deleteStudent(id){
      try{
        await api(`/api/admin/users/${encodeURIComponent(id)}`,{method:'DELETE'});
        return {ok:true,error:null};
      }catch(error){return {ok:false,error}}
    },

    async updateStudent(id,payload){
      try{
        return {data:await api(`/api/admin/users/${encodeURIComponent(id)}`,{
          method:'PATCH',
          body:JSON.stringify(payload)
        }),error:null};
      }catch(error){return {data:null,error}}
    },

    async listStudents(){
      try{return {data:await api('/api/admin/users'),error:null}}
      catch(error){return {data:null,error}}
    },

    async ping(){
      try{await api('/api/health');return {ok:true,error:null}}
      catch(error){return {ok:false,error}}
    },

    async saveState(scopeKey,payload){
      try{
        // scopeKey é mantido na assinatura para compatibilidade com app.js.
        // O backend ignora esse valor e usa o usuário do JWT.
        const session=await this.getSession();
        if(!session.session?.user?.id){
          return {ok:false,error:session.error||new Error('Sessão online ausente.')};
        }
        await api('/api/state',{
          method:'PUT',
          body:JSON.stringify({payload,updatedAt:new Date().toISOString()})
        });
        return {ok:true,error:null};
      }catch(error){
        return {ok:false,error};
      }
    },

    async loadState(scopeKey){
      try{
        const session=await this.getSession();
        if(!session.session?.user?.id){
          return {ok:false,data:null,error:session.error||new Error('Sessão online ausente.')};
        }
        const data=await api('/api/state');
        return {ok:true,data,error:null};
      }catch(error){
        return {ok:false,data:null,error};
      }
    },

    async loadSharedState(){
      try{
        const data=await api('/api/shared-state');
        return {ok:true,data,error:null};
      }catch(error){return {ok:false,data:null,error}}
    },

    async saveSharedState(payload){
      try{
        await api('/api/shared-state',{
          method:'PUT',
          body:JSON.stringify({payload,updatedAt:new Date().toISOString()})
        });
        return {ok:true,error:null};
      }catch(error){return {ok:false,error}}
    }
  };
})();
