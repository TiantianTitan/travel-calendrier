begin;
select version as initial_version from public.trip_boards where id='toulouse-2026' \gset
create function pg_temp.assert_true(value boolean, label text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.expect_error(operation jsonb, prefix text, label text) returns void
language plpgsql as $$ declare message text; begin
  begin perform public.apply_trip_operation(operation);
  exception when others then
    get stacked diagnostics message = message_text;
    if message like prefix || ':%' then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: %; unexpected: %', label, message;
  end;
  raise exception 'FAIL: %; unexpectedly succeeded', label;
end $$;
create function pg_temp.profile_op(id text, patch jsonb, base jsonb, member text default 'mia') returns jsonb
language sql as $$ select jsonb_build_object('id',id,'type','profile','memberId',member,'patch',patch,'base',base) $$;
create function pg_temp.avatar(bytes integer, fill text default '00') returns text
language sql as $$ select 'data:image/jpeg;base64,' || replace(encode(decode('ffd8ff'||repeat(fill,bytes-5)||'ffd9','hex'),'base64'),E'\n','') $$;

set local role anon;
select pg_temp.assert_true((select not (state ? 'profiles') from public.trip_boards), 'profile migration leaves old snapshots and default identities unchanged');
select public.apply_trip_operation('{"id":"profile-going","type":"participate","activityId":"arrival","memberId":"mia","status":"going"}');
select public.apply_trip_operation('{"id":"profile-like","type":"react","activityId":"arrival","memberId":"mia","emoji":"👍","active":true}');
select (state - 'version' - 'profiles')::text as untouched from public.trip_boards where id='toulouse-2026' \gset
select public.apply_trip_operation(pg_temp.profile_op('profile-name','{"name":"米娅"}','{"name":"Mia"}'));
select pg_temp.assert_true((select state->'profiles'->'mia'='{"name":"米娅","avatar":""}'::jsonb from public.trip_boards), 'first nickname edit materializes the original empty avatar');
select pg_temp.assert_true((select state-'version'-'profiles'=:'untouched'::jsonb from public.trip_boards), 'renaming keeps activity revisions, attendance and reactions unchanged');
select public.apply_trip_operation(pg_temp.profile_op('profile-avatar','{"avatar":"🐱"}','{"avatar":""}'));
select pg_temp.assert_true((select state->'profiles'->'mia'='{"name":"米娅","avatar":"🐱"}'::jsonb from public.trip_boards), 'an independent avatar baseline merges with a renamed profile');
select public.apply_trip_operation(pg_temp.profile_op('profile-other','{"avatar":"🚀"}','{"avatar":""}','hoting'));
select pg_temp.assert_true((select state->'profiles'->'hoting'='{"name":"Hoting","avatar":"🚀"}'::jsonb and state->'profiles'->'mia'->>'name'='米娅' from public.trip_boards), 'editing another member preserves both stable identities');
select pg_temp.expect_error(pg_temp.profile_op('profile-conflict','{"name":"Other","avatar":"😎"}','{"name":"Mia","avatar":"🐱"}'),'CONFLICT','stale nickname prevents the whole patch including otherwise valid avatar');
select pg_temp.assert_true((select state->'profiles'->'mia'='{"name":"米娅","avatar":"🐱"}'::jsonb from public.trip_boards), 'profile conflict leaves both fields intact');
select pg_temp.assert_true((select version=:initial_version+5 from public.trip_boards), 'failed profile operation does not advance board version');
select pg_temp.assert_true((public.apply_trip_operation(pg_temp.profile_op('profile-name','{"name":"米娅"}','{"name":"Mia"}'))->>'duplicate')::boolean,'same profile request ID is idempotent after later avatar edits');
select pg_temp.assert_true((select version=:initial_version+5 from public.trip_boards), 'profile duplicate returns latest snapshot without increasing version');
select pg_temp.expect_error(pg_temp.profile_op('profile-name','{"name":"Different"}','{"name":"Mia"}'),'CONFLICT','profile ID cannot be reused with a changed payload');
select public.apply_trip_operation(pg_temp.profile_op('profile-equal','{"name":"米娅"}','{"name":"Mia"}'));
select pg_temp.assert_true((select version=:initial_version+6 from public.trip_boards), 'already equal profile target is accepted once as a distinct operation');

select pg_temp.expect_error(pg_temp.profile_op('profile-unknown-member','{"name":"New"}','{"name":"Mia"}','outsider'),'VALIDATION','profile refuses members outside the fixed five');
select pg_temp.expect_error(pg_temp.profile_op('profile-empty','{}','{}'),'VALIDATION','empty profile patch is refused');
select pg_temp.expect_error(pg_temp.profile_op('profile-unknown-field','{"role":"admin"}','{"role":"user"}'),'VALIDATION','unknown profile field is refused');
select pg_temp.expect_error(pg_temp.profile_op('profile-extra-base','{"name":"New"}','{"name":"米娅","avatar":"🐱"}'),'VALIDATION','profile base may not include extra fields');
select pg_temp.expect_error(pg_temp.profile_op('profile-missing-base','{"name":"New"}','{}'),'VALIDATION','profile patch requires the same baseline fields');
select pg_temp.expect_error(pg_temp.profile_op('profile-wrong-base','{"name":"New"}','{"avatar":""}'),'VALIDATION','profile base field names must match patch exactly');
select pg_temp.expect_error(pg_temp.profile_op('profile-invalid-base','{"name":"New"}','{"name":""}'),'VALIDATION','profile baseline values are also validated');
select pg_temp.expect_error(pg_temp.profile_op('profile-extra-top','{"name":"New"}','{"name":"米娅"}')||'{"activityId":"arrival"}','VALIDATION','profile operation rejects unused activity fields');
select pg_temp.expect_error(pg_temp.profile_op('profile-null-name','{"name":null}','{"name":"米娅"}'),'VALIDATION','nickname must be a string');
select pg_temp.expect_error(pg_temp.profile_op('profile-blank-name','{"name":""}','{"name":"米娅"}'),'VALIDATION','empty nickname is refused');
select pg_temp.expect_error(pg_temp.profile_op('profile-trim-name','{"name":" Mia "}','{"name":"米娅"}'),'VALIDATION','nickname must already be trimmed');
select pg_temp.expect_error(pg_temp.profile_op('profile-nbsp-name',jsonb_build_object('name','Mia'||chr(160)),'{"name":"米娅"}'),'VALIDATION','nickname Unicode whitespace trim matches JavaScript');
select pg_temp.expect_error(pg_temp.profile_op('profile-control-name',jsonb_build_object('name','M'||chr(9)||'ia'),' {"name":"米娅"}'),'VALIDATION','nickname rejects embedded ASCII controls');
select pg_temp.expect_error(pg_temp.profile_op('profile-c1-name',jsonb_build_object('name','M'||chr(159)||'ia'),' {"name":"米娅"}'),'VALIDATION','nickname rejects embedded C1 controls');
select public.apply_trip_operation(pg_temp.profile_op('profile-unicode-max',jsonb_build_object('name',repeat('🚀',24)),'{"name":"米娅"}'));
select pg_temp.assert_true((select char_length(state->'profiles'->'mia'->>'name')=24 from public.trip_boards),'nickname counts Unicode code points rather than UTF16 units');
select pg_temp.expect_error(pg_temp.profile_op('profile-unicode-over',jsonb_build_object('name',repeat('🚀',25)),jsonb_build_object('name',repeat('🚀',24))),'VALIDATION','nickname refuses 25 Unicode code points');

select pg_temp.expect_error(pg_temp.profile_op('profile-external-avatar','{"avatar":"https://example.com/a.jpg"}','{"avatar":"🐱"}'),'VALIDATION','avatar refuses external image URLs');
select pg_temp.expect_error(pg_temp.profile_op('profile-svg-avatar','{"avatar":"data:image/svg+xml;base64,PHN2Zz4="}','{"avatar":"🐱"}'),'VALIDATION','avatar refuses SVG data URLs');
select pg_temp.expect_error(pg_temp.profile_op('profile-unknown-emoji','{"avatar":"❤️"}','{"avatar":"🐱"}'),'VALIDATION','avatar emoji is restricted to presets');
select pg_temp.expect_error(pg_temp.profile_op('profile-false-jpeg','{"avatar":"data:image/jpeg;base64,YWJj"}','{"avatar":"🐱"}'),'VALIDATION','avatar rejects a JPEG MIME without a JPEG signature');
select pg_temp.expect_error(pg_temp.profile_op('profile-noncanonical','{"avatar":"data:image/jpeg;base64,/9j//9l="}','{"avatar":"🐱"}'),'VALIDATION','avatar rejects noncanonical base64 padding bits');
select pg_temp.expect_error(pg_temp.profile_op('profile-newline-avatar',jsonb_build_object('avatar',pg_temp.avatar(5)||chr(10)),'{"avatar":"🐱"}'),'VALIDATION','avatar rejects trailing newline after base64');
select public.apply_trip_operation(pg_temp.profile_op('profile-max-photo',jsonb_build_object('avatar',pg_temp.avatar(24576)),'{"avatar":"🐱"}'));
select pg_temp.assert_true((select state->'profiles'->'mia'->>'avatar'=pg_temp.avatar(24576) from public.trip_boards),'maximum 24KiB decoded raster is accepted');
select public.apply_trip_operation(pg_temp.profile_op('profile-replace-max-photo',jsonb_build_object('avatar',pg_temp.avatar(24576,'01')),jsonb_build_object('avatar',pg_temp.avatar(24576))));
select pg_temp.assert_true((select state->'profiles'->'mia'->>'avatar'=pg_temp.avatar(24576,'01') from public.trip_boards),'profile request budget fits maximum old and replacement avatars');
select pg_temp.expect_error(pg_temp.profile_op('profile-photo-too-large',jsonb_build_object('avatar',pg_temp.avatar(24577)),jsonb_build_object('avatar',pg_temp.avatar(24576,'01'))),'VALIDATION','raster over the decoded byte limit is refused');
select pg_temp.expect_error(pg_temp.profile_op('profile-request-too-large',jsonb_build_object('avatar',repeat('x',73728)),'{"avatar":""}'),'VALIDATION','profile request beyond 72KiB is refused');
select pg_temp.expect_error(jsonb_build_object('id','profile-old-limit','type','update','activityId','arrival','patch',jsonb_build_object('note',repeat('x',17000)),'base',jsonb_build_object('note','')),'VALIDATION','non-profile operations retain the original 16KiB limit');
select public.apply_trip_operation(pg_temp.profile_op('profile-png',jsonb_build_object('avatar','data:image/png;base64,'||encode(decode('89504e470d0a1a0a0000000d494844520000000000000000','hex'),'base64')),jsonb_build_object('avatar',pg_temp.avatar(24576,'01'))));
select pg_temp.assert_true((select state->'profiles'->'mia'->>'avatar' like 'data:image/png;base64,%' from public.trip_boards),'PNG signature is accepted');
select public.apply_trip_operation(pg_temp.profile_op('profile-webp',jsonb_build_object('avatar','data:image/webp;base64,'||encode(convert_to('RIFFxxxxWEBP','UTF8'),'base64')),jsonb_build_object('avatar','data:image/png;base64,'||encode(decode('89504e470d0a1a0a0000000d494844520000000000000000','hex'),'base64'))));
select pg_temp.assert_true((select state->'profiles'->'mia'->>'avatar' like 'data:image/webp;base64,%' from public.trip_boards),'WebP signature is accepted');
select public.apply_trip_operation(pg_temp.profile_op('profile-reset-avatar','{"avatar":""}',jsonb_build_object('avatar','data:image/webp;base64,'||encode(convert_to('RIFFxxxxWEBP','UTF8'),'base64'))));
select pg_temp.assert_true((select state->'profiles'->'mia'->>'avatar'='' from public.trip_boards),'clearing a photo restores initials while keeping the nickname');
select pg_temp.assert_true((select state-'version'-'profiles'=:'untouched'::jsonb from public.trip_boards),'all profile operations leave the entire itinerary and votes intact');
-- Exercise every supported emoji through the public RPC, including the VS16 plane.
do $$
declare preset text; prior text := ''; ordinal integer := 0;
begin
  foreach preset in array array['🙂','😎','🥳','🤠','🦊','🐼','🐱','🐶','🐸','🐻','🌻','🚀','🐰','🐨','🐯','🦁','🐷','🐵','🐹','🦉','🐧','🦋','🐝','🐢','🌵','🍀','🍄','🌈','⭐','🌙','🍒','🍑','🥑','🍩','☕','✈️'] loop
    ordinal := ordinal + 1;
    perform public.apply_trip_operation(pg_temp.profile_op('profile-preset-'||ordinal::text,
      jsonb_build_object('avatar',preset),jsonb_build_object('avatar',prior)));
    perform pg_temp.assert_true((select state->'profiles'->'mia'->>'avatar'=preset from public.trip_boards),
      'all 36 emoji presets persist through RPC: '||preset);
    prior := preset;
  end loop;
end $$;
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','travel_private.avatar_is_valid(text)','EXECUTE'),'private avatar helper is not publicly executable');
rollback;
