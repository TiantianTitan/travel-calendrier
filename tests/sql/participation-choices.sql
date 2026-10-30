-- Incremental v2 behavior, with all fixtures rolled back.
begin;
select version as initial_version from public.trip_boards where id = 'toulouse-2026' \gset
create function pg_temp.assert_true(value boolean, label text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

create function pg_temp.expect_move_conflict(operation jsonb) returns void
language plpgsql as $$
declare message text;
begin
  begin
    perform public.apply_trip_operation(operation);
  exception when others then
    get stacked diagnostics message = message_text;
    if message = 'CONFLICT: 这次移动会让已参加的安排重合，请先调整接龙。' then
      raise notice 'PASS: moving confirmed activity into conflicting choice slot is rejected';
      return;
    end if;
    raise exception 'FAIL: unexpected movement error: %', message;
  end;
  raise exception 'FAIL: conflicting move unexpectedly succeeded';
end $$;

set local role anon;
select public.apply_trip_operation('{"id":"choice-create-a","type":"create","activity":{"id":"choice-a","revision":1,"date":"2026-10-31","time":"18:30","endTime":"20:00","title":"Dinner A","location":"","note":"","category":"food","sortOrder":1}}');
select public.apply_trip_operation('{"id":"choice-create-b","type":"create","activity":{"id":"choice-b","revision":1,"date":"2026-10-31","time":"18:30","endTime":"20:00","title":"Dinner B","location":"","note":"","category":"food","sortOrder":2}}');
select public.apply_trip_operation('{"id":"choice-create-c","type":"create","activity":{"id":"choice-c","revision":1,"date":"2026-10-31","time":"18:30","endTime":"20:00","title":"Dinner C","location":"","note":"","category":"food","sortOrder":3}}');
select public.apply_trip_operation('{"id":"choice-create-d","type":"create","activity":{"id":"choice-d","revision":1,"date":"2026-10-31","time":"18:30","endTime":"","title":"Unspecified finish","location":"","note":"","category":"food","sortOrder":4}}');
select public.apply_trip_operation('{"id":"choice-create-e","type":"create","activity":{"id":"choice-e","revision":1,"date":"2026-11-01","time":"18:30","endTime":"20:00","title":"Different day","location":"","note":"","category":"food","sortOrder":5}}');

select public.apply_trip_operation('{"id":"choice-mia-a-interested","type":"participate","activityId":"choice-a","memberId":"mia","status":"interested"}');
select public.apply_trip_operation('{"id":"choice-mia-b-maybe","type":"participate","activityId":"choice-b","memberId":"mia","status":"maybe"}');
select pg_temp.assert_true((select count(*) = 2 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status' in ('interested','maybe')), 'interested and maybe may coexist in one slot');
select public.apply_trip_operation('{"id":"choice-mia-c-going","type":"participate","activityId":"choice-c","memberId":"mia","status":"going"}');
select pg_temp.assert_true((select count(*) = 3 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId' in ('choice-a','choice-b','choice-c')), 'confirming one choice preserves interest and maybe in alternatives');
select public.apply_trip_operation('{"id":"choice-james-c-going","type":"participate","activityId":"choice-c","memberId":"james","status":"going"}');
select public.apply_trip_operation('{"id":"choice-mia-d-going","type":"participate","activityId":"choice-d","memberId":"mia","status":"going"}');
select public.apply_trip_operation('{"id":"choice-mia-e-going","type":"participate","activityId":"choice-e","memberId":"mia","status":"going"}');
select public.apply_trip_operation('{"id":"choice-mia-a-going","type":"participate","activityId":"choice-a","memberId":"mia","status":"going"}');
select pg_temp.assert_true((select count(*) = 1 and min(r->>'activityId') = 'choice-a' from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going' and r->>'activityId' in ('choice-a','choice-b','choice-c')), 'switching going atomically leaves exactly one confirmed choice');
select pg_temp.assert_true((select count(*) = 0 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId'='choice-c'), 'previous confirmed choice returns to unexpressed state');
select pg_temp.assert_true((select count(*) = 1 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='james' and r->>'activityId'='choice-c' and r->>'status'='going'), 'switch does not modify another member');
select pg_temp.assert_true((select count(*) = 2 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going' and r->>'activityId' in ('choice-d','choice-e')), 'different day or unspecified endTime does not imply conflict');
select pg_temp.assert_true((select count(*) = 1 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId'='choice-b' and r->>'status'='maybe'), 'switch retains maybe on another choice');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 12 from public.trip_boards), 'switch and previous-choice clear use one board version');
select pg_temp.assert_true((public.apply_trip_operation('{"id":"choice-mia-a-going","type":"participate","activityId":"choice-a","memberId":"mia","status":"going"}')->>'duplicate')::boolean, 'choice-switch retry is marked duplicate');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 12 from public.trip_boards), 'choice-switch retry does not increment version');
select public.apply_trip_operation('{"id":"choice-mia-a-maybe","type":"participate","activityId":"choice-a","memberId":"mia","status":"maybe"}');
select public.apply_trip_operation('{"id":"choice-mia-b-interested","type":"participate","activityId":"choice-b","memberId":"mia","status":"interested"}');
select pg_temp.assert_true((select count(*) = 2 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId' in ('choice-a','choice-b') and r->>'status' in ('maybe','interested')), 'confirm may be downgraded without changing other soft choices');
select public.apply_trip_operation('{"id":"choice-mia-b-no","type":"participate","activityId":"choice-b","memberId":"mia","status":"not-going"}');
select public.apply_trip_operation('{"id":"choice-mia-c-going-again","type":"participate","activityId":"choice-c","memberId":"mia","status":"going"}');
select pg_temp.assert_true((select count(*) = 1 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId'='choice-b' and r->>'status'='not-going'), 'confirm preserves explicit not-going on alternatives');
select public.apply_trip_operation('{"id":"choice-mia-c-null","type":"participate","activityId":"choice-c","memberId":"mia","status":null}');
select pg_temp.assert_true((select count(*) = 0 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId'='choice-c'), 'four-state participation still supports withdrawal');
select public.apply_trip_operation('{"id":"choice-mia-c-confirm","type":"participate","activityId":"choice-c","memberId":"mia","status":"going"}');
select pg_temp.expect_move_conflict('{"id":"choice-e-conflicting-move","type":"update","activityId":"choice-e","patch":{"date":"2026-10-31"},"base":{"date":"2026-11-01"}}');
select pg_temp.assert_true((select a->>'date' = '2026-11-01' and a->>'revision' = '1' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='choice-e'), 'conflicting move preserves original activity');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 18 from public.trip_boards), 'conflicting move does not change board version');
select public.apply_trip_operation('{"id":"choice-e-title-edit","type":"update","activityId":"choice-e","patch":{"title":"Updated dinner"},"base":{"title":"Different day"}}');
select pg_temp.assert_true((select a->>'title' = 'Updated dinner' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='choice-e'), 'non-placement activity edit remains possible');
select public.apply_trip_operation('{"id":"choice-e-safe-move","type":"update","activityId":"choice-e","patch":{"date":"2026-10-31","time":"20:00","endTime":"21:00"},"base":{"date":"2026-11-01","time":"18:30","endTime":"20:00"}}');
select pg_temp.assert_true((select a->>'date' = '2026-10-31' and a->>'time' = '20:00' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='choice-e'), 'moving to another time without duplicate confirmation succeeds');
select public.apply_trip_operation('{"id":"choice-mia-a-withdraw-soft","type":"participate","activityId":"choice-a","memberId":"mia","status":null}');
select pg_temp.assert_true((select count(*) = 1 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId'='choice-c' and r->>'status'='going'), 'withdrawing a soft choice preserves another confirmed option in the same slot');
rollback;
