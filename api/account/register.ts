import { register } from '../../server/routes/account.js';
import { serve } from '../../server/serve.js';

export async function POST(request: Request): Promise<Response> {
  return serve(request, register);
}
