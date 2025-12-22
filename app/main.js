import { loadConfig, saveConfig, loadToken, saveToken, clearToken } from "./storage.js";
import { buildAuthUrl, parseAuthCallback, exchangeCodeForToken, clearAuthParamsFromUrl, ensureValidToken } from "./spotifyAuth.js";
import { getMe, getAllPlaylists, getAllPlaylistItems, getAllSavedTracks, getAudioFeatures, getArtists } from "./spotifyApi.js";
import { setNotice, setStats, renderPlaylists, renderMe, renderInsights } from "./ui.js";
import { fmtInt, downloadBlob, safeFilename, toCsv } from "./utils.js";
import { SPOTIFY } from "./constants.js";
import { computeMetrics } from "./metrics.js";
import { drawBarChart, drawTimeline } from "./charts.js";
import { popConfetti } from "./confetti.js";
import { buildZipExport, buildOfflineReportHtml } from "./exporters.js";
import { buildTrackOccurrences, buildArtistIndex, getArtistDetail, buildPlaylistKeySets, computeOverlapMatrix, computeOverlapKeys, findExactDuplicateGroups, findNearDuplicateGroups } from "./insights.js";
import { computeMusicDna, renderMusicDnaSvg, getMusicDnaFromHash, makeMusicDnaShareUrl } from "./fingerprint.js";
import { computePlaylistPersona } from "./persona.js";

let cfg = loadConfig();

// After you load cfg from storage / defaults...
const injected = window.__SPOTIFY_EXPORTER_CONFIG__ || {};

function isUnset(v){
  return v === null || v === undefined || String(v).trim() === "";
}

function applyInjectedConfig(){
  // Only fill missing values; never overwrite user-set values
  if (isUnset(cfg.clientId) && !isUnset(injected.spotifyClientId)){
    cfg.clientId = String(injected.spotifyClientId).trim();
  }
  if (isUnset(cfg.redirectUri) && !isUnset(injected.redirectUri)){
    cfg.redirectUri = String(injected.redirectUri).trim();
  }
}

applyInjectedConfig();
let token = loadToken(cfg);

const state = {
  me: null,
  playlists: [],
  playlistItemsById: new Map(),
  likedItems: [],
  metrics: null,
  audioFeaturesByTrackId: null, // Map
  occurrences: [],
  artistIndexByKey: null, // Map
  artistGenresById: new Map(),
  topGenres: [],
  dna: null,
  dnaSvg: "",
};

const els = {
  btnConnect: document.querySelector("#btnConnect"),
  btnLogout: document.querySelector("#btnLogout"),
  btnSettings: document.querySelector("#btnSettings"),
  btnPrivacy: document.querySelector("#btnPrivacy"),
  btnFetch: document.querySelector("#btnFetch"),
  btnExportAll: document.querySelector("#btnExportAll"),
  btnOfflineReport: document.querySelector("#btnOfflineReport"),
  btnRecompute: document.querySelector("#btnRecompute"),
  btnCelebrate: document.querySelector("#btnCelebrate"),
  btnOverlap: document.querySelector("#btnOverlap"),
  btnDuplicates: document.querySelector("#btnDuplicates"),
  settingsModal: document.querySelector("#settingsModal"),
  privacyModal: document.querySelector("#privacyModal"),
  btnSaveSettings: document.querySelector("#btnSaveSettings"),
  privacyScopes: document.querySelector("#privacyScopes"),
  privacyToken: document.querySelector("#privacyToken"),
  privacyStorage: document.querySelector("#privacyStorage"),
  btnClearLocal: document.querySelector("#btnClearLocal"),
  btnResetLocalSettings: document.querySelector("#btnResetLocalSettings"),
  cfgClientId: document.querySelector("#cfgClientId"),
  cfgInjectedBadge: document.querySelector("#cfgInjectedBadge"),
  cfgRedirectUri: document.querySelector("#cfgRedirectUri"),
  cfgPrefix: document.querySelector("#cfgPrefix"),
  cfgDedupe: document.querySelector("#cfgDedupe"),
  cfgUseSessionStorage: document.querySelector("#cfgUseSessionStorage"),
  playlistSearch: document.querySelector("#playlistSearch"),
  toggleIncludeLiked: document.querySelector("#toggleIncludeLiked"),
  toggleAlbumExports: document.querySelector("#toggleAlbumExports"),
  toggleAudioFeatures: document.querySelector("#toggleAudioFeatures"),
  chartPlaylists: document.querySelector("#chartPlaylists"),
  chartTimeline: document.querySelector("#chartTimeline"),
  timelineSlider: document.querySelector("#timelineSlider"),
  timelineLabel: document.querySelector("#timelineLabel"),
  confetti: document.querySelector("#confetti"),

  artistModal: document.querySelector("#artistModal"),
  artistModalTitle: document.querySelector("#artistModalTitle"),
  artistModePlaylists: document.querySelector("#artistModePlaylists"),
  artistModeSongs: document.querySelector("#artistModeSongs"),
  artistModalSearch: document.querySelector("#artistModalSearch"),
  artistModalSummary: document.querySelector("#artistModalSummary"),
  artistModalContent: document.querySelector("#artistModalContent"),
  insightTopArtists: document.querySelector("#insightTopArtists"),

  dnaCard: document.querySelector("#dnaCard"),
  dnaSvgWrap: document.querySelector("#dnaSvgWrap"),
  dnaHint: document.querySelector("#dnaHint"),
  btnDnaGenres: document.querySelector("#btnDnaGenres"),
  btnDnaCopy: document.querySelector("#btnDnaCopy"),
  btnDnaSvg: document.querySelector("#btnDnaSvg"),
  btnDnaPng: document.querySelector("#btnDnaPng"),

  overlapModal: document.querySelector("#overlapModal"),
  overlapTopN: document.querySelector("#overlapTopN"),
  overlapCanvas: document.querySelector("#overlapCanvas"),
  overlapLegend: document.querySelector("#overlapLegend"),
  overlapDetail: document.querySelector("#overlapDetail"),

  duplicatesModal: document.querySelector("#duplicatesModal"),
  dupeModeExact: document.querySelector("#dupeModeExact"),
  dupeModeNear: document.querySelector("#dupeModeNear"),
  dupeSearch: document.querySelector("#dupeSearch"),
  btnDupeCsv: document.querySelector("#btnDupeCsv"),
  dupeSummary: document.querySelector("#dupeSummary"),
  dupeList: document.querySelector("#dupeList"),

  personaModal: document.querySelector("#personaModal"),
  personaModalTitle: document.querySelector("#personaModalTitle"),
  personaSummary: document.querySelector("#personaSummary"),
  personaBadges: document.querySelector("#personaBadges"),
  personaTraits: document.querySelector("#personaTraits"),
};

