import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from '@paperback/types';

export const NHENTAI_URL = 'https://nhentai.net';
export const NHENTAI_API = `${NHENTAI_URL}/api/v2`;

const MAX_RATE_LIMIT_RETRIES = 3;

async function cloudflareError(): Promise<CloudflareError> {
  return new CloudflareError(
    {
      url: NHENTAI_URL,
      method: 'GET',
      headers: {
        'referer': `${NHENTAI_URL}/`,
        'user-agent': await Application.getDefaultUserAgent(),
      },
    },
    'CLOUDFLARE BYPASS ERROR:\nPlease press the cloud icon to complete the Cloudflare bypass.',
  );
}

export class NHentaiInterceptor extends PaperbackInterceptor {
  private userAgent?: string;

  override async interceptRequest(request: Request): Promise<Request> {
    this.userAgent ??= await Application.getDefaultUserAgent();
    return {
      ...request,
      headers: {
        ...request.headers,
        'referer': `${NHENTAI_URL}/`,
        'user-agent': this.userAgent,
      },
    };
  }

  override async interceptResponse(
    _request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if(response.headers?.['cf-mitigated'] === 'challenge') {
      throw await cloudflareError();
    }
    return data;
  }
}

interface ApiErrorBody {
  error?: unknown;
}

function throwApiError(status: number, json: ApiErrorBody | undefined): void {
  if(status === 429 || json?.error === 'Rate limit exceeded') {
    throw new Error('RATE LIMIT ERROR:\nnhentai API rate limit exceeded. Please wait about 1 minute and try again.');
  }
  if(status >= 400 || json?.error) {
    const message = typeof json?.error === 'string' ? json.error : `Request failed with status ${status}`;
    throw new Error(`NHENTAI API ERROR:\n${message}`);
  }
}

// Fetches and parses a JSON API response, retrying on rate limits.
// Returns undefined for a 404 when `allowNotFound` is set.
export async function fetchJSON<T>(url: string, allowNotFound: true): Promise<T | undefined>;
export async function fetchJSON<T>(url: string, allowNotFound?: false): Promise<T>;
export async function fetchJSON<T>(url: string, allowNotFound = false): Promise<T | undefined> {
  const request: Request = { url, method: 'GET' };
  let [response, buffer] = await Application.scheduleRequest(request);
  for(let i = 0; i < MAX_RATE_LIMIT_RETRIES && response.status === 429; i++) {
    await Application.sleep(1);
    [response, buffer] = await Application.scheduleRequest(request);
  }

  if(response.status === 403 || response.status === 503) {
    throw await cloudflareError();
  }
  if(allowNotFound && response.status === 404) { return undefined; }

  const text = Application.arrayBufferToUTF8String(buffer);
  let json: T & ApiErrorBody;
  try {
    json = JSON.parse(text) as T & ApiErrorBody;
  } catch {
    throwApiError(response.status, undefined);
    throw new Error('JSON PARSE ERROR!\n\nThe API returned an unexpected response. Please try again in a moment.');
  }
  throwApiError(response.status, json);
  return json;
}
