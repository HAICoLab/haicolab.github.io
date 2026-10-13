// @deno-types="npm:@types/nodemailer@8.0.2"
import nodemailer from 'npm:nodemailer@10.1.0';
import type { Delivery, Mail } from './worker.ts';

export function smtpFailure(error: unknown): Delivery {
  const e = error as { responseCode?: number; code?: string; command?: string; timeoutType?: string } | null;
  const code = e?.responseCode;
  // An explicit SMTP rejection means Google did not accept the message.
  if (typeof code === 'number' && code >= 400 && code < 600) {
    return { providerID: null, errorCode: `smtp_${code}`, retryable: code < 500 };
  }
  const beforeMessage = e?.code === 'EDNS' || e?.command?.startsWith('AUTH') || e?.code === 'ETLS' ||
    ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT'].includes(e?.timeoutType || '');
  if (beforeMessage) return { providerID: null, errorCode: 'smtp_connection_failed', retryable: true };
  // A dropped connection after DATA may have delivered successfully. SMTP's
  // Message-ID is useful for investigation but does NOT guarantee deduplication.
  return { providerID: null, errorCode: 'smtp_delivery_unconfirmed', retryable: false };
}

export async function sendGmail(mail: Mail, id: string, user: string, password: string): Promise<Delivery> {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: password },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  const messageId = `<eng3510-notification.${id}@gmail.com>`;
  try {
    const result = await transport.sendMail({ ...mail, messageId, headers: { 'Auto-Submitted': 'auto-generated' } });
    if (!result.accepted?.length) return { providerID: null, errorCode: 'smtp_recipient_rejected', retryable: false };
    return { providerID: messageId, errorCode: null, retryable: false };
  } catch (error) { return smtpFailure(error); }
  finally { transport.close(); }
}
