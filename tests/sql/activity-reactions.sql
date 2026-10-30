begin;
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
create function pg_temp.react_op(id text, emoji text, active boolean, member text default 'mia', activity text default 'arrival') returns jsonb
language sql as $$ select jsonb_build_object('id',id,'type','react','activityId',activity,'memberId',member,'emoji',emoji,'active',active) $$;

set local role anon;
select public.apply_trip_operation('{"id":"reaction-profile","type":"profile","memberId":"mia","patch":{"name":"米娅","avatar":"✈️"},"base":{"name":"Mia","avatar":""}}');
select public.apply_trip_operation('{"id":"reaction-attendance","type":"participate","activityId":"arrival","memberId":"mia","status":"interested"}');
select version as initial_version, (state-'version'-'reactions')::text as untouched
from public.trip_boards where id='toulouse-2026' \gset

-- The exact emoji strings are significant (including the heart's VS16).
do $$
declare preset text; ordinal integer := 0;
begin
  foreach preset in array array['❤️','👍','🎉','😂','😍','🥰','😎','🤩','👏','🙌','🔥','✨','💯','🤔','👀','😋','🍻','☕','🍜','🥐','🏃','🚀','📸','🌟'] loop
    ordinal := ordinal + 1;
    perform public.apply_trip_operation(pg_temp.react_op('reaction-preset-'||ordinal::text,preset,true));
    perform pg_temp.assert_true((select count(*)=1 from public.trip_boards,
      jsonb_array_elements(state->'reactions') as reaction
      where reaction->>'activityId'='arrival' and reaction->>'memberId'='mia' and reaction->>'emoji'=preset),
      'all 24 activity emoji persist through RPC: '||preset);
  end loop;
end $$;
select pg_temp.assert_true((select jsonb_array_length(state->'reactions')=24 and version=:initial_version+24 from public.trip_boards), 'one member can select multiple distinct reactions with one version per request');
select public.apply_trip_operation(pg_temp.react_op('reaction-mia-repeat','🔥',true));
select public.apply_trip_operation(pg_temp.react_op('reaction-hotting-fire','🔥',true,'hoting'));
select public.apply_trip_operation(pg_temp.react_op('reaction-james-fire','🔥',true,'james'));
select public.apply_trip_operation(pg_temp.react_op('reaction-other-activity','🔥',true,'mia','machines'));
select pg_temp.assert_true((select count(*)=3 and count(distinct reaction->>'memberId')=3 from public.trip_boards,
  jsonb_array_elements(state->'reactions') as reaction where reaction->>'activityId'='arrival' and reaction->>'emoji'='🔥'),
  'reaction count is three members, not four clicks or another activity');
select public.apply_trip_operation(pg_temp.react_op('reaction-mia-unset','🔥',false));
select pg_temp.assert_true((select count(*)=2 and bool_and(reaction->>'memberId'<>'mia') from public.trip_boards,
  jsonb_array_elements(state->'reactions') as reaction where reaction->>'activityId'='arrival' and reaction->>'emoji'='🔥'),
  'unselect removes only that member from the activity emoji count');
select pg_temp.assert_true((select count(*)=23 from public.trip_boards,
  jsonb_array_elements(state->'reactions') as reaction where reaction->>'activityId'='arrival' and reaction->>'memberId'='mia'),
  'unselect preserves all other emoji selected by the same member');
select pg_temp.assert_true((select count(*)=1 from public.trip_boards,
  jsonb_array_elements(state->'reactions') as reaction where reaction->>'activityId'='machines' and reaction->>'memberId'='mia' and reaction->>'emoji'='🔥'),
  'unselect does not affect the same member and emoji on another activity');
select state::text as after_unset from public.trip_boards where id='toulouse-2026' \gset
select pg_temp.assert_true((public.apply_trip_operation(pg_temp.react_op('reaction-preset-11','🔥',true))->>'duplicate')::boolean,
  'retry of the original new-emoji request is recognized after unselect');
select pg_temp.assert_true((select state=:'after_unset'::jsonb from public.trip_boards),
  'retry returns latest state without reviving an unselected reaction or changing version');
select pg_temp.expect_error(pg_temp.react_op('reaction-preset-11','🔥',false),'CONFLICT','reaction ID cannot be reused with a different target state');

select pg_temp.expect_error(pg_temp.react_op('reaction-invalid-heart','❤',true),'VALIDATION','unlisted text-style heart is not treated as the emoji heart');
select pg_temp.expect_error(pg_temp.react_op('reaction-invalid-avatar','🦊',true),'VALIDATION','avatar-only preset is not an activity reaction');
select pg_temp.expect_error(pg_temp.react_op('reaction-invalid-compound','🔥🔥',true),'VALIDATION','compound emoji strings are refused');
select pg_temp.expect_error(pg_temp.react_op('reaction-invalid-null','🔥',true)||'{"emoji":null}','VALIDATION','reaction emoji cannot be null');
select pg_temp.expect_error(pg_temp.react_op('reaction-invalid-active','🔥',true)||'{"active":"true"}','VALIDATION','reaction active must be a boolean');
select pg_temp.expect_error(pg_temp.react_op('reaction-invalid-member','🔥',true,'outsider'),'VALIDATION','expanded reactions still require one of the five members');
select pg_temp.expect_error(pg_temp.react_op('reaction-invalid-field','🔥',true)||'{"count":99}','VALIDATION','client cannot submit or inflate a reaction count');
select pg_temp.expect_error(pg_temp.react_op('reaction-missing-activity','🔥',true,'mia','missing'),'NOT_FOUND','expanded reaction cannot create a nonexistent activity');
select pg_temp.assert_true((select state=:'after_unset'::jsonb from public.trip_boards),'all invalid or conflicting reactions leave state and version unchanged');

do $$
declare preset text; ordinal integer := 0;
begin
  foreach preset in array array['❤️','👍','🎉','😂','😍','🥰','😎','🤩','👏','🙌','🔥','✨','💯','🤔','👀','😋','🍻','☕','🍜','🥐','🏃','🚀','📸','🌟'] loop
    ordinal := ordinal + 1;
    perform public.apply_trip_operation(pg_temp.react_op('reaction-unset-'||ordinal::text,preset,false));
  end loop;
  perform pg_temp.assert_true((select count(*)=0 from public.trip_boards,
    jsonb_array_elements(state->'reactions') as reaction where reaction->>'activityId'='arrival' and reaction->>'memberId'='mia'),
    'all 24 activity emoji can be individually unselected');
end $$;
select pg_temp.assert_true((select state-'version'-'reactions'=:'untouched'::jsonb from public.trip_boards),
  'expanded reactions preserve participation, profiles, activity fields and revisions');
select public.apply_trip_operation('{"id":"reaction-delete","type":"delete","activityId":"arrival","expectedRevision":2}');
select pg_temp.assert_true((select count(*)=0 from public.trip_boards,
  jsonb_array_elements(state->'reactions') as reaction where reaction->>'activityId'='arrival'),
  'deleting an activity clears its remaining expanded emoji for all members');
select pg_temp.assert_true((select count(*)=1 from public.trip_boards,
  jsonb_array_elements(state->'reactions') as reaction where reaction->>'activityId'='machines'),
  'deleting another activity preserves unrelated expanded reactions');
reset role;
select pg_temp.assert_true((select prosecdef and proconfig=array['search_path=""']::text[] from pg_proc where oid='public.apply_trip_operation(jsonb)'::regprocedure),
  'expanded reaction RPC preserves SECURITY DEFINER and empty search path');
select pg_temp.assert_true(has_function_privilege('anon','public.apply_trip_operation(jsonb)','EXECUTE') and has_function_privilege('authenticated','public.apply_trip_operation(jsonb)','EXECUTE'),
  'both public application roles retain RPC execution');
rollback;
