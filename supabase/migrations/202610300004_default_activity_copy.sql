-- Refresh only untouched default titles/notes. User edits, deletions, placement,
-- participation, reactions, and operation history are preserved.
-- Applies after 202610300003_choice_confirmation_guard.sql; safe to re-run.
begin;

do $migration$
declare
  updates jsonb := $copy_updates$[{"id":"arrival","title":{"old":"到啦，图卢兹！","new":"抵达图卢兹"},"note":{"old":"先放行李，再慢慢开始周末。抵达时间待大家确认。","new":"抵达后寄存行李。抵达时间待确认。"}},{"id":"space-city","title":{"old":"去太空城看看","new":"太空城"},"note":{"old":"下午方案 A · 和机械城二选一，也可以分头玩。开放时间、门票待确认。","new":"开放时间、门票待确认。"}},{"id":"machines","title":{"old":"机械城奇遇","new":"机械城"},"note":{"old":"下午方案 B · 想看巨型机械的来这里接龙。开放时间、门票待确认。","new":"开放时间、门票待确认。"}},{"id":"dinner-first","title":{"old":"第一顿，一起吃","new":"晚餐 · Le Colombier"},"note":{"old":"尝尝 Cassoulet 和油封鸭。餐厅、订位和时间都可以一起改。","new":"Cassoulet、油封鸭。订位和用餐时间待确认。"}},{"id":"half-marathon","title":{"old":"半马加油小分队","new":"半程马拉松"},"note":{"old":"跑步或来加油都欢迎。比赛安排、集合地点待确认。","new":"参赛或观赛。比赛安排、集合地点待确认。"}},{"id":"recharge","title":{"old":"补给 & 休息一下","new":"午餐与休息"},"note":{"old":"洗漱、换装、午间简餐，各自按状态安排。","new":"洗漱、换装。"}},{"id":"japanese-garden","title":{"old":"日式花园慢慢走","new":"日式花园与运河"},"note":{"old":"轻松散步，找个地方坐坐。想加入的小伙伴随时接龙。","new":""}},{"id":"dinner-cassoulet","title":{"old":"庆功饭 · 经典法餐","new":"晚餐 · Maison du cassoulet"},"note":{"old":"晚餐候选之一，大家按喜好投票、接龙，订位待确认。","new":"订位待确认。"}},{"id":"dinner-buffet","title":{"old":"庆功饭 · 亚洲自助","new":"晚餐 · Royal Buffet"},"note":{"old":"晚餐候选之一，想吃自助的在这里表态。营业与交通待确认。","new":"亚洲自助。营业、交通待确认。"}},{"id":"dinner-market","title":{"old":"庆功饭 · 市集自助","new":"晚餐 · Grand Marché"},"note":{"old":"晚餐候选之一。餐厅营业、交通和订位待确认。","new":"市集自助。营业、交通、订位待确认。"}},{"id":"jean-jaures","title":{"old":"逛逛 Jean Jaurès","new":"Jean Jaurès 校园"},"note":{"old":"校园走走，地铁 A 线可达。访问安排待确认。","new":"地铁 A 线可达。访问安排待确认。"}},{"id":"city-lunch","title":{"old":"市中心午餐 & 小逛","new":"市中心午餐与购物"},"note":{"old":"一起吃午饭，再挑点喜欢的小东西。地点大家来定。","new":"用餐地点待定。"}},{"id":"old-town","title":{"old":"玫瑰老城散步","new":"老城步行"},"note":{"old":"市政厅广场、圣塞宁教堂、新桥，按体力自由加入。","new":"市政厅广场、圣塞宁教堂、新桥。"}},{"id":"collect-luggage","title":{"old":"取行李，去车站","new":"取行李、前往车站"},"note":{"old":"留好路上的时间。集合点和车次以实际订票为准。","new":"集合点、车次待确认。"}},{"id":"return-paris","title":{"old":"带着回忆回巴黎","new":"返回巴黎"},"note":{"old":"参考行程中的出发时间，实际车次待确认。","new":"车次及出发时间待确认。"}}]$copy_updates$::jsonb;
  board jsonb;
  activity jsonb;
  next_activity jsonb;
  copy_update jsonb;
  field text;
  next_activities jsonb := '[]'::jsonb;
  has_changes boolean := false;
begin
  select state into board from public.trip_boards
    where id = 'toulouse-2026' for update;
  if not found then
    return;
  end if;

  for activity in select value from jsonb_array_elements(board -> 'activities') loop
    next_activity := activity;
    select value into copy_update from jsonb_array_elements(updates)
      where value ->> 'id' = activity ->> 'id';
    if found then
      foreach field in array array['title','note'] loop
        -- Compare each field independently: an edited title does not prevent an
        -- untouched default note from being refreshed (or vice versa).
        if copy_update ? field and activity -> field = copy_update -> field -> 'old' then
          next_activity := jsonb_set(next_activity, array[field], copy_update -> field -> 'new');
        end if;
      end loop;
      if next_activity is distinct from activity then
        next_activity := jsonb_set(next_activity, '{revision}',
          to_jsonb((activity ->> 'revision')::integer + 1));
        perform travel_private.validate_activity(next_activity);
        has_changes := true;
      end if;
    end if;
    next_activities := next_activities || jsonb_build_array(next_activity);
  end loop;

  if has_changes then
    board := jsonb_set(board, '{activities}', next_activities);
    board := jsonb_set(board, '{version}', to_jsonb((board ->> 'version')::bigint + 1));
    update public.trip_boards set state = board, updated_at = clock_timestamp()
      where id = 'toulouse-2026';
  end if;
end;
$migration$;

commit;
