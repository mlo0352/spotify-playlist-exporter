import { SPOTIFY } from "./constants.js";
import { sleep } from "./utils.js";

async function apiFetch(path, token, { method="GET", params=null } = {}){
  let url = path.startsWith("http") ? path : `${SPOTIFY.apiBase}${path}`;
  if (params){
    const u = new URL(url);
    for (const [k,v] of Object.entries(params)) u.searchParams.set(k, v);
    url = u.toString();
  }

  // Rate limit handling (429)
  for (let attempt = 0; attempt < 6; attempt++){
    const resp = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
        "Accept": "application/json",
      }
    });

    if (resp.status === 429){
      const retryAfter = Number(resp.headers.get("Retry-After") || "1");
      await sleep((retryAfter + 0.25) * 1000);
      continue;
    }

    if (!resp.ok){
      const t = await resp.text();
      throw new Error(`Spotify API error ${resp.status}: ${t}`);
    }

    return resp.json();
  }
  throw new Error("Spotify API: too many rate-limits / retries.");
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
    const page = await apiFetch(url, token, { params: { limit, offset }});
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
    const page = await apiFetch(`/playlists/${encodeURIComponent(playlistId)}/tracks`, token, {
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
    const page = await apiFetch("/me/tracks", token, {
      params: { limit, offset }
    });
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
    const page = await apiFetch("/audio-features", token, {
      params: { ids: c.join(",") }
    });
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
    const page = await apiFetch("/artists", token, { params: { ids: c.join(",") }});
    out.push(...(page.artists || []));
  }
  return out;
}
