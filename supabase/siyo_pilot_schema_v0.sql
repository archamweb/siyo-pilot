-- ============================================================================
-- SIYO Pilot — schéma v0 (Supabase / PostgreSQL)
-- À exécuter dans Supabase → SQL Editor, en une fois, sur le projet de développement.
-- Principe v0 : les rapports journaliers et la configuration projet sont stockés
-- en JSONB avec la même structure que la V1.5, pour réutiliser tous les calculs
-- existants sans réécriture. La normalisation fine (lignes réseau par DN, etc.)
-- est un chantier ultérieur ; elle se fera à partir de ces JSONB, jamais à la main.
-- Sécurité : tout passe par RLS. La clé publiable (anon) ne donne accès qu'à ce
-- que ces règles autorisent. La clé service_role ne va JAMAIS dans le HTML.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Profils (miroir minimal de auth.users ; jamais de mot de passe ici)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  is_admin boolean not null default false,        -- administrateur SIYO (comptes, projets)
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Projets, statuts, affectations et rôles
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.project_status as enum
    ('preparation','active','suspended','works_completed','closed','abandoned','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_role as enum
    ('direction','chef_projet','agent','lecteur','visiteur');
exception when duplicate_object then null; end $$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                       -- ex. 'dispersion-1b'
  name text not null,
  short_name text,
  client text,
  moe text,
  contractor text,
  status public.project_status not null default 'preparation',
  is_demo boolean not null default false,          -- jeu expurgé destiné aux visiteurs
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.project_role not null,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 3. Configuration projet (DQE, zones, DN, poids, planning, état initial)
--    Une ligne par version ; la version active est la plus récente non annulée.
--    Toute modification structurelle = nouvelle version avec motif (verrouillage).
-- ---------------------------------------------------------------------------
create table if not exists public.project_config (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null,
  config jsonb not null,                           -- même structure que PROJECT_CONFIG V1.5
  reason text,                                     -- motif de révision (obligatoire dès v2)
  effective_from date,                             -- date d'effet (poids versionnés)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (project_id, version),
  constraint config_reason_required check (version = 1 or coalesce(length(reason),0) >= 8)
);

-- ---------------------------------------------------------------------------
-- 4. Rapports journaliers (payload JSONB identique à la V1.5 : loc, eff, rmq, contraintes…)
-- ---------------------------------------------------------------------------
create table if not exists public.daily_reports (
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  payload jsonb not null,
  version integer not null default 1,              -- incrémenté à chaque enregistrement (concurrence)
  author_id uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (project_id, report_date)
);

-- Clés spéciales de la V1.5 (__aleas__, __pilotage__, …) : table dédiée, pas mélangées aux dates
create table if not exists public.project_state (
  project_id uuid not null references public.projects(id) on delete cascade,
  key text not null,                               -- 'aleas', 'pilotage', …
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (project_id, key)
);

-- ---------------------------------------------------------------------------
-- 5. Attachements (finance) — lecture réservée à la direction
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.attachment_status as enum ('draft','validated','revised');
exception when duplicate_object then null; end $$;

create table if not exists public.attachment_periods (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  period text not null,                            -- 'YYYY-MM'
  number integer,
  status public.attachment_status not null default 'draft',
  ledger jsonb not null,                           -- lignes DQE, précédent, cumul, montants (decimal en texte)
  validated_by uuid references public.profiles(id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, period, status)
);

-- Interdiction de modifier un attachement validé (toute modification = nouvelle ligne 'revised')
create or replace function public.protect_validated_attachment()
returns trigger language plpgsql as $$
begin
  if old.status = 'validated' then
    raise exception 'Attachement validé : créez une révision au lieu de modifier.';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_validated on public.attachment_periods;
create trigger trg_protect_validated before update or delete on public.attachment_periods
  for each row execute function public.protect_validated_attachment();

-- ---------------------------------------------------------------------------
-- 6. Journal d'audit
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects(id) on delete set null,
  actor_id uuid,
  action text not null,                            -- 'report.save', 'config.revise', 'attachment.validate', …
  target text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Fonctions d'aide pour les règles d'accès
-- ---------------------------------------------------------------------------
create or replace function public.my_role(p_project uuid)
returns public.project_role language sql stable security definer set search_path = public as $$
  select role from public.project_members where project_id = p_project and user_id = auth.uid();
$$;

create or replace function public.is_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p_project and user_id = auth.uid());
$$;

create or replace function public.has_role(p_project uuid, variadic roles public.project_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members
                 where project_id = p_project and user_id = auth.uid() and role = any(roles));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security — refus par défaut, puis autorisations explicites
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.projects           enable row level security;
alter table public.project_members    enable row level security;
alter table public.project_config     enable row level security;
alter table public.daily_reports      enable row level security;
alter table public.project_state      enable row level security;
alter table public.attachment_periods enable row level security;
alter table public.audit_events       enable row level security;

-- profiles : chacun voit le sien ; l'admin voit tout
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- projects : visibles par leurs membres ; création par admin ; mise à jour par direction
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (public.is_member(id) or public.is_admin());
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_admin());
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (public.has_role(id,'direction') or public.is_admin());

