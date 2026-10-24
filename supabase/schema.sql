-- Documents app: one table holds every record (docs, bodies, folders, notes, reading positions…), keyed by the
-- path the app uses (for example "docs/abc123" or "bodies/abc123_t1"). Each person can only see and change their own
-- rows. Run this once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  path       text        not null,
  data       jsonb,
  t          bigint      not null,              -- when the device made the change (ms); newest change wins
  deleted    boolean     not null default false, -- kept as a marker so other devices learn about deletes
  updated_at timestamptz not null default now(), -- set by the server; devices fetch "everything since" this
  primary key (user_id, path)
);

create index if not exists records_user_updated on public.records (user_id, updated_at);

alter table public.records enable row level security;

drop policy if exists "own rows: read"   on public.records;
drop policy if exists "own rows: insert" on public.records;
drop policy if exists "own rows: update" on public.records;
drop policy if exists "own rows: delete" on public.records;
create policy "own rows: read"   on public.records for select using (user_id = auth.uid());
create policy "own rows: insert" on public.records for insert with check (user_id = auth.uid());
create policy "own rows: update" on public.records for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows: delete" on public.records for delete using (user_id = auth.uid());

-- A device that was offline must not overwrite a newer change from another device: keep the newer row,
-- and stamp the server time on every accepted write.
create or replace function public.records_keep_newest() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.t < old.t then
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists records_keep_newest on public.records;
create trigger records_keep_newest before insert or update on public.records
  for each row execute function public.records_keep_newest();

-- Live updates: tell open devices the moment a row changes.
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null;
end $$;
