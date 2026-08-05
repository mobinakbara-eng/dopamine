begin;

-- These indexes are byte-for-byte duplicates reported by the Supabase
-- performance advisor. Keep the clearer/canonical names and remove only the
-- redundant copies to reduce write amplification and storage overhead.
drop index if exists public.app_sessions_org_idx;
drop index if exists public.task_claims_employee_fk_idx;
drop index if exists public.task_evidence_location_fk_idx;
drop index if exists public.task_rules_location_fk_idx;
drop index if exists public.task_rules_template_fk_idx;
drop index if exists public.work_rules_org_idx;

commit;