const uiState = {
  artist: { key: null, mode: "playlists", q: "" },
  overlap: { playlistIds: [], playlistMeta: [], setsByPlaylistId: null, trackMetaByKey: null, matrix: null, max: 0, selected: null },
  dupes: { mode: "exact", q: "", exact: [], near: [] },
  timeTravel: { points: [], prefix: [], markerSampledIndex: null, fullIndex: null, sampled: [] },
  persona: { playlistId: null },
};

init();

async function init(){
  wireUi();
  hydrateSettingsModal();
  hydrateSharedFingerprint();

  // Handle OAuth callback
  const cb = parseAuthCallback();
  if (cb.error){
    setNotice("bad", `Spotify login error: <b>${cb.error}</b>`);
    clearAuthParamsFromUrl();
  }else if (cb.code){
    try{
      if (!cfg.clientId || !cfg.redirectUri) throw new Error("Missing Client ID or Redirect URI in settings.");
      const newToken = await exchangeCodeForToken({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, code: cb.code });
      token = newToken;
      saveToken(cfg, token);
      setNotice("ok", "Connected! Now fetch your playlists.");
    }catch(e){
      console.error(e);
      setNotice("bad", escapeHtml(e.message || String(e)));
    }finally{
      clearAuthParamsFromUrl();
    }
  }

  await refreshAuthUi();
  // If token exists, fetch profile for nicer UI
  if (token){
    await tryLoadProfile();
    enableActions();
  }
}

function wireUi(){
  els.btnSettings.addEventListener("click", () => {
    hydrateSettingsModal();
    els.settingsModal.showModal();
  });

  els.btnPrivacy?.addEventListener("click", () => {
    hydratePrivacyModal();
    els.privacyModal?.showModal();
  });

  els.btnClearLocal?.addEventListener("click", () => {
    const ok = confirm("Clear all local data for this app (settings + token) and reload?");
    if (!ok) return;
    clearAllLocalData();
    window.location.reload();
  });

  els.btnResetLocalSettings?.addEventListener("click", () => {
    const ok = confirm("Reset this app’s local settings and reload?");
    if (!ok) return;
    clearAllLocalData();
    window.location.reload();
  });

  els.btnLogout.addEventListener("click", () => {
    clearToken(cfg);
    token = null;
    resetState();
    refreshAuthUi();
    setNotice("warn", "Logged out. Connect again to export.");
  });

  els.btnConnect.addEventListener("click", async () => {
    if (!cfg.clientId || !cfg.redirectUri){
      setNotice("warn", "Open <b>Settings</b> and set your Spotify Client ID + Redirect URI first.");
      els.settingsModal.showModal();
      return;
    }
    const url = await buildAuthUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri });
    window.location.href = url;
  });

  els.btnSaveSettings.addEventListener("click", (e) => {
    // dialog form submit handles closing
    cfg.clientId = els.cfgClientId.value.trim();
    cfg.redirectUri = els.cfgRedirectUri.value.trim();
    cfg.exportPrefix = els.cfgPrefix.value.trim() || "spotify-export";
    cfg.dedupeRule = els.cfgDedupe.value;
    cfg.tokenStorage = els.cfgUseSessionStorage.checked ? "session" : "local";
    applyInjectedConfig();
    saveConfig(cfg);

    // token storage changed: migrate token
    if (token){
      try{
        // clear both stores then save to new store
        localStorage.removeItem("spe_token_v1");
        sessionStorage.removeItem("spe_token_v1");
        saveToken(cfg, token);
      }catch{}
    }

    setNotice("ok", "Settings saved.");
    hydrateSettingsModal();
  });

  els.btnFetch.addEventListener("click", async () => {
    await fetchEverything();
  });

  els.btnExportAll.addEventListener("click", async () => {
    await exportAllZip();
  });

  els.btnOfflineReport?.addEventListener("click", () => {
    downloadOfflineReport();
  });

  els.btnRecompute.addEventListener("click", () => {
    recomputeAndRenderInsights();
  });

  els.btnCelebrate.addEventListener("click", () => {
    popConfetti(els.confetti);
  });

  els.btnOverlap?.addEventListener("click", () => {
    openOverlapModal();
  });
  els.btnDuplicates?.addEventListener("click", () => {
    openDuplicatesModal();
  });

  els.playlistSearch.addEventListener("input", () => {
    renderPlaylists(state.playlists, { onExportOne: exportOnePlaylist, onPersona: openPersonaModal, filterText: els.playlistSearch.value });
  });

  // Cmd/Ctrl+K focuses search
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"){
      e.preventDefault();
      els.playlistSearch.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (state.metrics) renderCharts(state.metrics);
  });

  els.timelineSlider?.addEventListener("input", () => {
    const idx = Number(els.timelineSlider.value || "0");
    uiState.timeTravel.fullIndex = idx;
    renderTimeTravel();
  });

  els.insightTopArtists?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-artist-key]");
    if (!btn) return;
    const key = btn.getAttribute("data-artist-key");
    if (!key) return;
    openArtistModal(key);
  });

  els.artistModePlaylists?.addEventListener("click", () => {
    if (!uiState.artist.key) return;
    uiState.artist.mode = "playlists";
    renderArtistModal();
  });
  els.artistModeSongs?.addEventListener("click", () => {
    if (!uiState.artist.key) return;
    uiState.artist.mode = "songs";
    renderArtistModal();
  });
  els.artistModalSearch?.addEventListener("input", () => {
    uiState.artist.q = (els.artistModalSearch.value || "").trim().toLowerCase();
    renderArtistModal();
  });

  els.overlapTopN?.addEventListener("change", () => {
    if (!els.overlapModal?.open) return;
    renderOverlapModal();
  });
  els.overlapCanvas?.addEventListener("click", (e) => {
    if (!uiState.overlap.matrix) return;
    const hit = heatmapHitTest(e);
    if (!hit) return;
    uiState.overlap.selected = hit;
    renderOverlapModal();
    renderOverlapDetail(hit.i, hit.j);
  });

  els.dupeModeExact?.addEventListener("click", () => {
    uiState.dupes.mode = "exact";
    renderDuplicatesModal();
  });
  els.dupeModeNear?.addEventListener("click", () => {
    uiState.dupes.mode = "near";
    renderDuplicatesModal();
  });
  els.dupeSearch?.addEventListener("input", () => {
    uiState.dupes.q = (els.dupeSearch.value || "").trim().toLowerCase();
    renderDuplicatesModal();
  });
  els.btnDupeCsv?.addEventListener("click", () => {
    downloadDupesCsv();
  });

  els.btnDnaCopy?.addEventListener("click", async () => {
    if (!state.dna) return;
    const url = makeMusicDnaShareUrl(state.dna);
    try{
      await navigator.clipboard.writeText(url);
      setNotice("ok", "Copied share link to clipboard.");
    }catch{
      // fallback
      prompt("Copy this share link:", url);
    }
  });

  els.btnDnaSvg?.addEventListener("click", () => {
    if (!state.dnaSvg) return;
    const blob = new Blob([state.dnaSvg], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob("music-dna.svg", blob);
  });

  els.btnDnaPng?.addEventListener("click", async () => {
    if (!state.dnaSvg) return;
    try{
      const blob = await svgToPngBlob(state.dnaSvg, 1400, 610);
      downloadBlob("music-dna.png", blob);
    }catch(e){
      console.error(e);
      setNotice("bad", "PNG download failed (try SVG).");
    }
  });

  els.btnDnaGenres?.addEventListener("click", async () => {
    try{
      const t = await getValidToken();
      if (!t) throw new Error("Not authenticated.");
      const ids = topArtistIdsForGenres(50);
      if (!ids.length) throw new Error("No artist IDs available yet.");

      setNotice("ok", `Fetching genres for ${fmtInt(ids.length)} artists.`);
      const artists = await getArtists(t, ids);
      state.artistGenresById = new Map(artists.filter(Boolean).map(a => [a.id, a.genres || []]));
      state.topGenres = computeTopGenresFromArtists();
      recomputeDnaOnly();
      setNotice("ok", "Genres added to Music DNA.");
    }catch(e){
      console.error(e);
      setNotice("bad", escapeHtml(e.message || String(e)));
    }
  });
}

