type Job = {
  id: string;
  lease_token: string;
  recipient_email: string | null;
  event: string;
  idea_id: string;
  idea_title: string;
  actor_label: string;
};
type Dependencies = {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  pause?: (ms: number) => Promise<void>;
  gmailSend?: (mail: Mail, id: string, user: string, password: string) => Promise<Delivery>;
};
export type Mail = { from: string; to: string[]; subject: string; text: string; html: string };
export type Delivery = { providerID: string | null; errorCode: string | null; retryable: boolean };
const site = 'https://haicolab.sogang.ac.kr/courses/eng3510/2026-fall/team-building/';
const events: Record<string, [string, string]> = {
  application_received: ['새 합류 지원', '팀에 합류 지원을 보냈습니다.'],
  application_reply: ['팀장 답변·추가 질문', '지원서에 답변 또는 추가 질문을 남겼습니다.'],
  application_offer: ['팀 합류 제안', '팀 합류를 제안했습니다. 사이트에서 제안을 수락해야 합류가 확정됩니다.'],
  application_declined: ['지원 결과 안내', '지원 결과를 안내했습니다. 사이트에서 확인해 주세요.'],
  application_accepted: ['팀 합류 확정', '합류 제안을 수락하여 팀원이 되었습니다.'],
  project_comment: ['프로젝트에 새 질문·댓글', '프로젝트에 질문 또는 댓글을 남겼습니다.'],
};
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function emailFor(job: Job, from: string) {
  const event = events[job.event];
  if (!event || !job.recipient_email || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(job.recipient_email)) {
    throw new Error('invalid_notification');
  }
  const link = site + (job.event === 'project_comment' ? '#idea/' + encodeURIComponent(job.idea_id) : '#activity');
  const description = `${job.actor_label}님이 ${event[1]}`;
  return {
    from,
    to: [job.recipient_email],
    subject: `[ENG3510 팀빌딩] ${event[0]}`,
    text: `${event[0]}\n\n프로젝트: ${job.idea_title}\n${description}\n\n로그인 후 확인: ${link}\n\n개인정보 보호를 위해 지원·답변 본문은 사이트에서만 확인합니다. 이 메일에 회신해도 상대방에게 전달되지 않습니다.`,
    html: `<h2>${escapeHTML(event[0])}</h2><p>프로젝트: <strong>${escapeHTML(job.idea_title)}</strong></p><p>${escapeHTML(description)}</p><p><a href="${escapeHTML(link)}">로그인 후 확인하기</a></p><p>개인정보 보호를 위해 지원·답변 본문은 사이트에서만 확인합니다.<br>이 메일에 회신해도 상대방에게 전달되지 않습니다.</p>`,
  };
}

async function sameSecret(received: string, expected: string) {
  const bytes = new TextEncoder();
  const [a, b] = await Promise.all([received, expected].map(s => crypto.subtle.digest('SHA-256', bytes.encode(s))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function createHandler(deps: Dependencies) {
  const pause = deps.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const secret = deps.env('TEAM_NOTIFICATION_SECRET');
    if (!secret || secret.length < 32) return Response.json({ error: 'notification_service_not_configured' }, { status: 503 });
    if (!await sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const url = deps.env('SUPABASE_URL');
    const key = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    const provider = deps.env('TEAM_MAIL_PROVIDER') || 'resend';
    const resend = deps.env('RESEND_API_KEY');
    const gmailUser = deps.env('GMAIL_USER') || '';
    const gmailPassword = (deps.env('GMAIL_APP_PASSWORD') || '').replace(/\s/g, '');
    const gmailReady = !!deps.gmailSend && /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(gmailUser) && /^[a-z]{16}$/.test(gmailPassword);
    const from = provider === 'gmail' ? `ENG3510 팀빌딩 <${gmailUser}>` : deps.env('TEAM_MAIL_FROM');
    if (!url || !key || !from || !from.includes('@') || /[\r\n]/.test(from) ||
        (provider === 'gmail' ? !gmailReady : provider !== 'resend' || !resend)) {
      return Response.json({ error: 'notification_service_not_configured' }, { status: 503 });
    }
    // Only the secret holder can request a fixed, self-addressed connection test.
    // No caller-selected recipient or message is accepted, and no student data is read.
    if (new URL(request.url).searchParams.get('self_test') === '1') {
      if (provider !== 'gmail') return Response.json({ error: 'gmail_required' }, { status: 400 });
      const text = 'ENG3510 프로젝트 팀빌딩의 Gmail 알림 연결 확인 메일입니다. 학생에게 발송된 메일이 아닙니다.';
      try {
        const result = await deps.gmailSend!({ from, to: [gmailUser], subject: '[ENG3510 팀빌딩] Gmail 알림 연결 확인', text, html: `<p>${text}</p>` }, crypto.randomUUID(), gmailUser, gmailPassword);
        return Response.json({ sent: !!result.providerID, error: result.errorCode }, { status: result.providerID ? 200 : 503 });
      } catch { return Response.json({ sent: false, error: 'smtp_delivery_unconfirmed' }, { status: 503 }); }
    }
    async function rpc(name: string, payload: object) {
      const result = await deps.fetch(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: key!, authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error('notification_database_unavailable');
      return result.json();
    }
    try {
      const jobs: Job[] = await rpc('tb_claim_notifications', { batch_size: 5 });
      let sent = 0, deferred = 0;
      for (const [index, job] of jobs.entries()) {
        if (index) await pause(600);
        let body;
        try { body = emailFor(job, from); }
        catch {
          await rpc('tb_finish_notification', { job_id: job.id, token: job.lease_token, error_code: 'invalid_notification', retryable: false });
          deferred++;
          continue;
        }
        let providerID: string | null = null;
        let errorCode: string | null = null;
        let retryable = true;
        if (provider === 'gmail') {
          // SMTP has no idempotency API. Persist the start BEFORE sending so an
          // expired lease or failed acknowledgement cannot send this mail twice.
          const started = await rpc('tb_begin_notification_delivery', { job_id: job.id, token: job.lease_token });
          if (!started) { deferred++; continue; }
          try {
            ({ providerID, errorCode, retryable } = await deps.gmailSend!(body, job.id, gmailUser, gmailPassword));
          } catch { errorCode = 'smtp_delivery_unconfirmed'; retryable = false; }
        } else try {
          const response = await deps.fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${resend}`, 'Content-Type': 'application/json', 'Idempotency-Key': `eng3510-notification/${job.id}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
          });
          if (response.ok) {
            const data = await response.json();
            if (typeof data.id === 'string' && data.id) providerID = data.id;
            else errorCode = 'provider_response_invalid';
          } else {
            errorCode = `provider_http_${response.status}`;
            retryable = response.status === 429 || response.status >= 500 || response.status === 408;
          }
        } catch { errorCode = 'provider_network_error'; }
        // Resend can retry the same idempotency key. SMTP attempts with an
        // uncertain outcome stay marked for review instead of being resent.
        const acknowledged = await rpc('tb_finish_notification', {
          job_id: job.id, token: job.lease_token, provider_id: providerID, error_code: errorCode, retryable,
        });
        if (providerID && acknowledged) sent++; else deferred++;
      }
      return Response.json({ processed: jobs.length, sent, deferred });
    } catch {
      // Never log or return recipients, credentials, message contents or provider payloads.
      return Response.json({ error: 'notification_processing_failed' }, { status: 503 });
    }
  };
}
