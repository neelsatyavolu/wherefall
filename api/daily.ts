import { daily, dailyPost } from '../server/routes/daily.js';
import { serve } from '../server/serve.js';

export async function GET(request: Request): Promise<Response> {
  return serve(request, daily);
}

export async function POST(request: Request): Promise<Response> {
  return serve(request, dailyPost);
}
