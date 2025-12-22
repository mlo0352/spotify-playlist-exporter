import { fmtDate } from "./utils.js";

/**
 * Build metrics + fun insights from a normalized library shape.
 * library = {
 *   me,
 *   playlists: [{...}],
 *   playlistItems: Map(playlistId -> items[]),
 *   likedItems: items[] (from /me/tracks)
 * }
 */
export function normalizeTrackFromPlaylistItem(item){
  const t = item?.track || null;
  if (!t) return null;
  return {
    source_type: "playlist",
    added_at: item.added_at || null,
    added_by: item.added_by?.id || null,
    is_local: !!item.is_local,
    track_id: t.id || null,
    track_uri: t.uri || null,
    track_name: t.name || null,
    explicit: !!t.explicit,
    popularity: (typeof t.popularity === "number") ? t.popularity : null,
    duration_ms: (typeof t.duration_ms === "number") ? t.duration_ms : null,
    track_number: t.track_number ?? null,
    disc_number: t.disc_number ?? null,
    album_id: t.album?.id || null,
    album_name: t.album?.name || null,
    album_release_date: t.album?.release_date || null,
    album_uri: t.album?.uri || null,
    artist_ids: (t.artists || []).map(a => a.id).filter(Boolean).join("|"),
    artist_names: (t.artists || []).map(a => a.name).filter(Boolean).join("|"),
    artist_uris: (t.artists || []).map(a => a.uri).filter(Boolean).join("|"),
  };
}

export function normalizeTrackFromLikedItem(item){
  const t = item?.track || null;
  if (!t) return null;
  return {
    source_type: "liked",
    added_at: item.added_at || null,
    added_by: null,
    is_local: false,
    track_id: t.id || null,
    track_uri: t.uri || null,
    track_name: t.name || null,
    explicit: !!t.explicit,
    popularity: (typeof t.popularity === "number") ? t.popularity : null,
    duration_ms: (typeof t.duration_ms === "number") ? t.duration_ms : null,
    track_number: t.track_number ?? null,
    disc_number: t.disc_number ?? null,
    album_id: t.album?.id || null,
    album_name: t.album?.name || null,
    album_release_date: t.album?.release_date || null,
    album_uri: t.album?.uri || null,
    artist_ids: (t.artists || []).map(a => a.id).filter(Boolean).join("|"),
    artist_names: (t.artists || []).map(a => a.name).filter(Boolean).join("|"),
    artist_uris: (t.artists || []).map(a => a.uri).filter(Boolean).join("|"),
  };
}

