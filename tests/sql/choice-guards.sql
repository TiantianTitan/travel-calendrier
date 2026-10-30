begin;
select version as initial_version from public.trip_boards where id = 'toulouse-2026' \gset
create function pg_temp.assert_true(value boolean, label text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.expect_error(operation jsonb, prefix text, label text) returns void
language plpgsql as $$ declare message text; begin
  begin
    perform public.apply_trip_operation(operation);
  exception when others then
    get stacked diagnostics message = message_text;
    if message like prefix || ':%' then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: %; unexpected: %', label, message;
  end;
  raise exception 'FAIL: %; unexpectedly succeeded', label;
end $$;
set local role anon;
select public.apply_trip_operation('{"id":"guard-create-a","type":"create","activity":{"id":"guard-a","revision":1,"date":"2026-10-31","time":"10:00","endTime":"12:00","title":"A","location":"","note":"","category":"explore","sortOrder":1}}');
select public.apply_trip_operation('{"id":"guard-create-b","type":"create","activity":{"id":"guard-b","revision":1,"date":"2026-10-31","time":"10:00","endTime":"12:00","title":"B","location":"","note":"","category":"explore","sortOrder":2}}');
select public.apply_trip_operation('{"id":"guard-create-c","type":"create","activity":{"id":"guard-c","revision":1,"date":"2026-10-31","time":"10:00","endTime":"12:00","title":"C","location":"","note":"","category":"explore","sortOrder":3}}');
select public.apply_trip_operation('{"id":"guard-going-a","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":[]}}');
select pg_temp.assert_true((select count(*)=1 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'activityId'='guard-a' and r->>'status'='going'), 'guard with no prior choice confirms first option');
select public.apply_trip_operation('{"id":"guard-switch-b","type":"participate","activityId":"guard-b","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["guard-a"]}}');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='guard-b' from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going'), 'guard matching the current previous selection permits switch');
select pg_temp.assert_true((public.apply_trip_operation('{"id":"guard-switch-b","type":"participate","activityId":"guard-b","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["guard-a"]}}')->>'duplicate')::boolean, 'guarded switch retry returns duplicate despite changed selection');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 5 from public.trip_boards), 'guarded retry does not increment version');
select pg_temp.expect_error('{"id":"guard-stale-selection","type":"participate","activityId":"guard-c","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["guard-a"]}}', 'CONFLICT', 'changed previous going set rejects stale confirmation');
select public.apply_trip_operation('{"id":"guard-move-b","type":"update","activityId":"guard-b","patch":{"time":"13:00","endTime":"14:00"},"base":{"time":"10:00","endTime":"12:00"}}');
select pg_temp.expect_error('{"id":"guard-previous-moved","type":"participate","activityId":"guard-c","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["guard-b"]}}', 'CONFLICT', 'moving the previous selection invalidates open confirmation');
select public.apply_trip_operation('{"id":"guard-move-c","type":"update","activityId":"guard-c","patch":{"time":"13:00","endTime":"14:00"},"base":{"time":"10:00","endTime":"12:00"}}');
select pg_temp.expect_error('{"id":"guard-target-moved","type":"participate","activityId":"guard-c","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["guard-b"]}}', 'CONFLICT', 'target slot change rejects confirmation even with same previous ids');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='guard-b' from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going'), 'rejected stale guards preserve confirmed activity');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 7 from public.trip_boards), 'rejected stale guards preserve board version');
select public.apply_trip_operation('{"id":"guard-fresh-c","type":"participate","activityId":"guard-c","memberId":"mia","status":"going","choice":{"key":"2026-10-31|13:00|14:00","previousIds":["guard-b"]}}');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='guard-c' from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going'), 'fresh confirmation succeeds after reviewing moved candidates');

select pg_temp.expect_error('{"id":"guard-not-going","type":"participate","activityId":"guard-a","memberId":"mia","status":"not-going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":[]}}', 'VALIDATION', 'choice guard is not allowed on not-going');
select pg_temp.expect_error('{"id":"guard-null","type":"participate","activityId":"guard-a","memberId":"mia","status":null,"choice":{"key":"2026-10-31|10:00|12:00","previousIds":[]}}', 'VALIDATION', 'choice guard is not allowed on withdrawal');
select pg_temp.expect_error('{"id":"guard-extra-key","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":[],"extra":true}}', 'VALIDATION', 'choice guard rejects unknown fields');
select pg_temp.expect_error('{"id":"guard-missing-key","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"previousIds":[]}}', 'VALIDATION', 'choice guard rejects missing key');
select pg_temp.expect_error('{"id":"guard-duplicates","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["guard-b","guard-b"]}}', 'VALIDATION', 'duplicate previous ids are rejected');
select pg_temp.expect_error('{"id":"guard-number-id","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":[1]}}', 'VALIDATION', 'previous ids must be strings');
select pg_temp.expect_error('{"id":"guard-invalid-id","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["bad id"]}}', 'VALIDATION', 'previous id format is checked');
select pg_temp.expect_error('{"id":"guard-invalid-key","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"tomorrow|10:00|12:00","previousIds":[]}}', 'VALIDATION', 'choice key validates the trip date');
select pg_temp.expect_error('{"id":"guard-backwards-key","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|12:00|10:00","previousIds":[]}}', 'VALIDATION', 'choice key rejects backwards endTime');
select pg_temp.expect_error('{"id":"guard-target-included","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|10:00|12:00","previousIds":["guard-a"]}}', 'CONFLICT', 'including target in previous ids cannot bypass actual-set comparison');

-- Administrative fixture represents old pre-v2 data with duplicate confirmations.
-- The guarded set is order-independent and a reviewed switch safely resolves it.
reset role;
update public.trip_boards set state=jsonb_set(state,'{responses}',(state->'responses')||'[{"activityId":"guard-b","memberId":"mia","status":"going"}]'::jsonb) where id='toulouse-2026';
set local role anon;
select public.apply_trip_operation('{"id":"guard-move-a","type":"update","activityId":"guard-a","patch":{"time":"13:00","endTime":"14:00"},"base":{"time":"10:00","endTime":"12:00"}}');
select public.apply_trip_operation('{"id":"guard-order-independent","type":"participate","activityId":"guard-a","memberId":"mia","status":"going","choice":{"key":"2026-10-31|13:00|14:00","previousIds":["guard-c","guard-b"]}}');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='guard-a' from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going'), 'previous ids compare as an order-independent set');
select public.apply_trip_operation('{"id":"guard-legacy-b","type":"participate","activityId":"guard-b","memberId":"mia","status":"going"}');
select pg_temp.assert_true((select count(*)=1 and min(r->>'activityId')='guard-b' from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia' and r->>'status'='going'), 'legacy queued participation without choice remains compatible');
rollback;
