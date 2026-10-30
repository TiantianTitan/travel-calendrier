begin;
select version as initial_version from public.trip_boards where id='toulouse-2026' \gset
create function pg_temp.assert_true(value boolean, label text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.expect_conflict(operation jsonb, label text) returns void
language plpgsql as $$ declare message text; begin
  begin perform public.apply_trip_operation(operation);
  exception when others then
    get stacked diagnostics message = message_text;
    if message like 'CONFLICT:%' then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: %; unexpected: %', label, message;
  end;
  raise exception 'FAIL: %; unexpectedly succeeded', label;
end $$;
-- Fixture creation still uses the public RPC so field validation is exercised.
create function pg_temp.new_activity(activity_id text, trip_date text, start_time text, end_time text)
returns void language plpgsql as $$ begin
  perform public.apply_trip_operation(jsonb_build_object('id','create-'||activity_id,'type','create','activity',
    jsonb_build_object('id',activity_id,'revision',1,'date',trip_date,'time',start_time,'endTime',end_time,
      'title',activity_id,'location','','note','','category','explore','sortOrder',1)));
end $$;
set local role anon;
select pg_temp.new_activity('overlap-a','2026-11-01','14:30','16:00');
select pg_temp.new_activity('overlap-b','2026-11-01','14:00','19:00');
select pg_temp.new_activity('overlap-c','2026-11-01','15:20','17:40');
select public.apply_trip_operation('{"id":"overlap-mia-a","type":"participate","activityId":"overlap-a","memberId":"mia","status":"going","choice":{"key":"2026-11-01|14:30|16:00","previousIds":[]}}');
select public.apply_trip_operation('{"id":"overlap-mia-c","type":"participate","activityId":"overlap-c","memberId":"mia","status":"going","choice":{"key":"2026-11-01|15:20|17:40","previousIds":["overlap-a"]}}');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='overlap-c' from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going'), 'different start and end times still conflict when intervals intersect');
select public.apply_trip_operation('{"id":"overlap-mia-b","type":"participate","activityId":"overlap-b","memberId":"mia","status":"going","choice":{"key":"2026-11-01|14:00|19:00","previousIds":["overlap-c"]}}');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='overlap-b' from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going'), 'containing interval atomically replaces a confirmed inner interval');

select pg_temp.new_activity('chain-a','2026-11-02','14:00','15:00');
select pg_temp.new_activity('chain-b','2026-11-02','14:30','16:00');
select pg_temp.new_activity('chain-c','2026-11-02','15:30','17:00');
select public.apply_trip_operation('{"id":"chain-kada-a","type":"participate","activityId":"chain-a","memberId":"kada","status":"going","choice":{"key":"2026-11-02|14:00|15:00","previousIds":[]}}');
select public.apply_trip_operation('{"id":"chain-kada-c","type":"participate","activityId":"chain-c","memberId":"kada","status":"going","choice":{"key":"2026-11-02|15:30|17:00","previousIds":[]}}');
select pg_temp.assert_true((select count(*)=2 from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='kada' and r->>'status'='going'), 'non-transitive chain permits both non-overlapping end activities');
select pg_temp.expect_conflict('{"id":"chain-kada-b-incomplete","type":"participate","activityId":"chain-b","memberId":"kada","status":"going","choice":{"key":"2026-11-02|14:30|16:00","previousIds":["chain-a"]}}', 'bridge confirmation must acknowledge both directly conflicting activities');
select pg_temp.assert_true((select count(*)=2 from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='kada' and r->>'status'='going'), 'incomplete overlap guard preserves both prior selections');
select public.apply_trip_operation('{"id":"chain-james-a","type":"participate","activityId":"chain-a","memberId":"james","status":"going"}');
select public.apply_trip_operation('{"id":"chain-kada-b","type":"participate","activityId":"chain-b","memberId":"kada","status":"going","choice":{"key":"2026-11-02|14:30|16:00","previousIds":["chain-c","chain-a"]}}');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='chain-b' from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='kada' and r->>'status'='going'), 'reviewed bridge confirmation clears both direct overlaps in one transaction');
select pg_temp.assert_true((select count(*)=1 from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='james' and r->>'activityId'='chain-a' and r->>'status'='going'), 'overlap switch preserves another member on previous activities');
select pg_temp.assert_true((public.apply_trip_operation('{"id":"chain-kada-b","type":"participate","activityId":"chain-b","memberId":"kada","status":"going","choice":{"key":"2026-11-02|14:30|16:00","previousIds":["chain-c","chain-a"]}}')->>'duplicate')::boolean, 'overlap multi-replacement retry remains idempotent');

