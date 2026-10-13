import { createHandler } from './worker.ts';
import { sendGmail } from './gmail.ts';

Deno.serve(createHandler({ env: name => Deno.env.get(name), fetch, gmailSend: sendGmail }));
