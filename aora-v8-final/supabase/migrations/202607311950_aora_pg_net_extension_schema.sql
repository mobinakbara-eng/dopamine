-- Supabase's pg_net objects live in the dedicated net schema, but the extension
-- metadata was installed in public. The extension is not relocatable, so use the
-- documented drop/recreate path inside one transaction.

create schema if not exists extensions;

drop extension if exists pg_net;
create extension pg_net with schema extensions;
