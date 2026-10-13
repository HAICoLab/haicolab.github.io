-- Run only AFTER deploying team-notifications and configuring Resend + Vault.
-- Target: ybotwermtuxtohbwyznm. This does not send historical notifications.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='eng3510_notification_secret' and length(decrypted_secret)>=32) then
   raise exception 'Set eng3510_notification_secret in Supabase Vault first';
 end if;
end $$;

select cron.schedule('eng3510-team-notifications', '* * * * *', $job$
  select net.http_post(
    url := 'https://ybotwermtuxtohbwyznm.supabase.co/functions/v1/team-notifications',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='eng3510_notification_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) where (select email_notifications_enabled from team_private.settings);
$job$);

update team_private.settings set email_notifications_enabled=true;
commit;