export function computeMetrics({ playlists, playlistTracksById, likedTracks, dedupeRule }){
  const metrics = {
    generated_at: new Date().toISOString(),
    playlist_count: playlists.length,
    playlists_public_count: 0,
    playlists_private_count: 0,
    playlists_collaborative_count: 0,
    playlists: [],
    liked_count: likedTracks.length,
    total_tracks: 0,
    unique_tracks: 0,
    unique_by: dedupeRule,
    unavailable_tracks: 0,
    duplicates_across_sources: 0,
    local_track_count: 0,
    explicit_count: 0,
    explicit_known: 0,
    explicit_ratio: null,
    total_duration_ms: 0,
    duration_known: 0,
    avg_duration_ms: null,
    popularity_known: 0,
    avg_popularity: null,
    unique_artist_count: 0,
    unique_album_count: 0,
    decade_distribution: [], // [{decade, count}]
    first_added_at: null,
    last_added_at: null,
    top_artists: [],
    top_albums: [],
    added_timeline: [], // {date, count}
    vibe: null,
  };

  const seen = new Set();
  const artistCounts = new Map(); // key -> {id,name,count}
  const albumCounts = new Map(); // key -> {id,name,count}
  const timelineCounts = new Map(); // date->count
  const decadeCounts = new Map(); // decade -> count
  const artistUniq = new Set(); // key
  const albumUniq = new Set(); // key
  let popularitySum = 0;
  let durationSum = 0;

  function keyOf(t){
    if (dedupeRule === "track_uri") return t.track_uri || t.track_id || t.track_name || Math.random().toString(16);
    return t.track_id || t.track_uri || t.track_name || Math.random().toString(16);
  }

  function addTrack(t){
    metrics.total_tracks++;
    if (t.is_local) metrics.local_track_count++;

    if (typeof t.explicit === "boolean"){
      metrics.explicit_known++;
      if (t.explicit) metrics.explicit_count++;
    }
    if (typeof t.duration_ms === "number"){
      metrics.duration_known++;
      durationSum += t.duration_ms;
      metrics.total_duration_ms += t.duration_ms;
    }
    if (typeof t.popularity === "number"){
      metrics.popularity_known++;
      popularitySum += t.popularity;
    }

    if (t.album_id || t.album_name){
      const key = t.album_id ? `id:${t.album_id}` : `name:${t.album_name}`;
      albumUniq.add(key);
    }
    if (t.album_release_date){
      const year = parseYear(t.album_release_date);
      if (year){
        const decade = Math.floor(year / 10) * 10;
        decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
      }
    }

    if (t.added_at){
      if (!metrics.first_added_at || t.added_at < metrics.first_added_at) metrics.first_added_at = t.added_at;
      if (!metrics.last_added_at || t.added_at > metrics.last_added_at) metrics.last_added_at = t.added_at;
    }

    const key = keyOf(t);
    const existed = seen.has(key);
    if (!existed) seen.add(key);
    else metrics.duplicates_across_sources++;

    if (t.artist_names){
      const names = t.artist_names.split("|").filter(Boolean);
      const ids = (t.artist_ids || "").split("|");
      for (let i = 0; i < names.length; i++){
        const name = names[i];
        const id = ids[i] || null;
        const akey = id ? `id:${id}` : `name:${name}`;
        artistUniq.add(akey);
        const prev = artistCounts.get(akey) || { id, name, count: 0 };
        prev.count++;
        artistCounts.set(akey, prev);
      }
    }
    if (t.album_name || t.album_id){
      const id = t.album_id || null;
      const name = t.album_name || "Unknown Album";
      const akey = id ? `id:${id}` : `name:${name}`;
      const prev = albumCounts.get(akey) || { id, name, count: 0 };
      prev.count++;
      albumCounts.set(akey, prev);
    }
    if (t.added_at){
      const d = fmtDate(t.added_at);
      timelineCounts.set(d, (timelineCounts.get(d) || 0) + 1);
    }
  }

  // playlists
  for (const pl of playlists){
    if (pl.public) metrics.playlists_public_count++;
    else metrics.playlists_private_count++;
    if (pl.collaborative) metrics.playlists_collaborative_count++;

    const items = playlistTracksById.get(pl.id) || [];
    metrics.playlists.push({
      id: pl.id,
      name: pl.name,
      owner: pl.owner?.display_name || pl.owner?.id || "",
      track_count: items.length,
      tracks_total_field: pl.tracks?.total ?? null,
      public: pl.public,
      collaborative: pl.collaborative,
      snapshot_id: pl.snapshot_id || null,
    });
    for (const it of items){
      const t = normalizeTrackFromPlaylistItem(it);
      if (!t){ metrics.unavailable_tracks++; continue; }
      addTrack(t);
    }
  }

  // liked
  for (const it of likedTracks){
    const t = normalizeTrackFromLikedItem(it);
    if (!t){ metrics.unavailable_tracks++; continue; }
    addTrack(t);
  }

  metrics.unique_tracks = seen.size;

  metrics.unique_artist_count = artistUniq.size;
  metrics.unique_album_count = albumUniq.size;

  metrics.explicit_ratio = metrics.explicit_known ? (metrics.explicit_count / metrics.explicit_known) : null;
  metrics.avg_duration_ms = metrics.duration_known ? (durationSum / metrics.duration_known) : null;
  metrics.avg_popularity = metrics.popularity_known ? (popularitySum / metrics.popularity_known) : null;
  metrics.decade_distribution = Array.from(decadeCounts.entries())
    .sort((a,b) => a[0] - b[0])
    .map(([decade, count]) => ({ decade, count }));

  metrics.top_artists = topNObjects(artistCounts, 12);
  metrics.top_albums = topNObjects(albumCounts, 12);
  metrics.added_timeline = Array.from(timelineCounts.entries())
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([date,count]) => ({ date, count }));

  metrics.vibe = inferVibe(metrics);

  return metrics;
}

function topNObjects(map, n){
  return Array.from(map.values())
    .sort((a,b) => b.count - a.count)
    .slice(0,n)
    .map(({ id, name, count }) => ({ id: id || null, name, count }));
}

function parseYear(releaseDate){
  const m = String(releaseDate || "").match(/^(\d{4})/);
  if (!m) return null;
  const year = Number(m[1]);
  if (!Number.isFinite(year) || year < 1000 || year > 3000) return null;
  return year;
}

function inferVibe(metrics){
  // playful heuristic vibe label
  const total = metrics.total_tracks || 1;
  const uniqRatio = metrics.unique_tracks / total;
  const artistTop = metrics.top_artists?.[0]?.count || 0;
  const focused = artistTop / total;

  if (uniqRatio > 0.92) return "Explorer mode: lots of variety, minimal repeats 🌈";
  if (focused > 0.08) return "Deep dive: you have a few core artists on heavy rotation 🔁";
  if (total > 5000) return "Library dragon: massive hoard of tracks 🐉";
  return "Balanced vibe: a bit of everything with healthy repeats ✨";
}
