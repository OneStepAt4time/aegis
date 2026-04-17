export interface BaseUrlConfig {
  host: string;
  port: number;
  baseUrl?: string;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeHostname(hostname: string): string {
  if (hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]') {
    return '127.0.0.1';
  }
  return hostname;
}

export function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol || 'http:';
  url.hostname = normalizeHostname(url.hostname);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return trimTrailingSlash(url.toString());
}

export function deriveBaseUrl(host: string, port: number): string {
  const url = new URL('http://127.0.0.1');
  url.hostname = normalizeHostname(host);
  url.port = String(port);
  return trimTrailingSlash(url.toString());
}

export function getConfiguredBaseUrl(config: BaseUrlConfig): string {
  if (config.baseUrl) {
    return normalizeBaseUrl(config.baseUrl);
  }
  return deriveBaseUrl(config.host, config.port);
}

export function getDashboardUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/dashboard/`;
}
