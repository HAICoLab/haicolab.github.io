-- ENG3510 only. Run after the notifications and Gmail delivery migrations.
-- Preserve all applications. Stop if conflicting active applications appeared.
-- Existing active applications start their two-hour clock at this migration.
-- No automatic expiry: reminders do not cancel applications or reserve seats.
begin;
do $$
begin
 if position('ENG3510' in coalesce(pg_get_functiondef(to_regprocedure('public.tb_read()')),''))=0 then
   raise exception 'This migration requires the ENG3510 database';
 end if;
end $$;
lock table team_private.applications in share row exclusive mode;
do $$
begin
 if exists(select 1 from team_private.applications where status in ('pending','offered') group by applicant_id having count(*)>1) then
   raise exception 'Resolve existing multiple active applications with their applicants before applying this migration';
 end if;
end $$;
create unique index if not exists one_active_application_per_student
 on team_private.applications(applicant_id) where status in ('pending','offered');
alter table team_private.applications
 add column if not exists response_started_at timestamptz not null default now(),
 add column if not exists response_cycle uuid not null default gen_random_uuid();

create or replace function team_private.track_application_response() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
   new.response_started_at:=clock_timestamp();new.response_cycle:=gen_random_uuid();
 elsif new.status in ('pending','offered') and old.status is distinct from new.status then
   new.response_started_at:=clock_timestamp();new.response_cycle:=gen_random_uuid();
 else
   -- Editing a message or reply never postpones the decision reminder.
   new.response_started_at:=old.response_started_at;new.response_cycle:=old.response_cycle;
 end if;
 return new;
end $$;
drop trigger if exists team_application_response_clock on team_private.applications;
create trigger team_application_response_clock before insert or update of status,message,reply
 on team_private.applications for each row execute function team_private.track_application_response();

create or replace function public.tb_read() returns jsonb language plpgsql security definer set search_path='' as $$
declare me team_private.profiles; result jsonb;
begin
  select * into me from team_private.profiles where id=auth.uid();
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception '수업 계정으로 로그인해 주세요.';
  end if;
  if me.id is null then
    return jsonb_build_object('course_code','ENG3510','enrollment_required',true,
      'account_email',(select email from auth.users where id=auth.uid()));
  end if;
  select jsonb_build_object(
    'course_code','ENG3510',
    'offers_open',(select matching_open from team_private.settings),
    'me',to_jsonb(me),
    'settings',(select to_jsonb(s)-'id' from team_private.settings s),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_id',p.display_id,'role',p.role)) from team_private.profiles p),'[]'::jsonb),
    'ideas',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from team_private.ideas i),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(m)) from team_private.members m),'[]'::jsonb),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from team_private.comments c),'[]'::jsonb),
    'applications',coalesce((select jsonb_agg(to_jsonb(a)-'response_cycle' order by a.created_at desc) from team_private.applications a join team_private.ideas i on i.id=a.idea_id where me.role='admin' or a.applicant_id=me.id or i.owner_id=me.id),'[]'::jsonb),
    'invites',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'idea_id',v.idea_id,'status',v.status,'is_mine',v.student_number=me.student_number,'display_id',p.display_id)) from team_private.invites v join team_private.ideas i on i.id=v.idea_id left join team_private.profiles p on p.student_number=v.student_number where me.role='admin' or v.student_number=me.student_number or i.owner_id=me.id),'[]'::jsonb)
  ) into result;
  if me.role='admin' then
    result := result || jsonb_build_object('roster',coalesce((select jsonb_agg(jsonb_build_object(
      'student_number',r.student_number,'display_id',p.display_id,'user_id',p.id,'idea_id',m.idea_id,
      'submitted',exists(select 1 from team_private.ideas i where i.owner_id=p.id) or exists(select 1 from team_private.invites v where v.student_number=r.student_number and v.status='accepted')
    ) order by r.student_number) from team_private.roster r left join team_private.profiles p on p.student_number=r.student_number left join team_private.members m on m.user_id=p.id where r.role='student'),'[]'::jsonb));
  end if;
  return result;
end $$;

create or replace function public.tb_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me team_private.profiles; cfg team_private.settings; i team_private.ideas;
 a team_private.applications; v team_private.invites; rid uuid; n integer; sn text; secret text;
 output jsonb:='{}'::jsonb; status_value text;