-- project_members : je vois mes affectations ; la direction voit et gère celles de son projet
drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members for select to authenticated
  using (user_id = auth.uid() or public.has_role(project_id,'direction') or public.is_admin());
drop policy if exists members_write on public.project_members;
create policy members_write on public.project_members for all to authenticated
  using (public.has_role(project_id,'direction') or public.is_admin())
  with check (public.has_role(project_id,'direction') or public.is_admin());

-- project_config : lecture par tout membre (nécessaire aux calculs) ; écriture direction
drop policy if exists config_select on public.project_config;
create policy config_select on public.project_config for select to authenticated
  using (public.is_member(project_id));
drop policy if exists config_insert on public.project_config;
create policy config_insert on public.project_config for insert to authenticated
  with check (public.has_role(project_id,'direction') or public.is_admin());

-- daily_reports : lecture par tout membre ; écriture direction / chef de projet / agent ;
-- le visiteur et le lecteur ne peuvent rien écrire ; suppression réservée à la direction
drop policy if exists reports_select on public.daily_reports;
create policy reports_select on public.daily_reports for select to authenticated
  using (public.is_member(project_id));
drop policy if exists reports_insert on public.daily_reports;
create policy reports_insert on public.daily_reports for insert to authenticated
  with check (public.has_role(project_id,'direction','chef_projet','agent'));
drop policy if exists reports_update on public.daily_reports;
create policy reports_update on public.daily_reports for update to authenticated
  using (public.has_role(project_id,'direction','chef_projet','agent'));
drop policy if exists reports_delete on public.daily_reports;
create policy reports_delete on public.daily_reports for delete to authenticated
  using (public.has_role(project_id,'direction'));

-- project_state (aléas, pilotage…) : lecture membres ; écriture direction / chef de projet
drop policy if exists state_select on public.project_state;
create policy state_select on public.project_state for select to authenticated
  using (public.is_member(project_id));
drop policy if exists state_write on public.project_state;
create policy state_write on public.project_state for all to authenticated
  using (public.has_role(project_id,'direction','chef_projet'))
  with check (public.has_role(project_id,'direction','chef_projet'));

-- attachment_periods : FINANCE — direction uniquement, en lecture comme en écriture.
-- Un visiteur, un agent ou un lecteur n'obtient aucune ligne, même par appel direct à l'API.
drop policy if exists attach_direction on public.attachment_periods;
create policy attach_direction on public.attachment_periods for all to authenticated
  using (public.has_role(project_id,'direction'))
  with check (public.has_role(project_id,'direction'));

-- audit : tout membre peut écrire une trace ; lecture direction
drop policy if exists audit_insert on public.audit_events;
create policy audit_insert on public.audit_events for insert to authenticated
  with check (project_id is null or public.is_member(project_id));
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated
  using (public.has_role(project_id,'direction') or public.is_admin());

-- ---------------------------------------------------------------------------
-- 9. Horodatage automatique et version des rapports
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.bump_report_version()
returns trigger language plpgsql as $$
begin new.version := old.version + 1; new.updated_at := now(); new.author_id := coalesce(auth.uid(), new.author_id); return new; end $$;

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch before update on public.projects for each row execute function public.touch_updated_at();
drop trigger if exists trg_reports_version on public.daily_reports;
create trigger trg_reports_version before update on public.daily_reports for each row execute function public.bump_report_version();
drop trigger if exists trg_state_touch on public.project_state;
create trigger trg_state_touch before update on public.project_state for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Après exécution — à faire dans l'interface Supabase, pas en SQL :
--   a) Authentication → Providers → Email : désactiver « Allow new users to sign up »
--      (accès sur invitation uniquement).
--   b) Authentication → Users → Add user : créer ton compte direction, puis un compte
--      visiteur (ex. visiteur@… avec mot de passe) pour le jury.
--   c) Revenir ici et exécuter, en remplaçant les emails :
--        update public.profiles set is_admin = true where email = 'TON_EMAIL';
--        insert into public.projects (code,name,short_name,client,moe,status,is_demo,created_by)
--          values ('dispersion-1b-demo','AEP Kimoukro — Dispersion 1B (démo)','Dispersion 1B','Client','Maître d''œuvre','active',true,
--                  (select id from public.profiles where email='TON_EMAIL'));
--        insert into public.project_members (project_id,user_id,role)
--          select p.id, u.id, 'direction' from public.projects p, public.profiles u
--          where p.code='dispersion-1b-demo' and u.email='TON_EMAIL';
--        insert into public.project_members (project_id,user_id,role)
--          select p.id, u.id, 'visiteur' from public.projects p, public.profiles u
--          where p.code='dispersion-1b-demo' and u.email='EMAIL_VISITEUR';
--   d) Test d'isolation : connecté en visiteur, `select * from attachment_periods` doit
--      renvoyer 0 ligne, et tout insert doit être refusé.
-- ============================================================================
