create or replace function public.aora_consume_rate_limit(
  p_bucket text,
  p_window_seconds integer default 600,
  p_limit integer default 7
)
returns table(allowed boolean, attempts integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  row_value public.aora_login_rate_limits%rowtype;
begin
  if p_bucket is null or length(p_bucket) < 16 or p_window_seconds < 1 or p_limit < 1 then
    raise exception 'invalid rate limit parameters';
  end if;

  insert into public.aora_login_rate_limits as limits (bucket, window_started_at, attempts, updated_at)
  values (p_bucket, v_now, 1, v_now)
  on conflict (bucket) do update
  set window_started_at = case
        when v_now - limits.window_started_at >= make_interval(secs => p_window_seconds)
          then v_now
        else limits.window_started_at
      end,
      attempts = case
        when v_now - limits.window_started_at >= make_interval(secs => p_window_seconds)
          then 1
        else limits.attempts + 1
      end,
      updated_at = v_now
  returning limits.* into row_value;

  allowed := row_value.attempts <= p_limit;
  attempts := row_value.attempts;
  retry_after_seconds := greatest(
    0,
    p_window_seconds - floor(extract(epoch from (v_now - row_value.window_started_at)))::integer
  );
  return next;
end;
$$;

revoke all on function public.aora_consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.aora_consume_rate_limit(text, integer, integer)
  to service_role;
