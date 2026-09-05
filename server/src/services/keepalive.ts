/**
 * Render Self-Keepalive Service
 * 
 * Free tier containers on Render spin down after 15 minutes of inactivity.
 * This service sends a periodic lightweight GET request to `/api/ping` every
 * 9 minutes to keep the container warm and eliminate cold-start latency for
 * neighbor projects.
 */

let timer: NodeJS.Timeout | null = null;

export function startKeepAlive() {
  const targetUrl =
    process.env.KEEPALIVE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RENDER === 'true' ? 'https://my-freellmapi-proxy.onrender.com' : null);

  if (!targetUrl) {
    // In local development without explicit KEEPALIVE_URL, do not run keepalive.
    return;
  }

  const pingUrl = targetUrl.endsWith('/api/ping')
    ? targetUrl
    : `${targetUrl.replace(/\/+$/, '')}/api/ping`;

  console.log(`[KeepAlive] Service active. Periodic ping target: ${pingUrl}`);

  // Base interval: 9 minutes (540s) + up to 30s jitter
  const scheduleNext = () => {
    const intervalMs = 9 * 60 * 1000 + Math.floor(Math.random() * 30000);
    timer = setTimeout(async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(pingUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'FreeLLMAPI-KeepAlive/1.0' },
        });
        clearTimeout(timeout);
        if (res.ok) {
          console.log(`[KeepAlive] Keep-alive ping successful (${res.status}) at ${new Date().toISOString()}`);
        } else {
          console.warn(`[KeepAlive] Keep-alive ping returned ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[KeepAlive] Keep-alive ping error: ${err.message}`);
      } finally {
        scheduleNext();
      }
    }, intervalMs);
  };

  scheduleNext();
}

export function stopKeepAlive() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    console.log('[KeepAlive] Service stopped.');
  }
}
