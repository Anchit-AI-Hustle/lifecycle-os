-- One workspace row is one brand (2026-10-13), enforced where the row is written.
--
-- Root cause of the two live rows repaired by 20261012180000: the app let a
-- record that was not "established" at its website be re-pointed at another
-- brand's site and renamed, keeping its id, slug, palette, assets and every
-- value the new brand's read did not overwrite (one row was Mamaearth,
-- DelhiChic, Deli Chic and Lenskart in turn), and it saved the region code as
-- typed ("IND", which no lookup reads as India). The app rule is tightened in
-- brand-coherence.js; this trigger is the backstop for EVERY writer (an old
-- tab, a script, the SQL editor):
--   - a website may change only within the same brand (same registrable label,
--     or a corporate sibling such as nike / nikeinc), or to a site the record's
--     CURRENT name fits, or to the site its name was read from (the repair of a
--     mixed record). Anything else raises brand_change_refused: start a new brand.
--   - a region code is one market spelling: two capital letters or GLOBAL.
-- An operator-approved repair runs with: select set_config('lifecycle.brand_repoint', 'repair', true);
-- The suffix and stop-word lists are brand-coherence.js's own (parity-tested).

create or replace function public.lc_brand_host(url text)
returns text language sql immutable as $$
  select lower(rtrim(coalesce(substring(coalesce(url, '') from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:@]+)'), ''), '.'))
$$;

-- The host without its public suffix, e.g. shop.nike.co.in -> shop.nike
create or replace function public.lc_brand_stem(host text)
returns text language plpgsql immutable as $$
declare parts text[]; n int; p text; last2 text;
begin
  if host is null or host = '' or position('.' in host) = 0 then return coalesce(host, ''); end if;
  if host ~ '^\d{1,3}(\.\d{1,3}){3}$' then return host; end if;
  foreach p in array array['myshopify.com', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'herokuapp.com', 'web.app', 'firebaseapp.com'] loop
    if host <> p and right(host, length(p) + 1) = '.' || p then return left(host, length(host) - length(p) - 1); end if;
  end loop;
  parts := string_to_array(host, '.');
  n := array_length(parts, 1);
  if n <= 2 then return parts[1]; end if;
  last2 := parts[n - 1] || '.' || parts[n];
  if last2 = any(array['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'co.nz', 'com.mx', 'com.sg', 'com.hk', 'co.kr', 'com.cn', 'com.tw', 'co.za', 'com.tr', 'com.ar', 'co.id', 'com.my', 'com.ph', 'com.vn', 'co.th', 'com.sa', 'com.eg']) then return array_to_string(parts[1:n - 2], '.'); end if;
  return array_to_string(parts[1:n - 1], '.');
end $$;

-- The brand label: the label just before the public suffix (nike for www.nike.co.in).
create or replace function public.lc_brand_label(host text)
returns text language sql immutable as $$
  select coalesce((string_to_array(public.lc_brand_stem(host), '.'))[array_length(string_to_array(public.lc_brand_stem(host), '.'), 1)], '')
$$;

create or replace function public.lc_fold(s text)
returns text language sql immutable as $$ select regexp_replace(lower(coalesce(s, '')), '[^a-z0-9]+', '', 'g') $$;

-- Does a NAME read as the brand at this host? (brand-coherence nameFitsHost, approximated.)
create or replace function public.lc_name_fits_host(name text, host text)
returns boolean language plpgsql immutable as $$
declare n text := public.lc_fold(name); stem text := public.lc_brand_stem(host); joined text; l text; toks text[];
begin
  if n = '' or coalesce(host, '') = '' then return true; end if;
  joined := public.lc_fold(stem);
  foreach l in array string_to_array(stem, '.') loop
    l := public.lc_fold(l);
    if l = n then return true; end if;
    if length(l) >= 3 and (position(l in n) > 0 or position(n in l) > 0) then return true; end if;
  end loop;
  if length(n) >= 3 and position(n in joined) > 0 then return true; end if;
  select array_agg(w) into toks from regexp_split_to_table(lower(name), '[^a-z0-9]+') w
    where length(w) >= 3 and not (w = any(array['the', 'and', 'of', 'inc', 'ltd', 'llc', 'llp', 'plc', 'pvt', 'private', 'limited', 'company', 'co', 'gmbh', 'corp', 'official', 'store', 'shop']));
  if toks is null then return false; end if;
  return not exists (select 1 from unnest(toks) t where position(t in joined) = 0);
end $$;

create or replace function public.lc_same_brand_host(a text, b text)
returns boolean language sql immutable as $$
  select public.lc_brand_label(a) <> '' and (
    public.lc_brand_label(a) = public.lc_brand_label(b)
    or (length(public.lc_brand_label(a)) >= 3 and public.lc_brand_label(b) like public.lc_brand_label(a) || '%')
    or (length(public.lc_brand_label(b)) >= 3 and public.lc_brand_label(a) like public.lc_brand_label(b) || '%'))
$$;

create or replace function public.brand_workspaces_identity_guard()
returns trigger language plpgsql as $$
declare
  r jsonb; code text;
  old_host text; new_host text; name_src text;
begin
  -- Region codes: one spelling per market.
  if new.regions is not null and jsonb_typeof(new.regions) = 'array' then
    for r in select * from jsonb_array_elements(new.regions) loop
      code := coalesce(r->>'code', '');
      if code <> '' and code !~ '^([A-Z]{2}|GLOBAL)$' then
        raise exception 'region_code_invalid: "%" is not a market code (two capital letters, e.g. IN, UK, US, or GLOBAL)', code
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  if tg_op <> 'UPDATE' then return new; end if;
  if coalesce(current_setting('lifecycle.brand_repoint', true), '') = 'repair' then return new; end if;
  old_host := public.lc_brand_host(old.website);
  new_host := public.lc_brand_host(new.website);
  if old_host = '' or new_host = '' or public.lc_same_brand_host(old_host, new_host) then return new; end if;
  -- The repair of a mixed record: the site its CURRENT name fits, or the site its name was read from.
  if public.lc_name_fits_host(old.name, new_host) then return new; end if;
  name_src := public.lc_brand_host(coalesce(old.brand_data #>> '{field_origins,name,url}', old.brand_data #>> '{brand_extraction,applied,name,source_url}'));
  if name_src <> '' and public.lc_same_brand_host(name_src, new_host) then return new; end if;
  raise exception 'brand_change_refused: "%" is the brand at %. % is another brand, so this record is not changed into it: start a new brand.',
    coalesce(nullif(old.name, ''), 'this brand'), old_host, new_host using errcode = 'check_violation';
end $$;

drop trigger if exists brand_workspaces_identity_guard on public.brand_workspaces;
create trigger brand_workspaces_identity_guard
  before insert or update of website, regions on public.brand_workspaces
  for each row execute function public.brand_workspaces_identity_guard();
