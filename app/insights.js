import { hashString } from "./utils.js";

function splitPipe(s){
  if (!s) return [];
  return String(s).split("|").map(x => x.trim()).filter(Boolean);
}

function occurrenceFromPlaylistItem(pl, item){
  const t = item?.track || null;
  if (!t) return null;
  return {
    source_type: "playlist",
    playlist_id: pl.id,
    playlist_name: pl.name,
    playlist_owner: pl.owner?.display_name || pl.owner?.id || "",
    playlist_public: !!pl.public,
    playlist_collaborative: !!pl.collaborative,
    playlist_snapshot_id: pl.snapshot_id || null,
    added_at: item.added_at || null,
    added_by: item.added_by?.id || null,
    is_local: !!item.is_local,
    track_id: t.id || null,
    track_uri: t.uri || null,
    track_name: t.name || null,
    explicit: (typeof t.explicit === "boolean") ? t.explicit : null,
    popularity: (typeof t.popularity === "number") ? t.popularity : null,
    duration_ms: (typeof t.duration_ms === "number") ? t.duration_ms : null,
    album_id: t.album?.id || null,
    album_name: t.album?.name || null,
    album_release_date: t.album?.release_date || null,
    album_uri: t.album?.uri || null,
    artist_ids: (t.artists || []).map(a => a.id).filter(Boolean),
    artist_names: (t.artists || []).map(a => a.name).filter(Boolean),
    artist_uris: (t.artists || []).map(a => a.uri).filter(Boolean),
  };
}

function occurrenceFromLikedItem(item){
  const t = item?.track || null;
  if (!t) return null;
  return {
    source_type: "liked",
    playlist_id: "liked_songs",
    playlist_name: "Liked Songs",
    playlist_owner: "",
    playlist_public: false,
    playlist_collaborative: false,
    playlist_snapshot_id: null,
    added_at: item.added_at || null,
    added_by: null,
    is_local: false,
    track_id: t.id || null,
    track_uri: t.uri || null,
    track_name: t.name || null,
    explicit: (typeof t.explicit === "boolean") ? t.explicit : null,
    popularity: (typeof t.popularity === "number") ? t.popularity : null,
    duration_ms: (typeof t.duration_ms === "number") ? t.duration_ms : null,
    album_id: t.album?.id || null,
    album_name: t.album?.name || null,
    album_release_date: t.album?.release_date || null,
    album_uri: t.album?.uri || null,
    artist_ids: (t.artists || []).map(a => a.id).filter(Boolean),
    artist_names: (t.artists || []).map(a => a.name).filter(Boolean),
    artist_uris: (t.artists || []).map(a => a.uri).filter(Boolean),
  };
}

export function buildTrackOccurrences({ playlists, playlistItemsById, likedItems, includeLiked }){
  const out = [];
  for (const pl of playlists){
    const items = playlistItemsById.get(pl.id) || [];
    for (const it of items){
      const occ = occurrenceFromPlaylistItem(pl, it);
      if (occ) out.push(occ);
    }
  }
  if (includeLiked){
    for (const it of likedItems){
      const occ = occurrenceFromLikedItem(it);
      if (occ) out.push(occ);
    }
  }
  return out;
}

function artistKeyOf({ id, name }){
  if (id) return `id:${id}`;
  return `name:${name || "Unknown"}`;
}

function trackKeyOf(occ){
  const base = occ.track_id || occ.track_uri || `${occ.track_name || "Unknown"}::${occ.album_name || ""}`;
  return `${base}::${hashString(`${occ.track_name || ""}|${occ.artist_names.join("|")}|${occ.album_name || ""}`)}`;
}

