import type { CookieOptions } from "hono/utils/cookie";

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);

  return {
    httpOnly: true,
    path: "/",
    // The storefront and its API are same-origin. Lax still allows the
    // top-level GET redirect back from OAuth while withholding the session
    // cookie on cross-site POSTs, which prevents cross-site request forgery.
    sameSite: "Lax",
    secure: !localhost,
  };
}
