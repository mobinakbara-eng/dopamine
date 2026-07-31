begin;

create or replace function public.aora_run_backup_restore_verification(
  p_source_organization_id uuid,
  p_environment text default 'staging',
  p_created_by text default 'aora-release-gate'
) returns jsonb
language plpgsql
security definer
set search_path=public,storage,extensions,pg_temp
as $$
declare
  v_run_id uuid:=gen_random_uuid();
  v_restore_organization_id uuid:=gen_random_uuid();
  v_backup_id uuid;
  v_source_revision bigint;
  v_source_state jsonb;
  v_source_name text;
  v_source_timezone text;
  v_source_plan text;
  v_backup_snapshot jsonb;
  v_backup_checksum text;
  v_restored_checksum text;
  v_source_counts jsonb:='{}'::jsonb;
  v_restored_counts jsonb:='{}'::jsonb;
  v_storage_inventory jsonb:='{}'::jsonb;
  v_object_count bigint:=0;
  v_object_bytes bigint:=0;
  v_verified boolean:=false;
  v_result jsonb;
  v_restore_slug text:='aora-restore-'||replace(v_restore_organization_id::text,'-','');
begin
  select snapshot.revision,snapshot.state,organization.name,organization.timezone,organization.plan
  into v_source_revision,v_source_state,v_source_name,v_source_timezone,v_source_plan
  from public.workspace_snapshots snapshot
  join public.organizations organization on organization.id=snapshot.organization_id
  where snapshot.organization_id=p_source_organization_id
    and organization.status='active';

  if v_source_revision is null then
    raise exception using errcode='P0002',message='Source workspace was not found or is inactive.';
  end if;

  insert into public.backup_restore_verification_runs(
    id,source_organization_id,restore_organization_id,environment,source_revision,status,started_at,details
  ) values(
    v_run_id,p_source_organization_id,v_restore_organization_id,coalesce(nullif(p_environment,''),'staging'),
    v_source_revision,'running',clock_timestamp(),jsonb_build_object('createdBy',p_created_by)
  );

  begin
    v_backup_id:=public.aora_create_pilot_backup(p_source_organization_id,p_created_by);
    v_verified:=public.aora_verify_pilot_backup(v_backup_id);
    if not v_verified then
      raise exception using errcode='XX001',message='Backup checksum verification failed.';
    end if;

    select backup.snapshot,backup.checksum
    into v_backup_snapshot,v_backup_checksum
    from public.pilot_backups backup
    where backup.id=v_backup_id
      and backup.organization_id=p_source_organization_id;

    if v_backup_snapshot is null then
      raise exception using errcode='P0002',message='Verified backup could not be read.';
    end if;
    if encode(extensions.digest(v_backup_snapshot::text,'sha256'),'hex')<>v_backup_checksum then
      raise exception using errcode='XX001',message='Backup content checksum changed after verification.';
    end if;

    v_source_counts:=public.aora_verify_canonical_backfill(p_source_organization_id)-'organizationId'-'verifiedAt';

    select count(*),coalesce(sum(
      case when coalesce(object.metadata->>'size','')~'^[0-9]+$'
        then (object.metadata->>'size')::bigint else 0 end
    ),0)
    into v_object_count,v_object_bytes
    from storage.objects object
    where object.bucket_id='checklist-evidence'
      and object.name like p_source_organization_id::text||'/%';

    v_storage_inventory:=jsonb_build_object(
      'bucket','checklist-evidence',
      'objects',v_object_count,
      'bytes',v_object_bytes,
      'verifiedAt',clock_timestamp(),
      'externalCopyRequired',v_object_count>0
    );

    -- Database restore verification is intentionally fail-closed when binary evidence exists.
    -- Storage bytes must be copied and hashed by the storage release step before such a restore can pass.
    if v_object_count>0 then
      raise exception using errcode='55000',message='Checklist evidence objects require the external storage restore step.';
    end if;

    insert into public.organizations(id,slug,name,timezone,plan,status,billing_email,created_at,updated_at)
    values(
      v_restore_organization_id,v_restore_slug,
      left(coalesce(v_source_name,'Aora')||' · Restore Verification',200),
      coalesce(v_source_timezone,'Europe/Berlin'),coalesce(v_source_plan,'staging'),'active',null,
      clock_timestamp(),clock_timestamp()
    );

    insert into public.workspace_snapshots(organization_id,revision,state,updated_at)
    values(v_restore_organization_id,v_source_revision,v_backup_snapshot,clock_timestamp());

    perform public.project_workspace_state(v_restore_organization_id,v_backup_snapshot);

    v_restored_counts:=public.aora_verify_canonical_backfill(v_restore_organization_id)-'organizationId'-'verifiedAt';
    select encode(extensions.digest(snapshot.state::text,'sha256'),'hex')
    into v_restored_checksum
    from public.workspace_snapshots snapshot
    where snapshot.organization_id=v_restore_organization_id;

    if v_restored_checksum<>v_backup_checksum then
      raise exception using errcode='XX001',message='Restored snapshot checksum does not match the verified backup.';
    end if;
    if v_restored_counts<>v_source_counts then
      raise exception using errcode='XX001',message='Canonical row counts differ after restore.';
    end if;

    update public.backup_restore_verification_runs
    set status='verified',completed_at=clock_timestamp(),
        source_counts=v_source_counts,restored_counts=v_restored_counts,
        storage_inventory=v_storage_inventory,
        details=jsonb_build_object(
          'backupId',v_backup_id,
          'backupChecksum',v_backup_checksum,
          'restoredChecksum',v_restored_checksum,
          'snapshotEqual',v_backup_snapshot=v_source_state,
          'countsEqual',v_source_counts=v_restored_counts,
          'restoreSlug',v_restore_slug,
          'cleanup','pending'
        ),error=null
    where id=v_run_id;

    delete from public.organizations where id=v_restore_organization_id;

    update public.backup_restore_verification_runs
    set details=details||jsonb_build_object(
      'cleanup','completed',
      'restoreOrganizationRemoved',not exists(select 1 from public.organizations where id=v_restore_organization_id)
    )
    where id=v_run_id;

    select jsonb_build_object(
      'runId',run.id,'status',run.status,'sourceOrganizationId',run.source_organization_id,
      'restoreOrganizationId',run.restore_organization_id,'sourceRevision',run.source_revision,
      'sourceCounts',run.source_counts,'restoredCounts',run.restored_counts,
      'storageInventory',run.storage_inventory,'details',run.details,'completedAt',run.completed_at
    ) into v_result
    from public.backup_restore_verification_runs run where run.id=v_run_id;
    return v_result;
  exception when others then
    delete from public.organizations where id=v_restore_organization_id;
    update public.backup_restore_verification_runs
    set status='failed',completed_at=clock_timestamp(),
        source_counts=v_source_counts,restored_counts=v_restored_counts,
        storage_inventory=v_storage_inventory,error=sqlerrm,
        details=details||jsonb_build_object(
          'backupId',v_backup_id,
          'backupChecksum',v_backup_checksum,
          'restoredChecksum',v_restored_checksum,
          'cleanup','completed',
          'restoreOrganizationRemoved',not exists(select 1 from public.organizations where id=v_restore_organization_id),
          'sqlstate',sqlstate
        )
    where id=v_run_id;

    select jsonb_build_object(
      'runId',run.id,'status',run.status,'sourceOrganizationId',run.source_organization_id,
      'restoreOrganizationId',run.restore_organization_id,'sourceRevision',run.source_revision,
      'sourceCounts',run.source_counts,'restoredCounts',run.restored_counts,
      'storageInventory',run.storage_inventory,'details',run.details,'error',run.error,'completedAt',run.completed_at
    ) into v_result
    from public.backup_restore_verification_runs run where run.id=v_run_id;
    return v_result;
  end;
end;
$$;

revoke all on function public.aora_run_backup_restore_verification(uuid,text,text) from public,anon,authenticated;
grant execute on function public.aora_run_backup_restore_verification(uuid,text,text) to service_role;

comment on function public.aora_run_backup_restore_verification(uuid,text,text)
is 'Creates and verifies a backup, restores it into an isolated organization, reprojects canonical tables, compares checksum/counts, records the release gate and removes the restore tenant.';

commit;
