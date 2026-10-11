import { account, accountPost } from '../../server/routes/account.js';
import { serve } from '../../server/serve.js';

export async function GET(request: Request): Promise<Response> {
  return serve(request, account);
}

export async function POST(request: Request): Promise<Response> {
  return serve(request, accountPost);
}