begin
 perform pg_advisory_xact_lock(2026092801);
 select * into me from team_private.profiles where id=auth.uid();
 if me.id is null then raise exception '수업 계정으로 로그인해 주세요.'; end if;
 select * into cfg from team_private.settings;
 if action like 'admin_%' and me.role<>'admin' then raise exception '교수자만 사용할 수 있습니다.'; end if;

 if action='save_idea' then
   if not cfg.submissions_open and me.role<>'admin' then raise exception '아이디어 제출·수정이 마감되었습니다.'; end if;
   rid:=nullif(payload->>'id','')::uuid;
   if rid is not null then
     select * into i from team_private.ideas where id=rid;
     if i.id is null or i.owner_id<>me.id then raise exception '본인의 아이디어만 수정할 수 있습니다.'; end if;
     if i.status='archived' then raise exception '보관된 아이디어는 수정할 수 없습니다.'; end if;
   elsif exists(select 1 from team_private.members where user_id=me.id) then
     raise exception '이미 팀에 속해 있습니다. 내 활동에서 대표 게시물을 확인해 주세요.';
   end if;
   if split_part(payload->>'image_path','/',1)<>me.id::text or not exists(
      select 1 from storage.objects where bucket_id='team-images' and name=payload->>'image_path') then
     raise exception '설명 이미지를 먼저 업로드해 주세요.';
   end if;
   n:=(payload->>'target_size')::integer;
   status_value:=payload->>'status';
   if status_value not in ('recruiting','closed') or status_value is null then raise exception '모집 상태를 확인해 주세요.'; end if;
   if n not between 1 and 3 or n is null then raise exception '팀은 1~3명으로 구성합니다.'; end if;
   if rid is not null and n<(select count(*) from team_private.members where idea_id=rid)+(select count(*) from team_private.invites where idea_id=rid and status='pending') then
     raise exception '확정·확인 대기 인원보다 정원을 줄일 수 없습니다.';
   end if;
   if status_value='recruiting' and length(btrim(coalesce(payload->>'seeking','')))<5 then raise exception '함께할 팀원에게 바라는 역할을 적어 주세요.'; end if;
   if n=1 then status_value:='closed'; end if;
   if rid is not null and (select count(*) from team_private.members where idea_id=rid)>=n then status_value:='closed'; end if;
   if rid is null then
     insert into team_private.ideas(owner_id,title,summary,problem,outcome,data_plan,technology,contribution,seeking,image_path,image_alt,target_size,status)
     values(me.id,btrim(payload->>'title'),btrim(payload->>'summary'),btrim(payload->>'problem'),btrim(payload->>'outcome'),btrim(payload->>'data_plan'),btrim(payload->>'technology'),btrim(payload->>'contribution'),btrim(coalesce(payload->>'seeking','')),payload->>'image_path',btrim(payload->>'image_alt'),n,status_value) returning id into rid;
     insert into team_private.members(user_id,idea_id) values(me.id,rid);
   else
     update team_private.ideas set title=btrim(payload->>'title'),summary=btrim(payload->>'summary'),problem=btrim(payload->>'problem'),outcome=btrim(payload->>'outcome'),data_plan=btrim(payload->>'data_plan'),technology=btrim(payload->>'technology'),contribution=btrim(payload->>'contribution'),seeking=btrim(coalesce(payload->>'seeking','')),image_path=payload->>'image_path',image_alt=btrim(payload->>'image_alt'),target_size=n,status=status_value,updated_at=now() where id=rid;
   end if;
   if status_value='closed' then update team_private.applications set status='closed' where idea_id=rid and status in ('pending','offered'); end if;

   -- Optional on new and existing ideas; old clients with no list behave unchanged.
   if jsonb_typeof(coalesce(payload->'existing_members','[]'::jsonb)) is distinct from 'array' then
     raise exception '기존 팀원 학번을 확인해 주세요.';
   end if;
   if jsonb_array_length(coalesce(payload->'existing_members','[]'::jsonb))>2
     or exists(select 1 from jsonb_array_elements(coalesce(payload->'existing_members','[]'::jsonb)) x where jsonb_typeof(x)<>'string') then
     raise exception '기존 팀원 학번을 확인해 주세요.';
   end if;
   for sn in select btrim(value) from jsonb_array_elements_text(coalesce(payload->'existing_members','[]'::jsonb)) loop
     if sn='' then raise exception '기존 팀원 학번을 확인해 주세요.'; end if;
     if exists(select 1 from team_private.invites invite_row where invite_row.idea_id=rid and invite_row.student_number=sn and invite_row.status='pending') then
       raise exception '이미 등록 요청했거나 확정된 팀원입니다. 내 활동에서 확인해 주세요.';
     end if;
     -- Same transaction and course lock: an invalid invitation rolls back the entire save.
     perform public.tb_action('invite_member',jsonb_build_object('idea_id',rid,'student_number',sn));
   end loop;
   output:=jsonb_build_object('id',rid);

 elsif action='comment' then
   if not cfg.matching_open then raise exception '팀빌딩 활동이 마감되었습니다.'; end if;
   rid:=(payload->>'idea_id')::uuid;
   if not exists(select 1 from team_private.ideas where id=rid and status<>'archived') then raise exception '활동 중인 아이디어가 아닙니다.'; end if;
   insert into team_private.comments(idea_id,author_id,body) values(rid,me.id,btrim(payload->>'body'));

 elsif action='delete_comment' then
   delete from team_private.comments where id=(payload->>'id')::uuid and (author_id=me.id or me.role='admin');

 elsif action='apply' then
   if not cfg.matching_open then raise exception '팀 모집이 마감되었습니다.'; end if;
   select * into i from team_private.ideas where id=(payload->>'idea_id')::uuid;
   if i.id is null or i.owner_id=me.id or i.status<>'recruiting' then raise exception '지원 가능한 다른 팀을 선택해 주세요.'; end if;
   if (select count(*) from team_private.members where idea_id=i.id)+(select count(*) from team_private.invites where idea_id=i.id and status='pending')>=i.target_size then raise exception '현재 모집 가능한 자리가 없습니다.'; end if;
   if exists(select 1 from team_private.members m join team_private.ideas x on x.id=m.idea_id where m.user_id=me.id and (x.owner_id<>me.id or (select count(*) from team_private.members where idea_id=x.id)>1)) then raise exception '이미 구성된 팀에 소속되어 있습니다.'; end if;
   if exists(select 1 from team_private.applications where applicant_id=me.id and idea_id<>i.id and status in ('pending','offered')) then
     raise exception '한 번에 한 팀에만 지원할 수 있습니다. 내 활동에서 진행 중인 지원을 취소한 뒤 다른 팀에 지원해 주세요.';
   end if;
   if exists(select 1 from team_private.applications where applicant_id=me.id and idea_id=i.id and status='offered') then
     raise exception '합류 제안이 도착했습니다. 내 활동에서 수락하거나 지원을 취소해 주세요.';
   end if;
   insert into team_private.applications(idea_id,applicant_id,message) values(i.id,me.id,btrim(payload->>'message'))
   on conflict(idea_id,applicant_id) do update set message=excluded.message,status='pending',reply='' where team_private.applications.status<>'accepted';

 elsif action='application' then
   if not cfg.matching_open then raise exception '팀 모집이 마감되었습니다.'; end if;
   select * into a from team_private.applications where id=(payload->>'id')::uuid;
   select * into i from team_private.ideas where id=a.idea_id;
   status_value:=payload->>'decision';
   if a.id is null then raise exception '지원 내역을 찾을 수 없습니다.'; end if;
   if status_value in ('offer','reject','reply') and i.owner_id=me.id then
     if a.status not in ('pending','offered') or i.status<>'recruiting' then raise exception '처리 가능한 지원이 아닙니다.'; end if;
     update team_private.applications set status=case status_value when 'offer' then 'offered' when 'reject' then 'declined' else status end,reply=coalesce(payload->>'reply',reply) where id=a.id;
   elsif status_value in ('accept','withdraw') and a.applicant_id=me.id then
     if a.status not in ('pending','offered') then raise exception '이미 처리된 지원입니다.'; end if;
     if status_value='accept' then
       if a.status<>'offered' or i.status<>'recruiting' then raise exception '팀장의 합류 제안이 필요합니다.'; end if;
       perform team_private.join_team(me.id,i.id);
       update team_private.applications set status='accepted' where id=a.id;
     else update team_private.applications set status='withdrawn' where id=a.id; end if;
   else raise exception '지원 처리 권한이 없습니다.'; end if;

 elsif action='invite_member' then
   if not cfg.submissions_open and not cfg.matching_open then raise exception '팀 구성 변경이 마감되었습니다.'; end if;
   select * into i from team_private.ideas where id=(payload->>'idea_id')::uuid;
   if i.id is null or i.owner_id<>me.id or i.status='archived' then raise exception '팀장만 기존 팀원을 등록할 수 있습니다.'; end if;
   sn:=btrim(payload->>'student_number');
   if sn=me.student_number or not exists(select 1 from team_private.roster where student_number=sn and role='student') then raise exception '등록할 수 없는 학번입니다. 교수자에게 확인해 주세요.'; end if;
   if exists(select 1 from team_private.profiles p join team_private.members m on m.user_id=p.id where p.student_number=sn and m.idea_id=i.id) then raise exception '이미 같은 팀에 속해 있습니다.'; end if;
   if (select count(*) from team_private.members where idea_id=i.id)+(select count(*) from team_private.invites where idea_id=i.id and status='pending')>=i.target_size then raise exception '정원을 확인해 주세요. 확인 대기 중인 팀원도 자리를 차지합니다.'; end if;
   insert into team_private.invites(idea_id,student_number) values(i.id,sn);

 elsif action='respond_invite' then
   if not cfg.submissions_open and not cfg.matching_open then raise exception '팀 구성 변경이 마감되었습니다.'; end if;
   select * into v from team_private.invites where id=(payload->>'id')::uuid;
   select * into i from team_private.ideas where id=v.idea_id;
   if v.id is null or v.status<>'pending' then raise exception '확인 대기 중인 초대가 아닙니다.'; end if;
   status_value:=payload->>'decision';
   if status_value='cancel' and i.owner_id=me.id then
     update team_private.invites set status='cancelled' where id=v.id;
   elsif v.student_number=me.student_number and status_value in ('accept','decline') then
     update team_private.invites set status=case when status_value='accept' then 'accepted' else 'declined' end where id=v.id;
     if status_value='accept' then perform team_private.join_team(me.id,v.idea_id); end if;
   else raise exception '초대 처리 권한이 없습니다.'; end if;

 elsif action='admin_roster' then
   for sn in select distinct btrim(value) from jsonb_array_elements_text(payload->'students') loop
     if sn !~ '^[0-9A-Za-z_-]{2,30}$' or sn='professor' then raise exception '학번은 영문·숫자·하이픈으로 2~30자 입력해 주세요.'; end if;
     if not exists(select 1 from team_private.roster where student_number=sn) then
       secret:=gen_random_uuid()::text;
       insert into team_private.roster(student_number,invite_hash) values(sn,encode(sha256(convert_to(secret,'UTF8')),'hex'));
       output:=output||jsonb_build_object(sn,secret);
     end if;
   end loop;

 elsif action='admin_reissue' then
   sn:=payload->>'student_number'; secret:=gen_random_uuid()::text;
   update team_private.roster set invite_hash=encode(sha256(convert_to(secret,'UTF8')),'hex') where student_number=sn and claimed_by is null and role='student';
   if not found then raise exception '미가입 학생의 초대코드만 재발급할 수 있습니다.'; end if;
   output:=jsonb_build_object(sn,secret);

 elsif action='admin_settings' then
   update team_private.settings set submissions_open=(payload->>'submissions_open')::boolean,matching_open=(payload->>'matching_open')::boolean,notice=left(coalesce(payload->>'notice',''),2000);

 elsif action='admin_remove_member' then
   rid:=(payload->>'user_id')::uuid;
   select x.* into i from team_private.members m join team_private.ideas x on x.id=m.idea_id where m.user_id=rid;
   if i.id is null then raise exception '소속 팀이 없습니다.'; end if;
   if i.owner_id=rid then
     update team_private.ideas set status='archived' where id=i.id;
     delete from team_private.members where idea_id=i.id;
     update team_private.invites set status='cancelled' where idea_id=i.id and status in ('pending','accepted');
     update team_private.applications set status='closed' where idea_id=i.id;
   else
     delete from team_private.members where user_id=rid;
     update team_private.invites set status='cancelled' where idea_id=i.id and student_number=(select student_number from team_private.profiles where id=rid) and status='accepted';
     update team_private.applications set status='closed' where idea_id=i.id and applicant_id=rid;
   end if;
   insert into team_private.audit(actor_id,action,details) values(me.id,action,payload);
 else raise exception '지원하지 않는 요청입니다.';
 end if;
 return output;
