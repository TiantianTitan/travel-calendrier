-- Expand the picker to 36 emoji without rewriting any saved member profiles.
-- Legacy raster validation remains compatible with stored avatars and pending retries.
begin;

create or replace function travel_private.avatar_is_valid(value text)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare
  parts text[];
  decoded bytea;
  size integer;
begin
  if value = '' or value = any(array['🙂','😎','🥳','🤠','🦊','🐼','🐱','🐶','🐸','🐻','🌻','🚀','🐰','🐨','🐯','🦁','🐷','🐵','🐹','🦉','🐧','🦋','🐝','🐢','🌵','🍀','🍄','🌈','⭐','🌙','🍒','🍑','🥑','🍩','☕','✈️']) then return true; end if;
  if char_length(value) > 32791 then return false; end if;
  parts := regexp_match(value, '^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$');
  if parts is null or value <> concat('data:image/', parts[1], ';base64,', parts[2]) or
     mod(char_length(parts[2]), 4) <> 0 then return false; end if;
  begin
    decoded := decode(parts[2], 'base64');
  exception when others then return false;
  end;
  size := octet_length(decoded);
  if size > 24576 or replace(encode(decoded, 'base64'), E'\n', '') <> parts[2] then return false; end if;
  if parts[1] = 'jpeg' then
    return size >= 5 and substring(decoded from 1 for 3) = decode('ffd8ff', 'hex')
      and substring(decoded from size - 1 for 2) = decode('ffd9', 'hex');
  elsif parts[1] = 'png' then
    return size >= 24 and substring(decoded from 1 for 8) = decode('89504e470d0a1a0a', 'hex')
      and substring(decoded from 13 for 4) = convert_to('IHDR', 'UTF8');
  else
    return size >= 12 and substring(decoded from 1 for 4) = convert_to('RIFF', 'UTF8')
      and substring(decoded from 9 for 4) = convert_to('WEBP', 'UTF8');
  end if;
end;
$$;

revoke all on function travel_private.avatar_is_valid(text) from public, anon, authenticated;

commit;
