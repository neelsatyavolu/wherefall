import { mapsGet, mapsPost } from '../server/routes/maps.js';
import { serve } from '../server/serve.js';

export async function GET(request: Request): Promise<Response> {
  return serve(request, mapsGet);
}

export async function POST(request: Request): Promise<Response> {
  return serve(request, mapsPost);
}
