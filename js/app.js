const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const KEY='ciclofit-v4', DB_NAME='ciclofit-db', DB_STORE='app';
const AUTH_KEY='ciclofit-auth-v1', USERS_KEY='ciclofit-users-v1', ADMIN_WORKOUTS_KEY='ciclofit-admin-workouts-v1', ADMIN_NOTIF_KEY='ciclofit-admin-notifications-v1';
function earlyAuth(){try{return JSON.parse(sessionStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
function dataStorageKey(){const a=earlyAuth();return a?.role==='student'&&a.id?`${KEY}-student-${a.id}`:`${KEY}-admin`}
const APP_VERSION='5.0.0', MAX_STORED_GPX_POINTS=1200;
const defaultData={workouts:{},workoutDrafts:{},rides:[],profile:{name:'',age:'',birthDate:'',phone:'',photo:'',weight:'',height:'',goal:'Melhorar condicionamento',level:'Iniciante',maxHr:'',ftp:''},loadDefaults:{},goals:{km:500,workouts:12,hours:30,elevation:5000},bike:{name:'',frame:'',groupset:'',wheels:'',tires:'',km:0,maintenance:2000},recovery:{},gpx:null};
const workouts={A:{title:'Treino A — Força de pernas',subtitle:'Força para subida, aceleração e resistência',icon:'🦵',duration:'45–60 min',intensity:'Moderada',exercises:[['Leg press 45°','Quadríceps + glúteos',3,10],['Cadeira extensora','Quadríceps',3,10],['Mesa flexora','Posteriores',3,10],['Hip thrust','Glúteos',3,10],['Cadeira adutora','Adutores',2,12],['Cadeira abdutora','Glúteo médio',2,12],['Panturrilha','Panturrilhas',3,12],['Prancha','Core',3,30]]},B:{title:'Treino B — Parte superior',subtitle:'Postura, controle da bicicleta e estabilidade',icon:'💪',duration:'45–60 min',intensity:'Moderada',exercises:[['Puxada frontal','Costas',3,10],['Remada baixa','Costas',3,10],['Supino máquina','Peito',3,10],['Desenvolvimento de ombros','Ombros',2,10],['Elevação lateral','Ombros',2,12],['Rosca bíceps','Bíceps',2,10],['Tríceps na polia','Tríceps',2,10],['Pallof press','Core',3,10],['Dead bug','Core',3,10]]},C:{title:'Treino C — Estabilidade para ciclismo',subtitle:'Força unilateral, estabilidade e controle',icon:'🚴',duration:'45–65 min',intensity:'Moderada',exercises:[['Agachamento no Smith','Quadríceps + glúteos',3,8],['Terra romeno com halteres','Posteriores + glúteos',3,8],['Afundo / passada','Quadríceps + glúteos',2,10],['Step-up','Glúteos + quadríceps',2,10],['Cadeira adutora','Adutores',2,12],['Cadeira abdutora','Abdutores',2,12],['Panturrilha sentado','Panturrilhas',3,12],['Tibial anterior','Tibial',2,15],['Prancha lateral','Core',2,20]]}};
let data=loadLocal(),currentWorkout=null,timerValue=60,timerBase=60,timerInterval=null,calendarDate=new Date(),deferredPrompt=null,editingRideId=null,rideInputMode='gpx';
function clone(x){return JSON.parse(JSON.stringify(x))} function mergeData(obj){const base=clone(defaultData);return {...base,...obj,profile:{...base.profile,...(obj.profile||{})},goals:{...base.goals,...(obj.goals||{})},bike:{...base.bike,...(obj.bike||{})},recovery:{...base.recovery,...(obj.recovery||{})},loadDefaults:{...base.loadDefaults,...(obj.loadDefaults||{})},workouts:obj.workouts||{},workoutDrafts:obj.workoutDrafts||{},rides:Array.isArray(obj.rides)?obj.rides:[],gpx:obj.gpx||null}} function getUserProfileSnapshot(userId){try{const users=JSON.parse(localStorage.getItem(USERS_KEY)||'[]');const u=Array.isArray(users)?users.find(x=>String(x.id)===String(userId)):null;return u?.profile&&typeof u.profile==='object'?u.profile:null}catch{return null}}
function loadLocal(){try{const key=dataStorageKey(),a=earlyAuth(),saved=localStorage.getItem(key);if(saved){const loaded=mergeData(JSON.parse(saved));if(a?.role==='student'&&a.id){const up=getUserProfileSnapshot(a.id);if(up)loaded.profile={...loaded.profile,...up}}return loaded}if(a?.role==='student'&&a.id){const legacy=a.id==='student-demo'?localStorage.getItem(KEY):null;if(legacy){const migrated=mergeData(JSON.parse(legacy));const up=getUserProfileSnapshot(a.id);if(up)migrated.profile={...migrated.profile,...up};localStorage.setItem(key,JSON.stringify(migrated));return migrated}}return clone(defaultData)}catch{return clone(defaultData)}}
let cloudSaveTimer=null,cloudSavePending=false,cloudSaveRunning=false;
let sharedSaveTimer=null,adminRefreshTimer=null;
let cloudStateHydrated=false;
let cloudStateHydrating=false;
function cloudStateKey(){const a=currentAuth?.();return a?.id?String(a.id):null}
function queueSharedSave(){
  if(currentAuth?.()?.role!=='admin')return;
  clearTimeout(sharedSaveTimer);
  sharedSaveTimer=setTimeout(async()=>{
    const cloud=window.CicloFitCloud;
    const payload={adminUsers:data.adminUsers||[],adminWorkouts:data.adminWorkouts||[],customExercises:data.customExercises||[],customWorkouts:data.customWorkouts||[],adminNotifs:data.adminNotifs||[]};
    const result=await cloud?.saveSharedState?.(payload);
    if(result&&!result.ok)console.warn('CicloFit Cloud: falha ao sincronizar dados administrativos',result.error);
  },400);
}
async function refreshAdminUsersFromCloud(){
  if(currentAuth?.()?.role!=='admin')return;
  const result=await window.CicloFitCloud?.listStudents?.();
  if(!result?.data)return;

  // IMPORTANTE: o PostgreSQL é a fonte oficial do perfil.
  // Nunca sobrescrever user.profile vindo da API com uma cópia antiga do localStorage.
  data.adminUsers=result.data.map(user=>({
    ...user,
    profile:(user.profile&&typeof user.profile==='object')?clone(user.profile):{}
  }));

  // Atualiza apenas o cache local para que a interface offline continue funcionando.
  try{
    const previous=JSON.parse(localStorage.getItem(USERS_KEY)||'[]');
    const passwords=new Map((Array.isArray(previous)?previous:[]).map(u=>[String(u.id),u.password]));
    const cache=data.adminUsers.map(user=>({...user,password:passwords.get(String(user.id))||''}));
    localStorage.setItem(USERS_KEY,JSON.stringify(cache));
  }catch(e){console.warn('Não foi possível atualizar o cache de alunos',e)}

  renderAdminStudents();
  renderAdminWorkouts();
}
async function flushCloudSave(){
  if(cloudSaveRunning)return;
  // Nunca envie o estado local inicial para a nuvem antes de terminar
  // o carregamento do estado pertencente ao usuário autenticado.
  if(!cloudStateHydrated)return;
  cloudSaveRunning=true;
  try{
    while(cloudSavePending){
      cloudSavePending=false;
      const cloud=window.CicloFitCloud,key=cloudStateKey();
      if(!cloud?.enabled||!key)continue;
      const snapshot=clone(data);
      const result=await cloud.saveState(key,snapshot);
      if(!result.ok)console.warn('CicloFit Cloud: falha ao sincronizar dados',result.error);
    }
  }finally{
    cloudSaveRunning=false;
  }
}
function queueCloudSave(){
  // Durante a inicialização online, o cache local pode ainda ser de outro
  // usuário. A gravação só fica liberada depois da hidratação correta.
  if(!cloudStateHydrated)return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>{cloudSavePending=true;flushCloudSave()},400);
}
async function loadCloudState(){
  const cloud=window.CicloFitCloud,key=cloudStateKey();
  if(!cloud?.enabled||!key)return false;

  cloudStateHydrating=true;
  cloudStateHydrated=false;
  cloudSavePending=false;
  clearTimeout(cloudSaveTimer);

  try{
    // O ID do estado é determinado pelo JWT no servidor. O scopeKey é apenas
    // uma referência local e não é usado para escolher outro usuário.
    const result=await cloud.loadState(key);
    if(!result.ok){
      console.warn('CicloFit Cloud: falha ao carregar dados',result.error);
      return false;
    }

    if(result.data?.payload){
      // Substitui integralmente o estado em memória pelo estado do usuário.
      // Isso impede que rides de outro cache/localStorage sejam misturados.
      data=mergeData(result.data.payload);
      try{
        localStorage.setItem(dataStorageKey(),JSON.stringify(data));
      }catch(e){console.warn('CicloFit Cloud: não foi possível atualizar o cache local',e)}
    }

    const account=await cloud.getMyProfile?.();
    // Perfil do banco é a fonte oficial e sempre tem prioridade sobre cache/localStorage.
    if(account?.data?.profile&&typeof account.data.profile==='object'){
      data.profile={...data.profile,...account.data.profile};
    }

    // O estado compartilhado contém somente dados administrativos/atribuições.
    // Nunca substitua data.rides, data.workouts ou o restante do estado pessoal.
    const shared=await cloud.loadSharedState?.();
    if(shared?.ok&&shared.data?.payload){
      const payload=shared.data.payload;
      data.adminUsers=Array.isArray(payload.adminUsers)?payload.adminUsers:[];
      data.adminWorkouts=Array.isArray(payload.adminWorkouts)?payload.adminWorkouts:[];
      data.customExercises=Array.isArray(payload.customExercises)?payload.customExercises:[];
      data.customWorkouts=Array.isArray(payload.customWorkouts)?payload.customWorkouts:[];
      data.adminNotifs=Array.isArray(payload.adminNotifs)?payload.adminNotifs:[];
    }

    if(currentAuth?.()?.role==='admin'){
      await refreshAdminUsersFromCloud();
    }

    // Só depois de todo o estado pessoal ter sido carregado liberamos saves.
    cloudStateHydrated=true;

    // Conta nova sem registro ainda: cria o primeiro estado vazio somente agora.
    if(!result.data?.payload){
      queueCloudSave();
    }
    return true;
  }catch(e){
    console.warn('CicloFit Cloud: erro ao hidratar estado do usuário',e);
    return false;
  }finally{
    cloudStateHydrating=false;
  }
}
function syncStudentProfile(){try{const a=earlyAuth();if(!a||a.role!=='student'||!a.id)return;const users=JSON.parse(localStorage.getItem(USERS_KEY)||'[]');if(!Array.isArray(users))return;const idx=users.findIndex(u=>String(u.id)===String(a.id));if(idx<0)return;users[idx].profile=clone(data.profile);users[idx].name=data.profile.name||users[idx].name||'Aluno';localStorage.setItem(USERS_KEY,JSON.stringify(users))}catch(e){console.warn('Falha ao sincronizar perfil do aluno',e)}}
function save(){
  try{localStorage.setItem(dataStorageKey(),JSON.stringify(data));syncStudentProfile();queueIndexedSave();queueCloudSave();return true}
  catch(e){
    console.warn('Falha ao salvar localmente',e);
    try{
      // Mantém o GPX mais recente completo e compacta GPX antigos apenas para o armazenamento local.
      const compact=clone(data);
      if(Array.isArray(compact.rides))compact.rides=compact.rides.map(r=>r.gpx?{...r,gpx:{...r.gpx,points:[]}}:r);
      localStorage.setItem(dataStorageKey(),JSON.stringify(compact));
      syncStudentProfile();
      queueIndexedSave();
      queueCloudSave();
      return true;
    }catch(e2){toast?.('Não foi possível salvar a atividade. Exporte um backup e libere espaço no navegador.','error');return false}
  }
} function queueIndexedSave(){if(!('indexedDB'in window))return;try{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(DB_STORE))r.result.createObjectStore(DB_STORE)};r.onsuccess=()=>{const db=r.result;const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(data,`data:${dataStorageKey()}`);tx.oncomplete=()=>db.close()}}catch(e){console.warn('IndexedDB indisponível',e)}}
function iso(d=new Date()){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function calculateAge(birthDate,ref=new Date()){if(!birthDate)return '';const b=new Date(birthDate+'T12:00:00');if(Number.isNaN(b.getTime()))return '';let age=ref.getFullYear()-b.getFullYear();const m=ref.getMonth()-b.getMonth();if(m<0||(m===0&&ref.getDate()<b.getDate()))age--;return age>=0?age:''}
function exerciseKey(name){return String(name||'').trim().toLowerCase()}
function workoutDraftKey(type,date=iso()){return `${date}-${String(type||'').trim()}`;}
function saveWorkoutDraft(){
  if(!currentWorkout)return false;
  try{
    const key=workoutDraftKey(currentWorkout);
    const sets=collectWorkout();
    if(!data.workoutDrafts)data.workoutDrafts={};
    const hasProgress=sets.some(rows=>Array.isArray(rows)&&rows.some(x=>x&&(x.weight!==''||x.reps!==''||x.done)));
    if(hasProgress){
      data.workoutDrafts[key]={type:currentWorkout,sets,updatedAt:new Date().toISOString()};
    }else{
      delete data.workoutDrafts[key];
    }
    save();
    return true;
  }catch(e){console.warn('Falha ao salvar rascunho do treino',e);return false}
}
function defaultLoadForExercise(name){const k=exerciseKey(name);return data.loadDefaults?.[k]??''}
function setDefaultLoad(name,value){const k=exerciseKey(name);if(!k)return;if(!data.loadDefaults)data.loadDefaults={};if(String(value).trim()==='')delete data.loadDefaults[k];else data.loadDefaults[k]=String(value).trim();save()} function monthKey(d=new Date()){return iso(d).slice(0,7)} function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]))}
function navigate(page){if(currentWorkout&&$('#workoutModal')?.classList.contains('show'))saveWorkoutDraft();$$('.page').forEach(p=>p.classList.toggle('active',p.id===page));$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page));window.scrollTo({top:0,behavior:'smooth'});if(page==='profile'){refreshProfileFromServer().finally(()=>{loadProfile();refresh()})}else refresh();}
$$('.nav-btn').forEach(b=>b.onclick=()=>navigate(b.dataset.page));$$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));
function todayType(){const d=new Date().getDay();return [null,'A','ride','B','ride','C','ride'][d]||null} function isDoneWorkout(t,date=iso()){if(!!data.workouts[`${date}-${String(t||'').trim()}`])return true;return Object.entries(data.workouts||{}).some(([k,w])=>{const type=w?.type||k.split('-').slice(3).join('-')||k.split('-').pop();const keyDate=k.slice(0,10);return String(type)===String(t)&&keyDate===date})} function totalWorkoutCount(){return Object.keys(data.workouts).length} function monthRides(){return data.rides.filter(r=>r.date?.startsWith(monthKey()))} function monthWorkouts(){return Object.keys(data.workouts).filter(k=>k.startsWith(monthKey())).length}
function renderToday(){
  const d=new Date(),dayName=d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
  $('#todayDate').textContent=dayName;
  $('#welcomeTitle').textContent=data.profile.name?`Olá, ${data.profile.name.split(' ')[0]}.`:'Seu dia começa aqui.';
  $('#todayBadge').textContent='HOJE';
  const a=currentAuth?.();
  if(a?.role==='student'){
    const today=iso(d);
    const scheduled=weeklyAssignedSchedule(d).get(today)||[];
    const x=scheduled[0];
    if(!x){
      $('.hero-card')?.style.setProperty('display','none');
      return;
    }
    $('.hero-card')?.style.removeProperty('display');
    const w=workoutByKey(x.type);
    const done=isDoneWorkout(x.type,today);
    const isBikeWorkout=String(w?.category||'').toLowerCase()==='bike'||String(w.icon||'').toLowerCase()==='i-bike';
    $('#todayIcon').innerHTML=svgIcon(String(w?.category||'').toLowerCase()==='bike'?'i-bike':'i-training');
    $('#todayLabel').textContent=done?'TREINO DE HOJE':'TREINO ATRIBUÍDO';
    $('#todayWorkout').textContent=done?'Treino concluído':(w?.title||'Treino');
    $('#todayDescription').textContent=done?'Treino registrado. Revise as séries ou acompanhe sua evolução.':(x.note||w?.subtitle||'Treino atribuído pelo seu administrador.');
    $('#todayDuration').textContent=w?.duration||'—';
    $('#todayExercises').textContent=w?.exercises?.length||'—';
    $('#todayIntensity').textContent=w?.intensity||'—';
    $('#todayAction').textContent=done?'Concluído':(isBikeWorkout?'Carregar GPX':'Começar treino');
    $('#todayAction').disabled=!!done;$('#todayAction').classList.toggle('is-disabled',!!done);
    const openTodayWorkout=()=>{
      const gate=activityOpenGate(x.type);
      if(!gate.ok){toast(gate.reason,'error');return;}
      if(isBikeWorkout){navigate('cycling');setTimeout(()=>{try{setRideMode('gpx')}catch(e){};const el=$('#gpxFile');if(el){el.value='';el.click()}},50);return;}
      openWorkout(x.type);
    };
    $('#todayAction').onclick=(e)=>{e?.stopPropagation?.();if(done)return;openTodayWorkout()};
    const todayCard=$('.hero-card');
    if(todayCard){
      todayCard.classList.toggle('today-card-clickable',!done);
      todayCard.onclick=done?null:()=>openTodayWorkout();
    }
    $('.hero-card')?.classList.toggle('today-done',done);
    return;
  }
  $('.hero-card')?.style.removeProperty('display');
  const t=todayType();
  if(t==='ride'){const long=d.getDay()===6,done=data.rides.some(r=>r.date===iso(d));$('#todayIcon').innerHTML=svgIcon('i-bike');$('#todayLabel').textContent=done?'TREINO DE HOJE':'FOCO DE HOJE';$('#todayWorkout').textContent=done?'Pedal concluído':(long?'Pedal longo':'Pedal');$('#todayDescription').textContent=done?'Este pedal já foi concluído e não pode ser registrado novamente.':(long?'Sessão principal da semana. Priorize resistência e ritmo sustentável.':'Pedal leve/moderado para manter a consistência.');$('#todayDuration').textContent=long?'60–150 min':'45–90 min';$('#todayExercises').textContent='—';$('#todayIntensity').textContent=long?'Resistência':'Leve';$('#todayAction').textContent=done?'Concluído':'Registrar pedal';$('#todayAction').disabled=!!done;$('#todayAction').classList.toggle('is-disabled',!!done);$('#todayAction').onclick=()=>{if(done)return;navigate('cycling');setTimeout(()=>{setRideMode('gpx');const el=$('#gpxFile');if(el){el.value='';el.click()}},80)}}
  else if(!t){$('#todayIcon').innerHTML=svgIcon('i-rest');$('#todayLabel').textContent='FOCO DE HOJE';$('#todayWorkout').textContent='Recuperação';$('#todayDescription').textContent='Hoje é um bom dia para descansar, hidratar e preparar o corpo para a próxima sessão.';$('#todayDuration').textContent='20–30 min';$('#todayExercises').textContent='—';$('#todayIntensity').textContent='Leve';$('#todayAction').textContent='Dia de recuperação';$('#todayAction').disabled=true;$('#todayAction').classList.add('is-disabled');$('#todayAction').onclick=null}
  else{const w=workouts[t],done=isDoneWorkout(t);$('#todayIcon').innerHTML=String(w.icon)==='🚴'?svgIcon('i-bike'):svgIcon('i-dumbbell');$('#todayLabel').textContent=done?'TREINO DE HOJE':'FOCO DE HOJE';$('#todayWorkout').textContent=done?'Treino concluído':w.title;$('#todayDescription').textContent=done?'Este treino já foi concluído e não pode ser finalizado novamente.':w.subtitle;$('#todayDuration').textContent=w.duration;$('#todayExercises').textContent=w.exercises.length;$('#todayIntensity').textContent=w.intensity;$('#todayAction').textContent=done?'Concluído':'Começar treino';$('#todayAction').disabled=done;$('#todayAction').classList.toggle('is-disabled',done);$('#todayAction').onclick=()=>{if(done)return;openWorkout(t)}}
  $('.hero-card')?.classList.toggle('today-done',false);
}

