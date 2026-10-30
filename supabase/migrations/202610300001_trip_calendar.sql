-- Dedicated public-link trip; this migration does not change other application tables.
-- Execute the entire file in the Supabase SQL Editor as the project owner.
begin;

create schema if not exists travel_private;
revoke all on schema travel_private from public, anon, authenticated;

create table if not exists public.trip_boards (
  id text primary key,
  state jsonb not null,
  version bigint generated always as ((state ->> 'version')::bigint) stored,
  updated_at timestamptz not null default now(),
  constraint trip_board_state_shape check (
    jsonb_typeof(state) = 'object' and
    state ?& array['version','activities','responses','reactions'] and
    jsonb_typeof(state -> 'version') = 'number' and
    jsonb_typeof(state -> 'activities') = 'array' and
    jsonb_typeof(state -> 'responses') = 'array' and
    jsonb_typeof(state -> 'reactions') = 'array'
  )
);
alter table public.trip_boards enable row level security;
revoke all on public.trip_boards from public, anon, authenticated;
grant select on public.trip_boards to anon, authenticated;
drop policy if exists trip_public_read on public.trip_boards;
create policy trip_public_read on public.trip_boards for select to anon, authenticated
  using (id = 'toulouse-2026');

create table if not exists travel_private.trip_operations (
  id text primary key,
  request jsonb not null,
  applied_version bigint not null,
  created_at timestamptz not null default now()
);
alter table travel_private.trip_operations enable row level security;
revoke all on travel_private.trip_operations from public, anon, authenticated;

-- Helpers are private and callable only by the owner/RPC.
create or replace function travel_private.require_keys(value jsonb, expected text[])
returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or
    (select array_agg(key order by key) from jsonb_object_keys(value) as key)
      is distinct from (select array_agg(key order by key) from unnest(expected) as key) then
    raise exception 'VALIDATION: 请求字段不完整或包含未知字段';
  end if;
end;
$$;

-- Match JavaScript string.length, including astral emoji as two UTF-16 units.
create or replace function travel_private.text_length(value text)
returns integer language sql immutable strict set search_path = '' as $$
  select char_length(regexp_replace(value, U&'[\+010000-\+10FFFF]', 'xx', 'g'));
$$;

