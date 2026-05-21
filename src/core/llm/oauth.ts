/* ==========================================================
   oauth.ts — OAuth 2.0 PKCE flow cho Claude Pro/Max
   Lưu access_token + refresh_token vào localStorage, auto-refresh.

   Flow:
     1. startLogin() → generate code_verifier + code_challenge, redirect tới
        authorize URL.
     2. /oauth/callback nhận ?code= → handleCallback(code) → POST exchange
        token → lưu vào localStorage.
     3. getAccessToken() → return token hiện tại, tự refresh nếu sắp hết hạn.
   ========================================================== */

// Client ID của Claude Code app (đã được Anthropic đăng ký). User có thể
// override qua localStorage 'claude-oauth-client-id' nếu họ tự đăng ký app.
const DEFAULT_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const SCOPES = "org:create_api_key user:profile user:inference";
const STORAGE_KEY = "claude-oauth-tokens";
const VERIFIER_KEY = "claude-oauth-verifier";

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  token_type?: string;
}

// ---- PKCE helpers ----
function randomString(len = 64): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
}
async function sha256base64url(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return base64url(new Uint8Array(hash));
}
function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getClientId(): string {
  return localStorage.getItem("claude-oauth-client-id") || DEFAULT_CLIENT_ID;
}
function getRedirectUri(): string {
  return window.location.origin + "/oauth/callback";
}

// ---- Storage ----
export function getTokens(): OAuthTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as OAuthTokens : null;
  } catch { return null; }
}
function setTokens(t: OAuthTokens | null) {
  if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  else localStorage.removeItem(STORAGE_KEY);
}

export function isLoggedIn(): boolean {
  const t = getTokens();
  return !!(t && t.access_token);
}
export function logout() {
  setTokens(null);
}

// ---- Start login (generate PKCE + redirect) ----
export async function startLogin() {
  const verifier = randomString(96);
  const challenge = await sha256base64url(verifier);
  const state = randomString(32);
  sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: SCOPES,
    redirect_uri: getRedirectUri(),
  });
  window.location.href = `${AUTHORIZE_URL}?${params.toString()}`;
}

// ---- Handle callback ----
export async function handleCallback(code: string, returnedState: string): Promise<void> {
  const raw = sessionStorage.getItem(VERIFIER_KEY);
  if (!raw) throw new Error("Thiếu PKCE verifier (session expired)");
  const { verifier, state } = JSON.parse(raw) as { verifier: string; state: string };
  if (state !== returnedState) throw new Error("State mismatch (CSRF check failed)");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: getClientId(),
      redirect_uri: getRedirectUri(),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${t}`);
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number; token_type?: string };
  setTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000, // -60s safety
    token_type: data.token_type,
  });
  sessionStorage.removeItem(VERIFIER_KEY);
}

// ---- Refresh ----
async function refresh(): Promise<OAuthTokens> {
  const cur = getTokens();
  if (!cur?.refresh_token) throw new Error("Chưa đăng nhập");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: cur.refresh_token,
      client_id: getClientId(),
    }),
  });
  if (!res.ok) {
    setTokens(null);
    throw new Error(`Refresh failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  const next: OAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? cur.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  setTokens(next);
  return next;
}

// ---- Get fresh access token ----
export async function getAccessToken(): Promise<string> {
  let t = getTokens();
  if (!t) throw new Error("Chưa đăng nhập Claude Pro/Max");
  if (Date.now() >= t.expires_at) t = await refresh();
  return t.access_token;
}
