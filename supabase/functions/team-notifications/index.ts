import { createHandler } from './worker.ts';

Deno.serve(createHandler({ env: name => Deno.env.get(name), fetch }));