export function buildArtistIndex(occurrences){
  const byKey = new Map();
  for (const occ of occurrences){
    const ids = occ.artist_ids || [];
    const names = occ.artist_names || [];
    const n = Math.max(ids.length, names.length);
    for (let i = 0; i < n; i++){
      const id = ids[i] || null;
      const name = names[i] || "Unknown";
      const key = artistKeyOf({ id, name });
      if (!byKey.has(key)){
        byKey.set(key, {
          key,
          id,
          name,
          count: 0,
          playlists: new Map(), // playlist_id -> {playlist_id, playlist_name, count}
          tracks: new Map(), // track_key -> {track_id, track_name, album_name, count, playlists: Map}
        });
      }
      const entry = byKey.get(key);
      entry.count++;

      const plKey = occ.playlist_id;
      if (!entry.playlists.has(plKey)){
        entry.playlists.set(plKey, { playlist_id: occ.playlist_id, playlist_name: occ.playlist_name, count: 0 });
      }
      entry.playlists.get(plKey).count++;

      const tk = trackKeyOf(occ);
      if (!entry.tracks.has(tk)){
        entry.tracks.set(tk, {
          track_key: tk,
          track_id: occ.track_id || null,
          track_uri: occ.track_uri || null,
          track_name: occ.track_name || "Unknown",
          album_name: occ.album_name || "",
          artist_names: occ.artist_names.join("|"),
          count: 0,
          playlists: new Map(), // playlist_id -> count
        });
      }
      const tr = entry.tracks.get(tk);
      tr.count++;
      tr.playlists.set(plKey, (tr.playlists.get(plKey) || 0) + 1);
    }
  }
  return byKey;
}

export function getArtistDetail(byArtistKey, key){
  const entry = byArtistKey.get(key);
  if (!entry) return null;

  const playlists = Array.from(entry.playlists.values()).sort((a,b) => b.count - a.count);
  const tracks = Array.from(entry.tracks.values()).sort((a,b) => b.count - a.count);
  return {
    key: entry.key,
    id: entry.id,
    name: entry.name,
    count: entry.count,
    playlists,
    tracks,
  };
}

function keyForOcc(occ, dedupeRule){
  if (dedupeRule === "track_uri") return occ.track_uri || occ.track_id || null;
  return occ.track_id || occ.track_uri || null;
}

export function buildPlaylistKeySets(occurrences, { dedupeRule = "track_id" } = {}){
  const setsByPlaylistId = new Map(); // playlist_id -> Set(key)
  const trackMetaByKey = new Map(); // key -> {track_name, artist_names, album_name}

  for (const occ of occurrences){
    const key = keyForOcc(occ, dedupeRule);
    if (!key) continue;
    if (!setsByPlaylistId.has(occ.playlist_id)) setsByPlaylistId.set(occ.playlist_id, new Set());
    setsByPlaylistId.get(occ.playlist_id).add(key);

    if (!trackMetaByKey.has(key)){
      trackMetaByKey.set(key, {
        track_name: occ.track_name || "Unknown",
        artist_names: (occ.artist_names || []).join("|"),
        album_name: occ.album_name || "",
      });
    }
  }

  return { setsByPlaylistId, trackMetaByKey };
}

function intersectionCount(a, b){
  if (!a || !b) return 0;
  let small = a, big = b;
  if (b.size < a.size){ small = b; big = a; }
  let c = 0;
  for (const k of small) if (big.has(k)) c++;
  return c;
}

export function computeOverlapMatrix(playlistIds, setsByPlaylistId){
  const n = playlistIds.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  let max = 0;
  for (let i=0;i<n;i++){
    const a = setsByPlaylistId.get(playlistIds[i]) || new Set();
    for (let j=i;j<n;j++){
      const b = setsByPlaylistId.get(playlistIds[j]) || new Set();
      const c = (i === j) ? a.size : intersectionCount(a, b);
      matrix[i][j] = c;
      matrix[j][i] = c;
      if (i !== j) max = Math.max(max, c);
    }
  }
  return { matrix, max };
}

export function computeOverlapKeys(aPlaylistId, bPlaylistId, setsByPlaylistId){
  const a = setsByPlaylistId.get(aPlaylistId) || new Set();
  const b = setsByPlaylistId.get(bPlaylistId) || new Set();
  let small = a, big = b;
  if (b.size < a.size){ small = b; big = a; }
  const out = [];
  for (const k of small) if (big.has(k)) out.push(k);
  return out;
}