end $$;

alter table team_private.notification_outbox
 add column if not exists application_id uuid references team_private.applications(id) on delete cascade,
 add column if not exists application_cycle uuid;
alter table team_private.notification_outbox drop constraint if exists notification_outbox_event_check;
alter table team_private.notification_outbox add constraint notification_outbox_event_check check(event in (
 'application_received','application_reply','application_offer','application_declined','application_accepted','project_comment',
 'application_review_reminder','application_offer_reminder'));
create unique index if not exists one_reminder_per_application_phase
 on team_private.notification_outbox(application_id,application_cycle,event)
 where event in ('application_review_reminder','application_offer_reminder');

create or replace function team_private.reminder_is_current(application uuid, cycle uuid, kind text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from team_private.applications a join team_private.ideas i on i.id=a.idea_id
   where a.id=application and a.response_cycle=cycle and i.status='recruiting'
   and ((kind='application_review_reminder' and a.status='pending')
     or (kind='application_offer_reminder' and a.status='offered'))
   and (select matching_open and email_notifications_enabled from team_private.settings)
 );
$$;

create or replace function public.tb_queue_due_application_reminders() returns integer
language plpgsql security definer set search_path='' as $$
declare queued integer;
begin
 perform pg_advisory_xact_lock(2026092801);
 if not (select matching_open and email_notifications_enabled from team_private.settings) then return 0; end if;
 insert into team_private.notification_outbox(recipient_id,event,idea_id,idea_title,actor_label,application_id,application_cycle)
 select case when a.status='pending' then i.owner_id else a.applicant_id end,
   case when a.status='pending' then 'application_review_reminder' else 'application_offer_reminder' end,
   i.id,i.title,case when p.role='admin' then '교수자' else '학생 '||lpad(p.display_id::text,greatest(2,length(p.display_id::text)),'0') end,
   a.id,a.response_cycle
 from team_private.applications a join team_private.ideas i on i.id=a.idea_id
 join team_private.profiles p on p.id=case when a.status='pending' then a.applicant_id else i.owner_id end
 where a.status in ('pending','offered') and i.status='recruiting'
   and a.response_started_at<=clock_timestamp()-interval '2 hours'
 on conflict do nothing;
 get diagnostics queued = row_count;
 return queued;
