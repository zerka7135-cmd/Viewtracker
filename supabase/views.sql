-- Tables des vues envoyées par le bot ViewTracker (src/supabaseViews.js).
-- À exécuter une fois dans Supabase > SQL Editor. Relançable sans risque.

create table if not exists public.daily_views (
  account_name text not null,
  day          date not null,
  clipper_id   uuid references public.clippers(id) on delete set null,
  views        integer not null default 0,
  views_ig     integer not null default 0,
  views_tt     integer not null default 0,
  views_yt     integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (account_name, day)
);
create index if not exists daily_views_clipper_day on public.daily_views (clipper_id, day);

create table if not exists public.account_views (
  account_name text primary key,
  clipper_id   uuid references public.clippers(id) on delete set null,
  total        bigint not null default 0,
  ig           bigint not null default 0,
  tt           bigint not null default 0,
  yt           bigint not null default 0,
  updated_at   timestamptz not null default now()
);

-- Lecture pour les utilisateurs connectés de l'app ; écriture réservée à la
-- clé service_role du bot (elle passe outre ces règles).
alter table public.daily_views enable row level security;
alter table public.account_views enable row level security;

drop policy if exists "daily_views lecture" on public.daily_views;
create policy "daily_views lecture" on public.daily_views for select to authenticated using (true);

drop policy if exists "account_views lecture" on public.account_views;
create policy "account_views lecture" on public.account_views for select to authenticated using (true);
