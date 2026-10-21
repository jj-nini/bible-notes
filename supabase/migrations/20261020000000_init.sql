-- 말씀 노트: schema, access control, and search functions
create extension if not exists pg_trgm;

-- Who may use the app. Add your own auth user id here after creating the account:
--   insert into app_users (user_id) values ('<uuid from Authentication → Users>');
create table app_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create function is_app_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where user_id = auth.uid());
$$;

create table versions (
  code text primary key,
  name text not null,
  lang text not null check (lang in ('ko', 'en')),
  translatable boolean not null default false,
  sort int not null default 0
);

create table verses (
  version text not null references versions (code),
  book text not null,
  chapter int not null,
  verse int not null,
  text text not null,
  primary key (version, book, chapter, verse)
);
create index verses_ref_idx on verses (book, chapter, verse);
create index verses_text_trgm_idx on verses using gin (text gin_trgm_ops);

-- Korean renderings of English versions. "machine" = cached translator output, "fixed" = confirmed by me.
create table translations (
  version text not null references versions (code),
  book text not null,
  chapter int not null,
  verse int not null,
  lang text not null default 'ko',
  text text not null,
  status text not null default 'machine' check (status in ('machine', 'fixed')),
  edited boolean not null default false,
  engine text,
  updated_at timestamptz not null default now(),
  primary key (version, book, chapter, verse, lang)
);

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger translations_touch before update on translations
  for each row execute function touch_updated_at();

-- Topic dictionary, built offline (LLM-assisted) and only read at runtime
create table topics (
  id text primary key,           -- the Korean topic name itself, e.g. '염려'
  description text
);
create table topic_synonyms (
  term text not null,
  topic_id text not null references topics (id) on delete cascade,
  primary key (term, topic_id)
);
create table verse_topics (
  book text not null,
  chapter int not null,
  verse int not null,
  topic_id text not null references topics (id) on delete cascade,
  weight real not null check (weight > 0 and weight <= 1),
  primary key (book, chapter, verse, topic_id)
);
create index verse_topics_topic_idx on verse_topics (topic_id, weight desc);

-- Queries the dictionary could not match; reviewed later to extend it
create table search_misses (
  id bigint generated always as identity primary key,
  query text not null,
  created_at timestamptz not null default now()
);

-- Row level security: everything is private to app_users
alter table app_users enable row level security;
alter table versions enable row level security;
alter table verses enable row level security;
alter table translations enable row level security;
alter table topics enable row level security;
alter table topic_synonyms enable row level security;
alter table verse_topics enable row level security;
alter table search_misses enable row level security;

create policy "read" on versions for select using (is_app_user());
create policy "read" on verses for select using (is_app_user());
create policy "read" on topics for select using (is_app_user());
create policy "read" on topic_synonyms for select using (is_app_user());
create policy "read" on verse_topics for select using (is_app_user());
create policy "read" on translations for select using (is_app_user());
create policy "insert" on translations for insert with check (is_app_user());
create policy "update" on translations for update using (is_app_user()) with check (is_app_user());
create policy "read" on search_misses for select using (is_app_user());
create policy "insert" on search_misses for insert with check (is_app_user());
-- app_users has no policies: manage it from the SQL editor only

-- RPCs (security invoker, so RLS above applies)
create function verses_for_refs(refs jsonb) returns setof verses
language sql stable as $$
  select v.* from verses v
  join jsonb_to_recordset(refs) as r(book text, chapter int, verse int)
    on v.book = r.book and v.chapter = r.chapter and v.verse = r.verse;
$$;

create function translations_for_refs(ver text, refs jsonb) returns setof translations
language sql stable as $$
  select t.* from translations t
  join jsonb_to_recordset(refs) as r(book text, chapter int, verse int)
    on t.book = r.book and t.chapter = r.chapter and t.verse = r.verse
  where t.version = ver and t.lang = 'ko';
$$;

create function verses_by_topics(topic_ids text[], max_results int default 30)
returns table (book text, chapter int, verse int, score real, tags jsonb)
language sql stable as $$
  select vt.book, vt.chapter, vt.verse, max(vt.weight) as score,
    (select jsonb_object_agg(t2.topic_id, t2.weight) from verse_topics t2
      where t2.book = vt.book and t2.chapter = vt.chapter and t2.verse = vt.verse) as tags
  from verse_topics vt
  where vt.topic_id = any (topic_ids)
  group by vt.book, vt.chapter, vt.verse
  order by score desc, vt.book, vt.chapter, vt.verse
  limit max_results;
$$;

create function random_tagged_verse() returns table (book text, chapter int, verse int)
language sql volatile as $$
  select book, chapter, verse from (select distinct book, chapter, verse from verse_topics) s
  order by random() limit 1;
$$;
