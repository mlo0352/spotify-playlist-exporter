import { SPOTIFY } from "./constants.js";
import { sleep } from "./utils.js";

class SpotifyApiError extends Error{
  constructor(message, info){
    super(message);
    this.name = "SpotifyApiError";
    this.info = info || {};
  }
}

function pickHeaders(headers){
  const out = {};
  const keys = ["retry-after", "content-type", "x-request-id", "date"];
  for (const k of keys){
    const v = headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}

function shouldRetry(status, bodyText){
  if (!status) return true;
  if (status === 429) return true;
  if (status >= 500) return true;
  if (status === 401) return true;
  if (status === 403){
    const t = String(bodyText || "").toLowerCase();
    // Permanent-ish 403s where retries won't help
    if (t.includes("insufficient client scope") || t.includes("insufficient_scope")) return false;
    if (t.includes("user not registered") || t.includes("not registered in the developer dashboard")) return false;
    return true;
  }
  return false;
}

function backoffMs(attempt){
  const base = 450 * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.random() * 120;
  return Math.min(5000, base + jitter);
}

async function apiFetch(path, token, { method="GET", params=null } = {}){
  let url = path.startsWith("http") ? path : `${SPOTIFY.apiBase}${path}`;
  if (params){
    const u = new URL(url);
    for (const [k,v] of Object.entries(params)) u.searchParams.set(k, v);
    url = u.toString();
  }

  const maxAttempts = 3;
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++){
    let resp;
    try{
      resp = await fetch(url, {
        method,
        headers: {
          "Authorization": `Bearer ${token.access_token}`,
          "Accept": "application/json",
        }
      });
    }catch(e){
      attempts.push({ attempt, status: null, error: String(e?.message || e) });
      if (attempt < maxAttempts){
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new SpotifyApiError("Spotify API network error", { url, method, attempts });
    }

    if (resp.status === 429){
      const retryAfter = Number(resp.headers.get("Retry-After") || "1");
      attempts.push({ attempt, status: 429, retry_after: retryAfter, headers: pickHeaders(resp.headers) });
      if (attempt < maxAttempts){
        await sleep((retryAfter + 0.25) * 1000);
        continue;
      }
    }

    if (!resp.ok){
      const bodyText = await resp.text();
      const entry = { attempt, status: resp.status, headers: pickHeaders(resp.headers), body: bodyText.slice(0, 4000) };
      attempts.push(entry);

      if (attempt < maxAttempts && shouldRetry(resp.status, bodyText)){
        await sleep(backoffMs(attempt));
        continue;
      }

      const msg = `Spotify API error ${resp.status} (${attempt}/${maxAttempts})`;
      throw new SpotifyApiError(msg, { url, method, status: resp.status, attempts });
    }

    try{
      return await resp.json();
    }catch(e){
      attempts.push({ attempt, status: resp.status, headers: pickHeaders(resp.headers), error: `json_parse: ${String(e?.message || e)}` });
      if (attempt < maxAttempts){
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new SpotifyApiError("Spotify API invalid JSON response", { url, method, status: resp.status, attempts });
    }
  }

  throw new SpotifyApiError("Spotify API: failed after retries", { url, method, attempts });
}

export async function getMe(token){
  return apiFetch("/me", token);
}

export async function getAllPlaylists(token){
  const out = [];
  let url = "/me/playlists";
  let offset = 0;
  const limit = 50;
  while (true){
    let page;
    try{
      page = await apiFetch(url, token, { params: { limit, offset }});
    }catch(e){
      e.partialItems = out;
      throw e;
    }
    out.push(...(page.items || []));
    if (!page.next) break;
    offset += limit;
  }
  return out;
}

export async function getAllPlaylistItems(token, playlistId){
  const out = [];
  let offset = 0;
  const limit = 100;
  while (true){
    // fields trims payload; keep added_at/added_by/is_local + core track metadata
    let page;
    try{
      page = await apiFetch(`/playlists/${encodeURIComponent(playlistId)}/tracks`, token, {
        params: {
          limit,
          offset,
          fields: [
            "items(added_at,added_by(id),is_local,track(id,uri,name,explicit,popularity,duration_ms,track_number,disc_number",
            "album(id,name,release_date,uri),artists(id,name,uri)))",
            "total,next"
          ].join("")
        }
      });
    }catch(e){
      e.partialItems = out;
      e.partialOffset = offset;
      throw e;
    }
    out.push(...(page.items || []));
    if (!page.next) break;
    offset += limit;
  }
  return out;
}

export async function getAllSavedTracks(token){
  const out = [];
  let offset = 0;
  const limit = 50;
  while (true){
    let page;
    try{
      page = await apiFetch("/me/tracks", token, {
        params: { limit, offset }
      });
    }catch(e){
      e.partialItems = out;
      e.partialOffset = offset;
      throw e;
    }
    out.push(...(page.items || []));
    if (!page.next) break;
    offset += limit;
  }
  return out;
}

// Optional: Audio features in batches (up to 100 ids)
export async function getAudioFeatures(token, ids){
  if (!ids.length) return [];
  const chunks = [];
  for (let i=0;i<ids.length;i+=100) chunks.push(ids.slice(i,i+100));
  const out = [];
  for (const c of chunks){
    let page;
    try{
      page = await apiFetch("/audio-features", token, {
        params: { ids: c.join(",") }
      });
    }catch(e){
      e.partialItems = out;
      e.partialChunkSize = c.length;
      throw e;
    }
    out.push(...(page.audio_features || []));
  }
  return out;
}

// Artist details in batches (up to 50 ids) - used for genres
export async function getArtists(token, ids){
  if (!ids.length) return [];
  const chunks = [];
  for (let i=0;i<ids.length;i+=50) chunks.push(ids.slice(i,i+50));
  const out = [];
  for (const c of chunks){
    let page;
    try{
      page = await apiFetch("/artists", token, { params: { ids: c.join(",") }});
    }catch(e){
      e.partialItems = out;
      e.partialChunkSize = c.length;
      throw e;
    }
    out.push(...(page.artists || []));
  }
  return out;
}
