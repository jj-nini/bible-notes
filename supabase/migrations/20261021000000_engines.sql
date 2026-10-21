-- Keep one translation per engine for each verse, so engines can be compared side by side.
-- At most one of them is the confirmed ("fixed") translation.
update translations set engine = 'legacy' where engine is null;
alter table translations alter column engine set not null;
alter table translations alter column engine set default 'manual';

alter table translations drop constraint translations_pkey;
alter table translations add primary key (version, book, chapter, verse, lang, engine);
create unique index translations_one_fixed on translations (version, book, chapter, verse, lang) where status = 'fixed';

-- Confirm one engine's translation; any other confirmed one for the verse goes back to "machine".
-- security invoker (default), so the RLS policies for app_users apply.
create function fix_translation(ver text, b text, c int, v int, eng text) returns void
language plpgsql as $$
begin
  update translations set status = 'machine'
    where version = ver and book = b and chapter = c and verse = v and lang = 'ko' and status = 'fixed' and engine <> eng;
  update translations set status = 'fixed'
    where version = ver and book = b and chapter = c and verse = v and lang = 'ko' and engine = eng;
  if not found then
    raise exception 'translation % % %:% (%) not found', ver, b, c, v, eng;
  end if;
end $$;

-- My own wording: stored as engine 'manual', confirmed, replacing any other confirmation.
create function save_manual_translation(ver text, b text, c int, v int, txt text) returns void
language plpgsql as $$
begin
  update translations set status = 'machine'
    where version = ver and book = b and chapter = c and verse = v and lang = 'ko' and status = 'fixed' and engine <> 'manual';
  insert into translations (version, book, chapter, verse, lang, engine, text, status, edited)
    values (ver, b, c, v, 'ko', 'manual', txt, 'fixed', true)
    on conflict (version, book, chapter, verse, lang, engine)
    do update set text = excluded.text, status = 'fixed', edited = true;
end $$;