function weeklyAssignedSchedule(baseDate=new Date()){
  const map=new Map(),a=currentAuth?.();
  if(!a||a.role!=='student')return map;
  const all=adminWorkouts().filter(x=>String(x.studentId)===String(a.id)&&workoutByKey(x.type)&&x.startDate);
  const weekStart=new Date(baseDate);weekStart.setHours(0,0,0,0);
  // A semana do calendário é sempre de segunda a domingo.
  // getDay(): domingo=0, segunda=1 ... sábado=6.
  weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
  const days=Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);return iso(d)});
  const dayNames=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  all.forEach(x=>{
    const start=x.startDate;
    const end=x.validUntil||start;
    // Cada atribuição recebe um dia fixo da semana. Registros antigos usam o dia da data de início.
    const wd=Number.isInteger(Number(x.weekday))?Number(x.weekday):new Date(start+'T12:00:00').getDay();
    if(wd<0||wd>6)return;
    const target=days[(wd+6)%7];
    // Só exibe na semana se a atribuição estiver válida em algum momento dela.
    // A atribuição é semanal: o dia escolhido pelo Admin se repete dentro
    // da vigência do treino. Não bloqueie o dia da semana apenas porque a
    // data de início caiu depois dele na semana atual; isso fazia a
    // segunda-feira desaparecer quando o plano começava na terça-feira.
    if(end<days[0]||start>days[6])return;
    if(target>end)return;
    if(!map.has(target))map.set(target,[]);
    map.get(target).push({...x,weekday:wd,weekdayName:dayNames[wd]});
  });
  // Mantém a ordem definida pelo Admin e evita duplicidade do mesmo registro.
  map.forEach((items,date)=>map.set(date,items.sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate))||String(a.id).localeCompare(String(b.id)))));
  return map;
}
function svgIcon(id){return `<svg class="cf-svg" aria-hidden="true"><use href="#${id}"/></svg>`}
function shortWeekWorkoutLabel(item){
  const type=String(item?.type||'');
  if(type==='A'||type==='B'||type==='C') return `Força ${type}`;
  const workout=workoutByKey(type);
  const category=String(workout?.category||'').toLowerCase();
  if(category==='bike') return 'Bike';
  if(category==='gym') return 'Treino';
  const title=String(workout?.title||'Treino');
  return title.replace(/^Treino\s*/i,'').split('—')[0].trim().slice(0,14)||'Treino';
}
function renderWeek(){
  const grid=$('#weekGrid');
  if(!grid) return;
  const names=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const fullNames=['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo'];
  const now=new Date(), today=iso(now);
  const monday=new Date(now); monday.setHours(0,0,0,0); monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
  const schedule=weeklyAssignedSchedule(now);
  const days=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d});
  grid.innerHTML=days.map((d,i)=>{
    const date=iso(d), items=schedule.get(date)||[];
    const isToday=date===today;
    const firstWorkout=items.length?workoutByKey(items[0].type):null;
    const iconSvg=items.length?(String(firstWorkout?.category||'').toLowerCase()==='bike'?svgIcon('i-bike'):svgIcon('i-training')):svgIcon('i-rest');
    const label=items.length?[...new Set(items.map(shortWeekWorkoutLabel))].join(' + '):'Off';
    const done=items.length&&items.every(x=>isDoneWorkout(x.type));
    return `<article class="day ${isToday?'today':''} ${items.length?'assigned-day':''} ${done?'done':''} ${!items.length?'rest-day':''}" title="${esc(fullNames[i])}: ${esc(items.length?label:'Off')}"><span class="day-name">${names[i]}</span><span class="day-date">${String(d.getDate()).padStart(2,'0')}</span><div class="icon">${done?svgIcon('i-check'):iconSvg}</div><strong>${esc(label)}</strong><small class="day-status" title="${done?'Concluído':(items.length?'Programado':'Off')}">${done?'Concluído':(items.length?'Prog.':'Off')}</small></article>`;
  }).join('');
  const end=new Date(monday);end.setDate(monday.getDate()+6);
  const fmt=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'});
  const current=$('#weekCurrent');if(current)current.textContent=`${fmt.format(monday)} — ${fmt.format(end)}`;
}
function renderWorkouts(filter='all'){
  const entries=Object.entries(workouts).filter(([key])=>filter==='all'||key===filter);
  const box=$('#workoutCards');
  if(!box)return;
  box.innerHTML=entries.map(([key,workout])=>{
    const done=isDoneWorkout(key),sets=workout.exercises.reduce((total,exercise)=>total+exercise[2],0);
    return `<article class="card workout-item ${done?'workout-done':''}"><div class="workout-icon">${svgIcon(workout.category==='bike'?'i-bike':'i-dumbbell')}</div><div class="workout-main"><div class="workout-topline"><span class="workout-tag">TREINO ${key}</span>${done?'<span class="workout-status">✓ CONCLUÍDO</span>':''}</div><h3>${workout.title}</h3><p>${workout.subtitle}</p><div class="workout-meta"><span class="meta-icon-text">${svgIcon('i-clock')} ${workout.duration}</span><span>•</span><span>${workout.exercises.length} exercícios</span><span>•</span><span>${sets} séries</span></div></div><button class="btn ${done?'btn-light':'btn-primary'} workout-open" ${done?'disabled':''} onclick="if(!this.disabled)openWorkout('${key}')">${done?'Rever treino':'Começar'}</button></article>`;
  }).join('');
}
// Mantém o status da sessão de musculação sincronizado com as séries marcadas.
// Algumas versões anteriores chamavam esta função sem defini-la, interrompendo
// a abertura da lista de exercícios depois de renderizar o conteúdo.
function updateGymStatus(){
  const status=$('#gymSessionStatus');
  const list=$('#exerciseList');
  if(!status||!list)return;
  const checks=list.querySelectorAll('.set-check');
  const done=list.querySelectorAll('.set-check.done').length;
  const total=checks.length;
  if(!total){ status.textContent='TREINO PRONTO'; return; }
  status.textContent=done===0?'SÉRIE EM ANDAMENTO':(done>=total?'TREINO COMPLETO':`SÉRIES REGISTRADAS ${done}/${total}`);
}

function openWorkout(type){currentWorkout=type;const w=workoutByKey(type);if(!w){currentWorkout=null;toast('Treino não encontrado.','error');return;}const exercises=Array.isArray(w.exercises)?w.exercises:[];if(!exercises.length){toast('Este treino não possui exercícios cadastrados.','error');return;}$('#modalTitle').textContent=w.title||'Treino';$('#modalSubtitle').textContent='';const key=workoutDraftKey(type),saved=data.workoutDrafts?.[key]?.sets||data.workouts?.[key]?.sets||[];$('#exerciseList').innerHTML=exercises.map((e,i)=>{const savedExercise=saved[i]||[],def=defaultLoadForExercise(e[0]);const rows=Array.from({length:e[2]},(_,s)=>{const x=savedExercise[s]||{};return `<div class="sets"><span>${s+1}</span><input data-e="${i}" data-s="${s}" data-field="weight" type="number" value="${x.weight!==undefined&&x.weight!==''?esc(x.weight):esc(def)}" placeholder="${def?'kg · padrão '+esc(def):'kg'}"><input data-e="${i}" data-s="${s}" data-field="reps" type="number" value="${x.reps||e[3]}" placeholder="reps"><button class="set-check ${x.done?'done':''}" data-e="${i}" data-s="${s}" aria-label="Marcar série ${s+1}">${x.done?'✓':'○'}</button></div>`});return `<div class="exercise"><div class="exercise-top"><div><h3>${i+1}. ${esc(e[0])}</h3><small>${esc(e[1])}</small><label class="default-load-label">Carga padrão<input class="default-load-input" data-default-exercise="${esc(e[0])}" type="number" min="0" step="0.5" value="${esc(def)}" placeholder="Ex.: 20"></label></div><strong>${e[2]} × ${e[3]}</strong></div>${rows.join('')}</div>`}).join('');$$('.set-check').forEach(b=>b.onclick=()=>{b.classList.toggle('done');b.textContent=b.classList.contains('done')?'✓':'+';b.setAttribute('aria-label',b.classList.contains('done')?'Série concluída':'Concluir série');saveWorkoutDraft();updateGymStatus();renderInProgressExercises()});$$('.default-load-input').forEach(input=>input.addEventListener('change',()=>{const value=String(input.value??'').trim();setDefaultLoad(input.dataset.defaultExercise,value);const card=input.closest('.exercise');if(card){card.querySelectorAll('[data-field="weight"]').forEach(w=>{w.value=value})}saveWorkoutDraft();}));$$('#exerciseList input:not(.default-load-input)').forEach(input=>input.addEventListener('input',()=>{saveWorkoutDraft();renderInProgressExercises()}));updateGymStatus();$('#workoutModal').classList.add('show');resetTimer();renderInProgressExercises()}
function collectWorkout(){const activeWorkout=workoutByKey(currentWorkout)||workouts[currentWorkout];if(!activeWorkout)return [];return activeWorkout.exercises.map((e,i)=>Array.from({length:e[2]},(_,s)=>{const w=$(`[data-e="${i}"][data-s="${s}"][data-field="weight"]`),r=$(`[data-e="${i}"][data-s="${s}"][data-field="reps"]`),c=$(`.set-check[data-e="${i}"][data-s="${s}"]`);return{weight:w?.value||'',reps:r?.value||'',done:c?.classList.contains('done')||false}}))}
$('#finishWorkout').onclick=()=>{
  if(!currentWorkout)return;
  const gate=activityCompletionGate(currentWorkout);
  if(!gate.ok){toast(gate.reason,'error');updateFinishWorkoutState();return;}
  const key=workoutDraftKey(currentWorkout),sets=collectWorkout();
  data.workouts[key]={type:currentWorkout,sets,createdAt:new Date().toISOString(),completedAt:new Date().toISOString()};
  delete data.workoutDrafts[key];
  save();
  updateFinishWorkoutState();
  closeModal();
  refresh();
  renderWeek();
  renderInProgressExercises();
  toast('Treino registrado!');
  renderPRs();
};function closeModal(){if(currentWorkout&&$('#workoutModal')?.classList.contains('show'))saveWorkoutDraft();stopTimer();$('#workoutModal').classList.remove('show')}$('#closeModal').onclick=closeModal;$('#workoutModal').onclick=e=>{if(e.target.id==='workoutModal')closeModal()};
let restAudioContext=null;
function unlockRestAudio(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return null;
    if(!restAudioContext)restAudioContext=new AC();
    if(restAudioContext.state==='suspended')restAudioContext.resume().catch(()=>{});
    return restAudioContext;
  }catch(e){return null}
}
function playRestEndSound(){
  try{
    const ctx=unlockRestAudio();
    if(!ctx)return;
    const now=ctx.currentTime+0.03;
    [880,660,880,1046].forEach((freq,i)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      const t=now+i*.17;
      osc.type='sine';
      osc.frequency.setValueAtTime(freq,t);
      gain.gain.setValueAtTime(.0001,t);
      gain.gain.exponentialRampToValueAtTime(.20,t+.025);
      gain.gain.exponentialRampToValueAtTime(.0001,t+.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t+.14);
    });
  }catch(e){console.warn('Som de descanso indisponível',e)}
}
function updateTimer(){
  const timer=$('#timer'),bar=$('#timerProgress'),box=timer?.closest('.timer');
  if(!timer||!bar)return;
  timer.textContent=timerValue;
  bar.style.width=Math.max(0,Math.min(100,timerBase?timerValue/timerBase*100:0))+'%';
  box?.classList.toggle('timer-finished',timerValue===0);
}
function startTimer(){
  if(timerInterval)return;
  unlockRestAudio();
  const box=$('#timer')?.closest('.timer');
  box?.classList.remove('timer-finished');
  $('#startTimer').textContent='Pausar';
  timerInterval=setInterval(()=>{
    timerValue=Math.max(0,timerValue-1);
    updateTimer();
    if(timerValue===0){
      stopTimer();
      playRestEndSound();
      navigator.vibrate?.([250,100,250]);
      toast('⏱️ Descanso terminado! Próxima série.');
      // Volta automaticamente ao estado visual padrão após o aviso.
      setTimeout(()=>{
        if(!timerInterval && timerValue===0){
          timerValue=60;
          timerBase=60;
          updateTimer();
          $('#startTimer').textContent='Iniciar';
        }
      },1100);
    }
  },1000);
}
function stopTimer(){
  clearInterval(timerInterval);
  timerInterval=null;
  if($('#startTimer'))$('#startTimer').textContent='Iniciar';
}
function resetTimer(){
  stopTimer();
  timerValue=60;
  timerBase=60;
  const box=$('#timer')?.closest('.timer');
  box?.classList.remove('timer-finished');
  updateTimer();
}
$('#startTimer').onclick=()=>timerInterval?stopTimer():startTimer();
$('#resetTimer').onclick=resetTimer;
$('#minusTimer').onclick=()=>{
  timerValue=Math.max(15,timerValue-15);
  timerBase=Math.max(timerBase,timerValue);
  updateTimer();
};
$('#plusTimer').onclick=()=>{
  timerValue+=15;
  timerBase=Math.max(timerBase,timerValue);
  updateTimer();
};
// Pré-libera o áudio no primeiro toque do usuário, respeitando as políticas do navegador.
document.addEventListener('pointerdown',unlockRestAudio,{once:true,passive:true});
function getHrZones(){
  const max=Number(data.profile.maxHr)||190;
  return [
    {id:1,min:max*.50,max:max*.60,label:'Recuperação'},
    {id:2,min:max*.60,max:max*.70,label:'Endurance'},
    {id:3,min:max*.70,max:max*.80,label:'Tempo'},
    {id:4,min:max*.80,max:max*.90,label:'Limiar'},
    {id:5,min:max*.90,max:max,label:'VO₂ máx.'}
  ];
}
function zoneFromHr(hr){
  if(!Number.isFinite(hr)) return null;
  const zones=getHrZones();
  for(const z of zones){ if(hr < z.max || z.id===5) return z.id; }
  return 5;
}
function predominantZoneFromPoints(points){
  const samples=points.filter(p=>Number.isFinite(p.hr));
  if(!samples.length) return null;
  const totals=new Map([[1,0],[2,0],[3,0],[4,0],[5,0]]);
  let weightedSeconds=0, sampleCount=0, usedIntervals=0;
  // Cada amostra representa o intervalo até a próxima amostra. Assim a zona
  // predominante é a que realmente acumulou mais tempo, e não simplesmente
  // a que apareceu mais vezes no arquivo.
  for(let i=0;i<samples.length;i++){
    const p=samples[i], next=samples[i+1];
    const ta=Date.parse(p.time), tb=next?Date.parse(next.time):NaN;
    const z=zoneFromHr(p.hr);
    if(!z) continue;
    let weight=0;
    if(Number.isFinite(ta)&&Number.isFinite(tb)&&tb>ta&&tb-ta<=120000){
      weight=(tb-ta)/1000;
      usedIntervals++;
      weightedSeconds+=weight;
    }
    if(weight>0) totals.set(z,totals.get(z)+weight);
    sampleCount++;
  }
  // GPX sem timestamps: usa a quantidade de amostras como fallback.
  if(usedIntervals===0){
    for(const p of samples){ const z=zoneFromHr(p.hr); if(z) totals.set(z,totals.get(z)+1); }
  }
  let best=1,bestValue=-1;
  for(const [z,v] of totals){ if(v>bestValue){best=z;bestValue=v;} }
  const total=Array.from(totals.values()).reduce((a,b)=>a+b,0);
  return {id:best,label:getHrZones()[best-1]?.label||'',weighted:usedIntervals>0,seconds:usedIntervals?Math.round(bestValue):0,percent:total>0?Math.round(bestValue/total*100):0,samples:sampleCount};
}
function renderRides(){
  const arr=data.rides.slice().sort((a,b)=>b.date.localeCompare(a.date));
  $('#rideHistory').innerHTML=arr.length?arr.map(r=>{
    const mins=Number.isFinite(+r.minutes)&&+r.minutes>0?fmtMinutes(+r.minutes):'—';
    const distance=Number.isFinite(+r.distance)&&+r.distance>0?`${(+r.distance).toFixed(1)} km`:'—';
    const speed=Number.isFinite(+r.speed)&&+r.speed>0?`${(+r.speed).toFixed(1)} km/h`:'—';
    const elevation=Number.isFinite(+r.elevation)&&+r.elevation>=0?`${(+r.elevation).toFixed(0)} m`:'—';
    return `<article class="ride-item ride-item-subtle">
      <div class="ride-top"><div><strong><span class="ride-history-icon">${svgIcon('i-bike')}</span>${new Date(r.date+'T12:00:00').toLocaleDateString('pt-BR')}</strong><small class="ride-route-name">${r.manual?'Manual':'GPX'}</small></div></div>
      <div class="ride-meta"><span><small>Distância</small><b>${distance}</b></span><span><small>Tempo</small><b>${mins}</b></span><span><small>Velocidade</small><b>${speed}</b></span><span><small>Altimetria</small><b>${elevation}</b></span></div>
      <div class="ride-actions">${r.manual ? `<button class="mini-action" onclick="editRide('${esc(r.id)}')">Editar</button>` : `<button class="mini-action" type="button" disabled title="Atividades importadas por GPX não podem ser editadas">Editar</button>`}<button class="mini-action" onclick="deleteRide('${esc(r.id)}')">Excluir</button></div>
    </article>`;
  }).join(''):'<div class="card"><div class="muted">Nenhum pedal registrado ainda.</div></div>';
}