end $$;

create or replace function public.tb_begin_notification_delivery(job_id uuid, token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
 update team_private.notification_outbox q set smtp_started_at=clock_timestamp()
 where id=job_id and state='sending' and lease_token=token and lease_until>clock_timestamp() and smtp_started_at is null
   and (q.event not in ('application_review_reminder','application_offer_reminder')
     or team_private.reminder_is_current(q.application_id,q.application_cycle,q.event));
 get diagnostics updated = row_count;
 return updated=1;
end $$;

create or replace function public.tb_claim_notifications(batch_size integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not (select email_notifications_enabled from team_private.settings) then return '[]'::jsonb; end if;
 -- An unstarted reminder is no longer useful after a decision, withdrawal or close.
 update team_private.notification_outbox q set state='failed',last_error='reminder_obsolete',lease_token=null,lease_until=null
 where q.state in ('pending','sending') and q.smtp_started_at is null
   and q.event in ('application_review_reminder','application_offer_reminder')
   and not team_private.reminder_is_current(q.application_id,q.application_cycle,q.event);
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
revoke all on function team_private.track_application_response(),team_private.reminder_is_current(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.tb_queue_due_application_reminders(),public.tb_begin_notification_delivery(uuid,uuid),public.tb_claim_notifications(integer) from public,anon,authenticated;
grant execute on function public.tb_queue_due_application_reminders(),public.tb_begin_notification_delivery(uuid,uuid),public.tb_claim_notifications(integer) to service_role;
revoke all on function public.tb_read(),public.tb_action(text,jsonb) from public,anon;
grant execute on function public.tb_read(),public.tb_action(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

