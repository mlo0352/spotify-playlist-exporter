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

  // offline report HTML (self-contained)
  zip.file(`${root}/report.html`, buildOfflineReportHtml({ cfg, me, metrics }));

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
    <div class="sub">${esc(me.display_name || me.id || "Unknown user")} | generated ${esc(metrics.generated_at)}</div>
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

export function buildOfflineReportHtml({ cfg, me, metrics }){
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const payload = { me, metrics, cfg: { exportPrefix: cfg?.exportPrefix || "spotify-export" } };
  const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spotify Offline Report</title>
<style>
  :root{--bg:#fff;--text:#101217;--muted:#5c6370;--border:#e7eaf0}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;background:var(--bg);color:var(--text)}
  .wrap{max-width:1060px;margin:0 auto;padding:22px}
  .hero{border-radius:18px;padding:16px;background:linear-gradient(135deg, rgba(0,255,213,.18), rgba(255,61,243,.10), rgba(138,92,255,.14)); border:1px solid rgba(0,0,0,.06)}
  h1{margin:0 0 6px;font-size:22px}
  .sub{color:rgba(16,18,23,.72);line-height:1.35}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}
  @media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
  .card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:12px}
  .k{font-size:12px;color:rgba(16,18,23,.65)}
  .v{font-size:22px;font-weight:900;margin-top:6px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  @media(max-width:900px){.cols{grid-template-columns:1fr}}
  ol,ul{margin:0;padding-left:18px;line-height:1.55;color:var(--muted)}
  .charts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  @media(max-width:900px){.charts{grid-template-columns:1fr}}
  canvas{width:100%;height:260px;display:block}
  .table{width:100%;border-collapse:collapse;margin-top:8px}
  .table th,.table td{border-bottom:1px solid rgba(0,0,0,.06);padding:8px 6px;text-align:left;font-size:13px}
  .table th{font-size:12px;color:rgba(16,18,23,.65)}
  .pill{display:inline-block;font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:#fff;margin-right:6px;margin-top:6px}
  .muted{color:var(--muted)}
</style></head>
<body><div class="wrap">
  <div class="hero">
    <h1>Spotify Offline Report</h1>
    <div class="sub"><b>${esc(me?.display_name || me?.id || "Unknown user")}</b> | generated <span id="gen"></span></div>
    <div class="sub muted" style="margin-top:6px">Self-contained HTML: no network required to view.</div>
  </div>

  <div class="grid">
    <div class="card"><div class="k">Playlists</div><div class="v" id="m_playlists">-</div></div>
    <div class="card"><div class="k">Liked songs</div><div class="v" id="m_liked">-</div></div>
    <div class="card"><div class="k">Tracks total</div><div class="v" id="m_total">-</div></div>
    <div class="card"><div class="k">Tracks unique</div><div class="v" id="m_unique">-</div></div>
  </div>

  <div class="card" style="margin-top:12px">
    <div class="k">Quick stats</div>
    <div>
      <span class="pill" id="pill_dupes">-</span>
      <span class="pill" id="pill_unavail">-</span>
      <span class="pill" id="pill_explicit">-</span>
      <span class="pill" id="pill_duration">-</span>
    </div>
  </div>

  <div class="charts">
    <div class="card">
      <div class="k" style="margin-bottom:8px">Tracks per playlist (Top 12)</div>
      <canvas id="c_pl"></canvas>
    </div>
    <div class="card">
      <div class="k" style="margin-bottom:8px">Added over time</div>
      <canvas id="c_tl"></canvas>
    </div>
  </div>

  <div class="cols">
    <div class="card">
      <div class="k" style="margin-bottom:8px">Top artists</div>
      <ol id="top_artists"></ol>
    </div>
    <div class="card">
      <div class="k" style="margin-bottom:8px">Top albums</div>
      <ol id="top_albums"></ol>
    </div>
  </div>

  <div class="card" style="margin-top:12px">
    <div class="k">Playlists</div>
    <table class="table" id="pl_table">
      <thead><tr><th>Name</th><th>Owner</th><th>Tracks</th><th>Flags</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>

  <div class="card" style="margin-top:12px">
    <div class="k">Vibe</div>
    <div class="v" style="font-size:18px" id="vibe">-</div>
  </div>

  <script type="application/json" id="spe_data">${dataJson}</script>
  <script>
  (function(){
    const data = JSON.parse(document.getElementById('spe_data').textContent);
    const m = data.metrics || {};

    const fmtInt = (n) => (n === null || n === undefined || Number.isNaN(n)) ? '-' : new Intl.NumberFormat().format(n);
    const fmtPct = (r) => (r === null || r === undefined || Number.isNaN(r)) ? '-' : (Math.round(r*100) + '%');
    const fmtDur = (ms) => {
      if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
      const s = Math.floor(ms/1000);
      const h = Math.floor(s/3600);
      const mm = Math.floor((s%3600)/60);
      return h>0 ? (h+'h '+mm+'m') : (mm+'m');
    };

    document.getElementById('gen').textContent = (m.generated_at || '').replace('T',' ').slice(0,19);
    document.getElementById('m_playlists').textContent = fmtInt(m.playlist_count);
    document.getElementById('m_liked').textContent = fmtInt(m.liked_count);
    document.getElementById('m_total').textContent = fmtInt(m.total_tracks);
    document.getElementById('m_unique').textContent = fmtInt(m.unique_tracks);

    document.getElementById('pill_dupes').textContent = 'Duplicates: ' + fmtInt(m.duplicates_across_sources);
    document.getElementById('pill_unavail').textContent = 'Unavailable: ' + fmtInt(m.unavailable_tracks);
    document.getElementById('pill_explicit').textContent = 'Explicit: ' + fmtPct(m.explicit_ratio);
    document.getElementById('pill_duration').textContent = 'Total duration: ' + fmtDur(m.total_duration_ms);

    const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const topArtists = (m.top_artists || []).slice(0,12).map(a => '<li><b>'+esc(a.name)+'</b> <span style=\"opacity:.7\">('+fmtInt(a.count)+')</span></li>').join('');
    const topAlbums = (m.top_albums || []).slice(0,12).map(a => '<li><b>'+esc(a.name)+'</b> <span style=\"opacity:.7\">('+fmtInt(a.count)+')</span></li>').join('');
    document.getElementById('top_artists').innerHTML = topArtists || '<li>-</li>';
    document.getElementById('top_albums').innerHTML = topAlbums || '<li>-</li>';

    document.getElementById('vibe').textContent = m.vibe || '-';

    const pls = (m.playlists || []).slice().sort((a,b) => (b.track_count||0)-(a.track_count||0));
    const tbody = document.querySelector('#pl_table tbody');
    tbody.innerHTML = pls.slice(0, 120).map(p => {
      const flags = [(p.public ? 'public' : 'private'), (p.collaborative ? 'collab' : '')].filter(Boolean).join(' | ');
      return '<tr><td>'+esc(p.name)+'</td><td class=\"muted\">'+esc(p.owner||'')+'</td><td>'+fmtInt(p.track_count)+'</td><td class=\"muted\">'+esc(flags)+'</td></tr>';
    }).join('');

    function setupCanvas(canvas){
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 800;
      const h = canvas.clientHeight || 260;
      canvas.width = Math.floor(w*dpr);
      canvas.height = Math.floor(h*dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      return { ctx, w, h };
    }

    function drawBars(canvas, labels, values){
      const { ctx, w, h } = setupCanvas(canvas);
      ctx.clearRect(0,0,w,h);
      const top = 10, bottom = 26, left = 10, right = 10;
      const plotW = w-left-right, plotH = h-top-bottom;
      const max = Math.max(1, ...values);
      const n = values.length || 1;
      const gap = 6;
      const barW = (plotW - gap*(n-1)) / n;

      ctx.strokeStyle = 'rgba(0,0,0,.08)';
      ctx.beginPath(); ctx.moveTo(left, top+plotH); ctx.lineTo(left+plotW, top+plotH); ctx.stroke();

      for (let i=0;i<n;i++){
        const v = values[i] || 0;
        const bh = (v/max)*plotH;
        const x = left + i*(barW+gap);
        const y = top + (plotH-bh);
        const g = ctx.createLinearGradient(x,y,x,y+bh);
        g.addColorStop(0,'rgba(0,255,213,.85)');
        g.addColorStop(.55,'rgba(255,61,243,.55)');
        g.addColorStop(1,'rgba(138,92,255,.72)');
        ctx.fillStyle = g;
        ctx.fillRect(x,y,barW,bh);

        ctx.fillStyle = 'rgba(16,18,23,.75)';
        ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        const label = String(labels[i]||'').slice(0,12);
        ctx.save();
        ctx.translate(x + barW/2, top + plotH + 16);
        ctx.rotate(-0.26);
        ctx.textAlign='center';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }

    function drawTimeline(canvas, points){
      const { ctx, w, h } = setupCanvas(canvas);
      ctx.clearRect(0,0,w,h);
      const top = 10, bottom = 26, left = 10, right = 10;
      const plotW = w-left-right, plotH = h-top-bottom;
      const max = Math.max(1, ...(points.map(p=>p.count||0)));

      ctx.strokeStyle = 'rgba(0,0,0,.08)';
      ctx.beginPath(); ctx.moveTo(left, top+plotH); ctx.lineTo(left+plotW, top+plotH); ctx.stroke();

      const grad = ctx.createLinearGradient(left, top, left+plotW, top);
      grad.addColorStop(0,'rgba(0,163,255,.85)');
      grad.addColorStop(.5,'rgba(255,61,243,.65)');
      grad.addColorStop(1,'rgba(0,255,213,.85)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      for (let i=0;i<points.length;i++){
        const p = points[i];
        const x = left + (i/(points.length-1||1))*plotW;
        const y = top + (plotH - ((p.count||0)/max)*plotH);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }

    const topPl = pls.slice(0, 12);
    drawBars(document.getElementById('c_pl'), topPl.map(p=>p.name), topPl.map(p=>p.track_count||0));
    const tl = (m.added_timeline || []);
    const stride = Math.ceil(tl.length / 180) || 1;
    const sampled = tl.filter((_,i)=> i%stride===0);
    drawTimeline(document.getElementById('c_tl'), sampled);
  })();
  </script>
</div></body></html>`;
}