function hydrateSettingsModal(){
  els.cfgClientId.value = cfg.clientId || "";
  els.cfgRedirectUri.value = cfg.redirectUri || guessRedirectUri();
  els.cfgPrefix.value = cfg.exportPrefix || "spotify-export";
  els.cfgDedupe.value = cfg.dedupeRule || "track_id";
  els.cfgUseSessionStorage.checked = cfg.tokenStorage === "session";

  const hasInjectedClientId = !isUnset(injected.spotifyClientId);
  if (els.cfgInjectedBadge){
    els.cfgInjectedBadge.classList.toggle("hidden", !hasInjectedClientId);
  }
}

function guessRedirectUri(){
  // Default to origin root (works for GitHub Pages and custom domain)
  return window.location.origin + window.location.pathname.replace(/index\.html$/,"");
}

async function refreshAuthUi(){
  const authed = !!token;
  els.btnConnect.classList.toggle("hidden", authed);
  els.btnLogout.classList.toggle("hidden", !authed);

  els.btnFetch.disabled = !authed;
  els.btnExportAll.disabled = !authed;
  els.btnOfflineReport.disabled = true;
  els.btnRecompute.disabled = !authed;
  els.btnOverlap.disabled = true;
  els.btnDuplicates.disabled = true;
  els.btnCelebrate.disabled = !authed;

  if (!authed){
    renderMe(null);
    setStats({ playlists: null, likedCount: null, total: null, unique: null });
    return;
  }
}

function enableActions(){
  els.btnFetch.disabled = false;
  els.btnRecompute.disabled = false;
  els.btnCelebrate.disabled = false;
}

async function getValidToken(){
  if (!token) return null;
  token = await ensureValidToken(cfg, token, (t) => { token = t; saveToken(cfg, token); });
  return token;
}

async function tryLoadProfile(){
  try{
    const t = await getValidToken();
    state.me = await getMe(t);
    renderMe(state.me);
  }catch(e){
    console.warn("Profile load failed:", e);
  }
}

async function fetchEverything(){
  try{
    setNotice("ok", "Fetching playlists…");
    const t = await getValidToken();
    if (!t) throw new Error("Not authenticated.");

    state.me = await getMe(t);
    renderMe(state.me);

    const playlists = await getAllPlaylists(t);
    state.playlists = playlists;

    renderPlaylists(state.playlists, { onExportOne: exportOnePlaylist, onPersona: openPersonaModal, filterText: els.playlistSearch.value });

    setNotice("ok", `Found <b>${fmtInt(playlists.length)}</b> playlists. Now fetching tracks…`);

    state.playlistItemsById = new Map();
    // sequential to be gentle; can be parallelized later
    for (let i=0;i<playlists.length;i++){
      const pl = playlists[i];
      setNotice("ok", `Fetching tracks: <b>${escapeHtml(pl.name)}</b> (${i+1}/${playlists.length})…`);
      const items = await getAllPlaylistItems(t, pl.id);
      state.playlistItemsById.set(pl.id, items);
    }

    // liked songs optional
    if (els.toggleIncludeLiked.checked){
      setNotice("ok", "Fetching Liked Songs…");
      state.likedItems = await getAllSavedTracks(t);
    }else{
      state.likedItems = [];
    }

    // audio features optional
    state.audioFeaturesByTrackId = null;
    if (els.toggleAudioFeatures.checked){
      setNotice("ok", "Fetching audio features (beta)…");
      const ids = collectUniqueTrackIds();
      const features = await getAudioFeatures(t, ids);
      state.audioFeaturesByTrackId = new Map(features.filter(Boolean).map(f => [f.id, f]));
    }

    setNotice("ok", "Computing metrics…");
    recomputeAndRenderInsights();

    setNotice("ok", "Ready. Export whenever you want.");
    els.btnExportAll.disabled = false;
  }catch(e){
    console.error(e);
    setNotice("bad", escapeHtml(e.message || String(e)));
  }
}