select public.apply_trip_operation('{"id":"chain-kada-c-again","type":"participate","activityId":"chain-c","memberId":"kada","status":"going","choice":{"key":"2026-11-02|15:30|17:00","previousIds":["chain-b"]}}');
select pg_temp.new_activity('touching','2026-11-02','17:00','18:00');
select public.apply_trip_operation('{"id":"touching-going","type":"participate","activityId":"touching","memberId":"kada","status":"going","choice":{"key":"2026-11-02|17:00|18:00","previousIds":[]}}');
select pg_temp.assert_true((select count(*)=2 from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='kada' and r->>'status'='going'), 'end-to-start touching intervals can both be confirmed');
select pg_temp.new_activity('other-date','2026-10-31','15:30','17:00');
select public.apply_trip_operation('{"id":"other-date-going","type":"participate","activityId":"other-date","memberId":"kada","status":"going","choice":{"key":"2026-10-31|15:30|17:00","previousIds":[]}}');
select pg_temp.assert_true((select count(*)=3 from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='kada' and r->>'status'='going'), 'same clock times on a different date do not conflict');
select pg_temp.new_activity('unknown-finish','2026-11-02','16:00','');
select pg_temp.new_activity('zero-duration','2026-11-02','16:00','16:00');
select public.apply_trip_operation('{"id":"unknown-finish-going","type":"participate","activityId":"unknown-finish","memberId":"kada","status":"going","choice":{"key":"2026-11-02|16:00|","previousIds":[]}}');
select public.apply_trip_operation('{"id":"zero-duration-going","type":"participate","activityId":"zero-duration","memberId":"kada","status":"going","choice":{"key":"2026-11-02|16:00|16:00","previousIds":[]}}');
select pg_temp.assert_true((select count(*)=5 from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='kada' and r->>'status'='going'), 'unspecified and zero-duration activities do not imply conflict');
select public.apply_trip_operation('{"id":"chain-kada-a-again","type":"participate","activityId":"chain-a","memberId":"kada","status":"going","choice":{"key":"2026-11-02|14:00|15:00","previousIds":[]}}');
select pg_temp.expect_conflict('{"id":"extend-into-overlap","type":"update","activityId":"chain-a","patch":{"endTime":"15:45"},"base":{"endTime":"15:00"}}', 'extending a confirmed activity into another confirmed interval conflicts');
select pg_temp.assert_true((select a->>'endTime'='15:00' and a->>'revision'='1' from public.trip_boards,jsonb_array_elements(state->'activities') a where a->>'id'='chain-a'), 'rejected interval extension preserves original time and revision');
select pg_temp.expect_conflict('{"id":"unknown-becomes-overlap","type":"update","activityId":"unknown-finish","patch":{"endTime":"16:30"},"base":{"endTime":""}}', 'adding a finish that creates real overlap checks existing confirmations');
select public.apply_trip_operation('{"id":"touching-title","type":"update","activityId":"touching","patch":{"title":"Walk after the visit"},"base":{"title":"touching"}}');
select pg_temp.assert_true((select a->>'title'='Walk after the visit' from public.trip_boards,jsonb_array_elements(state->'activities') a where a->>'id'='touching'), 'non-time changes remain editable with multiple valid confirmations');
select pg_temp.assert_true(not has_function_privilege('anon',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='travel_private' and p.proname='activities_overlap'),'EXECUTE'), 'overlap helper is not publicly executable');
select pg_temp.new_activity('new-conflict-target','2026-11-01','20:00','21:00');
select pg_temp.new_activity('new-conflict-previous','2026-11-01','18:00','19:00');
select public.apply_trip_operation('{"id":"new-conflict-initial","type":"participate","activityId":"new-conflict-previous","memberId":"hoting","status":"going"}');
select public.apply_trip_operation('{"id":"new-conflict-remote-extension","type":"update","activityId":"new-conflict-previous","patch":{"endTime":"20:30"},"base":{"endTime":"19:00"}}');
select pg_temp.expect_conflict('{"id":"new-conflict-stale-guard","type":"participate","activityId":"new-conflict-target","memberId":"hoting","status":"going","choice":{"key":"2026-11-01|20:00|21:00","previousIds":[]}}', 'guard rejects a newly overlapping choice even when target slot did not move');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='new-conflict-previous' from public.trip_boards,jsonb_array_elements(state->'responses') r where r->>'memberId'='hoting' and r->>'status'='going'), 'new overlap guard conflict does not revoke the unreviewed previous choice');
rollback;
