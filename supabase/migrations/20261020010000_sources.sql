-- Where each version's text comes from, and when API.Bible text was fetched (for the 14-day purge)
alter table versions
  add column source text not null default 'local' check (source in ('local', 'apibible')),
  add column source_id text,       -- API.Bible bibleId
  add column copyright text;

alter table verses add column fetched_at timestamptz not null default now();
create index verses_fetched_idx on verses (version, fetched_at);

-- Machine translations are now made in the browser (Chrome Translator API), so the app inserts them directly.
-- The insert/update policies from the init migration already allow this for app_users.
