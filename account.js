'use strict';
(() => {
 const byId=id=>document.getElementById(id),config=window.BLOCK_TIME_CONFIG||{};
 let client=null,user=null,gameOwner=null,runId=null,requestId=0,busy=false,pending=null;
 const status=text=>{byId('accountStatus').textContent=text};
 function render(){byId('accountForm').hidden=!!user;byId('signedIn').hidden=!user;byId('accountEmail').textContent=user?.email||'';byId('history').replaceChildren();byId('cloudBest').textContent='—';byId('retrySave').hidden=!(pending&&user?.id===pending.user_id)}
 function friendly(error){const m=String(error?.message||'');if(/invalid login/i.test(m))return 'Email 或密碼不正確。';if(/email not confirmed/i.test(m))return '請先到信箱完成驗證。';if(/rate limit|too many/i.test(m))return '操作過於頻繁，請稍後再試。';if(/password/i.test(m))return '密碼未符合要求，請使用至少 8 個字元。';return '操作失敗，請檢查網路或稍後再試。'}
 async function loadHistory(){if(!client||!user)return;const owner=user.id,sequence=++requestId;byId('historyStatus').textContent='讀取紀錄中…';const mode=byId('mode').value;
  const [recent,best]=await Promise.all([client.from('block_time_games').select('mode,score,lines,level,created_at').eq('user_id',owner).order('created_at',{ascending:false}).limit(20),client.from('block_time_games').select('score').eq('user_id',owner).eq('mode',mode).order('score',{ascending:false}).limit(1)]);
  if(user?.id!==owner||sequence!==requestId)return;
  if(recent.error||best.error){byId('historyStatus').textContent='紀錄讀取失敗，請稍後重新整理。';return}
  byId('cloudBest').textContent=(best.data[0]?.score||0).toLocaleString();byId('history').replaceChildren();
  for(const row of recent.data){const li=document.createElement('li');li.className='historyRow';const info=document.createElement('div');info.textContent=(row.mode==='classic'?'經典':'無限')+' · '+new Date(row.created_at).toLocaleString('zh-TW');const details=document.createElement('div');details.className='note';details.textContent=row.lines+' 行 · 等級 '+row.level;info.append(details);const points=document.createElement('strong');points.textContent=row.score.toLocaleString();li.append(info,points);byId('history').append(li)}
  byId('historyStatus').textContent=recent.data.length?'顯示最近 20 局。':'登入後完成一局，就會出現在這裡。';
 }
 async function save(row){if(!client||user?.id!==row.user_id)return;byId('saveStatus').textContent='正在儲存這一局…';byId('retrySave').disabled=true;
  try{const {error}=await client.from('block_time_games').insert(row);if(error&&error.code!=='23505')throw error;
   if(user?.id!==row.user_id)return;pending=null;byId('retrySave').hidden=true;byId('saveStatus').textContent='這一局已儲存到帳號。';await loadHistory();
  }catch{if(user?.id===row.user_id){pending=row;byId('saveStatus').textContent='雲端儲存失敗，請在關閉頁面前重試。';byId('retrySave').hidden=false}}
  finally{byId('retrySave').disabled=false}
 }
 byId('retrySave').onclick=()=>{if(pending)void save(pending)};
 window.blockTimeAccount={getClient:()=>client,getUser:()=>user,start(){gameOwner=user?.id||null;runId=crypto.randomUUID();byId('saveStatus').textContent=gameOwner?'這一局將儲存到目前帳號。':'訪客遊玩，這一局只記錄在本機。'},finish(game){if(!gameOwner||!runId)return;const row={id:runId,user_id:gameOwner,...game};runId=null;if(user?.id!==gameOwner){byId('saveStatus').textContent='帳號已變更，這一局未同步到雲端。';return}void save(row)}};
 byId('accountForm').addEventListener('submit',async e=>{e.preventDefault();if(!client||busy)return;busy=true;byId('loginButton').disabled=byId('signupButton').disabled=true;const signup=e.submitter?.id==='signupButton';const email=byId('email').value.trim(),password=byId('password').value;status(signup?'正在註冊…':'正在登入…');
  try{const credentials={email,password};const result=signup?await client.auth.signUp({...credentials,options:{emailRedirectTo:location.origin+location.pathname}}):await client.auth.signInWithPassword(credentials);if(result.error)throw result.error;byId('password').value='';if(signup&&!result.data.session)status('請查看信箱並完成驗證，再回來登入。');else status('已登入，完成一局即可儲存分數。')}
  catch(err){status(friendly(err))}finally{busy=false;byId('loginButton').disabled=byId('signupButton').disabled=false}
 });
 byId('logout').onclick=async()=>{if(!client)return;byId('logout').disabled=true;const {error}=await client.auth.signOut();byId('logout').disabled=false;if(error)status(friendly(error));else status('已登出，可繼續以訪客遊玩。')};
 byId('refreshHistory').onclick=()=>void loadHistory();byId('mode').addEventListener('change',()=>void loadHistory());
 async function init(){render();if(!config.supabaseUrl||!config.supabasePublishableKey){status('帳號服務尚未啟用，仍可用訪客模式遊玩。');byId('loginButton').disabled=byId('signupButton').disabled=true;return}
  if(!window.supabase?.createClient){status('帳號服務載入失敗，請重新整理。');byId('loginButton').disabled=byId('signupButton').disabled=true;return}
  try{client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey);client.auth.onAuthStateChange((event,session)=>{const changed=user?.id!==session?.user?.id;user=session?.user||null;if(changed){requestId++;render();byId('saveStatus').textContent='';byId('historyStatus').textContent=user?'讀取紀錄中…':'登入後可查看跨裝置紀錄。';setTimeout(()=>void loadHistory(),0)}});const {data,error}=await client.auth.getSession();if(error)throw error;user=data.session?.user||null;render();status(user?'已登入，分數會儲存到帳號。':'登入或註冊，讓分數隨帳號保存。');await loadHistory()}
  catch{status('帳號服務連接失敗，仍可用訪客模式遊玩。')}
 }
 void init();
})();
