-- 암송 단계: how well I know each verse (1 알아보기 → 4 암송하기), and near-miss variants made ahead of time.
alter table memory_passages add column progress jsonb not null default '{}';
-- [{ "start": word position, "end": exclusive, "text": misremembered words }], written by scripts/memory-variants.ts
alter table memory_passages add column variants jsonb not null default '[]';

-- Word and verse positions shift when the body changes, so everything keyed by them starts over
create or replace function reset_memory_misses() returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body then
    new.misses = '{}';
    new.progress = '{}';
    new.variants = '[]';
  end if;
  return new;
end $$;

drop function record_memory_result(uuid, boolean, int[], int[]);

-- One answer. ok: right or wrong. hit/miss: word positions (miss count −1/+1).
-- verses: verse positions it tested; recall: typed from memory (counts toward the level-4 streak).
-- Level rules (same as nextProgress in src/lib/memorize.ts):
--   1 → 2 after 5 right; 2 → 3 at 80% over 10+ answers; 3 → 4 after 3 recalls right in a row.
-- security invoker (default), so the RLS policy decides whose row can change.
create function record_memory_result(
  pid uuid, ok boolean, hit int[], miss int[], verses int[] default '{}', recall boolean default false
) returns void
language plpgsql as $$
declare
  pr jsonb;
  cur jsonb;
  v int;
  r int; w int; s int; lv int; before int;
begin
  select progress into pr from memory_passages where id = pid for update;
  if not found then return; end if;
  foreach v in array coalesce(verses, '{}') loop
    cur := coalesce(pr -> v::text, '{}');
    r := coalesce((cur ->> 'r')::int, 0) + ok::int;
    w := coalesce((cur ->> 'w')::int, 0) + (not ok)::int;
    s := coalesce((cur ->> 's')::int, 0);
    if recall then s := case when ok then s + 1 else 0 end; end if;
    lv := coalesce((cur ->> 'lv')::int, 1);
    before := lv;
    if lv = 1 and r >= 5 then lv := 2;
    elsif lv = 2 and r + w >= 10 and r >= 0.8 * (r + w) then lv := 3;
    elsif lv = 3 and s >= 3 then lv := 4;
    end if;
    if lv <> before then s := 0; end if;
    pr := jsonb_set(pr, array[v::text], jsonb_build_object('r', r, 'w', w, 's', s, 'lv', lv));
  end loop;
  update memory_passages p set
    correct = correct + ok::int,
    wrong = wrong + (not ok)::int,
    last_practiced_at = now(),
    progress = pr,
    misses = coalesce((
      select jsonb_object_agg(k, n) from (
        select k, sum(n)::int as n from (
          select key as k, value::int as n from jsonb_each_text(p.misses)
          union all select x::text, 1 from unnest(miss) as x
          union all select x::text, -1 from unnest(hit) as x
        ) d group by k
      ) t where n > 0
    ), '{}'::jsonb)
  where id = pid;
end $$;
