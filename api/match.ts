import { matchGet, matchPost } from '../server/routes/match.js';
import { serve } from '../server/serve.js';

export async function GET(request: Request): Promise<Response> {
  return serve(request, matchGet);
}

export async function POST(request: Request): Promise<Response> {
  return serve(request, matchPost);
}
