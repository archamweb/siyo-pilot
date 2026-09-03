-- ============================================================================
-- SIYO Pilot — complément v2.0 (03/09/2026)
-- 1) Table project_finance : DQE (quantités et prix) réservé à la direction.
--    Le tableau de bord des autres rôles ne lit qu'un taux publié dans project_state.
-- 2) Le projet Dispersion 1B cesse d'être étiqueté « démo » : un projet existant, point.
-- À exécuter dans SQL Editor. Les « drop policy if exists » rendent le script rejouable.
-- ============================================================================

create table if not exists public.project_finance (
  project_id uuid primary key references public.projects(id) on delete cascade,
  dqe jsonb,                                       -- lignes DQE importées : désignation, unité, quantité marché, prix unitaire
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.project_finance enable row level security;

drop policy if exists finance_direction on public.project_finance;
create policy finance_direction on public.project_finance for all to authenticated
  using (public.has_role(project_id,'direction') or public.is_admin())
  with check (public.has_role(project_id,'direction') or public.is_admin());

drop trigger if exists trg_finance_touch on public.project_finance;
create trigger trg_finance_touch before update on public.project_finance
  for each row execute function public.touch_updated_at();

-- ── Projet Dispersion 1B : nom sans « (démo) », plus d'étiquette démo ──
update public.projects
   set name = 'AEP Kimoukro — Dispersion 1B', short_name = 'Dispersion 1B', is_demo = false
 where code = 'dispersion-1b-demo';

-- Même correction dans la dernière version de configuration (identité affichée dans l'application)
update public.project_config c
   set config = jsonb_set(jsonb_set(c.config, '{identity,name}', '"AEP Kimoukro — Dispersion 1B"'),
                          '{identity,shortName}', '"Dispersion 1B"')
 where c.project_id = (select id from public.projects where code = 'dispersion-1b-demo')
   and c.version = (select max(version) from public.project_config where project_id = c.project_id);

-- Contrôle
select p.name, p.short_name, p.is_demo, c.version, c.config->'identity'->>'name' as nom_config
  from public.projects p join public.project_config c on c.project_id = p.id
 where p.code = 'dispersion-1b-demo' order by c.version desc limit 1;

-- Facultatif — si tu décides d'afficher les vrais noms des parties, remplace les valeurs :
-- update public.projects set client = 'NOM_CLIENT', moe = 'NOM_MOE', contractor = 'SUD SUD BTP - SIYO LIMITED' where code = 'dispersion-1b-demo';
-- (la configuration reprend ces champs à la prochaine révision de paramétrage, ou via un jsonb_set similaire sur identity.client / identity.owner / identity.company)
