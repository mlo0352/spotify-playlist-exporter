import { SPOTIFY } from "./constants.js";
import { randomString, sha256Base64Url, sleep } from "./utils.js";

/**
 * OAuth 2.0 Authorization Code with PKCE
 * - No client secret required (safe for public SPA)
 */
const KEY_VERIFIER = "spe_pkce_verifier_v1";
const KEY_STATE = "spe_oauth_state_v1";

export function buildAuthUrl({ clientId, redirectUri }){
  const state = randomString(32);
  const verifier = randomString(64);

  localStorage.setItem(KEY_STATE, state);
  localStorage.setItem(KEY_VERIFIER, verifier);

  return (async () => {
    const challenge = await sha256Base64Url(verifier);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
      scope: SPOTIFY.scopes.join(" "),
      show_dialog: "false",
    });
    return `${SPOTIFY.authUrl}?${params.toString()}`;
  })();
}

export function parseAuthCallback(){
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  return { code, state, error };
}

export function clearAuthParamsFromUrl(){
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  window.history.replaceState({}, document.title, url.toString());
}

export async function exchangeCodeForToken({ clientId, redirectUri, code }){
  const expectedState = localStorage.getItem(KEY_STATE);
  const verifier = localStorage.getItem(KEY_VERIFIER);
  if (!verifier) throw new Error("Missing PKCE verifier. Try logging in again.");

  // Spotify requires application/x-www-form-urlencoded
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  const resp = await fetch(SPOTIFY.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok){
    const t = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${t}`);
  }

  const token = await resp.json();
  // token: access_token, token_type, scope, expires_in, refresh_token
  const now = Date.now();
  return {
    ...token,
    obtained_at: now,
    expires_at: now + (token.expires_in * 1000),
  };
}

export async function refreshAccessToken({ clientId, refresh_token }){
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: clientId,
  });

  const resp = await fetch(SPOTIFY.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok){
    const t = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${t}`);
  }

  const data = await resp.json();
  const now = Date.now();
  return {
    ...data,
    refresh_token: data.refresh_token || refresh_token,
    obtained_at: now,
    expires_at: now + (data.expires_in * 1000),
  };
}

export async function ensureValidToken(cfg, token, onUpdate){
  if (!token) return null;
  if (Date.now() < (token.expires_at - 30_000)) return token;
  if (!token.refresh_token) return token;

  // small backoff if multiple tabs refresh at once
  await sleep(250);
  const refreshed = await refreshAccessToken({ clientId: cfg.clientId, refresh_token: token.refresh_token });
  onUpdate?.({ ...token, ...refreshed });
  return { ...token, ...refreshed };
}