function readRideForm(){
  const val=id=>$('#'+id)?.value??'';
  const manual=rideInputMode==='manual';
  const num=id=>{const v=parseFloat(String(val(id)).replace(',','.'));return Number.isFinite(v)?v:null};
  const g=data.gpx;
  return {
    date:val('rideDate')||(g?.date||iso()),
    distance:manual?(num('manualDistance')??0):(Number.isFinite(+g?.distance)?+g.distance:0),
    minutes:manual?(num('manualMinutes')??0):(Number.isFinite(+g?.minutes)?+g.minutes:0),
    speed:manual?(num('manualSpeed')??0):(Number.isFinite(+g?.speed)?+g.speed:0),
    maxSpeed:manual?null:(Number.isFinite(+g?.maxSpeed)?+g.maxSpeed:null),
    hr:manual?null:(Number.isFinite(+g?.hr)?+g.hr:null),
    maxHr:manual?null:(Number.isFinite(+g?.maxHr)?+g.maxHr:null),
    cadence:manual?null:(Number.isFinite(+g?.cadence)?+g.cadence:null),
    cadenceMax:manual?null:(Number.isFinite(+g?.cadenceMax)?+g.cadenceMax:null),
    power:manual?null:(Number.isFinite(+g?.power)?+g.power:null),
    powerMax:manual?null:(Number.isFinite(+g?.powerMax)?+g.powerMax:null),
    elevation:manual?(num('manualElevation')??0):(Number.isFinite(+g?.elevation)?+g.elevation:0),
    maxClimb:manual?null:(Number.isFinite(+g?.maxClimb)?+g.maxClimb:null),
    calories:manual?null:(Number.isFinite(+g?.calories)?+g.calories:null),
    predominantZone:manual?null:(g?.predominantZone?clone(g.predominantZone):null),
    notes:'',
    gpx:manual?null:(g?clone(g):null),
    id:editingRideId||crypto.randomUUID?.()||String(Date.now()),
    manual
  };
}
function clearRoutePreview(){
  if($('#gpxHint'))$('#gpxHint').textContent='Nenhum GPX carregado.';
  if($('#gpxStatus'))$('#gpxStatus').textContent='Pronto para registrar';
}
function isTodayRideCompleted(){
  const a=currentAuth?.();
  if(!a||a.role!=='student')return false;
  const today=iso(new Date());
  return data.rides.some(r=>r.date===today);
}
function updateRideCompletionButton(){
  const btn=$('#saveRide');
  if(!btn)return;
  lockRideDateToToday();
  const gate=rideCompletionGate();
  if(!gate.ok&&!editingRideId){
    btn.disabled=true;
    btn.textContent=isTodayRideCompleted()?'✓ Treino concluído':'Somente o pedal de hoje';
    btn.classList.add('is-disabled');
    btn.setAttribute('aria-disabled','true');
    btn.title=gate.reason;
  }else{
    btn.disabled=false;
    btn.classList.remove('is-disabled');
    btn.removeAttribute('aria-disabled');
    btn.title='';
    btn.textContent=editingRideId?'Atualizar atividade':(rideInputMode==='manual'?'Salvar atividade':'Salvar atividade GPX');
  }
}
function clearRideForm(keepGpx=false){
  if($('#rideDate'))$('#rideDate').value=iso();
  ['manualDistance','manualSpeed','manualElevation','manualMinutes'].forEach(id=>{if($('#'+id))$('#'+id).value=''});
  editingRideId=null;
  rideInputMode='gpx';
  if(!keepGpx)data.gpx=null;
  setRideMode('gpx');
  if($('#gpxFile')&&!keepGpx)$('#gpxFile').value='';
  updateRideCompletionButton();
}
$('#saveRide').onclick=()=>{
  const rideGate=rideCompletionGate();
  if(!rideGate.ok){
    updateRideCompletionButton();
    toast(rideGate.reason,'error');
    return;
  }
  const r=readRideForm();
  if(!r.date){toast('Informe a data da atividade.','error');return}
  if(r.manual){if(r.distance<=0||r.minutes<=0||r.speed<=0){toast('Preencha distância, velocidade média e tempo.','error');return}}else if(!r.gpx?.points?.length||!(Number.isFinite(+r.distance)&&+r.distance>0)){toast('Carregue um GPX válido antes de salvar a atividade.','error');return}
  if(r.manual&&r.elevation<0){toast('A altimetria não pode ser negativa.','error');return}
  const idx=data.rides.findIndex(x=>x.id===r.id);
  if(idx>=0)data.rides[idx]=r;else data.rides.push(r);
  todayAssignedForStudent().filter(x=>isBikeWorkoutType(x.type)).forEach(x=>{
    const doneKey=workoutDraftKey(x.type,r.date);
    if(!data.workouts[doneKey])data.workouts[doneKey]={type:x.type,sets:[],createdAt:new Date().toISOString(),via:'ride'};
  });
  // GPX importado é apenas um rascunho da atividade atual. Depois de salvar,
  // ele é removido do estado global para impedir que o mesmo arquivo seja
  // reutilizado automaticamente na próxima atividade.
  data.gpx=null;
  if(save()){refresh();toast(idx>=0?'Atividade atualizada!':'Atividade salva!');clearRideForm(false);clearRoutePreview();updateRideCompletionButton()}
};
function editRide(id){
  const r=data.rides.find(x=>x.id===id);
  if(!r)return;
  if(!r.manual){toast('Atividades carregadas por GPX não podem ser editadas.','error');return;}
  editingRideId=id;
  $('#rideDate').value=r.date||iso();
  if(r.manual){
    data.gpx=null;
    rideInputMode='manual';
    $('#manualDistance').value=r.distance??'';
    $('#manualSpeed').value=r.speed??'';
    $('#manualElevation').value=r.elevation??'';
    $('#manualMinutes').value=r.minutes??'';
    setRideMode('manual');
  }else{
    data.gpx=r.gpx?clone(r.gpx):null;
    rideInputMode='gpx';
    setRideMode('gpx');
    if($('#gpxHint'))$('#gpxHint').textContent=data.gpx?.name?`Arquivo carregado: ${data.gpx.name}`:'GPX carregado.';
    if($('#gpxStatus'))$('#gpxStatus').textContent='GPX carregado';
  }
  $('#saveRide').textContent='Atualizar atividade';
  $('#saveRide').disabled=false;
  $('#saveRide').classList.remove('is-disabled');
  navigate('cycling');
  window.scrollTo({top:0,behavior:'smooth'});
}
function deleteRide(id){
  if(!confirm('Excluir esta atividade?'))return;
  data.rides=data.rides.filter(r=>r.id!==id);
  // A exclusão não remove automaticamente o mapa da última atividade exibida.
  save();refresh();toast('Atividade excluída.');
}
function gpxDisplayItems(g){
  const items=[
    ['distance','DISTANCE',Number.isFinite(+g?.distance)&&+g.distance>0?`${(+g.distance).toFixed(1)} km`:'—','i-route','orange'],
    ['elevation','ELEVATION GAIN',Number.isFinite(+g?.elevation)&&+g.elevation>=0?`${Math.round(+g.elevation)} m`:'—','i-mountain','teal'],
    ['speed','AVG SPEED',Number.isFinite(+g?.speed)&&+g.speed>0?`${(+g.speed).toFixed(1)} km/h`:'—','i-speed','white'],
    ['maxSpeed','MAX SPEED',Number.isFinite(+g?.maxSpeed)&&+g.maxSpeed>0?`${(+g.maxSpeed).toFixed(1)} km/h`:'—','i-speed','white'],
    ['cadence','AVG CADENCE',Number.isFinite(+g?.cadence)?`${Math.round(+g.cadence)} rpm`:'—','i-cadence','purple'],
    ['cadenceMax','MAX CADENCE',Number.isFinite(+g?.cadenceMax)?`${Math.round(+g.cadenceMax)} rpm`:'—','i-cadence','purple'],
    ['hr','HEART RATE',Number.isFinite(+g?.hr)?`${Math.round(+g.hr)} bpm`:'—','i-heart','red'],
    ['maxHr','MAX HR',Number.isFinite(+g?.maxHr)?`${Math.round(+g.maxHr)} bpm`:'—','i-heart','red']
  ];
  return items.map(([key,defaultLabel,value,icon,tone])=>{
    const real=value!=='—';
    return `<div class="gpx-ref-metric tone-${tone}">
      <div class="gpx-ref-label">${esc(defaultLabel)} ${real?'':'<em>sem dado</em>'}<span class="gpx-ref-icon">${svgIcon(icon)}</span></div>
      <div class="gpx-ref-value">${esc(value)}</div>
    </div>`;
  }).join('');
}
function gpxPowerZones(g){
  const points=Array.isArray(g?.rawPoints)?g.rawPoints:[];
  const powers=points.filter(p=>Number.isFinite(+p.power)&&+p.power>=0).map(p=>+p.power);
  if(!powers.length) return {html:'',weighted:null};
  const ftp=Number(data.profile.ftp);
  const bounds=Number.isFinite(ftp)&&ftp>0?[0,.55,.75,.90,1.05,1.20,1.50,Infinity]:null;
  const labels=['Z1','Z2','Z3','Z4','Z5','Z6','Z7'];
  let pct=[];
  if(bounds){
    const counts=new Array(7).fill(0);
    const pts=points.filter(p=>Number.isFinite(+p.power)&&+p.power>=0);
    pts.forEach(p=>{
      const x=+p.power; let z=6;
      for(let i=0;i<7;i++){if(x>=ftp*bounds[i] && x<ftp*bounds[i+1]){z=i;break}} counts[z]++;
    });
    const total=counts.reduce((a,b)=>a+b,0)||1;
    pct=counts.map(c=>Math.round(c*100/total));
  }else{
    // Sem FTP configurado, preserva a informação de potência mas não inventa zonas.
    return {html:`<div class="gpx-zone-empty"><span>POWER ZONES</span><small>Configure seu FTP no Perfil para distribuir o tempo entre Z1–Z7.</small></div>`,weighted:weightedPower(powers)};
  }
  const colors=['gray','blue','green','yellow','orange','red','purple'];
  const bars=pct.map((v,i)=>`<div class="gpx-zone"><b>${v}%</b><div class="gpx-zone-track"><i class="${colors[i]}" style="height:${Math.max(v,3)}%"></i></div><strong>${labels[i]}</strong></div>`).join('');
  const np=weightedPower(powers);
  return {weighted:np,html:`<div class="gpx-zone-title">POWER ZONES</div><div class="gpx-zone-bars">${bars}</div>
    <div class="gpx-zone-bottom"><div><small>WEIGHTED</small><strong>${np!==null?Math.round(np):'—'} <em>W</em></strong></div><div><small>ZONE 2</small><strong>${pct[1]} <em>%</em></strong></div></div>`};
}
function weightedPower(powers){
  if(!powers?.length)return null;
  const n=Math.max(1,powers.length), window=Math.max(1,Math.round(n/60));
  const rolling=[];
  for(let i=0;i<n;i++){
    const a=Math.max(0,i-window+1),slice=powers.slice(a,i+1);
    rolling.push(slice.reduce((s,v)=>s+Math.pow(v,4),0)/slice.length);
  }
  return Math.pow(rolling.reduce((s,v)=>s+v,0)/rolling.length,0.25);
}
let gpxDetailMap=null,gpxDetailRoute=null,gpxDetailStart=null,gpxDetailEnd=null;
function closeGpxDetail(){if($('#gpxDetailModal'))$('#gpxDetailModal').classList.remove('show');}
function openGpxDetail(id){
  const ride=data.rides.find(r=>String(r.id)===String(id)); const g=ride?.gpx||null;
  if(!g?.points?.length){toast('Esta atividade não possui uma rota GPX associada.','error');return}
  $('#gpxDetailTitle').textContent=g.name||'Detalhes da atividade';
  $('#gpxDetailMeta').textContent=`${ride?.date?new Date(ride.date+'T12:00:00').toLocaleDateString('pt-BR'):''} · Informações extraídas do GPX`;
  $('#gpxDetailGrid').innerHTML=gpxDisplayItems(g);
  $('#gpxDetailLocation').textContent=g.region||'Região identificada pelo ponto de partida';
  const zones=gpxPowerZones(g); $('#gpxPowerZoneSection').innerHTML=zones.html;
  $('#gpxFooterTime').textContent=Number.isFinite(+g.minutes)?fmtMinutes(+g.minutes):'—';
  $('#gpxDetailModal').classList.add('show');
  requestAnimationFrame(()=>{
    if(!window.L)return;
    if(!gpxDetailMap){gpxDetailMap=L.map('gpxDetailMap',{zoomControl:true,scrollWheelZoom:true}).setView([g.points[0].lat,g.points[0].lon],13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(gpxDetailMap)}
    if(gpxDetailRoute)gpxDetailMap.removeLayer(gpxDetailRoute);
    gpxDetailRoute=L.polyline(g.points.map(p=>[p.lat,p.lon]),{color:'#b7f500',weight:5,opacity:.94,lineCap:'round',lineJoin:'round'}).addTo(gpxDetailMap);
    if(gpxDetailStart)gpxDetailMap.removeLayer(gpxDetailStart); if(gpxDetailEnd)gpxDetailMap.removeLayer(gpxDetailEnd);
    gpxDetailStart=L.circleMarker([g.points[0].lat,g.points[0].lon],{radius:6,weight:2,fillOpacity:1}).addTo(gpxDetailMap).bindTooltip('Início');
    gpxDetailEnd=L.circleMarker([g.points[g.points.length-1].lat,g.points[g.points.length-1].lon],{radius:6,weight:2,fillOpacity:1}).addTo(gpxDetailMap).bindTooltip('Fim');
    gpxDetailMap.fitBounds(gpxDetailRoute.getBounds(),{padding:[24,24],maxZoom:15});
    setTimeout(()=>gpxDetailMap.invalidateSize(true),100);
  });
}
$('#closeGpxDetail')?.addEventListener('click',closeGpxDetail);
$('#gpxDetailModal')?.addEventListener('click',e=>{if(e.target.id==='gpxDetailModal')closeGpxDetail()});
function parseGpx(text){
  text=String(text||'').replace(/^\uFEFF/,'').trim();
  const xml=new DOMParser().parseFromString(text,'application/xml');
  if(!xml||xml.querySelector('parsererror')||!xml.documentElement||!/^(gpx)$/i.test(xml.documentElement.localName||xml.documentElement.nodeName))throw Error('GPX inválido ou corrompido');
  const localName=el=>String(el?.localName||el?.nodeName||'').split(':').pop().toLowerCase();
  const descendants=(node,names)=>{const wanted=new Set(names.map(x=>x.toLowerCase()));return [node,...node.querySelectorAll('*')].filter(el=>wanted.has(localName(el)))};
  const numberValues=(node,names)=>descendants(node,names).map(el=>Number(String(el.textContent||'').trim().replace(',','.'))).filter(Number.isFinite);
  const firstNumber=(node,names)=>numberValues(node,names)[0]??null;
  const textValue=(node,names)=>{const el=descendants(node,names)[0];return el?String(el.textContent||'').trim():''};
  const normalizeSpeed=(v,el,kind='point')=>{
    if(!Number.isFinite(v)||v<0)return null;
    const unit=String(el?.getAttribute?.('unit')||'').toLowerCase();
    if(unit.includes('km'))return v;
    if(unit.includes('mph'))return v*1.609344;
    const ns=String(el?.namespaceURI||'').toLowerCase();
    const parent=String(el?.parentElement?.localName||'').toLowerCase();
    // Velocidade dentro de TrackPointExtension/Garmin costuma estar em m/s.
    if(kind==='point' && (/garmin|gpxtpx|trackpointextension/.test(ns)||/trackpointextension/.test(parent)))return v*3.6;
    // Resumos como averageSpeed/maxSpeed são normalmente expressos em km/h
    // quando o GPX não informa a unidade.
    if(kind==='summary')return v;
    // Para pontos sem namespace, valores típicos de speed são m/s.
    return v*3.6;
  };
  let raw=[...xml.getElementsByTagNameNS('*','trkpt')];if(!raw.length)raw=[...xml.querySelectorAll('trkpt')];if(raw.length<2)throw Error('GPX sem pontos suficientes');
  const pts=raw.map(p=>{
    const speedEl=descendants(p,['speed','velocity'])[0];
    return {
      lat:Number(p.getAttribute('lat')),lon:Number(p.getAttribute('lon')),
      ele:firstNumber(p,['ele']),time:textValue(p,['time']),
      hr:(firstNumber(p,['hr','heartrate','heart-rate','heart_rate','heartRate','bpm','heart-rate-bpm']) ?? (()=>{const el=descendants(p,['hr','heartrate','heart-rate','heart_rate','heartRate','bpm','heart-rate-bpm'])[0];const v=Number(el?.getAttribute?.('value')||el?.getAttribute?.('bpm')||'');return Number.isFinite(v)?v:null})()),
      cadence:firstNumber(p,['cad','cadence','cadence-rpm']),
      power:firstNumber(p,['power','watts']),
      speed:normalizeSpeed(speedEl?Number(String(speedEl.textContent||'').trim().replace(',','.')):null,speedEl,'point')
    };
  }).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  if(pts.length<2)throw Error('GPX sem coordenadas válidas');
  const R=6371;let dist=0,elev=0,maxClimb=0,currentClimb=0;const speeds=[],hrs=[],cads=[],powers=[];
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180,q=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2,km=2*R*Math.asin(Math.min(1,Math.sqrt(q)));
    dist+=km;
    if(Number.isFinite(a.ele)&&Number.isFinite(b.ele)){const de=b.ele-a.ele;if(de>0){elev+=de;currentClimb+=de;maxClimb=Math.max(maxClimb,currentClimb)}else if(de<0)currentClimb=0}
    if(Number.isFinite(b.speed))speeds.push(b.speed);if(Number.isFinite(b.hr))hrs.push(b.hr);if(Number.isFinite(b.cadence))cads.push(b.cadence);if(Number.isFinite(b.power))powers.push(b.power);
  }
  const times=pts.map(p=>Date.parse(p.time)).filter(Number.isFinite),startTime=times.length?Math.min(...times):null,endTime=times.length?Math.max(...times):null,hasTime=startTime!==null&&endTime>startTime,minutes=hasTime?Math.round((endTime-startTime)/60000):null;
  // Quando o GPX não traz <speed>, calcula a velocidade de cada trecho usando
  // distância GPS + timestamps do próprio arquivo. Isso permite recuperar a
  // velocidade máxima mesmo em GPX exportados sem o campo speed.
  const segmentSpeeds=[];
  for(let i=1;i<pts.length;i++){
    const ta=Date.parse(pts[i-1].time),tb=Date.parse(pts[i].time);
    if(Number.isFinite(ta)&&Number.isFinite(tb)&&tb>ta){
      const a=pts[i-1],b=pts[i],dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180,q=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2,km=2*R*Math.asin(Math.min(1,Math.sqrt(q))),hours=(tb-ta)/3600000;
      if(km>0&&hours>0)segmentSpeeds.push(km/hours);
    }
  }
  // Prefere valores explícitos de resumo do GPX; caso não existam, calcula a partir das amostras fornecidas.
  const summary={
    speed:firstNumber(xml,['averageSpeed','avgSpeed','meanSpeed']),maxSpeed:firstNumber(xml,['maxSpeed','maximumSpeed']),
    cadence:firstNumber(xml,['averageCadence','avgCadence','meanCadence']),cadenceMax:firstNumber(xml,['maxCadence','maximumCadence']),
    hr:firstNumber(xml,['averageHeartRate','avgHeartRate','meanHeartRate','averageHr','avgHr','avgHeartRateBpm','heartRateAverage','averageHeartRateBpm']),maxHr:firstNumber(xml,['maxHeartRate','maximumHeartRate','maxHr','maxHeartRateBpm','heartRateMax','maximumHeartRateBpm']),
    power:firstNumber(xml,['averagePower','avgPower','meanPower']),powerMax:firstNumber(xml,['maxPower','maximumPower']),
    calories:firstNumber(xml,['calories','totalCalories','caloriesBurned','energyKcal','energy']),
    elevation:firstNumber(xml,['elevationGain','totalAscent','ascent','elevationAscent']),
    maxClimb:firstNumber(xml,['maxClimb','maximumClimb','largestClimb'])
  };
  if(Number.isFinite(summary.speed))summary.speed=normalizeSpeed(summary.speed,descendants(xml,['averageSpeed','avgSpeed','meanSpeed'])[0],'summary');
  if(Number.isFinite(summary.maxSpeed))summary.maxSpeed=normalizeSpeed(summary.maxSpeed,descendants(xml,['maxSpeed','maximumSpeed'])[0],'summary');
  const calories=Number.isFinite(summary.calories)?summary.calories:null;
  const name=textValue(xml,['name']);
  const predominantZone=predominantZoneFromPoints(pts);
  const rawPointsForAnalysis=pts.map(p=>({lat:p.lat,lon:p.lon,ele:p.ele,hr:p.hr,cadence:p.cadence,power:p.power,time:p.time||''}));
  return {
    points:downsamplePoints(pts.map(p=>({lat:p.lat,lon:p.lon,ele:Number.isFinite(p.ele)?p.ele:null,hr:Number.isFinite(p.hr)?p.hr:null,time:p.time||''})),MAX_STORED_GPX_POINTS),
    rawPoints:downsamplePoints(rawPointsForAnalysis,MAX_STORED_GPX_POINTS),
    distance:dist,elevation:Number.isFinite(summary.elevation)?summary.elevation:(pts.some(p=>Number.isFinite(p.ele))?elev:null),
    maxClimb:Number.isFinite(summary.maxClimb)?summary.maxClimb:(pts.some(p=>Number.isFinite(p.ele))?maxClimb:null),
    // Se o arquivo não traz um campo de velocidade média, podemos obtê-la
    // a partir dos próprios pontos GPS + horários do GPX, que são dados do arquivo.
    minutes,speed:Number.isFinite(summary.speed)?summary.speed:(speeds.length?average(speeds):(hasTime&&dist>0?dist/(minutes/60):null)),
    maxSpeed:Number.isFinite(summary.maxSpeed)?summary.maxSpeed:(speeds.length?Math.max(...speeds):(segmentSpeeds.length?Math.max(...segmentSpeeds):(hasTime&&dist>0?dist/(minutes/60):null))),
    hr:Number.isFinite(summary.hr)?summary.hr:(hrs.length?average(hrs):null),maxHr:Number.isFinite(summary.maxHr)?summary.maxHr:(hrs.length?Math.max(...hrs):null),
    cadence:Number.isFinite(summary.cadence)?summary.cadence:(cads.length?average(cads):null),cadenceMax:Number.isFinite(summary.cadenceMax)?summary.cadenceMax:(cads.length?Math.max(...cads):null),
    power:Number.isFinite(summary.power)?summary.power:(powers.length?average(powers):null),powerMax:Number.isFinite(summary.powerMax)?summary.powerMax:(powers.length?Math.max(...powers):null),
    calories,predominantZone,date:startTime!==null?iso(new Date(startTime)):'',startTime:startTime?new Date(startTime).toISOString():'',endTime:endTime?new Date(endTime).toISOString():'',name,
    source:{name:!!name,coordinates:true,elevation:Number.isFinite(summary.elevation)||pts.some(p=>Number.isFinite(p.ele)),time:hasTime,heartRate:hrs.length>0||Number.isFinite(summary.hr),cadence:cads.length>0||Number.isFinite(summary.cadence),power:powers.length>0||Number.isFinite(summary.power),speed:speeds.length>0||Number.isFinite(summary.speed),calories:Number.isFinite(calories),distanceDerived:true}
  };
}
function downsamplePoints(points,max=MAX_STORED_GPX_POINTS){if(points.length<=max)return points;const out=[];const step=(points.length-1)/(max-1);for(let i=0;i<max;i++)out.push(points[Math.round(i*step)]);return out}
function findExtNumber(node,names){
  const wanted=new Set(names.map(x=>x.toLowerCase()));
  const all=[...node.querySelectorAll('*')];
  for(const el of all){const n=(el.localName||el.nodeName||'').toLowerCase();if(wanted.has(n)){const v=Number(el.textContent);if(Number.isFinite(v))return v}}
  return null;
}
function average(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0}
function fmtMinutes(m){return Number.isFinite(m)?`${Math.floor(m/60)}h ${m%60}min`:'—'}
function renderGpxInfo(g){const set=(id,val)=>{const el=$('#'+id);if(el)el.textContent=val};set('gpxInfoDistance',Number.isFinite(g?.distance)?`${g.distance.toFixed(1)} km`:'—');set('gpxInfoTime',Number.isFinite(g?.minutes)?fmtMinutes(g.minutes):'—');set('gpxInfoSpeed',Number.isFinite(g?.speed)?`${g.speed.toFixed(1)} km/h`:'—');set('gpxInfoMaxSpeed',Number.isFinite(g?.maxSpeed)?`${g.maxSpeed.toFixed(1)} km/h`:'—');set('gpxInfoCadence',Number.isFinite(g?.cadence)?`${Math.round(g.cadence)} rpm`:'—');set('gpxInfoCadenceMax',Number.isFinite(g?.cadenceMax)?`${Math.round(g.cadenceMax)} rpm`:'—');set('gpxInfoHr',Number.isFinite(g?.hr)?`${Math.round(g.hr)} bpm`:'—');set('gpxInfoHrMax',Number.isFinite(g?.maxHr)?`${Math.round(g.maxHr)} bpm`:'—');set('gpxInfoCalories',Number.isFinite(g?.calories)?`${Math.round(g.calories)} kcal`:'—');set('gpxInfoElevation',Number.isFinite(g?.elevation)?`${Math.round(g.elevation)} m+`:'—');set('gpxInfoClimb',Number.isFinite(g?.maxClimb)?`${Math.round(g.maxClimb)} m`:'—');set('gpxInfoPower',Number.isFinite(g?.power)?`${Math.round(g.power)} W`:'—');set('gpxInfoPowerMax',Number.isFinite(g?.powerMax)?`${Math.round(g.powerMax)} W`:'—');if($('#gpxActivityName'))$('#gpxActivityName').textContent=g?.name||'Última atividade';if($('#gpxStatus'))$('#gpxStatus').textContent=g?'Dados disponíveis':'Pronto para registrar';if($('#gpxSourceNote'))$('#gpxSourceNote').textContent=g?'Dados disponíveis no GPX':'Sem atividade GPX'}
async function renderGpx(g){renderGpxInfo(g)}
function setRideMode(mode){
  rideInputMode=mode;
  const manual=mode==='manual';
  $('#manualModeBtn')?.classList.toggle('active',manual);
  $('#gpxModeBtn')?.classList.toggle('active',!manual);
  if($('#manualRideFields'))$('#manualRideFields').hidden=!manual;
  if($('#gpxRideFields'))$('#gpxRideFields').hidden=manual;
  if($('#saveRide'))$('#saveRide').textContent=editingRideId?'Atualizar atividade':(manual?'Salvar atividade':'Salvar atividade GPX');
  if(!manual)renderGpxInfo(data.gpx);
  updateRideCompletionButton();
}
function fillRideFromGpx(g){
  if(g?.date&&$('#rideDate'))$('#rideDate').value=g.date;
  renderGpxInfo(g);
}
$('#manualModeBtn')?.addEventListener('click',()=>setRideMode('manual'));
function canImportGpxToday(){
  const a=currentAuth?.();
  // Para alunos, GPX só pode ser usado quando existe um treino de ciclismo
  // atribuído para hoje. Administradores continuam com acesso normal.
  return true;
}
function guardGpxToday(){
  if(canImportGpxToday())return true;
  toast('O envio de GPX está disponível somente para a atividade de ciclismo programada para hoje.','error');
  return false;
}
$('#gpxModeBtn')?.addEventListener('click',()=>{if(guardGpxToday())setRideMode('gpx')});
$('#importGpx').onclick=()=>{
  if(!guardGpxToday())return;
  const input=$('#gpxFile');
  if(input){input.value='';input.click()}
};
function readGpxFile(file){return new Promise((resolve,reject)=>{if(!file)return reject(Error('Nenhum arquivo selecionado'));const reader=new FileReader();reader.onload=()=>{const text=String(reader.result||'').replace(/^\uFEFF/,'').trim();resolve(text)};reader.onerror=()=>reject(Error('Não foi possível ler o arquivo'));reader.onabort=()=>reject(Error('Leitura do arquivo cancelada'));reader.readAsText(file,'UTF-8')})}
$('#gpxFile').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(!guardGpxToday()){e.target.value='';return;}
  const previous=data.gpx?clone(data.gpx):null;
  try{
    const name=String(file.name||''),type=String(file.type||'');
    if(!/\.gpx$/i.test(name)&&!/(gpx|xml)/i.test(type))throw Error('Formato inválido');
    const text=await readGpxFile(file);
    if(!text||text.replace(/^\\uFEFF/,'').trim().length<50)throw Error('Arquivo vazio');
    const g=parseGpx(text);
    g.fileName=name;g.loadedAt=new Date().toISOString();
    data.gpx=g;fillRideFromGpx(g);
    if($('#gpxHint'))$('#gpxHint').textContent=`Arquivo carregado: ${name}. Confira a data e clique em salvar.`;
    // O arquivo permanece apenas no formulário até o usuário confirmar 'Salvar atividade'.
    toast('📥 GPX lido com sucesso. Confira os dados e clique em Salvar atividade.');
  }catch(err){
    console.error('GPX:',err);data.gpx=previous;
    renderGpxInfo(previous);
    toast(err.message==='save'?'Não foi possível salvar o GPX.':'Não foi possível ler este GPX. Verifique se o arquivo contém uma trilha válida.','error');
  }finally{e.target.value=''}
};


