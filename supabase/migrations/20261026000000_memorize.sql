-- 암송: passages I type in myself, and how well I know each word.
-- Private to the owner (not shared between app_users), and never part of the repository.
create table memory_passages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ref text not null check (length(ref) between 1 and 100),
  body text not null check (length(body) between 1 and 5000),
  correct int not null default 0,
  wrong int not null default 0,
  -- word position (as text) → times missed; positions shift if the body changes, so the trigger resets it
  misses jsonb not null default '{}',
  last_practiced_at timestamptz,
  created_at timestamptz not null default now()
);
create index memory_passages_user_idx on memory_passages (user_id, created_at);

create function reset_memory_misses() returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body then new.misses = '{}'; end if;
  return new;
end $$;
create trigger memory_passages_body before update on memory_passages
  for each row execute function reset_memory_misses();

alter table memory_passages enable row level security;
create policy "own" on memory_passages for all
  using (is_app_user() and user_id = auth.uid())
  with check (is_app_user() and user_id = auth.uid());
grant select, insert, update, delete on memory_passages to authenticated;

-- One answer. ok: right or wrong. hit: words I got right (miss count −1), miss: words I got wrong (+1).
-- security invoker (default), so the policy above decides whose rows can change.
create function record_memory_result(pid uuid, ok boolean, hit int[], miss int[]) returns void
language sql as $$
  update memory_passages p set
    correct = correct + ok::int,
    wrong = wrong + (not ok)::int,
    last_practiced_at = now(),
    misses = coalesce((
      select jsonb_object_agg(k, n) from (
        select k, sum(n)::int as n from (
          select key as k, value::int as n from jsonb_each_text(p.misses)
          union all select w::text, 1 from unnest(miss) as w
          union all select w::text, -1 from unnest(hit) as w
        ) d group by k
      ) s where n > 0
    ), '{}'::jsonb)
  where id = pid;
$$;