function collectUniqueTrackIds(){
  const ids = new Set();
  for (const items of state.playlistItemsById.values()){
    for (const it of items){
      const id = it?.track?.id;
      if (id) ids.add(id);
    }
  }
  for (const it of state.likedItems){
    const id = it?.track?.id;
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

function recomputeAndRenderInsights(){
  const includeLiked = els.toggleIncludeLiked.checked;
  state.occurrences = buildTrackOccurrences({
    playlists: state.playlists,
    playlistItemsById: state.playlistItemsById,
    likedItems: state.likedItems,
    includeLiked,
  });
  state.artistIndexByKey = buildArtistIndex(state.occurrences);

  const metrics = computeMetrics({
    playlists: state.playlists,
    playlistTracksById: state.playlistItemsById,
    likedTracks: includeLiked ? state.likedItems : [],
    dedupeRule: cfg.dedupeRule,
  });
  state.metrics = metrics;

  setStats({
    playlists: metrics.playlist_count,
    likedCount: includeLiked ? metrics.liked_count : 0,
    total: metrics.total_tracks,
    unique: metrics.unique_tracks,
  });

  renderInsights(metrics);
  renderCharts(metrics);
  recomputeDnaOnly();

  els.btnOverlap.disabled = false;
  els.btnDuplicates.disabled = false;
  els.btnOfflineReport.disabled = false;
}

function recomputeDnaOnly(){
  if (!state.metrics || !state.occurrences.length){
    renderDnaEmpty();
    return;
  }
  state.dna = computeMusicDna({
    metrics: state.metrics,
    occurrences: state.occurrences,
    audioFeaturesByTrackId: state.audioFeaturesByTrackId,
    topGenres: state.topGenres,
  });
  state.dnaSvg = renderMusicDnaSvg(state.dna, { width: 1200, height: 520 });
  els.dnaSvgWrap.innerHTML = state.dnaSvg;
  els.dnaHint.textContent = state.audioFeaturesByTrackId ? "Audio features included. Share it, download it, print it." : "Enable Audio features (beta) and re-fetch for tempo/energy.";

  els.btnDnaCopy.disabled = false;
  els.btnDnaSvg.disabled = false;
  els.btnDnaPng.disabled = false;
  els.btnDnaGenres.disabled = !token;
}

function hydrateSharedFingerprint(){
  const shared = getMusicDnaFromHash(window.location.hash);
  if (!shared) return;
  state.dna = shared;
  state.dnaSvg = renderMusicDnaSvg(state.dna, { width: 1200, height: 520 });
  els.dnaSvgWrap.innerHTML = state.dnaSvg;
  els.dnaHint.textContent = "Shared fingerprint loaded. Connect Spotify to generate your own.";
  els.btnDnaCopy.disabled = false;
  els.btnDnaSvg.disabled = false;
  els.btnDnaPng.disabled = false;
}

function renderDnaEmpty(){
  state.dna = null;
  state.dnaSvg = "";
  els.dnaSvgWrap.innerHTML = "";
  els.dnaHint.textContent = "Fetch your library to generate your fingerprint.";
  els.btnDnaCopy.disabled = true;
  els.btnDnaSvg.disabled = true;
  els.btnDnaPng.disabled = true;
  els.btnDnaGenres.disabled = true;
}

function topArtistIdsForGenres(n){
  if (!state.artistIndexByKey) return [];
  return Array.from(state.artistIndexByKey.values())
    .filter(a => a.id)
    .sort((a,b) => b.count - a.count)
    .slice(0, n)
    .map(a => a.id);
}

function computeTopGenresFromArtists(){
  const idToCount = new Map();
  for (const a of (state.artistIndexByKey?.values() || [])){
    if (a.id) idToCount.set(a.id, a.count || 0);
  }
  const counts = new Map(); // genre -> weight
  for (const [id, genres] of state.artistGenresById.entries()){
    const w = idToCount.get(id) || 1;
    for (const g of genres || []){
      counts.set(g, (counts.get(g) || 0) + w);
    }
  }
  return Array.from(counts.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 12)
    .map(([genre, weight]) => ({ genre, weight }));
}

async function svgToPngBlob(svgText, width, height){
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try{
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0,0,width,height);
    ctx.drawImage(img, 0, 0, width, height);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) throw new Error("canvas.toBlob returned null");
    return pngBlob;
  }finally{
    URL.revokeObjectURL(url);
  }
}

function openArtistModal(key){
  uiState.artist.key = key;
  uiState.artist.mode = "playlists";
  uiState.artist.q = "";
  if (els.artistModalSearch) els.artistModalSearch.value = "";
  renderArtistModal();
  els.artistModal?.showModal();
}

