create table public.block_time_rooms (
 id uuid primary key default gen_random_uuid(), code text not null unique,
 host_id uuid not null references auth.users(id) on delete cascade,
 guest_id uuid references auth.users(id) on delete set null,
 kind text not null check(kind in ('battle','score','coop')),
 game_mode text not null check(game_mode in ('classic','endless')),
 status text not null default 'waiting' check(status in ('waiting','playing','closed')),
 round integer not null default 0, started_at timestamptz,
 created_at timestamptz not null default now(),
 check(host_id is distinct from guest_id)
);
create table public.block_time_players (
 room_id uuid not null references public.block_time_rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 ready boolean not null default false, round integer not null default 0,
 state jsonb not null default '{}'::jsonb check(octet_length(state::text)<20000),
 updated_at timestamptz not null default now(), primary key(room_id,user_id)
);
alter table public.block_time_rooms enable row level security;
alter table public.block_time_players enable row level security;
revoke all on public.block_time_rooms, public.block_time_players from anon, authenticated;
grant select on public.block_time_rooms,public.block_time_players to authenticated;
create policy "room members read" on public.block_time_rooms for select to authenticated using(auth.uid()=host_id or auth.uid()=guest_id);
create policy "members read states" on public.block_time_players for select to authenticated using(exists(select 1 from public.block_time_rooms r where r.id=room_id and (auth.uid()=r.host_id or auth.uid()=r.guest_id)));
create function public.block_time_room_action(action text, room_code text default null, room_kind text default 'battle', speed_mode text default 'classic') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); r public.block_time_rooms; attempt integer; begin
 if uid is null then raise exception 'LOGIN_REQUIRED'; end if;
 if action='create' then
  if room_kind not in ('battle','score','coop') or speed_mode not in ('classic','endless') then raise exception 'INVALID_MODE';end if;
  for attempt in 1..5 loop
   begin
    insert into public.block_time_rooms(code,host_id,kind,game_mode) values(upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),uid,room_kind,speed_mode) returning * into r;
    exit;
   exception when unique_violation then if attempt=5 then raise;end if; end;
  end loop;
  insert into public.block_time_players(room_id,user_id) values(r.id,uid);
 else
  select * into r from public.block_time_rooms where code=upper(trim(room_code)) for update;
  if not found or r.created_at<now()-interval '24 hours' or r.status='closed' then raise exception 'ROOM_NOT_FOUND'; end if;
  if action='join' then
   if r.host_id=uid then raise exception 'SAME_ACCOUNT';end if;
   if r.guest_id is not null and r.guest_id<>uid then raise exception 'ROOM_FULL';end if;
   if r.status<>'waiting' then raise exception 'ALREADY_PLAYING';end if;
   update public.block_time_rooms set guest_id=uid where id=r.id returning * into r;
   insert into public.block_time_players(room_id,user_id) values(r.id,uid) on conflict do nothing;
  else
   if uid<>r.host_id and uid is distinct from r.guest_id then raise exception 'NOT_MEMBER';end if;
   if action='start' then
    if uid<>r.host_id then raise exception 'HOST_ONLY';end if;
    if r.status<>'waiting' or r.guest_id is null then raise exception 'NOT_READY';end if;
    if (select count(*) from public.block_time_players where room_id=r.id and ready)=2 then
     update public.block_time_rooms set status='playing',round=round+1,started_at=now()+interval '3 seconds' where id=r.id returning * into r;
     update public.block_time_players set ready=false,round=r.round,state='{}',updated_at=now() where room_id=r.id;
    else raise exception 'NOT_READY';end if;
   elsif action='reset' then
    if uid<>r.host_id then raise exception 'HOST_ONLY';end if;
    if r.status<>'playing' then raise exception 'NOT_PLAYING';end if;
    if (select count(*) from public.block_time_players where room_id=r.id and (state->>'ended')::boolean is true)<>2 then raise exception 'NOT_FINISHED';end if;
    update public.block_time_rooms set status='waiting',started_at=null where id=r.id returning * into r;
    update public.block_time_players set ready=false where room_id=r.id;
   elsif action='leave' then
    if uid=r.host_id or r.status='playing' then update public.block_time_rooms set status='closed' where id=r.id returning * into r;
    else update public.block_time_rooms set guest_id=null where id=r.id returning * into r;delete from public.block_time_players where room_id=r.id and user_id=uid;end if;
   else raise exception 'INVALID_ACTION';end if;
  end if;
 end if;
 return jsonb_build_object('room',to_jsonb(r),'server_now',now());
end;$$;
create function public.block_time_update_player(room uuid, match_round integer, player_state jsonb default null, is_ready boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); r public.block_time_rooms; begin
 if uid is null then raise exception 'LOGIN_REQUIRED';end if;
 select * into r from public.block_time_rooms where id=room for share;
 if not found or (uid<>r.host_id and uid is distinct from r.guest_id) or r.status='closed' then raise exception 'NOT_MEMBER';end if;
 if player_state is not null then
  if r.status<>'playing' or match_round<>r.round or octet_length(player_state::text)>19000 or jsonb_typeof(player_state)<>'object' then raise exception 'INVALID_STATE';end if;
  update public.block_time_players set state=player_state,round=match_round,updated_at=now() where room_id=room and user_id=uid;
 else
  if r.status<>'waiting' then raise exception 'ALREADY_PLAYING';end if;
  update public.block_time_players set ready=coalesce(is_ready,false),updated_at=now() where room_id=room and user_id=uid;
 end if;
end;$$;
revoke all on function public.block_time_room_action(text,text,text,text) from public, anon;
revoke all on function public.block_time_update_player(uuid,integer,jsonb,boolean) from public, anon;
grant execute on function public.block_time_room_action(text,text,text,text),public.block_time_update_player(uuid,integer,jsonb,boolean) to authenticated;
