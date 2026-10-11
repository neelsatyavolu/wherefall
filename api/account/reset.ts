import { reset } from '../../server/routes/reset.js';
import { serve } from '../../server/serve.js';

export async function POST(request: Request): Promise<Response> {
  return serve(request, reset);
}