function renderArtistModal(){
  const key = uiState.artist.key;
  if (!key || !state.artistIndexByKey) return;

  const detail = getArtistDetail(state.artistIndexByKey, key);
  if (!detail){
    els.artistModalTitle.textContent = "Artist details";
    els.artistModalSummary.textContent = "No data loaded yet.";
    els.artistModalContent.innerHTML = "";
    return;
  }

  els.artistModalTitle.textContent = detail.name;
  els.artistModalSummary.textContent = `${fmtInt(detail.count)} track occurrences  ${fmtInt(detail.playlists.length)} playlists`;

  const mode = uiState.artist.mode;
  els.artistModePlaylists.classList.toggle("isActive", mode === "playlists");
  els.artistModeSongs.classList.toggle("isActive", mode === "songs");
  els.artistModePlaylists.setAttribute("aria-selected", mode === "playlists" ? "true" : "false");
  els.artistModeSongs.setAttribute("aria-selected", mode === "songs" ? "true" : "false");

  const q = uiState.artist.q;

  if (mode === "songs"){
    const tracks = detail.tracks.filter(t => {
      if (!q) return true;
      return `${t.track_name} ${t.album_name} ${t.artist_names}`.toLowerCase().includes(q);
    });

    els.artistModalContent.innerHTML = tracks.slice(0, 250).map(t => {
      const pls = Array.from(t.playlists.keys());
      const shown = pls.slice(0, 6);
      const extra = pls.length - shown.length;
      const plText = shown.map(pid => escapeHtml(playlistName(pid, detail))).join(", ") + (extra > 0 ? `, +${extra} more` : "");
      return `
        <div class="rowCard">
          <div class="rowTop">
            <div class="rowTitle">${escapeHtml(t.track_name)}</div>
            <div class="rowMeta"><b>${fmtInt(t.count)}</b>  in ${fmtInt(pls.length)} playlists</div>
          </div>
          <div class="rowSub">${escapeHtml(t.album_name || "")}</div>
          <div class="rowSub small">${plText}</div>
        </div>
      `;
    }).join("") + (tracks.length > 250 ? `<div class="small mutedLine">Showing first 250 songs. Refine search to narrow.</div>` : "");
    return;
  }

  // playlists mode
  const tracksByPlaylist = new Map(); // playlist_id -> [{track_name, count}]
  for (const t of detail.tracks){
    for (const [pid, cnt] of t.playlists.entries()){
      if (!tracksByPlaylist.has(pid)) tracksByPlaylist.set(pid, []);
      tracksByPlaylist.get(pid).push({ track_name: t.track_name, count: cnt });
    }
  }
  for (const list of tracksByPlaylist.values()){
    list.sort((a,b) => b.count - a.count || a.track_name.localeCompare(b.track_name));
  }

  const pls = detail.playlists.filter(p => {
    if (!q) return true;
    if (p.playlist_name.toLowerCase().includes(q)) return true;
    const tracks = tracksByPlaylist.get(p.playlist_id) || [];
    return tracks.some(t => t.track_name.toLowerCase().includes(q));
  });

  els.artistModalContent.innerHTML = pls.slice(0, 120).map((p, idx) => {
    const tracks = tracksByPlaylist.get(p.playlist_id) || [];
    const shownTracks = tracks.slice(0, 40);
    const extraTracks = tracks.length - shownTracks.length;
    return `
      <details class="detailBlock" ${idx < 1 ? "open" : ""}>
        <summary>
          <span class="sumLeft">${escapeHtml(p.playlist_name)}</span>
          <span class="sumRight">${fmtInt(p.count)}  ${fmtInt(tracks.length)} songs</span>
        </summary>
        <ol class="miniList">
          ${shownTracks.map(t => `<li>${escapeHtml(t.track_name)} <span class="small">(${fmtInt(t.count)})</span></li>`).join("")}
        </ol>
        ${extraTracks > 0 ? `<div class="small mutedLine">+${fmtInt(extraTracks)} more songs in this playlist</div>` : ""}
      </details>
    `;
  }).join("") + (pls.length > 120 ? `<div class="small mutedLine">Showing first 120 playlists. Refine search to narrow.</div>` : "");
}

function playlistName(pid, detail){
  const hit = detail.playlists.find(p => p.playlist_id === pid);
  return hit?.playlist_name || pid;
}

function renderCharts(metrics){
  const top = (metrics.playlists || [])
    .slice()
    .sort((a,b) => (b.track_count||0) - (a.track_count||0))
    .slice(0,10);

  const labels = top.map(p => p.name);
  const values = top.map(p => p.track_count || 0);
  drawBarChart(els.chartPlaylists, labels, values);

  const points = (metrics.added_timeline || []);
  // downsample for UI
  const stride = Math.ceil(points.length / 140) || 1;
  const sampled = points.filter((_,i) => i % stride === 0);
  uiState.timeTravel.sampled = sampled;
  setupTimeTravel(points);
  drawTimeline(els.chartTimeline, sampled, { markerIndex: uiState.timeTravel.markerSampledIndex });
}

function setupTimeTravel(points){
  uiState.timeTravel.points = points || [];
  uiState.timeTravel.prefix = [];

  let run = 0;
  for (let i=0;i<uiState.timeTravel.points.length;i++){
    run += uiState.timeTravel.points[i]?.count || 0;
    uiState.timeTravel.prefix[i] = run;
  }

  const max = Math.max(0, uiState.timeTravel.points.length - 1);
  els.timelineSlider.disabled = max === 0;
  els.timelineSlider.max = String(max);

  if (uiState.timeTravel.fullIndex === null || uiState.timeTravel.fullIndex === undefined){
    uiState.timeTravel.fullIndex = max;
    els.timelineSlider.value = String(max);
  }else{
    uiState.timeTravel.fullIndex = Math.min(max, Math.max(0, uiState.timeTravel.fullIndex));
    els.timelineSlider.value = String(uiState.timeTravel.fullIndex);
  }

  renderTimeTravel();
}

