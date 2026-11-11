/**
 * Cabeceras de seguridad compartidas por Vite (desarrollo y preview) y por el
 * servidor local de producción. Vercel replica esta política en `vercel.json`.
 *
 * Nota: `upgrade-insecure-requests` solo se añade en Vercel (HTTPS), porque en
 * local se sirve por HTTP y podría romper las peticiones al propio servidor.
 */

export const PROD_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'none'",
  "manifest-src 'self'",
].join('; ');

/**
 * En desarrollo Vite inyecta CSS y usa un WebSocket para HMR. El resto de
 * directivas se mantiene igual para detectar problemas antes de producción.
 */
export const DEV_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "media-src 'none'",
  "manifest-src 'self'",
].join('; ');

export const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'accelerometer=(), bluetooth=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), serial=(), usb=()',
});

/** Devuelve todas las cabeceras, usando la CSP indicada. */
export function securityHeaders(csp = PROD_CSP) {
  return {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': csp,
  };
}