function weekStats(){const now=new Date(),start=new Date(now);start.setHours(0,0,0,0);start.setDate(now.getDate()-now.getDay());const end=new Date(start);end.setDate(start.getDate()+6);const startKey=iso(start),endKey=iso(end),gym=Object.keys(data.workouts).filter(k=>{const d=k.slice(0,10);return d>=startKey&&d<=endKey}).length,rides=data.rides.filter(r=>r.date>=startKey&&r.date<=endKey),mins=rides.reduce((s,r)=>s+(+r.minutes||0),0);$('#weekGym').textContent=gym;$('#weekRides').textContent=rides.length;$('#weekMinutes').textContent=mins;let streak=0;for(let i=0;i<90;i++){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);const k=iso(d),active=data.rides.some(r=>r.date===k)||Object.keys(data.workouts).some(x=>x.startsWith(k));if(active)streak++;else if(i>0)break}$('#streak').textContent=streak}
function renderGoals(){const g=data.goals,km=monthRides().reduce((s,r)=>s+(+r.distance||0),0),wm=monthWorkouts(),kp=Math.min(100,km/Math.max(1,+g.km||1)*100),wp=Math.min(100,wm/Math.max(1,+g.workouts||1)*100);$('#goalKmText').textContent=`${km.toFixed(1)} / ${g.km} km`;$('#goalMonthLabel').textContent=new Date().toLocaleDateString('pt-BR',{month:'long'});$('#goalKmPct').textContent=Math.round(kp)+'%';$('#goalKmFill').style.width=kp+'%';$('#goalWorkoutText').textContent=`${wm} / ${g.workouts}`;$('#goalWorkoutPct').textContent=Math.round(wp)+'%';$('#goalWorkoutFill').style.width=wp+'%'}
function totalVolume(){return Object.values(data.workouts).reduce((sum,w)=>sum+w.sets.reduce((a,ex)=>a+ex.reduce((b,s)=>b+(+s.weight||0)*(+s.reps||0),0),0),0)}
function renderProgress(){const tc=totalWorkoutCount(),rc=data.rides.length,km=data.rides.reduce((s,r)=>s+(+r.distance||0),0),mins=data.rides.reduce((s,r)=>s+(+r.minutes||0),0),elev=data.rides.reduce((s,r)=>s+(+r.elevation||0),0),vol=totalVolume();$('#totalCompleted').textContent=tc;$('#ridesCompleted').textContent=rc;$('#totalKm').textContent=km.toFixed(1);$('#totalRideTime').textContent=`${Math.floor(mins/60)}h`;$('#totalElevation').textContent=`${Math.round(elev)}m`;$('#totalVolume').textContent=`${Math.round(vol)} kg`;$('#volumeTotal').textContent=`${Math.round(vol)} kg`;$('#progressHeadline').textContent=tc+rc;const target=Math.max(1,data.goals.workouts+5),pct=Math.min(100,Math.round((tc+rc)/target*100));$('#progressRingText').textContent=pct+'%';$('#progressRing').style.background=`conic-gradient(var(--accent) ${pct*3.6}deg,rgba(127,127,127,.2) 0deg)`;drawCharts();renderPRs();renderHistory()}
function setupCanvas(c){const dpr=devicePixelRatio||1,w=c.clientWidth||600,h=190;c.width=w*dpr;c.height=h*dpr;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);return{ctx,w,h}}
function drawLineChart(id,values,labels){const c=$('#'+id),{ctx,w,h}=setupCanvas(c),pad={l:34,r:18,t:15,b:38},max=Math.max(1,...values),step=values.length>1?(w-pad.l-pad.r)/(values.length-1):w-pad.l-pad.r;ctx.clearRect(0,0,w,h);ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--border');ctx.lineWidth=1;for(let i=0;i<4;i++){const y=pad.t+i*(h-pad.t-pad.b)/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke()}ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--accent');ctx.lineWidth=3;ctx.beginPath();values.forEach((v,i)=>{const x=pad.l+i*step,y=pad.t+(h-pad.t-pad.b)*(1-v/max);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--muted');ctx.font='12px Arial';values.forEach((v,i)=>{const x=pad.l+i*step,y=pad.t+(h-pad.t-pad.b)*(1-v/max),text=String(labels[i]||''),tw=ctx.measureText(text).width,tx=Math.min(Math.max(2,x-tw/2),w-tw-2);ctx.fillText(text,tx,h-8);ctx.beginPath();ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--accent');ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--muted')})}
function drawCharts(){const rides=data.rides.slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-7);drawLineChart('rideChart',rides.map(r=>+r.distance||0),rides.map(r=>r.date.slice(5)));const vals=Object.entries(data.workouts).sort((a,b)=>a[0].localeCompare(b[0])).slice(-7).map(([,w])=>w.sets.reduce((a,ex)=>a+ex.reduce((b,s)=>b+(+s.weight||0)*(+s.reps||0),0),0));drawLineChart('volumeChart',vals.length?vals:[0],vals.map((_,i)=>i+1))}
function renderPRs(){const prs={};Object.values(data.workouts).forEach(v=>v.sets?.forEach((arr,i)=>arr.forEach(x=>{const ex=workouts[v.type]?.exercises[i],w=+x.weight||0,r=+x.reps||0;if(ex&&w&&r){const name=ex[0],score=w*r;if(!prs[name]||score>prs[name].score)prs[name]={name,score,weight:w,reps:r}}})));const list=Object.values(prs).sort((a,b)=>b.score-a.score);$('#prCount').textContent=list.length;$('#prList').innerHTML=list.length?list.slice(0,8).map(x=>`<div class="pr-row"><span class="pr-icon">${svgIcon('i-trophy')}</span><div><strong>${esc(x.name)}</strong><small>Melhor registro</small></div><b>${x.weight} kg × ${x.reps}</b></div>`).join(''):'<div class="muted">Complete séries com carga para criar seus recordes.</div>'}
function renderHistory(){const arr=Object.entries(data.workouts).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,8);$('#history').innerHTML=arr.length?arr.map(([k,v])=>{const date=k.slice(0,10),w=workouts[v.type];return `<div class="pr-row"><span>${String(w?.category||'').toLowerCase()==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</span><div><strong>${esc(w?.title||v.type)}</strong><small>${new Date(date+'T12:00:00').toLocaleDateString('pt-BR')}</small></div><b>Concluído</b></div>`}).join(''):'<div class="muted">Seus treinos concluídos aparecerão aqui.</div>'}
async function refreshProfileFromServer(){
  if(currentAuth?.()?.role!=='student')return;
  const cloud=window.CicloFitCloud;
  if(!cloud?.enabled)return;
  const result=await cloud.getMyProfile?.();
  if(result?.data?.profile&&typeof result.data.profile==='object'){
    data.profile={...data.profile,...result.data.profile};
    localStorage.setItem(dataStorageKey(),JSON.stringify(data));
  }
}
function loadProfile(){const p=data.profile;if(p.birthDate){const age=calculateAge(p.birthDate);if(age!=='' )p.age=age}['name','age','birthDate','phone','weight','height','goal','level','maxHr','ftp'].forEach(k=>{const el=$('#profile'+k[0].toUpperCase()+k.slice(1));if(el)el.value=p[k]??''});$('#profileDisplayName').textContent=p.name||'Seu perfil';$('#profileDisplayGoal').textContent=p.goal?`${p.goal} · ${p.level}`:'Configure seus dados para personalizar o CicloFit.';const avatar=$('#avatar');if(avatar){avatar.innerHTML=p.photo?`<img src="${p.photo}" alt="Foto do perfil">`:esc((p.name||'CF').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase())}renderZones()}
function renderZones(){const max=+data.profile.maxHr||190,zones=[['Zona 1',.5,.6,'Recuperação'],['Zona 2',.6,.7,'Endurance'],['Zona 3',.7,.8,'Tempo'],['Zona 4',.8,.9,'Limiar'],['Zona 5',.9,1,'VO₂']];$('#zones').innerHTML=zones.map(z=>`<div class="profile-zone"><div><strong>${z[0]}</strong><small>${z[3]}</small></div><span>${Math.round(max*z[1])}–${Math.round(max*z[2])} bpm</span></div>`).join('')}
$('#saveProfile').onclick=async()=>{['name','birthDate','phone','weight','height','goal','level','maxHr','ftp'].forEach(k=>{const el=$('#profile'+k[0].toUpperCase()+k.slice(1));if(el)data.profile[k]=el.value});data.profile.age=calculateAge(data.profile.birthDate)||data.profile.age||'';const cloud=window.CicloFitCloud;if(cloud?.enabled){const result=await cloud.updateMyProfile(data.profile);if(result.error){toast(result.error.message||'Não foi possível salvar o perfil.','error');return}if(result.data?.profile)data.profile={...data.profile,...result.data.profile};}save();loadProfile();refresh();toast('👤 Perfil salvo e sincronizado com o painel do Admin!')};
$('#profileBirthDate')?.addEventListener('change',()=>{const age=calculateAge($('#profileBirthDate').value);if(age!=='')$('#profileAge').value=age});
$('#profilePhotoInput')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){toast('Selecione uma imagem válida.','error');e.target.value='';return}if(file.size>4*1024*1024){toast('A foto deve ter no máximo 4 MB.','error');e.target.value='';return}try{const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url});const c=document.createElement('canvas'),max=320,scale=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);data.profile.photo=c.toDataURL('image/jpeg',.82);save();loadProfile();refresh();toast('Foto do perfil atualizada.')}catch{toast('Não foi possível carregar a foto.','error')}e.target.value='' });
function openGoalEditor(){$('#goalKmInput').value=data.goals.km;$('#goalWorkoutInput').value=data.goals.workouts;$('#goalHoursInput').value=data.goals.hours;$('#goalElevationInput').value=data.goals.elevation;$('#goalModal').classList.add('show')}function closeGoalEditor(){$('#goalModal').classList.remove('show')}function saveGoals(){data.goals={km:+$('#goalKmInput').value||500,workouts:+$('#goalWorkoutInput').value||12,hours:+$('#goalHoursInput').value||30,elevation:+$('#goalElevationInput').value||5000};save();closeGoalEditor();refresh();toast('Metas atualizadas!')}
$('#exportData').onclick=()=>{const payload={...data,appVersion:APP_VERSION,exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`ciclofit-backup-${iso()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Backup exportado!')};$('#importData').onclick=()=>$('#backupFile').click();$('#backupFile').onchange=async e=>{try{const file=e.target.files?.[0];if(!file) return;const obj=JSON.parse(await file.text());if(!obj||typeof obj!=='object'||(!obj.profile&&!obj.rides&&!obj.workouts))throw Error();data=mergeData(obj);save();loadProfile();refresh();toast('Backup restaurado!')}catch{toast('Backup inválido.','error')}e.target.value=''};
function setTheme(){const dark=document.body.dataset.theme==='dark';const next=dark?'light':'dark';document.body.dataset.theme=next;const iconId=next==='dark'?'i-sun':'i-moon';if($('#themeToggle'))$('#themeToggle').innerHTML=svgIcon(iconId);if($('#loginThemeToggle'))$('#loginThemeToggle').innerHTML=svgIcon(iconId);if($('#adminThemeToggle'))$('#adminThemeToggle').innerHTML=svgIcon(iconId);localStorage.setItem('ciclofit-theme',next);setTimeout(drawCharts,0)} $('#themeToggle')?.addEventListener('click',setTheme);$('#loginThemeToggle')?.addEventListener('click',setTheme);$('#adminThemeToggle')?.addEventListener('click',setTheme);function toast(msg,type='ok'){const el=$('#toast');el.textContent=msg;el.className='toast show '+type;clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2800)}function closeQuick(){$('#quickModal').classList.remove('show')}

window.addEventListener('pagehide',()=>{if(currentWorkout&&$('#workoutModal')?.classList.contains('show'))saveWorkoutDraft()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&currentWorkout&&$('#workoutModal')?.classList.contains('show'))saveWorkoutDraft()});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;closeQuick();closeGoalEditor();closeModal()});
$('#notifyBtn')?.addEventListener('click',async()=>{if(!('Notification'in window)){toast('Seu navegador não suporta notificações.','error');return}const p=await Notification.requestPermission();toast(p==='granted'?'Permissão de notificações ativada.':'Permissão não concedida.',p==='granted'?'ok':'error')});window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e});$('#installApp')?.addEventListener('click',async()=>{if(deferredPrompt){deferredPrompt.prompt();deferredPrompt=null}else toast('Use “Adicionar à tela inicial” no navegador.','error')});
function refresh(){renderToday();renderWeek();if(currentAuth()?.role==='student')renderStudentAssigned();else renderWorkouts(document.querySelector('.chip.active')?.dataset.filter||'all');renderRides();renderProgress();weekStats();renderGoals();try{updateRideCompletionButton()}catch(e){}}
document.body.dataset.theme=localStorage.getItem('ciclofit-theme')||'dark';const initialThemeIcon=document.body.dataset.theme==='dark'?'i-sun':'i-moon';if($('#themeToggle'))$('#themeToggle').innerHTML=svgIcon(initialThemeIcon);if($('#loginThemeToggle'))$('#loginThemeToggle').innerHTML=svgIcon(initialThemeIcon);if($('#adminThemeToggle'))$('#adminThemeToggle').innerHTML=svgIcon(initialThemeIcon);loadProfile();refresh();

/* ===== CicloFit 5.0 — acesso aluno/admin + gestão de treinos ===== */
const defaultUsers=[{id:'student-demo',name:'Aluno Demo',username:'aluno',password:'1234',role:'student',active:true}];
const defaultAdmin={username:'admin',password:'admin123',role:'admin'};
function normalizeUser(u){
  if(!u||typeof u!=='object')return null;
  const role=String(u.role||'student').toLowerCase();
  return {...u,id:String(u.id||crypto.randomUUID?.()||Date.now()),name:String(u.name||'Aluno').trim(),username:String(u.username||'').trim(),password:String(u.password??''),role:(role==='aluno'||role==='student')?'student':role,active:u.active!==false};
}
function authUsers(){
  try{
    const raw=Array.isArray(data.adminUsers)?data.adminUsers:JSON.parse(localStorage.getItem(USERS_KEY)||'[]');
    const source=Array.isArray(raw)?raw:[];
    const normalized=source.map(normalizeUser).filter(u=>u&&u.role==='student'&&u.username);
    if(!window.CicloFitCloud?.enabled&&!normalized.some(u=>u.id==='student-demo')) normalized.unshift(normalizeUser(defaultUsers[0]));
    const seen=new Set(),list=normalized.filter(u=>{const key=u.username.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
    // Persiste a migração/normalização sem apagar alunos existentes.
    try{localStorage.setItem(USERS_KEY,JSON.stringify(list));}catch(e){console.warn('Não foi possível atualizar usuários',e)}
    return list;
  }catch{return [normalizeUser(defaultUsers[0])] }
}
function saveAuthUsers(u){
  const list=u.map(normalizeUser).filter(x=>x&&x.role==='student'&&x.username).map(x=>({...x,username:String(x.username).trim()}));
  localStorage.setItem(USERS_KEY,JSON.stringify(list));
  data.adminUsers=list.map(({password,...user})=>user);
  save();
  queueSharedSave();
  try{const check=JSON.parse(localStorage.getItem(USERS_KEY)||'[]');if(!Array.isArray(check))throw Error('storage');}catch(e){console.warn('Falha ao persistir usuários',e);toast?.('Não foi possível salvar os usuários.','error');}
}
function adminWorkouts(){try{const v=Array.isArray(data.adminWorkouts)?data.adminWorkouts:JSON.parse(localStorage.getItem(ADMIN_WORKOUTS_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function cleanLegacyABCWorkouts(){
  // Compatibilidade: atribuições dos treinos A/B/C são registros válidos e
  // devem permanecer disponíveis para o aluno. Versões anteriores removiam
  // esses registros durante a inicialização, fazendo o treino atribuído
  // desaparecer da aba Treinos/Treino do dia. Não faça limpeza destrutiva aqui.
  return adminWorkouts();
}
function saveAdminWorkouts(v){localStorage.setItem(ADMIN_WORKOUTS_KEY,JSON.stringify(v));data.adminWorkouts=v;save();queueSharedSave()}
function adminNotifs(){try{const v=Array.isArray(data.adminNotifs)?data.adminNotifs:JSON.parse(localStorage.getItem(ADMIN_NOTIF_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function saveAdminNotifs(v){localStorage.setItem(ADMIN_NOTIF_KEY,JSON.stringify(v));data.adminNotifs=v;save();queueSharedSave()}
function isOfflineAuthError(error){
  const msg=String(error?.message||error||'').toLowerCase();
  return /failed to fetch|network|database|econnrefused|503|502|504|404|timeout|banco|servidor|indispon|deslig|abort/i.test(msg)||error?.name==='TypeError';
}
function findLocalLogin(role,user,password){
  const u=String(user||'').trim().toLowerCase();
  const p=String(password??'');
  if(role==='admin'&&(u===defaultAdmin.username.toLowerCase()||u==='admin@ciclo-fit.local')&&p===defaultAdmin.password){
    return {id:'admin',role:'admin',username:defaultAdmin.username,name:'Administrador',offline:true};
  }
  if(role!=='student')return null;
  const locals=authUsers().slice();
  if(!locals.some(x=>x.id==='student-demo'||String(x.username||'').toLowerCase()==='aluno')) locals.unshift(normalizeUser(defaultUsers[0]));
  return locals.find(x=>x.role==='student'&&String(x.username||'').trim().toLowerCase()===u&&String(x.password??'')===p&&x.active!==false)||null;
}
function updateAuthConnectivity(online){
  const hint=$('#loginHint');
  if(!hint)return;
  const role=$('.auth-tab.active')?.dataset.role||'student';
  if(online){
    hint.textContent=role==='admin'?'Acesso administrativo.':'O acesso do aluno é criado pelo administrador.';
    return;
  }
  hint.textContent='Banco/servidor offline. Use o acesso local: admin / admin123 ou aluno / 1234.';
}
function currentAuth(){try{return JSON.parse(sessionStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
function setAuth(a){sessionStorage.setItem(AUTH_KEY,JSON.stringify(a))}
function clearAuth(){sessionStorage.removeItem(AUTH_KEY)}
function notifyAdmin(title,body){
  const list=adminNotifs();
  const key=title+'|'+body;
  if(!list.some(n=>n.key===key)){list.unshift({id:Date.now(),key,title,body,date:new Date().toISOString(),read:false});saveAdminNotifs(list)}
  if(window.Notification && Notification.permission==='granted') new Notification(title,{body});
  renderAdminNotifications();
}
function checkWorkoutValidity(){
  const now=Date.now(), list=adminWorkouts(), users=authUsers(); let changed=false;
  list.forEach(w=>{if(!w.notified && w.validUntil && new Date(w.validUntil).getTime()<=now){const u=users.find(x=>x.id===w.studentId);notifyAdmin('Treino vencido',`${u?.name||'Aluno'} — ${workoutByKey(w.type)?.title||'Treino'}`);w.notified=true;changed=true}});
  if(changed)saveAdminWorkouts(list);
}
function requestAdminNotifications(){if('Notification' in window)Notification.requestPermission().then(()=>{toast('Notificações ativadas');checkWorkoutValidity()})}
async function logout(){
  try{if(window.CicloFitCloud?.enabled && window.CicloFitCloud.signOut)await window.CicloFitCloud.signOut()}catch(e){console.warn('CicloFit Cloud: falha ao sair',e)}
  clearAuth();location.reload()
}
function renderStudentAssigned(){
  const a=currentAuth(); if(!a||a.role!=='student')return;
  const assigned=adminWorkouts().filter(w=>String(w.studentId)===String(a.id)).sort((x,y)=>String(y.startDate).localeCompare(String(x.startDate)));
  const cards=assigned.map(x=>{
    const w=workoutByKey(x.type);
    if(!w)return '';
    const expired=x.validUntil&&new Date(x.validUntil+'T23:59:59')<new Date();
    const title=String(w.title||'Treino').replace(/^Treino [A-Z] — /,'');
    return `<article class="card workout-item ${expired?'workout-done':''}"><div class="workout-icon">${String(w.category||'').toLowerCase()==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</div><div class="workout-main"><div class="workout-topline"><span class="workout-tag">${x.type?.startsWith('custom:')?'PERSONALIZADO':'TREINO '+esc(x.type||'')}</span><span class="${expired?'validity-expired':'validity-ok'}">${expired?'VENCIDO':'VÁLIDO ATÉ '+new Date(x.validUntil+'T12:00:00').toLocaleDateString('pt-BR')}</span></div><h3>${esc(title)}</h3><p>${esc(x.note||w.subtitle||'Treino atribuído pelo Admin.')}</p><div class="workout-meta"><span class="meta-icon-text">${svgIcon('i-clock')} ${esc(w.duration||'')}</span><span>•</span><span>${w.exercises?.length||0} exercícios</span></div></div><button class="btn ${expired?'btn-light':'btn-primary'} workout-open" ${expired?'disabled':''} onclick="openAssignedWorkout('${esc(x.id||x.type)}')">${expired?'Expirado':'Começar'}</button></article>`;
  }).filter(Boolean).join('');
  $('#workoutCards').innerHTML=cards||'<div class="card"><div class="muted">Nenhum treino atribuído pelo Admin.</div></div>';
}

let editingAdminWorkoutId=null;
function resetAdminWorkoutForm(){
  editingAdminWorkoutId=null;
  const sel=$('#adminWorkoutStudent'); if(sel) sel.value='';
  if($('#adminWorkoutType')) $('#adminWorkoutType').value='A';
  if($('#adminWorkoutValidity')) $('#adminWorkoutValidity').value='30';
  if($('#adminWorkoutStart')) $('#adminWorkoutStart').value=iso();
  if($('#adminWorkoutNote')) $('#adminWorkoutNote').value='';
  if($('#assignWorkoutBtn')) $('#assignWorkoutBtn').textContent='+ Criar/atribuir treino';
  if($('#cancelAdminWorkoutEdit')) $('#cancelAdminWorkoutEdit').hidden=true;
}
function renderStudentSelect(el, users){
  if(!el)return;
  el.innerHTML='<option value="" selected disabled>Selecione um aluno</option>'+users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)} (@${esc(u.username)})</option>`).join('');
  el.value='';
}
function renderAdminStudents(){
  const users=authUsers().filter(u=>u.role==='student');
  const query=String($('#adminStudentSearch')?.value||'').trim().toLowerCase();
  const visibleUsers=users.filter(u=>{const profile=u.profile||{};return !query||[u.name,u.username,profile.name].some(value=>String(value||'').toLowerCase().includes(query))});
  if($('#studentCount'))$('#studentCount').textContent=users.length;
  if($('#adminStudentSearchCount'))$('#adminStudentSearchCount').textContent=users.length;
  $('#studentList').innerHTML=visibleUsers.map(u=>{
    const p=u.profile||{};
    const age=p.birthDate?calculateAge(p.birthDate):p.age;
    const avatar= p.photo ? `<img src="${p.photo}" alt="Foto de ${esc(p.name||u.name)}">` : esc((p.name||u.name||'CF').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase());
    const details=[
      age?`<span>${svgIcon('i-user')} ${esc(age)} anos</span>`:null,
      p.birthDate?`<span>${svgIcon('i-calendar')} nasc. ${new Date(p.birthDate+'T12:00:00').toLocaleDateString('pt-BR')}</span>`:null,
      p.phone?`<span>${svgIcon('i-phone')} ${esc(p.phone)}</span>`:null,
      p.weight?`<span>${svgIcon('i-scale')} ${esc(p.weight)} kg</span>`:null,
      p.height?`<span>${svgIcon('i-ruler')} ${esc(p.height)} cm</span>`:null,
      p.goal?`<span>${svgIcon('i-target')} ${esc(p.goal)}${p.level?` · ${esc(p.level)}`:''}</span>`:p.level?`<span>${svgIcon('i-target')} ${esc(p.level)}</span>`:null,
      p.maxHr?`<span>${svgIcon('i-heart')} FC máx. ${esc(p.maxHr)} bpm</span>`:null,
      p.ftp?`<span>${svgIcon('i-bolt')} FTP ${esc(p.ftp)} W</span>`:null
    ].filter(Boolean).join('');
    return `<div class="admin-row admin-student-row">
      <div class="admin-student-head"><div class="admin-student-avatar">${avatar}</div><div class="admin-student-info"><strong>${esc(p.name||u.name)}</strong><small>@${esc(u.username)}</small></div></div>
      <div class="admin-student-details">${details||'<span class="student-no-data">Sem dados de perfil</span>'}</div>
      <div class="admin-row-actions"><button class="mini-action" onclick="editStudent('${esc(u.id)}')">${svgIcon('i-edit')} Conta</button><button class="mini-action" onclick="editStudentProfile('${esc(u.id)}')">${svgIcon('i-user')} Perfil</button><button class="mini-action mini-danger" onclick="deleteStudent('${esc(u.id)}')">${svgIcon('i-trash')} Excluir</button></div>
    </div>`;
  }).join('')||(query?'<div class="muted">Nenhum aluno encontrado.</div>':'<div class="muted">Nenhum aluno cadastrado.</div>');
  renderStudentSelect($('#adminWorkoutStudent'),users);
  renderCustomStudents();
}
function renderAdminWorkouts(){
  const users=authUsers(), all=adminWorkouts().filter(x=>x.type?.startsWith('custom:'));
  const search=String($('#adminWorkoutSearch')?.value||'').trim().toLowerCase();
  const studentFilter=String($('#adminWorkoutStudentFilter')?.value||'');
  const status=String($('#adminWorkoutStatusFilter')?.value||'all');
  const now=new Date();
  const isExpired=x=>x.validUntil&&new Date(x.validUntil+'T23:59:59')<now;
  const activeCount=all.filter(x=>!isExpired(x)).length, expiredCount=all.length-activeCount;
  if($('#adminWorkoutCount'))$('#adminWorkoutCount').textContent=all.length;
  if($('#adminWorkoutActive'))$('#adminWorkoutActive').textContent=activeCount;
  if($('#adminWorkoutExpired'))$('#adminWorkoutExpired').textContent=expiredCount;
  const sf=$('#adminWorkoutStudentFilter');
  if(sf){
    const current=sf.value;
    sf.innerHTML='<option value="">Todos os alunos</option>'+users.filter(u=>u.role==='student').sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')).map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    sf.value=current;
  }
  const list=all.filter(x=>{
    const u=users.find(z=>z.id===x.studentId), cw=customWorkouts().find(c=>c.id===x.customId), title=cw?.workout?.title||'Treino personalizado';
    const hay=`${u?.name||'Aluno removido'} ${title} ${x.note||''}`.toLowerCase();
    return (!search||hay.includes(search))&&(!studentFilter||x.studentId===studentFilter)&&(status==='all'||(status==='expired'?isExpired(x):!isExpired(x)));
  }).sort((a,b)=>{const wa=Number.isInteger(Number(a.weekday))?Number(a.weekday):new Date(a.startDate+'T12:00:00').getDay();const wb=Number.isInteger(Number(b.weekday))?Number(b.weekday):new Date(b.startDate+'T12:00:00').getDay();return ((wa+6)%7)-((wb+6)%7)||String(a.startDate).localeCompare(String(b.startDate))});
  const box=$('#adminWorkoutList');
  if(!box)return;
  box.innerHTML=list.map(x=>{
    const u=users.find(z=>z.id===x.studentId), expired=isExpired(x), cw=customWorkouts().find(c=>c.id===x.customId);
    const title=cw?.workout?.title||'Treino personalizado', cat=cw?.workout?.category==='bike'?`${svgIcon('i-bike')} Bike`:`${svgIcon('i-dumbbell')} Academia`;
    const weekday=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][Number.isInteger(Number(x.weekday))?Number(x.weekday):new Date(x.startDate+'T12:00:00').getDay()];
    const validity=x.validUntil?new Date(x.validUntil+'T12:00:00').toLocaleDateString('pt-BR'):'—';
    return `<div class="admin-workout-row ${expired?'is-expired':''}">
      <div class="admin-workout-icon">${cw?.workout?.category==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</div>
      <div class="admin-workout-main"><div class="admin-workout-title"><strong>${esc(title)}</strong></div><div class="admin-workout-student">${esc(u?.name||'Aluno removido')}</div><small>${cat} · ${weekday} · início ${new Date(x.startDate+'T12:00:00').toLocaleDateString('pt-BR')} · válido até ${validity}</small></div>
      <div class="admin-row-actions"><span class="admin-status-badge ${expired?'expired':'active'}">${expired?'Vencido':'Ativo'}</span><button class="mini-action" onclick="editCustomWorkout('${esc(x.customId||x.id)}')">${svgIcon('i-edit')} Editar</button><button class="mini-action mini-danger" onclick="deleteAdminWorkout('${esc(x.id)}')">${svgIcon('i-trash')} Excluir</button></div>
    </div>`;
  }).join('')||'<div class="admin-empty"><strong>Nenhum treino encontrado.</strong><small>Ajuste os filtros ou crie um novo treino personalizado.</small></div>';
}
function renderAdminNotifications(){const n=adminNotifs();$('#adminNotificationCount').textContent=n.filter(x=>!x.read).length;$('#adminNotifications').innerHTML=n.length?n.slice(0,20).map(x=>`<div class="admin-row"><div><strong>${esc(x.title)}</strong><small>${esc(x.body)} · ${new Date(x.date).toLocaleString('pt-BR')}</small></div><button class="mini-action" onclick="markAdminNotification('${x.id}')">${x.read?'Lida':'Marcar lida'}</button></div>`).join(''):'<div class="muted">Nenhum aviso.</div>'}
function markAdminNotification(id){const n=adminNotifs();const x=n.find(a=>String(a.id)===String(id));if(x)x.read=true;saveAdminNotifs(n);renderAdminNotifications()}
function showAdmin(){document.body.classList.add('admin-mode');document.querySelector('main')?.style.setProperty('display','none');document.querySelector('.app-header')?.style.setProperty('display','none');document.querySelector('.bottom-nav')?.style.setProperty('display','none');$('#quickAdd')?.style.setProperty('display','none');$('#adminPanel').classList.add('active');$('#authScreen').style.display='none';document.body.classList.remove('auth-open');renderAdminStudents();renderAdminWorkouts();renderCustomWorkoutList();renderAdminNotifications();checkWorkoutValidity();setAdminTab('students');refreshAdminUsersFromCloud().catch(e=>console.warn('Falha ao atualizar alunos online',e));clearInterval(adminRefreshTimer);adminRefreshTimer=setInterval(()=>refreshAdminUsersFromCloud().catch(e=>console.warn('Falha ao atualizar alunos online',e)),3000)}
function showStudent(){document.body.classList.remove('admin-mode');document.querySelector('.app-header')?.style.removeProperty('display');document.querySelector('main')?.style.removeProperty('display');document.querySelector('.bottom-nav')?.style.removeProperty('display');$('#quickAdd')?.style.removeProperty('display');$('#adminPanel').classList.remove('active');$('#authScreen').style.display='none';document.body.classList.remove('auth-open');renderStudentAssigned();refresh()}
async function initAuth(){
  const cloud = window.CicloFitCloud;
  // Quando o Supabase está ativo, a sessão real tem prioridade sobre o localStorage.
  if(cloud?.enabled && cloud.getSession){
    try{
      const sessionResult = await cloud.getSession();
      const session = sessionResult?.session;
      if(session?.user){
        const profileResult = await cloud.getProfile(session.user.id);
        const profile = profileResult?.data;
        if(profile && profile.active !== false){
          const role = profile.role === 'admin' ? 'admin' : 'student';
          setAuth({id:profile.id,role,username:profile.username||session.user.email,name:profile.name||session.user.email||'Usuário',email:session.user.email});
          const hydrated=await loadCloudState();
          if(!hydrated){
            console.warn('CicloFit Cloud: estado pessoal não foi carregado; sincronização remota permanece bloqueada até nova sessão.');
          }
          if(role==='admin')showAdmin();else showStudent();
          return;
        }
        await cloud.signOut();
      }
    }catch(e){console.warn('CicloFit Cloud: erro ao restaurar sessão',e)}
  }

  let a=currentAuth(); if(a){if(a.role==='admin')showAdmin();else showStudent();return}
  $('#authScreen').style.display='flex';
  document.body.classList.add('auth-open');
  let cloudOnline=false;
  if(cloud?.enabled&&cloud.ping){
    cloud.ping().then(r=>{
      cloudOnline=!!r?.ok;
      updateAuthConnectivity(cloudOnline);
    }).catch(()=>{cloudOnline=false;updateAuthConnectivity(false)});
  }else{
    updateAuthConnectivity(false);
  }
  $$('.auth-tab').forEach(b=>b.onclick=()=>{
    $$('.auth-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    updateAuthConnectivity(cloudOnline);
    $('#loginUser').placeholder=cloud?.enabled&&cloudOnline?'E-mail':'E-mail, usuário ou CPF';
  });

  $('#loginBtn').onclick=async()=>{
    const role=$('.auth-tab.active')?.dataset.role||'student';
    const u=String($('#loginUser').value||'').trim();
    const p=String($('#loginPass').value||'');
    if(!u||!p){$('#loginError').hidden=false;$('#loginError').textContent='Informe usuário/e-mail e senha.';return}
    const btn=$('#loginBtn'); if(btn){btn.disabled=true;btn.textContent='ENTRANDO...'}
    try{
      if(cloud?.enabled){
        const reachable=cloudOnline?{ok:true}:await cloud.ping?.().catch(()=>({ok:false}));
        cloudOnline=!!reachable?.ok;
        updateAuthConnectivity(cloudOnline);
        if(cloudOnline){
          const result=await cloud.signIn(u,p);
          if(result.error){
            if(!isOfflineAuthError(result.error))throw result.error;
          }else{
            const user=result.data?.user;
            if(!user)throw new Error('Usuário autenticado não retornado.');
            const profileResult=await cloud.getProfile(user.id);
            if(profileResult.error)throw profileResult.error;
            const profile=profileResult.data;
            if(!profile){await cloud.signOut();throw new Error('Perfil do usuário não encontrado.');}
            const actualRole=profile.role==='admin'?'admin':'student';
            if(actualRole!==role){await cloud.signOut();throw new Error(role==='admin'?'Este acesso não é de administrador.':'Este acesso não é de aluno.')}
            if(profile.active===false){await cloud.signOut();throw new Error('Este acesso está desativado pelo administrador.')}
            $('#loginError').hidden=true;
            setAuth({id:user.id,role:actualRole,username:profile.username||u,name:profile.name||user.email||'Usuário',email:user.email});
            location.reload();
            return;
          }
        }
        const offline=findLocalLogin(role,u,p);
        if(offline){
          $('#loginError').hidden=true;
          setAuth({id:offline.id,role:offline.role,username:offline.username,name:offline.name||'Aluno',offline:true});
          toast('Entrando em modo local. O banco está desligado.');
          location.reload();
          return;
        }
        throw new Error(cloudOnline?'Usuário ou senha inválidos.':'Banco offline. Use admin / admin123 ou aluno / 1234.');
      }

      const ok=findLocalLogin(role,u,p);
      if(!ok)throw new Error('Usuário ou senha inválidos. Verifique se o acesso foi criado pelo Admin.');
      $('#loginError').hidden=true;setAuth({id:ok.id,role:ok.role,username:ok.username,name:ok.name||'Aluno'});location.reload();
    }catch(e){
      console.warn('CicloFit login:',e);
      $('#loginError').hidden=false;
      $('#loginError').textContent=e?.message||'Não foi possível entrar. Verifique seus dados e tente novamente.';
    }finally{
      if(btn){btn.disabled=false;btn.textContent='ENTRAR'}
    }
  };
  $('#loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click()});
  if($('#registerBtn')) $('#registerBtn').onclick=async()=>{
    if(!cloud?.enabled)return toast('Ative o Supabase para criar contas online.','error');
    const name=prompt('Seu nome:')?.trim();
    if(!name)return;
    const email=prompt('Seu e-mail:')?.trim();
    if(!email)return;
    const password=prompt('Crie uma senha (mínimo de 6 caracteres):')||'';
    if(password.length<6)return toast('A senha precisa ter ao menos 6 caracteres.','error');
    const username=prompt('Nome de usuário (opcional):')?.trim()||email;
    const result=await cloud.signUp({email,password,name,username});
    if(result.error)return toast(result.error.message||'Não foi possível criar a conta.','error');
    toast(result.data?.session?'Conta criada. Entrando...':'Conta criada. Confirme seu e-mail para entrar.');
    if(result.data?.session)location.reload();
  };
}
$('#logoutBtn')?.addEventListener('click',logout);$('#adminNotifyBtn')?.addEventListener('click',requestAdminNotifications);
$('#goCustomWorkoutBtn')?.addEventListener('click',()=>setAdminTab('custom'));
['adminWorkoutSearch','adminWorkoutStudentFilter','adminWorkoutStatusFilter'].forEach(id=>$('#'+id)?.addEventListener(id==='adminWorkoutSearch'?'input':'change',renderAdminWorkouts));
$('#adminStudentSearch')?.addEventListener('input',renderAdminStudents);
$('#createStudentBtn')?.addEventListener('click',async()=>{const name=$('#newStudentName').value.trim(),username=$('#newStudentUser').value.trim(),password=$('#newStudentPass').value,cloud=window.CicloFitCloud;if(!name||!username||!password)return toast('Preencha nome, e-mail e senha.');if(cloud?.enabled){const btn=$('#createStudentBtn');btn.disabled=true;try{const result=await cloud.createStudent({name,email:username,password,username});if(result.error)throw result.error;const profile=result.data?.profile;if(!profile)throw new Error('O Supabase não retornou o perfil do aluno.');const users=authUsers().filter(u=>u.id!==profile.id&&u.username.toLowerCase()!==String(profile.username||username).toLowerCase());users.push({id:profile.id,name:profile.name||name,username:profile.username||username,role:'student',active:profile.active!==false});saveAuthUsers(users);['newStudentName','newStudentUser','newStudentPass'].forEach(id=>$('#'+id).value='');renderAdminStudents();renderAdminWorkouts();renderCustomWorkoutList();toast('Conta online criada. O aluno já pode entrar em outro dispositivo.')}catch(e){toast(e?.message||'Não foi possível criar a conta online.','error')}finally{btn.disabled=false}return}const users=authUsers();if(users.some(u=>u.username.toLowerCase()===username.toLowerCase())||username.toLowerCase()===defaultAdmin.username.toLowerCase())return toast('Usuário já existe.');users.push({id:crypto.randomUUID?.()||String(Date.now()),name,username,password,role:'student',active:true});saveAuthUsers(users);['newStudentName','newStudentUser','newStudentPass'].forEach(id=>$('#'+id).value='');renderAdminStudents();renderAdminWorkouts();renderCustomWorkoutList();toast('Acesso do aluno criado.')});
window.deleteStudent=async id=>{if(!confirm('Excluir este aluno e seus treinos?'))return;const cloud=window.CicloFitCloud;if(cloud?.enabled){const result=await cloud.deleteStudent(id);if(!result.ok&&result.error?.message!=='Aluno não encontrado.'){toast(result.error?.message||'Não foi possível excluir o aluno.','error');return}}saveAuthUsers(authUsers().filter(u=>u.id!==id));saveAdminWorkouts(adminWorkouts().filter(w=>w.studentId!==id));saveCustomWorkouts(customWorkouts().filter(w=>w.studentId!==id));resetAdminWorkoutForm();resetCustomWorkoutForm();renderAdminStudents();renderCustomWorkoutList();renderAdminWorkouts();toast('Aluno excluído.')};
window.resetStudentPassword=id=>{const pass=prompt('Digite a nova senha:');if(!pass)return;const users=authUsers(),u=users.find(x=>x.id===id);if(u){u.password=pass;saveAuthUsers(users);toast('Senha atualizada.')}};
window.editStudent=async id=>{const users=authUsers(),u=users.find(x=>x.id===id);if(!u)return;const name=prompt('Nome do aluno:',u.name);if(name===null)return;const username=prompt('E-mail:',u.username);if(username===null)return;const normalized=username.trim().toLowerCase();if(!normalized)return toast('E-mail não pode ficar vazio.','error');if(users.some(x=>x.id!==id&&x.username===normalized))return toast('E-mail já existe.','error');const pass=prompt('Senha (deixe em branco para manter a atual):');const cloud=window.CicloFitCloud;if(cloud?.enabled){const result=await cloud.updateStudent(id,{name:name.trim()||u.name,email:normalized,password:pass||''});if(result.error)return toast(result.error.message||'Não foi possível atualizar o aluno.','error');Object.assign(u,{name:result.data.name,username:result.data.email,password:''})}else{u.name=name.trim()||u.name;u.username=normalized;if(pass!==null&&pass!=='')u.password=pass}saveAuthUsers(users);renderAdminStudents();renderAdminWorkouts();renderCustomWorkoutList();toast('Aluno atualizado.')};
window.editStudentProfile=async id=>{const users=authUsers(),u=users.find(x=>x.id===id);if(!u)return;const p={...(u.profile||{})};const ask=(label,value)=>{const v=prompt(label,value??'');return v===null?null:v.trim()};const name=ask('Nome:',p.name||u.name);if(name===null)return;const birthDate=ask('Data de nascimento (AAAA-MM-DD):',p.birthDate||'');if(birthDate===null)return;const age=calculateAge(birthDate)||ask('Idade:',p.age||'');if(age===null)return;const phone=ask('Telefone:',p.phone||'');if(phone===null)return;const weight=ask('Peso (kg):',p.weight||'');if(weight===null)return;const height=ask('Altura (cm):',p.height||'');if(height===null)return;const goal=ask('Objetivo:',p.goal||'Melhorar condicionamento');if(goal===null)return;const level=ask('Nível:',p.level||'Iniciante');if(level===null)return;const maxHr=ask('FC máxima:',p.maxHr||'');if(maxHr===null)return;const ftp=ask('FTP (W):',p.ftp||'');if(ftp===null)return;const profile={...p,name:name||u.name,birthDate,age,phone,weight,height,goal,level,maxHr,ftp},cloud=window.CicloFitCloud;if(cloud?.enabled){const result=await cloud.updateStudent(id,{name:profile.name,email:u.username,password:'',profile});if(result.error)return toast(result.error.message||'Não foi possível atualizar o perfil.','error');Object.assign(u,{name:result.data.name,username:result.data.email,profile:result.data.profile||profile})}else{u.name=profile.name;u.profile=profile}saveAuthUsers(users);renderAdminStudents();toast('Perfil do aluno atualizado e sincronizado.')} ;
$('#assignWorkoutBtn')?.addEventListener('click',()=>{
  const studentId=$('#adminWorkoutStudent').value;
  if(!studentId)return toast('Selecione um aluno.','error');
  const type=$('#adminWorkoutType').value,start=$('#adminWorkoutStart').value||iso(),days=Math.max(1,Number($('#adminWorkoutValidity').value)||30),end=new Date(start+'T12:00:00');end.setDate(end.getDate()+days);const note=$('#adminWorkoutNote').value.trim();
  const list=adminWorkouts();
  if(editingAdminWorkoutId){
    const item=list.find(x=>x.id===editingAdminWorkoutId);
    if(item){Object.assign(item,{studentId,type,startDate:start,validUntil:iso(end),validityDays:days,note,notified:false});saveAdminWorkouts(list);toast('Treino atualizado.')}else toast('Treino não encontrado.','error');
  }else{
    list.push({id:crypto.randomUUID?.()||String(Date.now()),studentId,type,startDate:start,validUntil:iso(end),validityDays:days,note,notified:false});saveAdminWorkouts(list);toast('Treino atribuído ao aluno.');
  }
  resetAdminWorkoutForm();renderAdminWorkouts();renderStudentAssigned();
});
window.deleteAdminWorkout=id=>{if(!confirm('Excluir este treino?'))return;if(editingAdminWorkoutId===id)resetAdminWorkoutForm();saveAdminWorkouts(adminWorkouts().filter(x=>x.id!==id));renderAdminWorkouts()};
window.editAdminWorkout=id=>{const x=adminWorkouts().find(a=>a.id===id);if(!x)return;if(x.type?.startsWith('custom:')){setAdminTab('custom');return editCustomWorkout(x.customId||x.type.slice(7))}editingAdminWorkoutId=id;$('#adminWorkoutStudent').value=x.studentId;$('#adminWorkoutType').value=x.type;$('#adminWorkoutStart').value=x.startDate;$('#adminWorkoutValidity').value=x.validityDays||30;$('#adminWorkoutNote').value=x.note||'';$('#assignWorkoutBtn').textContent='✓ Salvar alterações';$('#cancelAdminWorkoutEdit').hidden=false;setAdminTab('workouts');toast('Edite os campos e salve as alterações.')};
$('#cancelAdminWorkoutEdit')?.addEventListener('click',resetAdminWorkoutForm);
$('#finishWorkout')?.addEventListener('click',e=>{
  if(!currentWorkout)return;
  const gate=activityCompletionGate(currentWorkout);
  if(!gate.ok){e.stopImmediatePropagation();toast(gate.reason,'error');updateFinishWorkoutState();}
},true);
const _oldRefresh=window.refresh;window.refresh=function(){_oldRefresh?.();if(currentAuth()?.role==='student')renderStudentAssigned();};
setInterval(()=>{if(currentAuth()?.role==='admin')checkWorkoutValidity()},60000);
if($('#adminWorkoutStart')&&!$('#adminWorkoutStart').value)$('#adminWorkoutStart').value=iso();

/* ===== v20.1: abas do painel administrativo ===== */
function setAdminTab(tab){
  $$('.admin-tab').forEach(b=>{const active=b.dataset.adminTab===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false')});
  $$('[data-admin-panel]').forEach(p=>p.classList.toggle('active',p.dataset.adminPanel===tab));
  const tabs=$('#adminPanel .admin-tabs');
  if(tabs)tabs.scrollLeft=0;
  if(tab==='students')renderAdminStudents();
  if(tab==='workouts')renderAdminWorkouts();
  if(tab==='custom'){renderExerciseCatalog();renderCustomStudents();renderSelectedExercises();renderCustomWorkoutList()}
  if(tab==='notifications')renderAdminNotifications();
}
$$('.admin-tab').forEach(b=>b.addEventListener('click',()=>setAdminTab(b.dataset.adminTab)));

/* ===== v18: logout no cabeçalho + treinos personalizados ===== */
const CUSTOM_EXERCISES_KEY='ciclofit-custom-exercises-v1';
const CUSTOM_WORKOUTS_KEY='ciclofit-custom-workouts-v1';
const exerciseCatalog=[
  // Academia
  ['Supino reto','Peito','gym'],['Supino inclinado','Peito','gym'],['Crucifixo máquina','Peito','gym'],['Flexão de braço','Peito','gym'],['Puxada frontal','Costas','gym'],['Puxada neutra','Costas','gym'],['Remada baixa','Costas','gym'],['Remada unilateral','Costas','gym'],['Remada cavalinho','Costas','gym'],['Pullover na polia','Costas','gym'],['Desenvolvimento de ombros','Ombros','gym'],['Elevação lateral','Ombros','gym'],['Elevação frontal','Ombros','gym'],['Face pull','Ombros','gym'],['Rosca direta','Bíceps','gym'],['Rosca alternada','Bíceps','gym'],['Rosca martelo','Bíceps','gym'],['Tríceps na polia','Tríceps','gym'],['Tríceps francês','Tríceps','gym'],['Tríceps testa','Tríceps','gym'],['Agachamento livre','Pernas','gym'],['Agachamento no Smith','Pernas','gym'],['Leg press 45°','Pernas','gym'],['Cadeira extensora','Quadríceps','gym'],['Mesa flexora','Posteriores','gym'],['Flexora sentado','Posteriores','gym'],['Terra romeno','Posteriores','gym'],['Levantamento terra','Posteriores','gym'],['Hip thrust','Glúteos','gym'],['Glute bridge','Glúteos','gym'],['Afundo / passada','Pernas','gym'],['Step-up','Pernas','gym'],['Cadeira adutora','Adutores','gym'],['Cadeira abdutora','Glúteos','gym'],['Panturrilha em pé','Panturrilhas','gym'],['Panturrilha sentado','Panturrilhas','gym'],['Tibial anterior','Tibial','gym'],['Prancha','Core','gym'],['Prancha lateral','Core','gym'],['Dead bug','Core','gym'],['Bird dog','Core','gym'],['Pallof press','Core','gym'],['Abdominal na polia','Core','gym'],['Abdominal infra','Core','gym'],['Hiperextensão lombar','Lombar','gym'],
  // Bike / ciclismo
  ['Aquecimento leve','Endurance','bike'],['Giro contínuo Z2','Endurance','bike'],['Tempo Z3','Tempo','bike'],['Sweet spot','Limiar','bike'],['Intervalo VO₂ máx.','VO₂ máx.','bike'],['Sprint máximo','Potência','bike'],['Sprint 10 s','Potência','bike'],['Sprint 20 s','Potência','bike'],['Subida sentado','Força','bike'],['Subida em pé','Força','bike'],['Força em baixa cadência','Força','bike'],['Cadência alta','Técnica','bike'],['Cadência baixa','Técnica','bike'],['Over-under','Limiar','bike'],['Intervalos 30/30','VO₂ máx.','bike'],['Intervalos 1/1','VO₂ máx.','bike'],['Intervalos 2/2','VO₂ máx.','bike'],['Intervalos 4/4','VO₂ máx.','bike'],['Endurance longo','Endurance','bike'],['Recuperação ativa','Recuperação','bike'],['Contrarrelógio','Performance','bike'],['Ataque em subida','Potência','bike'],['Arrancada','Potência','bike'],['Pedalada unilateral','Técnica','bike'],['Drill de cadência','Técnica','bike'],['Tempo progressivo','Tempo','bike'],['Fartlek','Variado','bike'],['Descida técnica','Técnica','bike'],['Sprint em subida','Potência','bike'],['Resistência muscular','Força','bike']
];
function customExercises(){try{const v=Array.isArray(data.customExercises)?data.customExercises:JSON.parse(localStorage.getItem(CUSTOM_EXERCISES_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function saveCustomExercises(v){localStorage.setItem(CUSTOM_EXERCISES_KEY,JSON.stringify(v));data.customExercises=v;save();queueSharedSave()}
function allExerciseCatalog(){return exerciseCatalog.concat(customExercises().map(e=>[e.name,e.group,e.category]))}
function customWorkouts(){try{const v=Array.isArray(data.customWorkouts)?data.customWorkouts:JSON.parse(localStorage.getItem(CUSTOM_WORKOUTS_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function saveCustomWorkouts(v){localStorage.setItem(CUSTOM_WORKOUTS_KEY,JSON.stringify(v));data.customWorkouts=v;save();queueSharedSave()}
function customById(id){return customWorkouts().find(x=>x.id===id)||null}
function workoutByKey(type){return type&&type.startsWith('custom:')?customById(type.slice(7))?.workout:workouts[type]}
function normalizeCustomExercise(e){return [e.name,e.group,Math.max(1,+e.sets||1),e.reps||10]}
function populateExerciseGroupFilter(){
  const select=$('#exerciseCatalogGroup');if(!select)return;
  const current=select.value||'all';
  const groups=[...new Set(allExerciseCatalog().map(e=>e[1]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  select.innerHTML='<option value="all">Todos os grupos</option>'+groups.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');
  if(groups.includes(current))select.value=current;else select.value='all';
}
function renderExerciseCatalog(){
  const box=$('#exerciseCatalog');if(!box)return;
  populateExerciseGroupFilter();
  const q=($('#exerciseSearch')?.value||'').trim().toLowerCase();
  const group=$('#exerciseCatalogGroup')?.value||'all';
  const cat=$('#exerciseCatalogCategory')?.value||'all';
  const list=allExerciseCatalog().filter(e=>(cat==='all'||e[2]===cat)&&(group==='all'||e[1]===group)&&(!q||e[0].toLowerCase().includes(q)||e[1].toLowerCase().includes(q)));
  box.innerHTML=list.map(e=>`<button type="button" class="catalog-item" data-exercise="${esc(e[0])}" data-group="${esc(e[1])}" data-category="${e[2]}"><span class="catalog-icon">${e[2]==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</span><span class="catalog-copy"><strong>${esc(e[0])}</strong><small>${esc(e[1])}</small></span><span class="catalog-add">+</span></button>`).join('')||'<div class="catalog-empty"><strong>Nenhum exercício encontrado</strong><small>Ajuste a busca, o grupo muscular ou a modalidade.</small></div>';
  $$('#exerciseCatalog .catalog-item').forEach(b=>b.onclick=()=>addSelectedExercise({name:b.dataset.exercise,group:b.dataset.group,category:b.dataset.category,sets:3,reps:10}));
}
let selectedCustomExercises=[];
function addSelectedExercise(e){if(selectedCustomExercises.some(x=>x.name===e.name)){toast('Esse exercício já foi adicionado.','error');return}selectedCustomExercises.push(e);renderSelectedExercises()}
function removeSelectedExercise(i){selectedCustomExercises.splice(i,1);renderSelectedExercises()}
function renderSelectedExercises(){
 const box=$('#selectedExercises');if(!box)return;

 box.innerHTML=selectedCustomExercises.length?selectedCustomExercises.map((e,i)=>`<div class="selected-exercise"><div><strong>${i+1}. ${esc(e.name)}</strong><small>${esc(e.group)} · ${e.category==='bike'?'Bike':'Academia'}</small></div><input type="number" min="1" value="${e.sets||3}" aria-label="Séries" data-custom-field="sets" data-index="${i}"><input type="number" min="1" value="${e.reps||10}" aria-label="Repetições" data-custom-field="reps" data-index="${i}"><button type="button" class="remove-exercise" data-remove="${i}" aria-label="Remover">×</button></div>`).join(''):'<div class="muted">Nenhum exercício adicionado.</div>';
 $$('#selectedExercises [data-custom-field]').forEach(i=>i.oninput=()=>{const n=+i.value||1;selectedCustomExercises[+i.dataset.index][i.dataset.customField]=n});
 $$('#selectedExercises [data-remove]').forEach(b=>b.onclick=()=>removeSelectedExercise(+b.dataset.remove));
}
let editingCustomWorkoutId=null;
function resetCustomWorkoutForm(){
  editingCustomWorkoutId=null; selectedCustomExercises=[];
  ['customWorkoutName','customWorkoutGroup','customWorkoutDuration','customWorkoutNote'].forEach(x=>{if($('#'+x))$('#'+x).value=''});
  if($('#customWorkoutCategory'))$('#customWorkoutCategory').value='gym';
  if($('#customWorkoutIntensity'))$('#customWorkoutIntensity').value='Moderada';
  if($('#customWorkoutStart'))$('#customWorkoutStart').value=iso();
  if($('#customWorkoutValidity'))$('#customWorkoutValidity').value='30';
  if($('#customWorkoutWeekday'))$('#customWorkoutWeekday').value='';
  const sel=$('#customWorkoutStudent');if(sel)sel.value='';
  if($('#saveCustomWorkout'))$('#saveCustomWorkout').innerHTML='<svg class="cf-svg" aria-hidden="true"><use href="#i-check"></use></svg> Salvar treino';
  if($('#cancelCustomWorkoutEdit'))$('#cancelCustomWorkoutEdit').hidden=true;
  if($('#customWorkoutFeedback'))$('#customWorkoutFeedback').textContent='Defina o treino, adicione exercícios e salve como grupo. Você poderá atribuí-lo a alunos agora ou depois.';
  renderSelectedExercises();
}
function renderCustomWorkoutList(){
 const box=$('#customWorkoutList');if(!box)return;const users=authUsers(),list=customWorkouts().slice().reverse();
 box.innerHTML=list.length?list.map(x=>{
   const u=users.find(a=>a.id===x.studentId);
   const group=x.group||x.workout?.group||'Grupo sem nome';
   const assigned=adminWorkouts().filter(a=>a.customId===x.id).length;
   return `<div class="admin-row"><div><strong>${svgIcon(x.workout?.category==='bike'?'i-bike':'i-dumbbell')} ${esc(x.workout.title)}</strong><small>Grupo: ${esc(group)} · ${x.workout.exercises.length} exercícios · ${esc(x.workout.duration||'')} · ${assigned} aluno(s) atribuído(s)</small></div><div class="admin-row-actions"><button class="mini-action" onclick="assignCustomWorkout('${x.id}')">Atribuir</button><button class="mini-action" onclick="editCustomWorkout('${x.id}')">Editar</button><button class="mini-action mini-danger" onclick="deleteCustomWorkout('${x.id}')">Excluir</button></div></div>`
 }).join(''):'<div class="muted">Nenhum grupo de treino criado.</div>';
}
window.assignCustomWorkout=id=>{
 const x=customById(id); if(!x)return toast('Grupo de treino não encontrado.','error');
 const users=authUsers(); if(!users.length)return toast('Cadastre um aluno primeiro.','error');
 const options=users.map((u,i)=>`${i+1} — ${u.name} (@${u.username})`).join('\n');
 const choice=prompt(`Atribuir “${x.workout.title}” a qual aluno?\n\n${options}\n\nDigite o número:`);
 if(choice===null)return; const idx=Number(choice)-1,u=users[idx]; if(!u)return toast('Aluno inválido.','error');
 const dayChoice=prompt(`Qual dia da semana deseja programar?\n\n0 — Domingo\n1 — Segunda-feira\n2 — Terça-feira\n3 — Quarta-feira\n4 — Quinta-feira\n5 — Sexta-feira\n6 — Sábado\n\nDigite o número:`);
 if(dayChoice===null)return; const weekday=Number(dayChoice); if(!Number.isInteger(weekday)||weekday<0||weekday>6)return toast('Dia da semana inválido.','error');
 const start=x.startDate||iso(),days=Math.max(1,Number(x.validityDays)||30),end=new Date(start+'T12:00:00');end.setDate(end.getDate()+days);
 const list=adminWorkouts();
 if(list.some(a=>a.customId===id&&a.studentId===u.id&&new Date(a.validUntil)>=new Date()))return toast('Este treino já está atribuído a esse aluno.','error');
 list.push({id:crypto.randomUUID?.()||String(Date.now()),customId:id,studentId:u.id,type:'custom:'+id,startDate:start,validUntil:iso(end),validityDays:days,weekday,note:x.note||'',notified:false});
 saveAdminWorkouts(list);authUsers();renderCustomWorkoutList();renderAdminWorkouts();toast(`Treino atribuído a ${u.name}.`);
};

window.editCustomWorkout=id=>{
 const x=customById(id); if(!x)return toast('Treino personalizado não encontrado.','error');
 const assigned=adminWorkouts().find(a=>a.customId===id);
 editingCustomWorkoutId=id;
 setAdminTab('custom');
 $('#customWorkoutStudent').value=x.studentId||'';
 $('#customWorkoutName').value=x.workout.title||'';
 $('#customWorkoutGroup').value=x.group||x.workout.group||'';
 $('#customWorkoutCategory').value=x.workout.category||'gym';
 $('#customWorkoutDuration').value=x.workout.duration||'';
 $('#customWorkoutIntensity').value=x.workout.intensity||'Moderada';
 $('#customWorkoutValidity').value=assigned?.validityDays||Math.max(1,Math.round((new Date(x.validUntil)-new Date(x.startDate))/86400000))||30;
 $('#customWorkoutStart').value=x.startDate||iso();
 $('#customWorkoutWeekday').value=String(Number.isInteger(Number(assigned?.weekday))?Number(assigned.weekday):new Date((x.startDate||iso())+'T12:00:00').getDay());
 $('#customWorkoutNote').value=assigned?.note||'';
 selectedCustomExercises=(x.workout.exercises||[]).map(e=>({name:e[0],group:e[1],sets:e[2],reps:e[3],category:x.workout.category||'gym'}));
 $('#saveCustomWorkout').innerHTML='<svg class="cf-svg" aria-hidden="true"><use href="#i-check"></use></svg> Salvar alterações';$('#cancelCustomWorkoutEdit').hidden=false;
 renderSelectedExercises();
 if($('#customWorkoutFeedback'))$('#customWorkoutFeedback').textContent='Editando treino personalizado. Salve para aplicar as alterações.';
};
window.deleteCustomWorkout=id=>{if(!confirm('Excluir este treino personalizado?'))return;if(editingCustomWorkoutId===id)resetCustomWorkoutForm();saveCustomWorkouts(customWorkouts().filter(x=>x.id!==id));saveAdminWorkouts(adminWorkouts().filter(x=>x.customId!==id));renderCustomWorkoutList();renderAdminWorkouts();renderStudentAssigned()};
function renderCustomStudents(){const users=authUsers().filter(u=>u.role==='student');renderStudentSelect($('#customWorkoutStudent'),users)}
$('#exerciseSearch')?.addEventListener('input',renderExerciseCatalog);
$('#exerciseCatalogGroup')?.addEventListener('change',renderExerciseCatalog);
$('#exerciseCatalogCategory')?.addEventListener('change',renderExerciseCatalog);
function closeNewExerciseModal(){$('#newExerciseModal')?.classList.remove('show')}
function openNewExerciseModal(){if(!$('#newExerciseModal'))return;$('#newExerciseName').value='';$('#newExerciseGroup').value='';$('#newExerciseCategory').value=$('#customWorkoutCategory')?.value||'gym';$('#newExerciseModal').classList.add('show');setTimeout(()=>$('#newExerciseName')?.focus(),50)}
$('#addExerciseBtn')?.addEventListener('click',openNewExerciseModal);
$('#closeNewExercise')?.addEventListener('click',closeNewExerciseModal);
$('#cancelNewExercise')?.addEventListener('click',closeNewExerciseModal);
$('#saveNewExercise')?.addEventListener('click',()=>{const name=($('#newExerciseName')?.value||'').trim(),group=($('#newExerciseGroup')?.value||'').trim(),category=$('#newExerciseCategory')?.value||'gym';if(!name)return toast('Informe o nome do exercício.','error');if(!group)return toast('Informe o grupo muscular ou objetivo.','error');if(allExerciseCatalog().some(e=>e[0].trim().toLowerCase()===name.toLowerCase()))return toast('Esse exercício já existe no catálogo.','error');const list=customExercises();list.push({id:'ex_'+Date.now().toString(36),name,group,category});saveCustomExercises(list);renderExerciseCatalog();closeNewExerciseModal();addSelectedExercise({name,group,category,sets:3,reps:10});toast('Novo exercício adicionado ao catálogo.','success')});
$('#newExerciseModal')?.addEventListener('click',e=>{if(e.target.id==='newExerciseModal')closeNewExerciseModal()});
$('#saveCustomWorkout')?.addEventListener('click',()=>{
 const studentId=$('#customWorkoutStudent')?.value?.trim(),name=$('#customWorkoutName')?.value?.trim(),group=$('#customWorkoutGroup')?.value?.trim()||'Grupo personalizado',category=$('#customWorkoutCategory')?.value||'gym',weekdayValue=$('#customWorkoutWeekday')?.value;
 if(!name)return toast('Informe o nome do treino.','error');
 if(studentId && weekdayValue==='')return toast('Selecione o dia da semana para este aluno.','error');
 if(!selectedCustomExercises.length)return toast('Adicione pelo menos um exercício.','error');
 const duration=$('#customWorkoutDuration')?.value.trim()||'60 min',intensity=$('#customWorkoutIntensity')?.value||'Moderada';
 const startDate=$('#customWorkoutStart')?.value||iso(),days=Math.max(1,+$('#customWorkoutValidity')?.value||30),end=new Date(startDate+'T12:00:00');end.setDate(end.getDate()+days);
 if(Number.isNaN(end.getTime()))return toast('Data de início inválida.','error');
 const workout={title:name,subtitle:category==='bike'?'Treino personalizado de ciclismo':'Treino personalizado de academia',icon:category==='bike'?'i-bike':'i-dumbbell',duration,intensity,exercises:selectedCustomExercises.map(normalizeCustomExercise),category,group};
 if(editingCustomWorkoutId){
   const list=customWorkouts(),item=list.find(x=>x.id===editingCustomWorkoutId); if(!item)return toast('Treino não encontrado.','error');
   item.workout=workout;item.group=group;item.startDate=startDate;item.validUntil=iso(end);item.validityDays=days;item.note=$('#customWorkoutNote')?.value.trim()||'';item.studentId=studentId||null;saveCustomWorkouts(list);
   const assigned=adminWorkouts();
   const a=assigned.find(x=>x.customId===editingCustomWorkoutId&&(!studentId||x.studentId===studentId));
   if(a)Object.assign(a,{studentId,startDate:startDate,validUntil:iso(end),validityDays:days,weekday:weekdayValue===''?(Number.isInteger(Number(a.weekday))?Number(a.weekday):new Date(startDate+'T12:00:00').getDay()):Number(weekdayValue),note:item.note,notified:false});
   else if(studentId)assigned.push({id:crypto.randomUUID?.()||String(Date.now()+1),customId:editingCustomWorkoutId,studentId,type:'custom:'+editingCustomWorkoutId,startDate:startDate,validUntil:iso(end),validityDays:days,weekday:Number(weekdayValue),note:item.note,notified:false});
   saveAdminWorkouts(assigned);toast('Grupo de treino atualizado.');
 }else{
   const id=crypto.randomUUID?.()||String(Date.now()),list=customWorkouts();
   const item={id,studentId:studentId||null,group,workout,startDate:startDate,validUntil:iso(end),validityDays:days,note:$('#customWorkoutNote')?.value.trim()||''};
   list.push(item);saveCustomWorkouts(list);
   if(studentId){const assigned=adminWorkouts();assigned.push({id:crypto.randomUUID?.()||String(Date.now()+1),customId:id,studentId,type:'custom:'+id,startDate:startDate,validUntil:iso(end),validityDays:days,weekday:Number(weekdayValue),note:item.note,notified:false});saveAdminWorkouts(assigned);toast('Grupo criado e atribuído ao aluno.');}
   else toast('Grupo de treino criado. Atribua a alunos quando quiser.');
 }
 resetCustomWorkoutForm();renderCustomWorkoutList();renderAdminWorkouts();renderCustomStudents();renderStudentAssigned();
});

$('#cancelCustomWorkoutEdit')?.addEventListener('click',resetCustomWorkoutForm);

// Resolve treinos personalizados no player do aluno.
window.openWorkout=function(type){try{if(!$('#exerciseList')||!$('#workoutModal')){toast('Tela de treino indisponível.','error');return false}currentWorkout=type;const w=workoutByKey(type);if(!w){currentWorkout=null;toast('Treino não encontrado.','error');return false}const exercises=Array.isArray(w.exercises)?w.exercises:[];if(!exercises.length){toast('Este treino não possui exercícios cadastrados.','error');return}const key=workoutDraftKey(type),saved=data.workoutDrafts?.[key]?.sets||data.workouts?.[key]?.sets||[];$('#modalTitle').textContent=w.title||'Treino';$('#modalSubtitle').textContent='';$('#exerciseList').innerHTML=exercises.map((e,i)=>{const se=saved[i]||[],def=defaultLoadForExercise(e[0]);const rows=Array.from({length:e[2]},(_,s)=>{const x=se[s]||{};return `<div class="sets"><span>${s+1}</span><input data-e="${i}" data-s="${s}" data-field="weight" type="number" value="${x.weight!==undefined&&x.weight!==''?esc(x.weight):esc(def)}" placeholder="${def?'kg · padrão '+esc(def):'kg'}"><input data-e="${i}" data-s="${s}" data-field="reps" type="number" value="${x.reps||e[3]||10}" placeholder="reps"><button class="set-check ${x.done?'done':''}" data-e="${i}" data-s="${s}" aria-label="Marcar série">${x.done?'✓':'○'}</button></div>`});return `<div class="exercise"><div class="exercise-top"><div><h3>${i+1}. ${esc(e[0])}</h3><small>${esc(e[1])}</small><label class="default-load-label">Carga padrão<input class="default-load-input" data-default-exercise="${esc(e[0])}" type="number" min="0" step="0.5" value="${esc(def)}" placeholder="Ex.: 20"></label></div><strong>${e[2]} × ${e[3]}</strong></div>${rows.join('')}</div>`}).join('');$$('.set-check').forEach(b=>b.onclick=()=>{b.classList.toggle('done');b.textContent=b.classList.contains('done')?'✓':'○';saveWorkoutDraft();updateGymStatus();renderInProgressExercises()});$$('.default-load-input').forEach(input=>input.addEventListener('change',()=>{const value=String(input.value??'').trim();setDefaultLoad(input.dataset.defaultExercise,value);const card=input.closest('.exercise');if(card){card.querySelectorAll('[data-field="weight"]').forEach(w=>{w.value=value})}saveWorkoutDraft();}));$$('#exerciseList input:not(.default-load-input)').forEach(i=>i.addEventListener('input',()=>{saveWorkoutDraft();renderInProgressExercises()}));updateGymStatus();$('#workoutModal').classList.add('show');document.body.classList.add('modal-open');resetTimer();updateFinishWorkoutState();renderInProgressExercises();return true}catch(e){console.error('CicloFit: openWorkout falhou',e);currentWorkout=null;$('#workoutModal')?.classList.remove('show');toast('Não foi possível abrir a lista de exercícios.','error');return false}};
// Treinos atribuídos: inclui personalizados e templates A/B/C.
function renderInProgressExercisesLegacy(){
  const box=$('#inProgressExercises'); if(!box)return;
  const a=currentAuth(); if(!a||a.role!=='student'){box.innerHTML='';return}
  const today=iso(), drafts=Object.values(data.workoutDrafts||{}).filter(d=>String(d.updatedAt||'').slice(0,10)===today||String(d.type||'').startsWith('custom:'));
  const unique=[]; const seen=new Set();
  drafts.forEach(d=>{const key=workoutDraftKey(d.type,today);if(seen.has(d.type))return;const w=workoutByKey(d.type);if(!w)return;const sets=(d.sets||[]).flat();const completed=sets.filter(s=>s.done).length;const total=sets.length;if(completed>0&&completed<total){seen.add(d.type);unique.push({d,w,completed,total})}});
  box.innerHTML=unique.length?unique.map(({d,w,completed,total})=>`<article class="in-progress-card"><div class="in-progress-icon">${String(w.category||'').toLowerCase()==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</div><div class="in-progress-main"><div class="in-progress-top"><span>EM ANDAMENTO</span><b>${completed}/${total} séries</b></div><strong>${esc((w.title||'Treino').replace(/^Treino [ABC] — /,''))}</strong><small>${esc(w.duration||'')} · continue de onde parou</small><div class="in-progress-bar"><i style="width:${Math.round(completed/Math.max(total,1)*100)}%"></i></div></div><button class="mini-action" onclick="openWorkout('${esc(d.type)}')">Continuar</button></article>`).join(''):'<div class="in-progress-empty">Nenhum exercício em andamento. Seus treinos iniciados aparecerão aqui.</div>';
}
window.openAssignedWorkout=function(identifier){
  const a=currentAuth?.();
  if(!a||a.role!=='student'){toast('Faça login como aluno para abrir o treino.','error');return false;}
  const id=String(identifier??'').trim();
  const assigned=adminWorkouts().find(x=>{
    const sameStudent=String(x.studentId??'')===String(a.id??'');
    const candidateIds=[x.id,x.type,x.customId,x.customId?`custom:${x.customId}`:''].map(v=>String(v??'').trim()).filter(Boolean);
    return sameStudent && candidateIds.includes(id);
  });
  if(!assigned){toast('Treino atribuído não encontrado.','error');return false;}
  const w=workoutByKey(assigned.type);
  if(!w){toast('O treino atribuído não está disponível.','error');return false;}
  const expired=assigned.validUntil&&new Date(assigned.validUntil+'T23:59:59')<new Date();
  if(expired){toast('Este treino está vencido.','error');return false;}
  const gate=activityOpenGate(assigned.type);
  if(!gate.ok){toast(gate.reason,'error');return false;}
  const isBike=String(w.category||'').toLowerCase()==='bike'||String(w.icon||'').toLowerCase()==='i-bike';
  if(isBike){
    navigate('cycling');
    return true;
  }
  // Garante que o aluno esteja na aba Treinos e abre a lista de exercícios.
  navigate('workouts');
  requestAnimationFrame(()=>{
    try{window.openWorkout(String(assigned.type));}
    catch(e){console.error('CicloFit: falha ao abrir treino atribuído',e);toast('Não foi possível abrir a lista de exercícios.','error');}
  });
  return true;
};

document.addEventListener('click',e=>{
  const btn=e.target?.closest?.('[data-open-assigned]');
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  try{window.openAssignedWorkout(btn.getAttribute('data-open-assigned')||'')}catch(err){console.error('CicloFit: erro ao abrir treino atribuído',err);toast('Não foi possível abrir o treino.','error')}
},true);

window.renderStudentAssigned=function(){
  const a=currentAuth(); if(!a||a.role!=='student')return;
  const box=$('#workoutCards'); if(!box)return;
  const assigned=adminWorkouts().filter(w=>String(w.studentId)===String(a.id)).sort((x,y)=>{const wx=Number.isInteger(Number(x.weekday))?Number(x.weekday):new Date(x.startDate+'T12:00:00').getDay();const wy=Number.isInteger(Number(y.weekday))?Number(y.weekday):new Date(y.startDate+'T12:00:00').getDay();return ((wx+6)%7)-((wy+6)%7)||String(x.startDate).localeCompare(String(y.startDate))});
  const cards=assigned.map(x=>{
    const w=workoutByKey(x.type); if(!w)return '';
    const expired=x.validUntil&&new Date(x.validUntil+'T23:59:59')<new Date();
    const isBike=String(w.category||'').toLowerCase()==='bike'||String(w.icon||'').toLowerCase()==='i-bike';
    const tag=x.type?.startsWith('custom:')?'PERSONALIZADO':`TREINO ${esc(x.type)}`;
    const title=w.title||'Treino';
    const subtitle=x.note||w.subtitle||'';
    const duration=w.duration||'';
    const exercises=w.exercises?.length||0;
    const sets=w.exercises?.reduce((sum,e)=>sum+(+e[2]||0),0)||0;
    const buttonLabel=expired?'Expirado':(isBike?'Carregar GPX':'Começar');
    return `<article class="card workout-item ${expired?'workout-done':''} ${isBike?'workout-bike':''}"><div class="workout-icon">${String(w.category||'').toLowerCase()==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</div><div class="workout-main"><div class="workout-topline"><span class="workout-tag">${tag}</span><span class="${expired?'validity-expired':'validity-ok'}">${expired?'VENCIDO':'VÁLIDO ATÉ '+new Date(x.validUntil+'T12:00:00').toLocaleDateString('pt-BR')}</span></div><h3>${esc(title.replace(/^Treino [ABC] — /,''))}</h3><p>${esc(subtitle)}</p><div class="workout-meta"><span class="meta-icon-text">${svgIcon('i-clock')} ${esc(duration)}</span><span>•</span><span>${exercises} exercícios</span>${sets&&!isBike?`<span>•</span><span>${sets} séries</span>`:''}</div></div><button class="btn ${expired?'btn-light':'btn-primary'} workout-open" ${expired?'disabled':''} onclick="openAssignedWorkout('${esc(x.id||x.type)}')">${buttonLabel}</button></article>`;
  }).join('');
  box.innerHTML=cards||'<div class="card"><div class="muted">Nenhum treino atribuído pelo Admin.</div></div>';
};
// Ajusta validação para treinos personalizados.
$('#headerLogout')?.addEventListener('click',logout);
const _oldShowAdmin=showAdmin;showAdmin=function(){_oldShowAdmin();$('#headerLogout')?.style.setProperty('display','none');renderCustomStudents();renderExerciseCatalog();renderSelectedExercises();renderCustomWorkoutList()};
const _oldShowStudent=showStudent;showStudent=function(){_oldShowStudent();$('#headerLogout')?.style.removeProperty('display')};
// Reaplica o botão de sair quando a sessão já estiver restaurada.
if(currentAuth()?.role==='student')$('#headerLogout')?.style.removeProperty('display');else $('#headerLogout')?.style.setProperty('display','none');


/* ===== v40: regras por modalidade e dia ===== */
function todayAssignedForStudent(){
  const a=currentAuth();
  if(!a||a.role!=='student')return [];
  const today=iso(new Date());
  return weeklyAssignedSchedule(new Date()).get(today)||[];
}
function isBikeWorkoutType(type){
  const w=workoutByKey(type);
  return String(w?.category||'').toLowerCase()==='bike'||String(w.icon||'').toLowerCase()==='i-bike';
}
function isWorkoutScheduledToday(type){
  const a=currentAuth();
  if(!type)return false;
  if(a?.role==='student')return todayAssignedForStudent().some(x=>String(x.type)===String(type));
  const fallback=todayType();
  return String(fallback)===String(type);
}
function activityOpenGate(type){
  if(!type)return {ok:false,reason:'Nenhuma atividade selecionada.'};
  if(isDoneWorkout(type))return {ok:false,reason:'Esta atividade já foi concluída e não pode ser aberta novamente.'};
  if(!isWorkoutScheduledToday(type))return {ok:false,reason:'Só é possível abrir a atividade do dia.'};
  return {ok:true};
}
function activityCompletionGate(type){
  if(!type)return {ok:false,reason:'Nenhuma atividade selecionada.'};
  if(isDoneWorkout(type))return {ok:false,reason:'Esta atividade já foi concluída e não pode ser finalizada novamente.'};
  if(!isWorkoutScheduledToday(type))return {ok:false,reason:'Só é possível concluir a atividade do dia.'};
  const a=currentAuth();
  if(a?.role==='student'){
    const active=adminWorkouts().find(x=>String(x.studentId)===String(a.id)&&String(x.type)===String(type)&&(!x.validUntil||new Date(x.validUntil+'T23:59:59')>=new Date()));
    if(!active)return {ok:false,reason:'Este treino não está válido.'};
  }
  if(isBikeWorkoutType(type))return {ok:false,reason:'Pedais são concluídos na aba Pedal.'};
  return {ok:true};
}
function lockRideDateToToday(){
  const el=$('#rideDate');
  if(!el)return;
  const today=iso();
  el.value=today;
  el.min=today;
  el.max=today;
  el.readOnly=true;
}
function rideCompletionGate(){
  const today=iso();
  const selected=$('#rideDate')?.value||today;
  if(selected!==today)return {ok:false,reason:'Só é possível registrar o pedal do dia.'};
  if(isTodayRideCompleted()&&!editingRideId)return {ok:false,reason:'O pedal de hoje já foi concluído e não pode ser registrado novamente.'};
  const a=currentAuth();
  if(a?.role==='student'){
    const bikeToday=todayAssignedForStudent().some(x=>isBikeWorkoutType(x.type));
    if(!bikeToday)return {ok:false,reason:'Não há pedal programado para hoje.'};
  }
  return {ok:true};
}
function isCurrentWorkoutFinished(){
  if(!currentWorkout)return false;
  return !!data.workouts[workoutDraftKey(currentWorkout)];
}
function canFinishCurrentWorkout(){
  return activityCompletionGate(currentWorkout).ok;
}
function updateFinishWorkoutState(){
  const btn=$('#finishWorkout'); if(!btn)return;
  const finished=isCurrentWorkoutFinished();
  const gate=activityCompletionGate(currentWorkout);
  const allowed=gate.ok;
  btn.disabled=!allowed;
  btn.setAttribute('aria-disabled',String(!allowed));
  btn.title=finished?'Treino já finalizado':(allowed?'Concluir treino':gate.reason);
  btn.innerHTML=finished?`${svgIcon('i-check')} Treino finalizado`:(allowed?`${svgIcon('i-check')} Concluir treino`:`${svgIcon('i-lock')} ${finished?'Já concluído':'Somente o treino do dia'}`);
}

/* ===== v22: treinos personalizados também aparecem na caixa Treinos + fechamento robusto ===== */
function renderCustomWorkoutsInTrainings(){
  const box=$('#customWorkoutsInTrainings'); if(!box)return;
  const users=authUsers();
  const list=customWorkouts().slice().reverse();
  box.innerHTML=list.length?list.map(x=>{
    const u=users.find(a=>a.id===x.studentId);
    const icon=svgIcon(x.workout?.category==='bike'?'i-bike':'i-dumbbell');
    const title=x.workout?.title||'Treino personalizado';
    const cat=x.workout?.category==='bike'?'Bike':'Academia';
    return `<div class="admin-row"><div><strong class="inline-icon-text">${icon}<span>${esc(title)}</span></strong><small>${esc(u?.name||'Aluno removido')} · ${cat} · ${x.workout?.exercises?.length||0} exercícios · início ${new Date(x.startDate+'T12:00:00').toLocaleDateString('pt-BR')} · validade ${new Date(x.validUntil+'T12:00:00').toLocaleDateString('pt-BR')}</small></div><div class="admin-row-actions"><button class="mini-action" onclick="editCustomWorkout('${esc(x.id)}')">${svgIcon('i-edit')} Editar</button><button class="mini-action mini-danger" onclick="deleteCustomWorkout('${esc(x.id)}')">${svgIcon('i-trash')} Excluir</button></div></div>`;
  }).join(''):'<div class="muted">Nenhum treino personalizado criado.</div>';
}

function renderInProgressExercises(){
  const box=$('#inProgressExercises'); if(!box)return;
  const a=currentAuth(); if(!a||a.role!=='student'){box.innerHTML='';return}
  const today=iso(), drafts=Object.values(data.workoutDrafts||{}).filter(d=>String(d.updatedAt||'').slice(0,10)===today||String(d.type||'').startsWith('custom:'));
  const unique=[]; const seen=new Set();
  drafts.forEach(d=>{if(seen.has(d.type))return;const w=workoutByKey(d.type);if(!w)return;if(isDoneWorkout(d.type,today)||!isWorkoutScheduledToday(d.type))return;const sets=(d.sets||[]).flat();const completed=sets.filter(s=>s.done).length;const total=sets.length;if(completed>0&&completed<total){seen.add(d.type);unique.push({d,w,completed,total})}});
  box.innerHTML=unique.length?unique.map(({d,w,completed,total})=>`<article class="in-progress-card"><div class="in-progress-icon">${String(w.category||'').toLowerCase()==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</div><div class="in-progress-main"><div class="in-progress-top"><span>EM ANDAMENTO</span><b>${completed}/${total} séries</b></div><strong>${esc((w.title||'Treino').replace(/^Treino [ABC] — /,''))}</strong><small>${esc(w.duration||'')} · continue de onde parou</small><div class="in-progress-bar"><i style="width:${Math.round(completed/Math.max(total,1)*100)}%"></i></div></div><button class="mini-action" onclick="openWorkout('${esc(d.type)}')">Continuar</button></article>`).join(''):'<div class="in-progress-empty">Nenhum exercício em andamento. Seus treinos iniciados aparecerão aqui.</div>';
}
window.renderStudentAssigned=function(){
  const a=currentAuth(); if(!a||a.role!=='student')return;
  const box=$('#workoutCards'); if(!box)return;
  /* O aluno só vê treinos que tenham sido efetivamente atribuídos pelo Admin. */
  const assigned=adminWorkouts().filter(w=>String(w.studentId)===String(a.id)).sort((x,y)=>{const wx=Number.isInteger(Number(x.weekday))?Number(x.weekday):new Date(x.startDate+'T12:00:00').getDay();const wy=Number.isInteger(Number(y.weekday))?Number(y.weekday):new Date(y.startDate+'T12:00:00').getDay();return ((wx+6)%7)-((wy+6)%7)||String(x.startDate).localeCompare(String(y.startDate))});
  const cards=assigned.map(x=>{
    const w=workoutByKey(x.type); if(!w)return '';
    const expired=x.validUntil&&new Date(x.validUntil+'T23:59:59')<new Date();
    const done=isDoneWorkout(x.type);
    const todayOnly=isWorkoutScheduledToday(x.type);
    const locked=expired||done||!todayOnly;
    const isCustom=String(x.type||'').startsWith('custom:');
    const tag=isCustom?'':`TREINO ${esc(x.type)}`;
    const title=w.title||'Treino';
    const subtitle=x.note||w.subtitle||'';
    const duration=w.duration||'';
    const exercises=w.exercises?.length||0;
    const sets=w.exercises?.reduce((sum,e)=>sum+(+e[2]||0),0)||0;
    const label=expired?'Expirado':(done?'Concluído':(todayOnly?'Começar':'Somente no dia'));
    const status=expired?'VENCIDO':(done?'CONCLUÍDO':(todayOnly?'HOJE':'PROGRAMADO'));
    const statusClass=expired||done?'validity-expired':'workout-tag';
    const tagHtml=tag?`<span class="workout-tag">${tag}</span>`:'';
    const aid=esc(x.id||x.type||x.customId||''); return `<article class="card workout-item ${locked?'workout-done workout-locked':''} ${isCustom?'workout-custom':''}"><div class="workout-icon">${String(w.category||'').toLowerCase()==='bike'?svgIcon('i-bike'):svgIcon('i-dumbbell')}</div><div class="workout-main"><div class="workout-topline">${tagHtml}<span class="${statusClass}">${status}</span></div><h3>${esc(title.replace(/^Treino [ABC] — /,''))}</h3><p>${esc(subtitle)}</p><div class="workout-meta"><span class="meta-icon-text">${svgIcon('i-clock')} ${esc(duration)}</span><span>•</span><span>${exercises} exercícios</span>${sets?`<span>•</span><span>${sets} séries</span>`:''}</div></div><button type="button" class="btn ${locked?'btn-light':'btn-primary'} workout-open" ${locked?'disabled':''} data-open-assigned="${aid}">${label}</button></article>`;
  }).join('');
  box.innerHTML=cards||'<div class="card"><div class="muted">Nenhum treino atribuído pelo Admin.</div></div>';
};

/* O construtor personalizado passa a atualizar também a aba TREINOS. */
const _renderAdminWorkoutsV22=renderAdminWorkouts;
renderAdminWorkouts=function(){_renderAdminWorkoutsV22();renderCustomWorkoutsInTrainings()};

/* Fechamento confiável da aba/modal de treino em botão, toque, backdrop e ESC. */
window.closeWorkout=function(){
  try{if(currentWorkout)saveWorkoutDraft()}catch(e){}
  try{stopTimer()}catch(e){}
  currentWorkout=null;
  $('#workoutModal')?.classList.remove('show');
  document.body.classList.remove('modal-open');
};
$('#closeModal')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.closeWorkout()});
$('#workoutModal')?.addEventListener('click',e=>{if(e.target.id==='workoutModal')window.closeWorkout()});

const _openWorkoutV22=window.openWorkout;
window.openWorkout=function(type){
  const gate=activityOpenGate(type);
  if(!gate.ok){toast(gate.reason,'error');return false;}
  const w=workoutByKey(type);
  const isBike=String(w?.category||'').toLowerCase()==='bike';
  if(isBike){
    try{closeWorkout()}catch(e){}
    navigate('cycling');
    return;
  }
  _openWorkoutV22(type);
  const btn=$('#closeModal');
  if(btn)btn.onclick=e=>{e.preventDefault();e.stopPropagation();window.closeWorkout()};
};

const _refreshV22=window.refresh;
window.refresh=function(){_refreshV22?.();if(currentAuth()?.role==='admin')renderCustomWorkoutsInTrainings()};

// Migra grupos personalizados antigos sem alterar o conteúdo dos treinos.
try{const cs=customWorkouts();let changed=false;cs.forEach(x=>{if(!x.group){x.group=x.workout?.group||'Grupo personalizado';changed=true}if(x.validityDays==null&&x.startDate&&x.validUntil){x.validityDays=Math.max(1,Math.round((new Date(x.validUntil)-new Date(x.startDate))/86400000));changed=true}});if(changed)saveCustomWorkouts(cs)}catch(e){console.warn('Migração de grupos',e)}
// Remove atribuições antigas dos treinos A/B/C da estrutura administrativa.
cleanLegacyABCWorkouts();
/* ===== v36: treino de bike no card inicial abre a área de GPX ===== */
// Treinos atribuídos de ciclismo levam o aluno diretamente para Pedal > Carregar GPX.

// ===== Fluxo do Treino do dia: academia -> Treinos | ciclismo -> Carregar GPX =====
(function setupTodayWorkoutLaunch(){
  function findTodayAssignment(){
    const a=currentAuth?.();
    if(!a||a.role!=='student')return null;
    const today=iso(new Date());
    const items=typeof weeklyAssignedSchedule==='function' ? (weeklyAssignedSchedule(new Date()).get(today)||[]) : [];
    return items.find(x=>{
      if(x.validUntil && new Date(x.validUntil+'T23:59:59')<new Date()) return false;
      return !!workoutByKey(x.type);
    })||null;
  }

  function launchTodayWorkout(e){
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const assigned=findTodayAssignment();
    const fallback=todayType?.();
    const type=assigned?.type||fallback;
    const w=type?workoutByKey(type):null;
    if(!w){toast?.('Nenhum treino está programado para hoje.','error');return false;}
    const gate=activityOpenGate(type);
    if(!gate.ok){toast?.(gate.reason,'error');return false;}

    const isBike=String(w.category||'').toLowerCase()==='bike';
    if(isBike){
      try{
        navigate('cycling');
        requestAnimationFrame(()=>{
          try{setRideMode('gpx')}catch(err){console.error('CicloFit: falha ao abrir carregamento GPX',err)}
        });
      }catch(err){
        console.error('CicloFit: falha ao abrir Pedal',err);
        toast?.('Não foi possível abrir o carregamento GPX.','error');
        return false;
      }
      return true;
    }

    try{
      navigate('workouts');
      requestAnimationFrame(()=>{
        try{
          if(assigned?.id && typeof openAssignedWorkout==='function'){
            const opened=openAssignedWorkout(assigned.id);
            if(opened===false) openWorkout(type);
          }else{
            openWorkout(type);
          }
        }catch(err){
          console.error('CicloFit: falha ao abrir treino de academia',err);
          toast?.('Não foi possível abrir a lista de exercícios.','error');
        }
      });
    }catch(err){
      console.error('CicloFit: falha ao abrir aba Treinos',err);
      toast?.('Não foi possível abrir a aba Treinos.','error');
      return false;
    }
    return true;
  }

  window.launchTodayWorkout=launchTodayWorkout;

  function bind(){
    const btn=$('#todayAction');
    if(!btn)return;
    btn.onclick=launchTodayWorkout;
    btn.classList.add('today-launch-fixed');
    const icon=$('#todayIcon');
    if(icon && !icon.querySelector('svg')) icon.innerHTML=svgIcon('i-training');
  }
  bind();
  const oldRefresh=window.refresh;
  window.refresh=function(){oldRefresh?.();setTimeout(bind,0)};
})();

// Inicializa o acesso somente após carregar o construtor de treinos personalizados.
initAuth();

// v5.0 online: verifica opcional da infraestrutura Supabase sem alterar o fluxo local.
if(window.CicloFitCloud?.enabled){
  window.CicloFitCloud.ping().then(r=>{
    if(r.ok) console.info('CicloFit Cloud: conexão Supabase OK.');
    else console.warn('CicloFit Cloud: banco não respondeu.', r.error||r.reason);
  }).catch(e=>console.warn('CicloFit Cloud: erro de conexão.',e));
}

// v40: mantém o botão de conclusão coerente com o treino do dia.
try{updateFinishWorkoutState()}catch(e){}
