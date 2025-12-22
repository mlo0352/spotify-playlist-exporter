import { safeFilename, toCsv } from "./utils.js";

/**
 * Creates a folder structure + files inside a JSZip instance.
 * Requires global JSZip (loaded from CDN).
 */
export async function buildZipExport({
  cfg,
  me,
  playlists,
  playlistItemsById,
  likedItems,
  metrics,
  includeLiked,
  includeAlbumExports,
  audioFeaturesByTrackId, // Map
}){
  if (!window.JSZip) throw new Error("JSZip not found. Check CDN load.");
  const zip = new window.JSZip();

  const stamp = new Date().toISOString().slice(0,10);
  const root = `${safeFilename(cfg.exportPrefix || "spotify-export")}-${stamp}`;

  // meta
  const meta = zip.folder(`${root}/meta`);
  meta.file("me.json", JSON.stringify(me, null, 2));
  meta.file("playlists.json", JSON.stringify(playlists, null, 2));
  meta.file("metrics.json", JSON.stringify(metrics, null, 2));

  // playlists
  const plFolder = zip.folder(`${root}/playlists`);
  for (const pl of playlists){
    const items = playlistItemsById.get(pl.id) || [];
    const rows = items.map(it => playlistItemRow(pl, it, audioFeaturesByTrackId));
    const jsonRows = rows;

    const base = `${safeFilename(pl.name)}__${pl.id}`;
    plFolder.file(`${base}.json`, JSON.stringify(jsonRows, null, 2));
    plFolder.file(`${base}.csv`, toCsv(jsonRows));
  }

  // liked songs
  if (includeLiked){
    const likedFolder = zip.folder(`${root}/liked_songs`);
    const rows = likedItems.map(it => likedItemRow(it, audioFeaturesByTrackId));
    likedFolder.file("liked_songs.json", JSON.stringify(rows, null, 2));
    likedFolder.file("liked_songs.csv", toCsv(rows));
  }

  // albums view (optional)
  if (includeAlbumExports){
    const albumsFolder = zip.folder(`${root}/albums`);
    const albumMap = new Map(); // key -> {album_id, album_name, ... rows}
    const push = (row) => {
      const aid = row.album_id || "unknown";
      const an = row.album_name || "Unknown Album";
      const key = `${aid}::${an}`;
      if (!albumMap.has(key)){
        albumMap.set(key, { album_id: aid, album_name: an, album_release_date: row.album_release_date || null, rows: [] });
      }
      albumMap.get(key).rows.push(row);
    };

    for (const pl of playlists){
      const items = playlistItemsById.get(pl.id) || [];
      for (const it of items) push(playlistItemRow(pl, it, audioFeaturesByTrackId));
    }
    if (includeLiked){
      for (const it of likedItems) push(likedItemRow(it, audioFeaturesByTrackId));
    }

    for (const v of albumMap.values()){
      const base = `${safeFilename(v.album_name)}__${v.album_id}`;
      albumsFolder.file(`${base}.json`, JSON.stringify(v.rows, null, 2));
      albumsFolder.file(`${base}.csv`, toCsv(v.rows));
    }
  }

  // fun report HTML
  zip.file(`${root}/report.html`, buildReportHtml(cfg, me, metrics));

  return { zip, root };
}

