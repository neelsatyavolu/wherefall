import { socialGet, socialPost } from '../server/routes/social.js';
import { serve } from '../server/serve.js';

export async function GET(request: Request): Promise<Response> {
  return serve(request, socialGet);
}

export async function POST(request: Request): Promise<Response> {
  return serve(request, socialPost);
}
