-- All behavioral fixtures are rolled back. Only the disposable test DB runs this file.
begin;
select version as initial_version from public.trip_boards where id = 'toulouse-2026' \gset
create function pg_temp.assert_true(value boolean, label text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.expect_error(operation jsonb, prefix text, label text) returns void
language plpgsql as $$
declare message text;
begin
  begin
    perform public.apply_trip_operation(operation);
  exception when others then
    get stacked diagnostics message = message_text;
    if message like prefix || ':%' then
      raise notice 'PASS: %', label;
      return;
    end if;
    raise exception 'FAIL: %; unexpected: %', label, message;
  end;
  raise exception 'FAIL: %; operation unexpectedly succeeded', label;
end $$;

-- A second board proves that anon's SELECT policy is scoped to this trip.
insert into public.trip_boards(id,state) values
('private-other-trip','{"version":0,"activities":[],"responses":[],"reactions":[]}');
set local role anon;
select pg_temp.assert_true((select count(*) = 1 from public.trip_boards), 'anon sees only this trip');
select pg_temp.assert_true(not has_table_privilege('anon','public.trip_boards','INSERT,UPDATE,DELETE,TRUNCATE'), 'anon has no direct write privileges');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.trip_boards','INSERT,UPDATE,DELETE,TRUNCATE'), 'authenticated has no direct write privileges');
select pg_temp.assert_true(not has_schema_privilege('anon','travel_private','USAGE'), 'operation log schema is private');
select pg_temp.assert_true(not has_function_privilege('anon',(select p.oid from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='travel_private' and p.proname='validate_activity'),'EXECUTE'), 'validation helper cannot be invoked by anon');
select pg_temp.assert_true(has_function_privilege('anon','public.apply_trip_operation(jsonb)','EXECUTE'), 'anon may call narrow write RPC');

select public.apply_trip_operation('{"id":"test-create","type":"create","activity":{"id":"test-activity","revision":1,"date":"2026-10-31","time":"10:00","endTime":"12:00","title":"Original","location":"Place","note":"","category":"explore","sortOrder":1}}');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 1 from public.trip_boards), 'create increments board version');
select pg_temp.assert_true((public.apply_trip_operation('{"id":"test-create","type":"create","activity":{"id":"test-activity","revision":1,"date":"2026-10-31","time":"10:00","endTime":"12:00","title":"Original","location":"Place","note":"","category":"explore","sortOrder":1}}')->>'duplicate')::boolean, 'retry is idempotent');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 1 from public.trip_boards), 'duplicate does not increment version');
select pg_temp.expect_error('{"id":"test-create","type":"delete","activityId":"test-activity","expectedRevision":1}', 'CONFLICT','reusing operation id with different request is rejected');
select pg_temp.expect_error('{"id":"test-create-collision","type":"create","activity":{"id":"test-activity","revision":1,"date":"2026-10-31","time":"10:00","endTime":"12:00","title":"Original","location":"Place","note":"","category":"explore","sortOrder":1}}', 'CONFLICT', 'existing activity cannot be overwritten by create');

select public.apply_trip_operation('{"id":"test-update-title","type":"update","activityId":"test-activity","patch":{"title":"Title A"},"base":{"title":"Original"}}');
select public.apply_trip_operation('{"id":"test-update-location","type":"update","activityId":"test-activity","patch":{"location":"Place B"},"base":{"location":"Place"}}');
select pg_temp.assert_true((select a->>'title' = 'Title A' and a->>'location' = 'Place B' and a->>'revision' = '3' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='test-activity'), 'independent field edits merge and increment revision');
select pg_temp.expect_error('{"id":"test-stale-title","type":"update","activityId":"test-activity","patch":{"title":"Title C"},"base":{"title":"Original"}}', 'CONFLICT', 'same-field stale edit conflicts');
select public.apply_trip_operation('{"id":"test-same-title","type":"update","activityId":"test-activity","patch":{"title":"Title A"},"base":{"title":"Original"}}');
select pg_temp.assert_true((select a->>'revision' = '4' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='test-activity'), 'same target value is accepted with new revision');