create or replace function travel_private.validate_activity(value jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  field text;
begin
  perform travel_private.require_keys(value,
    array['id','revision','date','time','endTime','title','location','note','category','sortOrder']);
  foreach field in array array['id','date','time','endTime','title','location','note','category'] loop
    if jsonb_typeof(value -> field) is distinct from 'string' then
      raise exception 'VALIDATION: 活动字段格式不正确';
    end if;
  end loop;
  if (value ->> 'id') !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'VALIDATION: 活动标识不正确';
  end if;
  if (value ->> 'date') not in ('2026-10-31','2026-11-01','2026-11-02') then
    raise exception 'VALIDATION: 请从三天行程中选择日期';
  end if;
  if (value ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
     ((value ->> 'endTime') <> '' and (
       (value ->> 'endTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
       (value ->> 'endTime') < (value ->> 'time'))) then
    raise exception 'VALIDATION: 请检查开始与结束时间';
  end if;
  if char_length(btrim(value ->> 'title', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) = 0 or
     travel_private.text_length(value ->> 'title') > 120 or
     travel_private.text_length(value ->> 'location') > 160 or travel_private.text_length(value ->> 'note') > 2000 then
    raise exception 'VALIDATION: 活动标题、地点或备注长度不正确';
  end if;
  if (value ->> 'category') not in ('travel','explore','food','rest') then
    raise exception 'VALIDATION: 活动分类不正确';
  end if;
  if jsonb_typeof(value -> 'revision') is distinct from 'number' or
     (value ->> 'revision') !~ '^[1-9][0-9]{0,9}$' then
    raise exception 'VALIDATION: 活动版本不正确';
  end if;
  if (value ->> 'revision')::numeric > 2147483647 then
    raise exception 'VALIDATION: 活动版本超出范围';
  end if;
  if jsonb_typeof(value -> 'sortOrder') is distinct from 'number' then
    raise exception 'VALIDATION: 活动排序不正确';
  end if;
  if abs((value ->> 'sortOrder')::numeric) > 1000000000 then
    raise exception 'VALIDATION: 活动排序超出范围';
  end if;
end;
$$;

-- Partial baselines must contain valid field values, without comparing an old
-- time to a newly edited endTime (or vice versa).
create or replace function travel_private.validate_base(value jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  field text;
  probe jsonb := '{"id":"baseline","revision":1,"date":"2026-10-31","time":"00:00","endTime":"23:59","title":"baseline","location":"","note":"","category":"travel","sortOrder":0}'::jsonb;
begin
  for field in select jsonb_object_keys(value) loop
    perform travel_private.validate_activity(probe || jsonb_build_object(field, value -> field));
  end loop;
end;
$$;

create or replace function public.apply_trip_operation(p_operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  board jsonb;
  previous_request jsonb;
  operation_type text;
  operation_id text;
  target_id text;
  target_member text;
  activity jsonb;
  next_activity jsonb;
  activity_index integer;
  field text;
  next_version bigint;
begin
  if p_operation is null or jsonb_typeof(p_operation) is distinct from 'object' or
     octet_length(p_operation::text) > 16384 then
    raise exception 'VALIDATION: 请求格式不正确或内容过长';
  end if;
  if jsonb_typeof(p_operation -> 'id') is distinct from 'string' or
     (p_operation ->> 'id') !~ '^[A-Za-z0-9_-]{1,80}$' or
     jsonb_typeof(p_operation -> 'type') is distinct from 'string' then
    raise exception 'VALIDATION: 操作标识或类型不正确';
  end if;
  operation_id := p_operation ->> 'id';
  operation_type := p_operation ->> 'type';
  case operation_type
    when 'create' then
      perform travel_private.require_keys(p_operation, array['id','type','activity']);
    when 'update' then
      perform travel_private.require_keys(p_operation, array['id','type','activityId','patch','base']);
    when 'delete' then
      perform travel_private.require_keys(p_operation, array['id','type','activityId','expectedRevision']);
    when 'participate' then
      perform travel_private.require_keys(p_operation, array['id','type','activityId','memberId','status']);
    when 'react' then
      perform travel_private.require_keys(p_operation, array['id','type','activityId','memberId','emoji','active']);
    else
      raise exception 'VALIDATION: 未知操作类型';
  end case;

  -- A single row lock serializes mutations and operation-id deduplication together.
  select state into board from public.trip_boards where id = 'toulouse-2026' for update;
  if not found then
    raise exception 'NOT_FOUND: 行程尚未准备好';
  end if;
  select request into previous_request from travel_private.trip_operations where id = operation_id;
  if found then
    if previous_request is distinct from p_operation then
      raise exception 'CONFLICT: 操作标识已用于其他修改，请重新提交';
    end if;
    return jsonb_build_object('state', board, 'duplicate', true);
  end if;

  if operation_type = 'create' then
    activity := p_operation -> 'activity';
    perform travel_private.validate_activity(activity);
    if (activity ->> 'revision')::integer <> 1 then
      raise exception 'VALIDATION: 新活动版本必须为 1';
    end if;
    if exists (select 1 from jsonb_array_elements(board -> 'activities') as item where item ->> 'id' = activity ->> 'id') then
      raise exception 'CONFLICT: 这个活动已存在，请刷新后重试';
    end if;
    if jsonb_array_length(board -> 'activities') >= 500 then
      raise exception 'VALIDATION: 活动数量已达上限，请先整理现有活动';
    end if;
    board := jsonb_set(board, '{activities}', (board -> 'activities') || jsonb_build_array(activity));
  else
    if jsonb_typeof(p_operation -> 'activityId') is distinct from 'string' or
       (p_operation ->> 'activityId') !~ '^[A-Za-z0-9_-]{1,80}$' then
      raise exception 'VALIDATION: 活动标识不正确';
    end if;
    target_id := p_operation ->> 'activityId';
    select item, (ordinality - 1)::integer into activity, activity_index
      from jsonb_array_elements(board -> 'activities') with ordinality as entries(item, ordinality)
      where item ->> 'id' = target_id;
    if not found then
      raise exception 'NOT_FOUND: 活动已被移除，请保留草稿并刷新';
    end if;

    if operation_type = 'update' then
      if jsonb_typeof(p_operation -> 'patch') is distinct from 'object' or
         jsonb_typeof(p_operation -> 'base') is distinct from 'object' or
         p_operation -> 'patch' = '{}'::jsonb then
        raise exception 'VALIDATION: 请提交需要修改的活动字段';
      end if;
      if exists (select 1 from jsonb_object_keys(p_operation -> 'patch') as key
        where key not in ('date','time','endTime','title','location','note','category','sortOrder')) then
        raise exception 'VALIDATION: 不允许修改这个活动字段';
      end if;
      perform travel_private.require_keys(p_operation -> 'base',
        array(select jsonb_object_keys(p_operation -> 'patch')));
      -- Validate both submitted values and their edit baseline, before comparing.
      perform travel_private.validate_activity(activity || (p_operation -> 'patch'));
      perform travel_private.validate_base(p_operation -> 'base');
      for field in select jsonb_object_keys(p_operation -> 'patch') loop
        if jsonb_typeof(p_operation -> 'base' -> field) is distinct from jsonb_typeof(activity -> field) then
          raise exception 'VALIDATION: 编辑基线格式不正确';
        end if;
        if activity -> field is distinct from p_operation -> 'base' -> field and
           activity -> field is distinct from p_operation -> 'patch' -> field then
          raise exception 'CONFLICT: 这个字段刚被修改，请查看最新内容后再保存';
        end if;
      end loop;
      next_activity := activity || (p_operation -> 'patch') ||
        jsonb_build_object('revision', (activity ->> 'revision')::integer + 1);
      perform travel_private.validate_activity(next_activity);
      board := jsonb_set(board, array['activities', activity_index::text], next_activity);

    elsif operation_type = 'delete' then
      if jsonb_typeof(p_operation -> 'expectedRevision') is distinct from 'number' or
         (p_operation ->> 'expectedRevision') !~ '^[1-9][0-9]{0,9}$' then
        raise exception 'VALIDATION: 活动版本不正确';
      end if;
      if (p_operation ->> 'expectedRevision')::numeric <> (activity ->> 'revision')::numeric then
        raise exception 'CONFLICT: 活动刚被修改，请查看后再删除';
      end if;
      board := jsonb_set(board, '{activities}', (board -> 'activities') - activity_index);
      board := jsonb_set(board, '{responses}', coalesce((
        select jsonb_agg(item) from jsonb_array_elements(board -> 'responses') as item
        where item ->> 'activityId' <> target_id), '[]'::jsonb));
      board := jsonb_set(board, '{reactions}', coalesce((
        select jsonb_agg(item) from jsonb_array_elements(board -> 'reactions') as item
        where item ->> 'activityId' <> target_id), '[]'::jsonb));

    else
      if jsonb_typeof(p_operation -> 'memberId') is distinct from 'string' or
         (p_operation ->> 'memberId') not in ('hoting','mia','james','ganggang','kada') then
        raise exception 'VALIDATION: 请从五位同行者中选择名字';
      end if;
      target_member := p_operation ->> 'memberId';
      if operation_type = 'participate' then
        if p_operation -> 'status' <> 'null'::jsonb and
           (jsonb_typeof(p_operation -> 'status') is distinct from 'string' or
            (p_operation ->> 'status') not in ('going','not-going')) then
          raise exception 'VALIDATION: 参加状态不正确';
        end if;
        board := jsonb_set(board, '{responses}', coalesce((
          select jsonb_agg(item) from jsonb_array_elements(board -> 'responses') as item
          where not (item ->> 'activityId' = target_id and item ->> 'memberId' = target_member)), '[]'::jsonb));
        if p_operation -> 'status' <> 'null'::jsonb then
          board := jsonb_set(board, '{responses}', (board -> 'responses') || jsonb_build_array(
            jsonb_build_object('activityId', target_id, 'memberId', target_member, 'status', p_operation ->> 'status')));
        end if;
      else
        if jsonb_typeof(p_operation -> 'emoji') is distinct from 'string' or
           (p_operation ->> 'emoji') not in ('❤️','👍','🎉') or
           jsonb_typeof(p_operation -> 'active') is distinct from 'boolean' then
          raise exception 'VALIDATION: 表情或选中状态不正确';
        end if;
        board := jsonb_set(board, '{reactions}', coalesce((
          select jsonb_agg(item) from jsonb_array_elements(board -> 'reactions') as item
          where not (item ->> 'activityId' = target_id and item ->> 'memberId' = target_member and
            item ->> 'emoji' = p_operation ->> 'emoji')), '[]'::jsonb));
        if (p_operation ->> 'active')::boolean then
          board := jsonb_set(board, '{reactions}', (board -> 'reactions') || jsonb_build_array(
            jsonb_build_object('activityId', target_id, 'memberId', target_member, 'emoji', p_operation ->> 'emoji')));
        end if;
      end if;
    end if;
  end if;
  next_version := (board ->> 'version')::bigint + 1;
  board := jsonb_set(board, '{version}', to_jsonb(next_version));
  update public.trip_boards set state = board, updated_at = clock_timestamp() where id = 'toulouse-2026';
  insert into travel_private.trip_operations(id, request, applied_version)
    values (operation_id, p_operation, next_version);
  return jsonb_build_object('state', board);
end;
$$;

revoke all on function travel_private.require_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function travel_private.text_length(text) from public, anon, authenticated;
revoke all on function travel_private.validate_activity(jsonb) from public, anon, authenticated;
revoke all on function travel_private.validate_base(jsonb) from public, anon, authenticated;
revoke all on function public.apply_trip_operation(jsonb) from public, anon, authenticated;
grant execute on function public.apply_trip_operation(jsonb) to anon, authenticated;

-- Add only this table to the existing publication; leave other subscriptions intact.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'trip_boards') then
    alter publication supabase_realtime add table public.trip_boards;
  end if;
end;
$$;

-- Seed mirrors src/lib/seed.ts and supabase/seed.json; reruns preserve existing edits.
insert into public.trip_boards(id, state) values ('toulouse-2026', $trip_seed${"version":0,"activities":[{"id":"arrival","date":"2026-10-31","time":"13:30","endTime":"14:15","title":"到啦，图卢兹！","location":"Toulouse Matabiau","note":"先放行李，再慢慢开始周末。抵达时间待大家确认。","category":"travel","sortOrder":100,"revision":1},{"id":"space-city","date":"2026-10-31","time":"14:30","endTime":"18:00","title":"去太空城看看","location":"Cité de l’Espace","note":"下午方案 A · 和机械城二选一，也可以分头玩。开放时间、门票待确认。","category":"explore","sortOrder":200,"revision":1},{"id":"machines","date":"2026-10-31","time":"14:30","endTime":"18:00","title":"机械城奇遇","location":"Halle de La Machine","note":"下午方案 B · 想看巨型机械的来这里接龙。开放时间、门票待确认。","category":"explore","sortOrder":300,"revision":1},{"id":"dinner-first","date":"2026-10-31","time":"19:00","endTime":"20:30","title":"第一顿，一起吃","location":"Le Colombier · 待确认","note":"尝尝 Cassoulet 和油封鸭。餐厅、订位和时间都可以一起改。","category":"food","sortOrder":400,"revision":1},{"id":"half-marathon","date":"2026-11-01","time":"10:00","endTime":"13:00","title":"半马加油小分队","location":"比赛路线 · 待确认","note":"跑步或来加油都欢迎。比赛安排、集合地点待确认。","category":"explore","sortOrder":100,"revision":1},{"id":"recharge","date":"2026-11-01","time":"13:00","endTime":"15:00","title":"补给 & 休息一下","location":"住处 / 附近","note":"洗漱、换装、午间简餐，各自按状态安排。","category":"rest","sortOrder":200,"revision":1},{"id":"japanese-garden","date":"2026-11-01","time":"15:00","endTime":"18:00","title":"日式花园慢慢走","location":"Jardin Japonais · 运河","note":"轻松散步，找个地方坐坐。想加入的小伙伴随时接龙。","category":"explore","sortOrder":300,"revision":1},{"id":"dinner-cassoulet","date":"2026-11-01","time":"19:30","endTime":"21:00","title":"庆功饭 · 经典法餐","location":"Maison du cassoulet · 待确认","note":"晚餐候选之一，大家按喜好投票、接龙，订位待确认。","category":"food","sortOrder":400,"revision":1},{"id":"dinner-buffet","date":"2026-11-01","time":"19:30","endTime":"21:00","title":"庆功饭 · 亚洲自助","location":"Royal Buffet · 待确认","note":"晚餐候选之一，想吃自助的在这里表态。营业与交通待确认。","category":"food","sortOrder":500,"revision":1},{"id":"dinner-market","date":"2026-11-01","time":"19:30","endTime":"21:00","title":"庆功饭 · 市集自助","location":"Le Buffet du Grand Marché · 待确认","note":"晚餐候选之一。餐厅营业、交通和订位待确认。","category":"food","sortOrder":600,"revision":1},{"id":"jean-jaures","date":"2026-11-02","time":"09:30","endTime":"12:00","title":"逛逛 Jean Jaurès","location":"Université Toulouse – Jean Jaurès","note":"校园走走，地铁 A 线可达。访问安排待确认。","category":"explore","sortOrder":100,"revision":1},{"id":"city-lunch","date":"2026-11-02","time":"12:15","endTime":"14:00","title":"市中心午餐 & 小逛","location":"图卢兹市中心","note":"一起吃午饭，再挑点喜欢的小东西。地点大家来定。","category":"food","sortOrder":200,"revision":1},{"id":"old-town","date":"2026-11-02","time":"14:00","endTime":"16:00","title":"玫瑰老城散步","location":"Capitole → Saint-Sernin → Pont Neuf","note":"市政厅广场、圣塞宁教堂、新桥，按体力自由加入。","category":"explore","sortOrder":300,"revision":1},{"id":"collect-luggage","date":"2026-11-02","time":"16:00","endTime":"16:45","title":"取行李，去车站","location":"住处 → Toulouse Matabiau","note":"留好路上的时间。集合点和车次以实际订票为准。","category":"travel","sortOrder":400,"revision":1},{"id":"return-paris","date":"2026-11-02","time":"17:00","endTime":"17:00","title":"带着回忆回巴黎","location":"Toulouse Matabiau","note":"参考行程中的出发时间，实际车次待确认。","category":"travel","sortOrder":500,"revision":1}],"responses":[],"reactions":[]}$trip_seed$::jsonb) on conflict (id) do nothing;

commit;
