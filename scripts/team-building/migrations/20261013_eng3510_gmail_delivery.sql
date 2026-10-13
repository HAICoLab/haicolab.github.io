-- Apply after 20261013_eng3510_notifications_and_offer_window.sql, before deploying Gmail support.
-- SMTP cannot deduplicate ambiguous sends. Persist a send-start marker and hold
-- uncertain outcomes for manual review; retry only definite temporary rejections.
begin;
alter table team_private.notification_outbox add column if not exists smtp_started_at timestamptz;

create or replace function public.tb_begin_notification_delivery(job_id uuid, token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
 update team_private.notification_outbox set smtp_started_at=clock_timestamp()
 where id=job_id and state='sending' and lease_token=token and lease_until>clock_timestamp() and smtp_started_at is null;
 get diagnostics updated = row_count;
 return updated=1;
end $$;

create or replace function public.tb_claim_notifications(batch_size integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not (select email_notifications_enabled from team_private.settings) then return '[]'::jsonb; end if;
 -- SMTP may already have accepted these messages. Never reclaim them for sending.
 update team_private.notification_outbox set state='failed',last_error='smtp_delivery_unconfirmed',lease_token=null,lease_until=null
 where state='sending' and smtp_started_at is not null and lease_until<=now();
 update team_private.notification_outbox set state='failed',last_error='delivery_window_expired',lease_token=null,lease_until=null
 where state in ('pending','sending') and (created_at<now()-interval '23 hours' or (attempts>=6 and coalesce(lease_until,available_at)<=now()));
 with candidates as (
   select id from team_private.notification_outbox
   where smtp_started_at is null and ((state='pending' and available_at<=now()) or (state='sending' and lease_until<=now())) and attempts<6
   order by created_at for update skip locked limit least(greatest(batch_size,1),10)
 ), claimed as (
   update team_private.notification_outbox q set state='sending',attempts=q.attempts+1,
     lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
     recipient_email=coalesce(q.recipient_email,(select email from auth.users where id=q.recipient_id))
   from candidates c where q.id=c.id
   returning q.id,q.lease_token,q.recipient_email,q.event,q.idea_id,q.idea_title,q.actor_label
 ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
 return result;
end $$;

create or replace function public.tb_finish_notification(job_id uuid, token uuid, provider_id text default null, error_code text default null, retryable boolean default true) returns boolean
language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
 if provider_id is null and error_code is null then raise exception 'A delivery result is required'; end if;
 update team_private.notification_outbox q set
   state=case when tb_finish_notification.provider_id is not null then 'sent' when not retryable or q.attempts>=6 then 'failed' else 'pending' end,
   provider_id=tb_finish_notification.provider_id,
   sent_at=case when tb_finish_notification.provider_id is not null then now() else null end,
   last_error=left(error_code,120),
   smtp_started_at=case when tb_finish_notification.provider_id is null and retryable then null else q.smtp_started_at end,
   available_at=now()+make_interval(mins=>least(60,power(2,q.attempts-1)::int)),
   lease_token=null,lease_until=null
 where q.id=job_id and q.state='sending' and q.lease_token=token;
 get diagnostics updated = row_count;
 return updated=1;
end $$;
revoke all on function public.tb_begin_notification_delivery(uuid,uuid),public.tb_claim_notifications(integer),public.tb_finish_notification(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.tb_begin_notification_delivery(uuid,uuid),public.tb_claim_notifications(integer),public.tb_finish_notification(uuid,uuid,text,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