select public.apply_trip_operation('{"id":"test-mia-going","type":"participate","activityId":"test-activity","memberId":"mia","status":"going"}');
select public.apply_trip_operation('{"id":"test-mia-no","type":"participate","activityId":"test-activity","memberId":"mia","status":"not-going"}');
select public.apply_trip_operation('{"id":"test-james-going","type":"participate","activityId":"test-activity","memberId":"james","status":"going"}');
select pg_temp.assert_true((select count(*) = 1 and min(r->>'status') = 'not-going' from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'activityId'='test-activity' and r->>'memberId'='mia'), 'participation is unique per member and activity');
select public.apply_trip_operation('{"id":"test-mia-unset","type":"participate","activityId":"test-activity","memberId":"mia","status":null}');
select pg_temp.assert_true((select count(*) = 0 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'activityId'='test-activity' and r->>'memberId'='mia'), 'null withdraws participation');
select public.apply_trip_operation('{"id":"test-heart","type":"react","activityId":"test-activity","memberId":"mia","emoji":"❤️","active":true}');
select public.apply_trip_operation('{"id":"test-heart-again","type":"react","activityId":"test-activity","memberId":"mia","emoji":"❤️","active":true}');
select pg_temp.assert_true((select count(*) = 1 from public.trip_boards, jsonb_array_elements(state->'reactions') r where r->>'activityId'='test-activity'), 'reactions use a unique target state');
select pg_temp.assert_true((select count(*) = 0 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'memberId'='mia'), 'reactions do not imply participation');
select pg_temp.assert_true((select a->>'revision' = '4' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='test-activity'), 'participation and reactions do not change activity revision');
select public.apply_trip_operation('{"id":"test-unheart","type":"react","activityId":"test-activity","memberId":"mia","emoji":"❤️","active":false}');
select pg_temp.assert_true((select count(*) = 0 from public.trip_boards, jsonb_array_elements(state->'reactions') r where r->>'activityId'='test-activity'), 'reaction can be withdrawn');
select public.apply_trip_operation('{"id":"test-thumb","type":"react","activityId":"test-activity","memberId":"james","emoji":"👍","active":true}');

