-- Incremental upgrade: four participation choices and one confirmed option per slot.
-- Applies after 202610300001_trip_calendar.sql. Existing trip state and operation
-- ledger are preserved; only the RPC implementation changes.
begin;

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
      -- Moving a confirmed activity into another confirmed option's exact slot
      -- must not silently change someone else's RSVP. Let the editor resolve it.
      if (activity ->> 'date', activity ->> 'time', activity ->> 'endTime') is distinct from
         (next_activity ->> 'date', next_activity ->> 'time', next_activity ->> 'endTime') and
         exists (
           select 1
           from jsonb_array_elements(board -> 'responses') as selected
           join jsonb_array_elements(board -> 'responses') as alternative
             on alternative ->> 'memberId' = selected ->> 'memberId'
             and alternative ->> 'status' = 'going'
             and alternative ->> 'activityId' <> target_id
           where selected ->> 'activityId' = target_id and selected ->> 'status' = 'going'
             and exists (
               select 1 from jsonb_array_elements(board -> 'activities') as candidate
               where candidate ->> 'id' = alternative ->> 'activityId'
                 and candidate ->> 'date' = next_activity ->> 'date'
                 and candidate ->> 'time' = next_activity ->> 'time'
                 and candidate ->> 'endTime' = next_activity ->> 'endTime'
             )
         ) then
        raise exception 'CONFLICT: 这次移动会让已参加的安排重合，请先调整接龙。';
      end if;
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
            (p_operation ->> 'status') not in ('going','not-going','interested','maybe')) then
          raise exception 'VALIDATION: 参加状态不正确';
        end if;
        board := jsonb_set(board, '{responses}', coalesce((
          select jsonb_agg(item) from jsonb_array_elements(board -> 'responses') as item
          where not (
            item ->> 'memberId' = target_member and (
              item ->> 'activityId' = target_id or (
                (p_operation ->> 'status') is not distinct from 'going' and item ->> 'status' = 'going' and
                exists (select 1 from jsonb_array_elements(board -> 'activities') as candidate
                  where candidate ->> 'id' = item ->> 'activityId'
                    and candidate ->> 'date' = activity ->> 'date'
                    and candidate ->> 'time' = activity ->> 'time'
                    and candidate ->> 'endTime' = activity ->> 'endTime')
              )
            )
          )), '[]'::jsonb));
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

revoke all on function public.apply_trip_operation(jsonb) from public, anon, authenticated;
grant execute on function public.apply_trip_operation(jsonb) to anon, authenticated;

commit;
