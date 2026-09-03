-- ============================================================================
-- SIYO Pilot — complément v2.2 (03/09/2026)
-- Archivage : conserver le statut antérieur pour le restaurer (constat M5 du diagnostic externe).
-- À exécuter dans SQL Editor. Rejouable.
-- ============================================================================
alter table public.projects add column if not exists previous_status public.project_status;

-- Contrôle
select code, name, status, previous_status from public.projects order by created_at;

-- Rappel de versionnement (constat B1 / P0-01) : ces trois fichiers doivent vivre dans le dépôt Git,
-- dossier /supabase, dans l'ordre d'exécution :
--   1. siyo_pilot_schema_v0.sql          (schéma, rôles, RLS)
--   2. siyo_pilot_complement_finance.sql (project_finance, renommage)
--   3. siyo_pilot_v2_2.sql               (previous_status)
-- Une base neuve se reconstruit en les exécutant dans cet ordre.