select pg_temp.expect_error('{"id":"unknown-field","type":"participate","activityId":"test-activity","memberId":"mia","status":"going","admin":true}', 'VALIDATION', 'unknown operation fields rejected');
select pg_temp.expect_error('{"id":"unknown-member","type":"participate","activityId":"test-activity","memberId":"outsider","status":"going"}', 'VALIDATION', 'invalid member rejected');
select pg_temp.expect_error('{"id":"unknown-status","type":"participate","activityId":"test-activity","memberId":"mia","status":"unknown"}', 'VALIDATION', 'invalid participation rejected');
select pg_temp.expect_error('{"id":"unknown-emoji","type":"react","activityId":"test-activity","memberId":"mia","emoji":"👻","active":true}', 'VALIDATION', 'invalid reaction rejected');
select pg_temp.expect_error('{"id":"unknown-active","type":"react","activityId":"test-activity","memberId":"mia","emoji":"👍","active":"true"}', 'VALIDATION', 'reaction active must be boolean');
select pg_temp.expect_error('{"id":"bad-date","type":"update","activityId":"test-activity","patch":{"date":"2026-11-03"},"base":{"date":"2026-10-31"}}', 'VALIDATION', 'date outside trip rejected');
select pg_temp.expect_error('{"id":"bad-time","type":"update","activityId":"test-activity","patch":{"time":"25:00"},"base":{"time":"10:00"}}', 'VALIDATION', 'invalid time rejected');
select pg_temp.expect_error('{"id":"backward-time","type":"update","activityId":"test-activity","patch":{"time":"13:00"},"base":{"time":"10:00"}}', 'VALIDATION', 'end before start rejected');
select pg_temp.expect_error('{"id":"null-title","type":"update","activityId":"test-activity","patch":{"title":null},"base":{"title":"Title A"}}', 'VALIDATION', 'null required text rejected');
select pg_temp.expect_error('{"id":"blank-title","type":"update","activityId":"test-activity","patch":{"title":"  "},"base":{"title":"Title A"}}', 'VALIDATION', 'blank title rejected');
select pg_temp.expect_error(jsonb_build_object('id','long-title','type','update','activityId','test-activity','patch',jsonb_build_object('title',repeat('a',121)),'base',jsonb_build_object('title','Title A')), 'VALIDATION', 'oversized title rejected');
select pg_temp.expect_error(jsonb_build_object('id','emoji-long-title','type','update','activityId','test-activity','patch',jsonb_build_object('title',repeat('🎉',61)),'base',jsonb_build_object('title','Title A')), 'VALIDATION', 'emoji title length matches JavaScript UTF16 length');
select pg_temp.expect_error(jsonb_build_object('id','whitespace-title','type','update','activityId','test-activity','patch',jsonb_build_object('title',U&'\0009\FEFF\3000'),'base',jsonb_build_object('title','Title A')), 'VALIDATION', 'Unicode whitespace title matches JavaScript trim');
select pg_temp.expect_error('{"id":"bad-category","type":"update","activityId":"test-activity","patch":{"category":"other"},"base":{"category":"explore"}}', 'VALIDATION', 'invalid category rejected');
select pg_temp.expect_error('{"id":"bad-sort","type":"update","activityId":"test-activity","patch":{"sortOrder":1000000001},"base":{"sortOrder":1}}', 'VALIDATION', 'oversized sort value rejected');
select pg_temp.expect_error('{"id":"bad-sort-type","type":"update","activityId":"test-activity","patch":{"sortOrder":"1"},"base":{"sortOrder":1}}', 'VALIDATION', 'sort value must be numeric');
select pg_temp.expect_error('{"id":"bad-revision","type":"update","activityId":"test-activity","patch":{"revision":99},"base":{"revision":4}}', 'VALIDATION', 'client cannot overwrite revision');
select pg_temp.expect_error('{"id":"missing-base","type":"update","activityId":"test-activity","patch":{"title":"Other"},"base":{}}', 'VALIDATION', 'baseline keys must match patch');
select pg_temp.expect_error('{"id":"extra-base","type":"update","activityId":"test-activity","patch":{"title":"Other"},"base":{"title":"Title A","date":"2026-10-31"}}', 'VALIDATION', 'extra baseline fields rejected');
select pg_temp.expect_error('{"id":"invalid-base","type":"update","activityId":"test-activity","patch":{"date":"2026-10-31"},"base":{"date":"yesterday"}}', 'VALIDATION', 'malformed baseline rejected even for same target');
select pg_temp.expect_error('{"id":"empty-patch","type":"update","activityId":"test-activity","patch":{},"base":{}}', 'VALIDATION', 'empty update rejected');
select pg_temp.expect_error('{"id":"unknown-op","type":"destroy"}', 'VALIDATION', 'unknown operation rejected');
select pg_temp.expect_error('[]', 'VALIDATION', 'operation must be object');
select pg_temp.expect_error('null', 'VALIDATION', 'operation cannot be null');
select pg_temp.expect_error('{"id":"bad id","type":"delete","activityId":"test-activity","expectedRevision":4}', 'VALIDATION', 'invalid operation id rejected');
select pg_temp.expect_error('{"id":"missing-activity","type":"delete","activityId":"gone","expectedRevision":1}', 'NOT_FOUND', 'missing activity returns stable error');
select pg_temp.expect_error('{"id":"stale-delete","type":"delete","activityId":"test-activity","expectedRevision":1}', 'CONFLICT', 'stale deletion is rejected');
select public.apply_trip_operation('{"id":"test-delete","type":"delete","activityId":"test-activity","expectedRevision":4}');
select pg_temp.assert_true((select count(*) = 0 from public.trip_boards, jsonb_array_elements(state->'responses') r where r->>'activityId'='test-activity'), 'delete removes participation');
select pg_temp.assert_true((select count(*) = 0 from public.trip_boards, jsonb_array_elements(state->'reactions') r where r->>'activityId'='test-activity'), 'delete removes reactions');
select pg_temp.assert_true((public.apply_trip_operation('{"id":"test-delete","type":"delete","activityId":"test-activity","expectedRevision":4}')->>'duplicate')::boolean, 'delete retry succeeds after activity removed');
-- End time is intentionally optional in the editor and data contract.
select public.apply_trip_operation('{"id":"optional-end-create","type":"create","activity":{"id":"optional-end-activity","revision":1,"date":"2026-11-01","time":"19:30","endTime":"","title":"Dinner without a fixed finish","location":"","note":"","category":"food","sortOrder":2}}');
select pg_temp.assert_true((select a->>'endTime' = '' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='optional-end-activity'), 'create permits optional empty endTime');
select public.apply_trip_operation('{"id":"optional-end-fill","type":"update","activityId":"optional-end-activity","patch":{"endTime":"21:00"},"base":{"endTime":""}}');
select pg_temp.assert_true((select a->>'endTime' = '21:00' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='optional-end-activity'), 'empty endTime baseline permits adding a finish');
select public.apply_trip_operation('{"id":"optional-end-clear","type":"update","activityId":"optional-end-activity","patch":{"endTime":""},"base":{"endTime":"21:00"}}');
select pg_temp.assert_true((select a->>'endTime' = '' and a->>'revision' = '3' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='optional-end-activity'), 'update permits clearing endTime');
select public.apply_trip_operation('{"id":"optional-end-move","type":"update","activityId":"optional-end-activity","patch":{"time":"22:30"},"base":{"time":"19:30"}}');
select pg_temp.assert_true((select a->>'time' = '22:30' and a->>'endTime' = '' from public.trip_boards, jsonb_array_elements(state->'activities') a where a->>'id'='optional-end-activity'), 'start time can move while endTime remains empty');
select pg_temp.expect_error('{"id":"optional-end-invalid","type":"update","activityId":"optional-end-activity","patch":{"endTime":"24:00"},"base":{"endTime":""}}', 'VALIDATION', 'nonempty optional endTime must be valid');
select pg_temp.expect_error('{"id":"optional-end-backwards","type":"update","activityId":"optional-end-activity","patch":{"endTime":"21:00"},"base":{"endTime":""}}', 'VALIDATION', 'nonempty optional endTime must follow start');
reset role;
select pg_temp.assert_true((select count(*) = 17 from travel_private.trip_operations), 'only successful unique requests enter operation log');
select pg_temp.assert_true((select (state->>'version')::bigint = :initial_version + 17 from public.trip_boards where id='toulouse-2026'), 'version counts all successful unique operations only');
select pg_temp.assert_true((select count(*) = 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_boards'), 'trip table enrolled in Realtime publication');
select pg_temp.assert_true((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.apply_trip_operation(jsonb)'::regprocedure), 'RPC is definer with fixed empty search_path');
rollback;