function renderTimeTravel(){
  const points = uiState.timeTravel.points || [];
  const idx = uiState.timeTravel.fullIndex ?? 0;
  const p = points[idx] || null;
  const cumulative = uiState.timeTravel.prefix[idx] || 0;

  if (els.timelineLabel){
    els.timelineLabel.textContent = p
      ? `As of ${p.date}: ${fmtInt(cumulative)} added (${fmtInt(p.count)} that day)`
      : "-";
  }

  // update marker on chart (map full index to sampled index)
  const sampled = uiState.timeTravel.sampled || [];
  const sampleIdx = sampled.length
    ? Math.round((idx / Math.max(1, points.length - 1)) * (sampled.length - 1))
    : null;
  uiState.timeTravel.markerSampledIndex = (sampleIdx === null) ? null : Math.max(0, Math.min(sampled.length - 1, sampleIdx));
  drawTimeline(els.chartTimeline, sampled, { markerIndex: uiState.timeTravel.markerSampledIndex });
}

function hydratePrivacyModal(){
  if (els.privacyScopes){
    els.privacyScopes.innerHTML = (SPOTIFY.scopes || []).map(s => `<li><b>${escapeHtml(s)}</b></li>`).join("");
  }

  if (els.privacyToken){
    if (!token){
      els.privacyToken.textContent = "Not connected.";
    }else{
      const exp = token.expires_at ? new Date(token.expires_at) : null;
      const leftMs = token.expires_at ? (token.expires_at - Date.now()) : null;
      const leftMin = (leftMs === null) ? null : Math.max(0, Math.round(leftMs / 60000));
      els.privacyToken.textContent = [
        `access_token present`,
        exp ? `expires: ${exp.toLocaleString()}` : `expires: unknown`,
        leftMin !== null ? `(${leftMin} min left)` : "",
        token.refresh_token ? "refresh_token present" : "no refresh_token",
      ].filter(Boolean).join("  ");
    }
  }

  if (els.privacyStorage){
    const store = cfg.tokenStorage === "session" ? "sessionStorage" : "localStorage";
    els.privacyStorage.textContent = `Token stored in ${store}. Settings stored in localStorage.`;
  }
}

function clearAllLocalData(){
  const keys = [
    "spe_cfg_v1",
    "spe_token_v1",
    "spe_pkce_verifier_v1",
    "spe_oauth_state_v1",
  ];
  for (const k of keys){
    try{ localStorage.removeItem(k); }catch{}
    try{ sessionStorage.removeItem(k); }catch{}
  }
}

function downloadOfflineReport(){
  if (!state.me || !state.metrics){
    setNotice("warn", "Fetch playlists first.");
    return;
  }
  const html = buildOfflineReportHtml({ cfg, me: state.me, metrics: state.metrics });
  const stamp = new Date().toISOString().slice(0,10);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  downloadBlob(`${safeFilename(cfg.exportPrefix || "spotify-export")}-${stamp}-report.html`, blob);
  setNotice("ok", "Downloaded offline report HTML.");
}

function openPersonaModal(pl){
  if (!state.occurrences.length){
    setNotice("warn", "Fetch playlists first.");
    return;
  }
  uiState.persona.playlistId = pl?.id || null;

  const occ = state.occurrences.filter(o => o.playlist_id === pl.id);
  const persona = computePlaylistPersona({
    name: pl.name || "Unknown playlist",
    occurrences: occ,
    audioFeaturesByTrackId: state.audioFeaturesByTrackId,
    artistGenresById: state.artistGenresById,
    dedupeRule: cfg.dedupeRule,
  });

  els.personaModalTitle.textContent = `If “${pl.name || "this playlist"}” were a person…`;
  els.personaSummary.textContent = persona.summary;

  els.personaBadges.innerHTML = (persona.badges || []).map(b => `<span class="pill">${escapeHtml(b)}</span>`).join("");
  els.personaTraits.innerHTML = (persona.traits || []).map(t => `
    <div class="rowCard">
      <div class="rowTop">
        <div class="rowTitle">${escapeHtml(t.k)}</div>
        <div class="rowMeta">${escapeHtml(t.v)}</div>
      </div>
    </div>
  `).join("");

  els.personaModal?.showModal();
}

function openOverlapModal(){
  if (!state.metrics || !state.occurrences.length){
    setNotice("warn", "Fetch your library first.");
    return;
  }
  uiState.overlap.selected = null;
  renderOverlapModal();
  els.overlapModal?.showModal();
}

function getPlaylistMetaForOverlap(){
  const includeLiked = els.toggleIncludeLiked.checked;
  const base = (state.metrics?.playlists || []).slice().sort((a,b) => (b.track_count||0) - (a.track_count||0));
  if (includeLiked){
    base.unshift({ id: "liked_songs", name: "Liked Songs", track_count: state.likedItems.length });
  }
  const topN = Number(els.overlapTopN?.value || "20");
  const picked = base.slice(0, topN);
  return picked.map(p => ({ id: p.id, name: p.name, track_count: p.track_count || 0 }));
}

function renderOverlapModal(){
  const playlistMeta = getPlaylistMetaForOverlap();
  const playlistIds = playlistMeta.map(p => p.id);

  const { setsByPlaylistId, trackMetaByKey } = buildPlaylistKeySets(state.occurrences, { dedupeRule: cfg.dedupeRule });
  const { matrix, max } = computeOverlapMatrix(playlistIds, setsByPlaylistId);

  uiState.overlap.playlistMeta = playlistMeta;
  uiState.overlap.playlistIds = playlistIds;
  uiState.overlap.setsByPlaylistId = setsByPlaylistId;
  uiState.overlap.trackMetaByKey = trackMetaByKey;
  uiState.overlap.matrix = matrix;
  uiState.overlap.max = max;

  // legend
  els.overlapLegend.innerHTML = playlistMeta.map((p, i) => `<li><b>${i+1}.</b> ${escapeHtml(p.name)} <span class="small">(${fmtInt(p.track_count)})</span></li>`).join("");
  els.overlapDetail.innerHTML = `<div class="mutedLine small">Click a cell to see overlapping tracks.</div>`;

  drawOverlapHeatmap();
  if (uiState.overlap.selected) renderOverlapDetail(uiState.overlap.selected.i, uiState.overlap.selected.j);
}