function coreTrackFields(t){
  if (!t) return {
    track_id: null, track_uri: null, track_name: null,
    explicit: null, popularity: null, duration_ms: null,
    track_number: null, disc_number: null,
    album_id: null, album_name: null, album_release_date: null, album_uri: null,
    artist_ids: "", artist_names: "", artist_uris: ""
  };

  return {
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

function audioFeatureFields(track_id, audioFeaturesByTrackId){
  if (!track_id || !audioFeaturesByTrackId) return {};
  const f = audioFeaturesByTrackId.get(track_id);
  if (!f) return {};
  return {
    af_danceability: f.danceability,
    af_energy: f.energy,
    af_valence: f.valence,
    af_tempo: f.tempo,
    af_loudness: f.loudness,
    af_speechiness: f.speechiness,
    af_acousticness: f.acousticness,
    af_instrumentalness: f.instrumentalness,
    af_liveness: f.liveness,
    af_time_signature: f.time_signature,
    af_key: f.key,
    af_mode: f.mode,
  };
}

function playlistItemRow(pl, item, audioFeaturesByTrackId){
  const t = item?.track || null;
  const core = coreTrackFields(t);
  return {
    source: "playlist",
    playlist_id: pl.id,
    playlist_name: pl.name,
    playlist_owner: pl.owner?.display_name || pl.owner?.id || "",
    playlist_public: !!pl.public,
    playlist_collaborative: !!pl.collaborative,
    playlist_snapshot_id: pl.snapshot_id || null,
    added_at: item?.added_at || null,
    added_by: item?.added_by?.id || null,
    is_local: !!item?.is_local,
    ...core,
    ...audioFeatureFields(core.track_id, audioFeaturesByTrackId),
  };
}

function likedItemRow(item, audioFeaturesByTrackId){
  const t = item?.track || null;
  const core = coreTrackFields(t);
  return {
    source: "liked",
    playlist_id: "liked_songs",
    playlist_name: "Liked Songs",
    playlist_owner: "",
    playlist_public: false,
    playlist_collaborative: false,
    playlist_snapshot_id: null,
    added_at: item?.added_at || null,
    added_by: null,
    is_local: false,
    ...core,
    ...audioFeatureFields(core.track_id, audioFeaturesByTrackId),
  };
}

function buildReportHtml(cfg, me, metrics){
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const topArtists = (metrics.top_artists || []).slice(0,10).map(a => `<li><b>${esc(a.name)}</b> <span style="opacity:.7">(${a.count})</span></li>`).join("");
  const topAlbums = (metrics.top_albums || []).slice(0,10).map(a => `<li><b>${esc(a.name)}</b> <span style="opacity:.7">(${a.count})</span></li>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spotify Export Report</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;background:#fff;color:#111}
  .wrap{max-width:980px;margin:0 auto;padding:24px}
  .hero{border-radius:18px;padding:18px;background:linear-gradient(135deg, rgba(0,255,213,.18), rgba(255,61,243,.10), rgba(138,92,255,.14)); border:1px solid rgba(0,0,0,.06)}
  h1{margin:0 0 6px;font-size:22px}
  .sub{opacity:.75}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
  @media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
  .card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:12px}
  .k{font-size:12px;opacity:.7}
  .v{font-size:22px;font-weight:900;margin-top:6px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  @media(max-width:900px){.cols{grid-template-columns:1fr}}
  ol{margin:0;padding-left:18px;line-height:1.5}
</style></head>
<body><div class="wrap">
  <div class="hero">
    <h1>Spotify Export Report</h1>
    <div class="sub">${esc(me.display_name || me.id || "Unknown user")} • generated ${esc(metrics.generated_at)}</div>
  </div>

  <div class="grid">
    <div class="card"><div class="k">Playlists</div><div class="v">${metrics.playlist_count}</div></div>
    <div class="card"><div class="k">Liked songs</div><div class="v">${metrics.liked_count}</div></div>
    <div class="card"><div class="k">Tracks total</div><div class="v">${metrics.total_tracks}</div></div>
    <div class="card"><div class="k">Tracks unique</div><div class="v">${metrics.unique_tracks}</div></div>
  </div>

  <div class="cols">
    <div class="card">
      <div class="k" style="margin-bottom:8px">Top artists</div>
      <ol>${topArtists}</ol>
    </div>
    <div class="card">
      <div class="k" style="margin-bottom:8px">Top albums</div>
      <ol>${topAlbums}</ol>
    </div>
  </div>

  <div class="card" style="margin-top:12px">
    <div class="k">Vibe</div>
    <div class="v" style="font-size:18px">${esc(metrics.vibe || "")}</div>
  </div>
</div></body></html>`;
}