export function findExactDuplicateGroups(occurrences, { dedupeRule = "track_id", minPlaylists = 2 } = {}){
  const groups = new Map(); // key -> group
  for (const occ of occurrences){
    const k = keyForOcc(occ, dedupeRule);
    if (!k) continue;
    if (!groups.has(k)){
      groups.set(k, {
        key: k,
        track_name: occ.track_name || "Unknown",
        artist_names: (occ.artist_names || []).join("|"),
        album_name: occ.album_name || "",
        occurrences: 0,
        playlistIds: new Set(),
      });
    }
    const g = groups.get(k);
    g.occurrences++;
    g.playlistIds.add(occ.playlist_id);
  }

  return Array.from(groups.values())
    .filter(g => g.playlistIds.size >= minPlaylists)
    .sort((a,b) => (b.playlistIds.size - a.playlistIds.size) || (b.occurrences - a.occurrences) || a.track_name.localeCompare(b.track_name))
    .map(g => ({ ...g, playlistIds: Array.from(g.playlistIds) }));
}

function normalizeText(s){
  return String(s || "")
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeTrackName(name){
  let s = String(name || "").toLowerCase();
  s = s.replace(/’/g, "'");
  // strip common "version" suffixes (but keep core title)
  s = s.replace(/\s*-\s*(radio edit|edit|mix|remaster(ed)?(\s*\d{4})?|live|acoustic|mono|stereo|instrumental|demo|deluxe|bonus track|version|feat\.?.*)\s*$/i, "");
  // remove parenthetical/bracketed version tags
  s = s.replace(/\(([^)]*)\)/g, (m, inner) => {
    return /remaster|live|acoustic|edit|mix|mono|stereo|demo|version|deluxe|bonus|feat/i.test(inner) ? "" : m;
  });
  s = s.replace(/\[([^\]]*)\]/g, (m, inner) => {
    return /remaster|live|acoustic|edit|mix|mono|stereo|demo|version|deluxe|bonus|feat/i.test(inner) ? "" : m;
  });
  s = normalizeText(s);
  return s;
}

export function findNearDuplicateGroups(occurrences, { minVariants = 2 } = {}){
  const groups = new Map(); // canonicalKey -> group

  for (const occ of occurrences){
    const title = occ.track_name || "";
    if (!title) continue;
    const canon = canonicalizeTrackName(title);
    if (!canon) continue;

    const artistId = occ.artist_ids?.[0] || null;
    const artistName = occ.artist_names?.[0] || "Unknown";
    const aKey = artistId ? `id:${artistId}` : `name:${artistName}`;

    const groupKey = `${aKey}::${canon}`;
    if (!groups.has(groupKey)){
      groups.set(groupKey, {
        groupKey,
        artist: artistName,
        canonical: canon,
        variants: new Map(), // key -> variant
      });
    }

    const vKey = occ.track_id || occ.track_uri || `${occ.track_name}::${occ.album_name || ""}`;
    const g = groups.get(groupKey);
    if (!g.variants.has(vKey)){
      g.variants.set(vKey, {
        variant_key: vKey,
        track_name: occ.track_name || "Unknown",
        album_name: occ.album_name || "",
        occurrences: 0,
        playlistIds: new Set(),
      });
    }
    const v = g.variants.get(vKey);
    v.occurrences++;
    v.playlistIds.add(occ.playlist_id);
  }

  const out = [];
  for (const g of groups.values()){
    if (g.variants.size < minVariants) continue;
    const vars = Array.from(g.variants.values()).map(v => ({ ...v, playlistIds: Array.from(v.playlistIds) }));
    // Heuristic: keep only if variants appear in at least 2 playlists total
    const allPls = new Set();
    for (const v of vars) for (const pid of v.playlistIds) allPls.add(pid);
    if (allPls.size < 2) continue;
    out.push({
      groupKey: g.groupKey,
      artist: g.artist,
      canonical: g.canonical,
      playlistCount: allPls.size,
      variantCount: vars.length,
      variants: vars.sort((a,b) => (b.playlistIds.length - a.playlistIds.length) || (b.occurrences - a.occurrences)),
    });
  }

  return out.sort((a,b) => (b.variantCount - a.variantCount) || (b.playlistCount - a.playlistCount) || a.canonical.localeCompare(b.canonical));
}