function drawOverlapHeatmap(){
  const canvas = els.overlapCanvas;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0,0,w,h);

  const n = uiState.overlap.playlistIds.length || 1;
  const pad = 16;
  const size = Math.min(w, h) - pad*2;
  const cell = size / n;
  const startX = pad;
  const startY = pad;

  const max = Math.max(1, uiState.overlap.max || 1);
  const matrix = uiState.overlap.matrix || [];

  // background
  ctx.fillStyle = "rgba(255,255,255,.9)";
  roundRect(ctx, startX, startY, size, size, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.06)";
  ctx.stroke();

  for (let i=0;i<n;i++){
    for (let j=0;j<n;j++){
      const v = matrix?.[i]?.[j] ?? 0;
      const x = startX + j*cell;
      const y = startY + i*cell;

      const t = (i === j) ? 0 : (v / max);
      const a = 0.08 + t * 0.85;
      ctx.fillStyle = (i === j)
        ? "rgba(0,0,0,.05)"
        : `rgba(138,92,255,${a})`;
      ctx.fillRect(x, y, cell, cell);

      if (uiState.overlap.selected && uiState.overlap.selected.i === i && uiState.overlap.selected.j === j){
        ctx.strokeStyle = "rgba(0,163,255,.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x+1, y+1, cell-2, cell-2);
      }
    }
  }

  // grid lines
  ctx.strokeStyle = "rgba(0,0,0,.06)";
  ctx.lineWidth = 1;
  for (let k=0;k<=n;k++){
    const x = startX + k*cell;
    const y = startY + k*cell;
    ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, startY+size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(startX+size, y); ctx.stroke();
  }

  // labels (numbers)
  ctx.fillStyle = "rgba(10,12,18,.72)";
  ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i=0;i<n;i++){
    const y = startY + i*cell + cell/2;
    const x = startX + i*cell + cell/2;
    ctx.fillText(String(i+1), x, y);
  }
}

function heatmapHitTest(e){
  const rect = els.overlapCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const n = uiState.overlap.playlistIds.length || 0;
  const pad = 16;
  const size = Math.min(rect.width, rect.height) - pad*2;
  if (x < pad || y < pad || x > pad + size || y > pad + size) return null;
  const cell = size / n;
  const i = Math.floor((y - pad) / cell);
  const j = Math.floor((x - pad) / cell);
  if (i < 0 || j < 0 || i >= n || j >= n) return null;
  return { i, j };
}

function renderOverlapDetail(i, j){
  const a = uiState.overlap.playlistMeta[i];
  const b = uiState.overlap.playlistMeta[j];
  if (!a || !b) return;
  if (i === j){
    els.overlapDetail.innerHTML = `<div class="mutedLine"><b>${escapeHtml(a.name)}</b>  ${fmtInt(a.track_count)} tracks</div>`;
    return;
  }
  const keys = computeOverlapKeys(a.id, b.id, uiState.overlap.setsByPlaylistId);
  const metas = keys.map(k => ({ key: k, ...(uiState.overlap.trackMetaByKey.get(k) || {}) }));
  metas.sort((x,y) => String(x.track_name || "").localeCompare(String(y.track_name || "")));
  els.overlapDetail.innerHTML = `
    <div class="detailHeader">
      <div><b>${escapeHtml(a.name)}</b> × <b>${escapeHtml(b.name)}</b></div>
      <div class="small">${fmtInt(keys.length)} shared tracks</div>
    </div>
    <ol class="miniList">
      ${metas.slice(0, 220).map(m => `<li>${escapeHtml(m.track_name || "Unknown")} <span class="small">— ${escapeHtml((m.artist_names || "").split("|")[0] || "")}</span></li>`).join("")}
    </ol>
    ${metas.length > 220 ? `<div class="small mutedLine">Showing first 220 tracks.</div>` : ""}
  `;
}

function openDuplicatesModal(){
  if (!state.metrics || !state.occurrences.length){
    setNotice("warn", "Fetch your library first.");
    return;
  }
  uiState.dupes.q = "";
  if (els.dupeSearch) els.dupeSearch.value = "";
  uiState.dupes.mode = "exact";
  computeDuplicates();
  renderDuplicatesModal();
  els.duplicatesModal?.showModal();
}

function computeDuplicates(){
  uiState.dupes.exact = findExactDuplicateGroups(state.occurrences, { dedupeRule: cfg.dedupeRule, minPlaylists: 2 });
  uiState.dupes.near = findNearDuplicateGroups(state.occurrences, { minVariants: 2 });
}

function playlistNameById(pid){
  if (pid === "liked_songs") return "Liked Songs";
  const pl = state.playlists.find(p => p.id === pid);
  return pl?.name || pid;
}

