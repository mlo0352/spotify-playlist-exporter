import { fmtInt, fmtDate } from "./utils.js";

export function setNotice(kind, html){
  const el = document.querySelector("#notice");
  el.classList.remove("hidden", "ok", "warn", "bad");
  el.classList.add(kind || "ok");
  el.innerHTML = html;
  if (!html) el.classList.add("hidden");
}

export function setStats({ playlists, likedCount, total, unique }){
  document.querySelector("#statPlaylists").textContent = fmtInt(playlists);
  document.querySelector("#statLiked").textContent = fmtInt(likedCount);
  document.querySelector("#statTotal").textContent = fmtInt(total);
  document.querySelector("#statUnique").textContent = fmtInt(unique);
}

export function renderMe(me){
  const el = document.querySelector("#meCard");
  if (!me){ el.classList.add("hidden"); el.innerHTML = ""; return; }

  const img = me.images?.[0]?.url;
  const followers = me.followers?.total ?? null;

  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="meLeft">
      <div class="avatar">${img ? `<img alt="" src="${img}"/>` : ""}</div>
      <div>
        <div class="meName">${escapeHtml(me.display_name || me.id || "Unknown")}</div>
        <div class="meMeta">${escapeHtml(me.email || "")}${followers !== null ? ` • ${fmtInt(followers)} followers` : ""}</div>
      </div>
    </div>
    <div class="meRight">
      <span class="pill">country: ${escapeHtml(me.country || "—")}</span>
      <span class="pill">product: ${escapeHtml(me.product || "—")}</span>
      <span class="pill">user: ${escapeHtml(me.id || "—")}</span>
    </div>
  `;
}

export function renderPlaylists(playlists, { onExportOne, onPersona, filterText }){
  const list = document.querySelector("#playlistList");
  const q = (filterText || "").toLowerCase().trim();

  const filtered = playlists.filter(pl => {
    if (!q) return true;
    const hay = `${pl.name} ${pl.owner?.display_name || pl.owner?.id || ""}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length){
    list.innerHTML = `
      <div class="emptyState">
        <div class="emptyTitle">No playlists match</div>
        <div class="emptyBody">Try a different search.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = "";
  for (const pl of filtered){
    const row = document.createElement("div");
    row.className = "playlistRow";

    const img = pl.images?.[0]?.url;
    const owner = pl.owner?.display_name || pl.owner?.id || "—";
    const count = pl.tracks?.total ?? "—";
    const flags = [
      pl.public ? "public" : "private",
      pl.collaborative ? "collab" : null
    ].filter(Boolean).join(" • ");

    row.innerHTML = `
      <div class="plLeft">
        <div class="plImg">${img ? `<img alt="" src="${img}">` : ""}</div>
        <div class="plMain">
          <div class="plName" title="${escapeAttr(pl.name)}">${escapeHtml(pl.name)}</div>
          <div class="plSub">${escapeHtml(owner)} • ${fmtInt(count)} tracks • ${escapeHtml(flags || "")}</div>
        </div>
      </div>
      <div class="plRight">
        <span class="badge">id: ${escapeHtml(pl.id)}</span>
        <button class="btn btnGhost" type="button" data-action="persona">Persona</button>
        <button class="btn btnGhost" type="button" data-action="export">Export</button>
      </div>
    `;
    const btnExport = row.querySelector('button[data-action="export"]');
    btnExport.addEventListener("click", () => onExportOne(pl));

    const btnPersona = row.querySelector('button[data-action="persona"]');
    btnPersona.addEventListener("click", () => onPersona?.(pl));
    list.appendChild(row);
  }
}

export function renderInsights(metrics){
  const topPL = document.querySelector("#insightTopPlaylists");
  const topArtists = document.querySelector("#insightTopArtists");
  const vibe = document.querySelector("#insightVibe");
  const stats = document.querySelector("#insightStats");

  const pls = (metrics.playlists || [])
    .slice()
    .sort((a,b) => (b.track_count||0) - (a.track_count||0))
    .slice(0,10);

  topPL.innerHTML = pls.map(p => `<li><b>${escapeHtml(p.name)}</b> <span class="small">(${fmtInt(p.track_count)})</span></li>`).join("");
  topArtists.innerHTML = (metrics.top_artists || []).slice(0,10).map(a => {
    const key = a.id ? `id:${a.id}` : `name:${a.name}`;
    return `
      <li class="liRow">
        <span><b>${escapeHtml(a.name)}</b> <span class="small">(${fmtInt(a.count)})</span></span>
        <button class="iconBtn" type="button" data-artist-key="${escapeAttr(key)}" aria-label="Show songs and playlists for ${escapeAttr(a.name)}">i</button>
      </li>
    `;
  }).join("");
  vibe.textContent = metrics.vibe || "-";

  if (stats){
    const topDecade = (metrics.decade_distribution || []).slice().sort((a,b) => b.count - a.count)[0] || null;
    stats.innerHTML = [
      li(`Duplicates across sources: <b>${fmtInt(metrics.duplicates_across_sources)}</b>`),
      li(`Unavailable tracks: <b>${fmtInt(metrics.unavailable_tracks)}</b>`),
      li(`Explicit ratio: <b>${fmtPct(metrics.explicit_ratio)}</b> <span class="small">(known: ${fmtInt(metrics.explicit_known)})</span>`),
      li(`Total duration: <b>${fmtDuration(metrics.total_duration_ms)}</b>`),
      li(`Avg track duration: <b>${fmtDuration(metrics.avg_duration_ms)}</b>`),
      li(`Unique artists: <b>${fmtInt(metrics.unique_artist_count)}</b>  Unique albums: <b>${fmtInt(metrics.unique_album_count)}</b>`),
      li(`Playlists: <b>${fmtInt(metrics.playlists_public_count)}</b> public  <b>${fmtInt(metrics.playlists_private_count)}</b> private  <b>${fmtInt(metrics.playlists_collaborative_count)}</b> collab`),
      li(`First added: <b>${escapeHtml(fmtDate(metrics.first_added_at) || "-")}</b>  Last added: <b>${escapeHtml(fmtDate(metrics.last_added_at) || "-")}</b>`),
      li(`Top decade: <b>${topDecade ? `${topDecade.decade}s (${fmtInt(topDecade.count)})` : "-"}</b>`),
    ].join("");
  }
}

function li(html){ return `<li>${html}</li>`; }

function fmtPct(r){
  if (r === null || r === undefined || Number.isNaN(r)) return "-";
  return `${Math.round(r * 100)}%`;
}

function fmtDuration(ms){
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "-";
  const n = Math.max(0, Math.round(ms));
  const s = Math.floor(n / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}
function escapeAttr(s){
  return escapeHtml(s).replace(/"/g,"&quot;");
}
