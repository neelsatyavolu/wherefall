/** A stand-in `fetch` for the unit tests of the API clients. Not used by the game. */

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers every call with one canned reply and remembers what it was asked. */
export function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return reply();
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}

export const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status });
export const success = (data: unknown, status = 200) => json({ success: true, data }, status);
export const failure = (error: string, status: number) => json({ success: false, error }, status);

/** What a call posted, read back from its JSON body. */
export const bodyOf = (call: FetchCall | undefined): unknown => JSON.parse(String(call?.init?.body));

export const UNREACHABLE = 'Could not reach the server. Check your connection and try again.';
export const UNEXPECTED = 'The server sent a reply this page could not read. Try again in a moment.';