function renderDuplicatesModal(){
  els.dupeModeExact.classList.toggle("isActive", uiState.dupes.mode === "exact");
  els.dupeModeNear.classList.toggle("isActive", uiState.dupes.mode === "near");
  els.dupeModeExact.setAttribute("aria-selected", uiState.dupes.mode === "exact" ? "true" : "false");
  els.dupeModeNear.setAttribute("aria-selected", uiState.dupes.mode === "near" ? "true" : "false");

  const q = uiState.dupes.q;

  if (uiState.dupes.mode === "near"){
    const groups = uiState.dupes.near.filter(g => {
      if (!q) return true;
      return `${g.artist} ${g.canonical}`.toLowerCase().includes(q) || g.variants.some(v => `${v.track_name} ${v.album_name}`.toLowerCase().includes(q));
    });
    els.dupeSummary.textContent = `${fmtInt(groups.length)} near-duplicate groups`;
    els.btnDupeCsv.disabled = !groups.length;
    els.dupeList.innerHTML = groups.slice(0, 120).map(g => `
      <div class="rowCard">
        <div class="rowTop">
          <div class="rowTitle">${escapeHtml(g.artist)}  ${escapeHtml(g.canonical)}</div>
          <div class="rowMeta">${fmtInt(g.variantCount)} variants  ${fmtInt(g.playlistCount)} playlists</div>
        </div>
        <ol class="miniList">
          ${g.variants.slice(0, 6).map(v => `<li>${escapeHtml(v.track_name)} <span class="small">(${fmtInt(v.playlistIds.length)} playlists)</span></li>`).join("")}
        </ol>
      </div>
    `).join("") + (groups.length > 120 ? `<div class="small mutedLine">Showing first 120 groups.</div>` : "");
    return;
  }

  const groups = uiState.dupes.exact.filter(g => {
    if (!q) return true;
    return `${g.track_name} ${g.artist_names} ${g.album_name}`.toLowerCase().includes(q);
  });
  els.dupeSummary.textContent = `${fmtInt(groups.length)} exact duplicates across playlists`;
  els.btnDupeCsv.disabled = !groups.length;
  els.dupeList.innerHTML = groups.slice(0, 160).map(g => {
    const pls = g.playlistIds.map(playlistNameById);
    const shown = pls.slice(0, 6);
    const extra = pls.length - shown.length;
    return `
      <div class="rowCard">
        <div class="rowTop">
          <div class="rowTitle">${escapeHtml(g.track_name)} <span class="small">— ${escapeHtml((g.artist_names || "").split("|")[0] || "")}</span></div>
          <div class="rowMeta">${fmtInt(pls.length)} playlists</div>
        </div>
        <div class="rowSub">${escapeHtml(g.album_name || "")}</div>
        <div class="rowSub small">${escapeHtml(shown.join(", "))}${extra > 0 ? `, +${extra} more` : ""}</div>
      </div>
    `;
  }).join("") + (groups.length > 160 ? `<div class="small mutedLine">Showing first 160 tracks.</div>` : "");
}

function downloadDupesCsv(){
  const q = uiState.dupes.q;
  if (uiState.dupes.mode === "near"){
    const groups = uiState.dupes.near.filter(g => !q || (`${g.artist} ${g.canonical}`.toLowerCase().includes(q) || g.variants.some(v => `${v.track_name} ${v.album_name}`.toLowerCase().includes(q))));
    const rows = [];
    for (const g of groups){
      for (const v of g.variants){
        rows.push({
          type: "near",
          artist: g.artist,
          canonical: g.canonical,
          variant_track_name: v.track_name,
          variant_album_name: v.album_name,
          variant_key: v.variant_key,
          occurrences: v.occurrences,
          playlist_count: v.playlistIds.length,
          playlists: v.playlistIds.map(playlistNameById).join(" | "),
        });
      }
    }
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    downloadBlob("near-duplicates.csv", blob);
    return;
  }

  const groups = uiState.dupes.exact.filter(g => !q || (`${g.track_name} ${g.artist_names} ${g.album_name}`.toLowerCase().includes(q)));
  const rows = groups.map(g => ({
    type: "exact",
    track_name: g.track_name,
    artist_names: g.artist_names,
    album_name: g.album_name,
    occurrences: g.occurrences,
    playlist_count: g.playlistIds.length,
    playlists: g.playlistIds.map(playlistNameById).join(" | "),
  }));
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  downloadBlob("duplicates.csv", blob);
}

function roundRect(ctx, x, y, w, h, r){
  r = Math.max(0, Math.min(r, Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

async function exportOnePlaylist(pl){
  try{
    if (!state.metrics) recomputeAndRenderInsights();
    const { zip } = await buildZipExport({
      cfg,
      me: state.me || {},
      playlists: [pl],
      playlistItemsById: new Map([[pl.id, state.playlistItemsById.get(pl.id) || []]]),
      likedItems: [],
      metrics: state.metrics,
      includeLiked: false,
      includeAlbumExports: false,
      audioFeaturesByTrackId: state.audioFeaturesByTrackId,
    });
    const blob = await zip.generateAsync({ type:"blob" });
    downloadBlob(`${safeFilename(cfg.exportPrefix)}-${safeFilename(pl.name)}.zip`, blob);
    setNotice("ok", `Exported playlist: <b>${escapeHtml(pl.name)}</b>`);
  }catch(e){
    console.error(e);
    setNotice("bad", escapeHtml(e.message || String(e)));
  }
}

async function exportAllZip(){
  try{
    if (!state.me || !state.playlists.length){
      setNotice("warn", "Fetch playlists first.");
      return;
    }
    if (!state.metrics) recomputeAndRenderInsights();

    setNotice("ok", "Building ZIP…");
    const includeLiked = els.toggleIncludeLiked.checked;
    const includeAlbumExports = els.toggleAlbumExports.checked;

    const { zip, root } = await buildZipExport({
      cfg,
      me: state.me,
      playlists: state.playlists,
      playlistItemsById: state.playlistItemsById,
      likedItems: includeLiked ? state.likedItems : [],
      metrics: state.metrics,
      includeLiked,
      includeAlbumExports,
      audioFeaturesByTrackId: state.audioFeaturesByTrackId,
    });

    const blob = await zip.generateAsync({ type:"blob" });
    downloadBlob(`${root}.zip`, blob);
    setNotice("ok", "Downloaded ZIP ✅");
    popConfetti(els.confetti);
  }catch(e){
    console.error(e);
    setNotice("bad", escapeHtml(e.message || String(e)));
  }
}

function resetState(){
  state.me = null;
  state.playlists = [];
  state.playlistItemsById = new Map();
  state.likedItems = [];
  state.metrics = null;
  state.audioFeaturesByTrackId = null;
  state.occurrences = [];
  state.artistIndexByKey = null;
  state.artistGenresById = new Map();
  state.topGenres = [];
  state.dna = null;
  state.dnaSvg = "";
  renderMe(null);
  renderPlaylists([], { onExportOne: () => {}, onPersona: () => {}, filterText: "" });
  setStats({ playlists: null, likedCount: null, total: null, unique: null });
  renderDnaEmpty();
  if (els.btnOfflineReport) els.btnOfflineReport.disabled = true;
  if (els.timelineSlider){
    els.timelineSlider.disabled = true;
    els.timelineSlider.max = "0";
    els.timelineSlider.value = "0";
  }
  if (els.timelineLabel) els.timelineLabel.textContent = "-";
}

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}
