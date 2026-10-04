'use strict';
(() => {
 const $=id=>document.getElementById(id), game=()=>window.blockTimeGame, account=()=>window.blockTimeAccount, client=()=>account()?.getClient(), me=()=>account()?.getUser();
 let room=null,owner=null,players=[],polling=false,writing=false,busy=false,localRound=0,attacks=0,received=0,garbage=0,reason=null,remotePause=false,lastOther=Date.now(),lastWrite=0,lastState='',lastPollSuccess=Date.now(),finishedAt=0,clockOffset=0;
 const names={battle:'雙人對戰',score:'比分挑戰',coop:'合作模式'};
 const status=t=>{$('roomStatus').textContent=t};
 function errorText(e){const m=String(e?.message||'');for(const [code,text] of Object.entries({LOGIN_REQUIRED:'請先登入。',ROOM_NOT_FOUND:'找不到房間，可能已關閉或超過 24 小時。',ROOM_FULL:'房間已滿。',SAME_ACCOUNT:'雙方需使用不同帳號。',ALREADY_PLAYING:'這個房間已在遊戲中。',NOT_READY:'請等雙方都按準備。',HOST_ONLY:'只有房主可以開始。',NOT_FINISHED:'請等雙方都結束。'}))if(m.includes(code))return text;return '連線失敗，請稍後再試。'}
 function own(){return players.find(p=>p.user_id===owner)}function other(){return players.find(p=>p.user_id!==owner)}
 function hash(s){let n=2166136261;for(const c of s){n^=c.charCodeAt(0);n=Math.imul(n,16777619)}return n>>>0}
 function render(){const live=!!room;$('roomSetup').hidden=live;$('roomLive').hidden=!live;$('mode').disabled=live||game().snapshot().running;if(!live)return;
  $('hostLabel').textContent=owner===room.host_id?'房主（你）':'房主';$('guestLabel').textContent=owner===room.guest_id?'玩家 2（你）':'玩家 2';for(const [id,uid] of [['hostStatus',room.host_id],['guestStatus',room.guest_id]]){const p=players.find(x=>x.user_id===uid);$(id).textContent=!uid?'等待加入':room.status==='playing'?(p?.state?.ended?'已結束':'遊玩中'):(p?.ready?'已準備':'已加入');$(id).dataset.waiting=String(!uid)}$('roomOccupancy').textContent=(room.guest_id?'2':'1')+' / 2 人';$('roomCode').textContent=room.code;$('roomLabel').textContent=names[room.kind]+' · '+(room.game_mode==='classic'?'經典加速':'固定速度')+' · '+(owner===room.host_id?'你是房主':'你是加入者');
  $('startRoom').hidden=owner!==room.host_id;$('startRoom').disabled=room.status!=='waiting'||players.length!==2||!players.every(p=>p.ready);$('readyRoom').disabled=room.status!=='waiting';$('readyRoom').textContent=own()?.ready?'取消準備':'準備';
  const a=game().snapshot(),b=other()?.state||{};$('myRoomScore').textContent=(a.score||0).toLocaleString();$('theirRoomScore').textContent=(b.score||0).toLocaleString();$('teamScoreWrap').hidden=room.kind!=='coop';$('teamScore').textContent=((a.score||0)+(b.score||0)).toLocaleString();
  $('resetRoom').hidden=owner!==room.host_id||room.status!=='playing'||players.length!==2||!players.every(p=>p.state?.ended);
  drawOpponent(b);
 }
 function drawOpponent(s){const c=$('opponent').getContext('2d');c.clearRect(0,0,150,300);const palette=['','#58d6f5','#f4cc63','#bba0ff','#5ce1bd','#ff758c','#6e9eff','#ffa969','#718198'];
  function cell(x,y,v){if(x<0||x>=10||y<0||y>=20||!v)return;c.fillStyle=palette[v]||'#718198';c.fillRect(x*15+1,y*15+1,13,13)}
  if(Array.isArray(s.board)&&s.board.length===20)s.board.forEach((r,y)=>{if(Array.isArray(r))r.slice(0,10).forEach((v,x)=>cell(x,y,v))});
  if(s.active&&Array.isArray(s.active.matrix)&&s.active.matrix.length<=4)s.active.matrix.forEach((r,y)=>{if(Array.isArray(r))r.slice(0,4).forEach((v,x)=>cell(s.active.x+x,s.active.y+y,v))});
 }
 async function rpc(action,code){const result=await client().rpc('block_time_room_action',{action,room_code:code??room?.code??null,room_kind:$('roomKind').value,speed_mode:$('mode').value});if(result.error)throw result.error;if(result.data.server_now)clockOffset=Date.parse(result.data.server_now)-Date.now();return result.data.room}
 async function connect(create){if(busy)return;if(!me()||!client()){status('請先登入，再建立或加入房間。');return}if(game().snapshot().running&&!confirm('加入連線房間會放棄目前這一局，確定嗎？'))return;
  busy=true;$('createRoom').disabled=$('joinRoom').disabled=true;
  try{const code=$('roomInput').value.trim().toUpperCase();if(!create&&!/^[A-F0-9]{10}$/.test(code)){status('請輸入完整的 10 碼房間代碼。');return}room=await rpc(create?'create':'join',code);owner=me().id;players=[];localRound=0;reason=null;garbage=attacks=received=0;lastOther=lastPollSuccess=Date.now();finishedAt=0;remotePause=false;game().idle();$('roomResult').textContent='';render();status(create?'房間已建立，將代碼給朋友。':'已加入房間，按準備後等待房主開始。');await poll()}
  catch(e){status(errorText(e))}finally{busy=false;$('createRoom').disabled=$('joinRoom').disabled=false}
 }
 async function leave(remote=false){const old=room;if(!old)return;room=null;owner=null;localRound=0;remotePause=false;garbage=0;players=[];game().cancel();render();$('roomResult').textContent='';status(remote?'對方已離開，房間已關閉。':'已離開房間，可繼續單人遊玩。');if(!remote&&client())try{await client().rpc('block_time_room_action',{action:'leave',room_code:old.code})}catch{}}
 async function ready(){if(!room||busy)return;busy=true;try{const {error}=await client().rpc('block_time_update_player',{room:room.id,match_round:room.round,is_ready:!own()?.ready});if(error)throw error;await poll()}catch(e){status(errorText(e))}finally{busy=false}}
 async function requestStart(){if(!room||busy)return;if(owner!==room.host_id){status('按準備後，等待房主開始。');return}busy=true;try{room=await rpc('start');await poll()}catch(e){status(errorText(e))}finally{busy=false}}
 async function reset(){if(!room||busy)return;busy=true;try{room=await rpc('reset');localRound=0;reason=null;remotePause=false;game().idle();$('roomResult').textContent='';await poll()}catch(e){status(errorText(e))}finally{busy=false}}
 async function write(force=false){if(!room||!localRound||writing||!client()||owner!==me()?.id||room.status!=='playing')return;const state={...game().snapshot(),attacks,reason};const serialized=JSON.stringify(state);if(!force&&serialized===lastState&&Date.now()-lastWrite<2000)return;writing=true;const id=room.id,round=localRound;
  try{const {error}=await client().rpc('block_time_update_player',{room:id,match_round:round,player_state:state});if(error)throw error;if(room?.id===id){lastState=serialized;lastWrite=Date.now()}}
  catch{if(room?.id===id)status('分數同步暫時失敗，正在重試…')}
  finally{writing=false}
 }
 async function poll(){if(!room||polling||!client())return;if(owner!==me()?.id){await leave();return}polling=true;const id=room.id;
  try{const [a,b]=await Promise.all([client().from('block_time_rooms').select('*').eq('id',id).single(),client().from('block_time_players').select('*').eq('room_id',id)]);if(a.error||b.error)throw a.error||b.error;if(room?.id!==id)return;room=a.data;players=b.data;lastPollSuccess=Date.now();if(room.status==='closed'){await leave(true);return}
   const opponent=other();if(room.status==='playing'){
    const seconds=Math.ceil((Date.parse(room.started_at)-(Date.now()+clockOffset))/1000);
    if(seconds>0){status('兩人已準備，'+seconds+' 秒後開始。');render();return}
    if(localRound!==room.round){localRound=room.round;attacks=received=garbage=0;reason=null;lastState='';lastWrite=0;finishedAt=0;lastOther=Date.now();remotePause=false;game().start(hash(room.id+':'+room.round),room.game_mode);$('roomResult').textContent='';await write(true)}
    const s=opponent?.round===room.round?opponent.state||{}:{};
    if(opponent?.updated_at)lastOther=Math.max(lastOther,Date.parse(opponent.updated_at)-clockOffset);
    remotePause=!!s.paused&&!s.ended;
    if(room.kind==='battle'&&Number.isInteger(s.attacks)&&s.attacks>=received){garbage+=Math.min(40,s.attacks-received);received=s.attacks}
    if(s.reason==='aborted'&&reason!=='aborted'){game().cancel();reason='aborted';finishedAt=Date.now();await write(true);$('roomResult').textContent='連線中斷，本局不判勝負。';}
    else if(room.kind==='battle'&&s.ended&&!game().snapshot().ended){game().win();}
    const mine=game().snapshot();
    if(mine.ended&&s.ended){remotePause=false;if(!finishedAt)finishedAt=Date.now();if(reason==='aborted'||s.reason==='aborted')$('roomResult').textContent='本局已中止，不判勝負。';else if(room.kind==='coop')$('roomResult').textContent='合作完成！團隊總分 '+((mine.score||0)+(s.score||0)).toLocaleString();else if(room.kind==='score')$('roomResult').textContent=mine.score===s.score?'平手！':mine.score>s.score?'你贏了！':'對方贏了！';else $('roomResult').textContent=reason==='topout'&&s.reason==='topout'?'雙方同時堆到頂，平手。':reason==='won'?'你贏了！':'對方贏了！';status('本局結束，房主可以再開一局。')}
    else if(mine.ended){status('你已結束，等待對方完成。')}
    else if(s.ended){status('對方已結束，你可以繼續挑戰。')}
    else if(remotePause||mine.paused){status(remotePause?'對方暫停中，雙方棋盤暫停。':'你已暫停，按 P 或繼續恢復。')}
    else status('連線中 · '+names[room.kind]);
    if(!finishedAt&&Date.now()-lastOther>20000){reason='aborted';game().cancel();finishedAt=Date.now();await write(true);$('roomResult').textContent='對方超過 20 秒沒有同步，本局中止。'}
   }else{status(room.guest_id?(players.every(p=>p.ready)?'雙方已準備，由房主開始。':'雙方按準備後，即可開始。'):'等待朋友加入…')}
   render();
  }catch{if(room?.id===id){status('連線不穩，正在重新同步…');remotePause=true;if(Date.now()-lastPollSuccess>20000){reason='aborted';game().cancel();finishedAt=Date.now();$('roomResult').textContent='連線中斷，本局已中止。'}}}
  finally{polling=false}
 }
 window.blockTimeMultiplayer={inRoom:()=>!!room,requestStart,remotePaused:()=>remotePause,cleared(n){if(room?.kind==='battle'&&localRound&&!finishedAt)attacks+=[0,0,1,2,4][n]||0},takeGarbage(){const n=Math.min(20,garbage);garbage-=n;return n},finish(r){if(room&&localRound){reason=r;void write(true)}}};
 $('createRoom').onclick=()=>void connect(true);$('joinRoom').onclick=()=>void connect(false);$('readyRoom').onclick=()=>void ready();$('startRoom').onclick=()=>void requestStart();$('leaveRoom').onclick=()=>{if(room?.status==='playing'&&!confirm('離開將中止這場遊戲，確定嗎？'))return;void leave()};$('resetRoom').onclick=()=>void reset();$('copyRoom').onclick=async()=>{try{await navigator.clipboard.writeText(room.code);status('房間碼已複製。')}catch{status('請手動複製上方房間碼。')}};
 setInterval(()=>{void poll();void write();if(room)render()},600);
})();
