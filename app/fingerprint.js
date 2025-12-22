import { hashString } from "./utils.js";

function toBase64Url(bytes){
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function fromBase64Url(s){
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = s.replace(/-/g,"+").replace(/_/g,"/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeMusicDna(dna){
  const json = JSON.stringify(dna);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytes);
}

export function decodeMusicDna(encoded){
  const bytes = fromBase64Url(String(encoded || ""));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

export function getMusicDnaFromHash(hash){
  const h = String(hash || "").replace(/^#/,"");
  if (!h) return null;
  const params = new URLSearchParams(h);
  const v = params.get("dna");
  if (!v) return null;
  try{
    return decodeMusicDna(v);
  }catch{
    return null;
  }
}

export function makeMusicDnaShareUrl(dna){
  const base = window.location.origin + window.location.pathname;
  return `${base}#dna=${encodeMusicDna(dna)}`;
}

function avg(nums){
  if (!nums.length) return null;
  return nums.reduce((a,b) => a+b, 0) / nums.length;
}

export function computeMusicDna({ metrics, occurrences, audioFeaturesByTrackId, topGenres }){
  const uniqTrackIds = new Set();
  for (const occ of occurrences){
    if (occ.track_id) uniqTrackIds.add(occ.track_id);
  }

  const tempos = [];
  const energies = [];
  const valences = [];
  if (audioFeaturesByTrackId){
    for (const id of uniqTrackIds){
      const f = audioFeaturesByTrackId.get(id);
      if (!f) continue;
      if (typeof f.tempo === "number") tempos.push(f.tempo);
      if (typeof f.energy === "number") energies.push(f.energy);
      if (typeof f.valence === "number") valences.push(f.valence);
    }
  }

  return {
    v: 1,
    generated_at: new Date().toISOString(),
    total_tracks: metrics.total_tracks,
    unique_tracks: metrics.unique_tracks,
    explicit_ratio: metrics.explicit_ratio,
    decades: (metrics.decade_distribution || []).slice(-10),
    top_genres: (topGenres || []).slice(0, 8),
    audio: {
      tracks_with_features: audioFeaturesByTrackId ? tempos.length : 0,
      avg_tempo: avg(tempos),
      avg_energy: avg(energies),
      avg_valence: avg(valences),
    },
    vibe: metrics.vibe || null,
  };
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function pct01(n){
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return clamp(Number(n), 0, 1);
}

function fmtPct(r){
  if (r === null) return "—";
  return `${Math.round(r*100)}%`;
}

function fmtTempo(t){
  if (t === null || t === undefined || Number.isNaN(t)) return "—";
  return `${Math.round(t)} bpm`;
}

function seeded(seed){
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function renderMusicDnaSvg(dna, { width = 960, height = 420 } = {}){
  const seed = parseInt(hashString(JSON.stringify(dna)).slice(0, 8), 16) >>> 0;
  const rnd = seeded(seed);

  const pad = 24;
  const innerW = width - pad*2;
  const innerH = height - pad*2;

  const genres = (dna.top_genres || []).map(g => g.genre || g.name || "").filter(Boolean).slice(0, 6);
  const decades = (dna.decades || []).slice();
  const decadeMax = Math.max(1, ...decades.map(d => d.count || 0));
  const explicit = dna.explicit_ratio ?? null;
  const energy = pct01(dna.audio?.avg_energy ?? null);
  const valence = pct01(dna.audio?.avg_valence ?? null);

  const barcodeX = pad;
  const barcodeY = pad + 170;
  const barcodeW = innerW;
  const barcodeH = innerH - 170;

  const bars = [];
  const barCount = 56;
  for (let i=0;i<barCount;i++){
    const v = rnd();
    const h = Math.floor(18 + v * (barcodeH - 24));
    const x = barcodeX + (i / barCount) * barcodeW;
    const w = Math.max(2, (barcodeW / barCount) * 0.78);
    bars.push({ x, y: barcodeY + (barcodeH - h), w, h, v });
  }

  const decadeBars = decades.slice(-8);
  const decadeW = 12;
  const decadeGap = 6;
  const decadeStartX = pad + 10;
  const decadeBaseY = pad + 136;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgba(0,255,213,.85)"/>
      <stop offset=".55" stop-color="rgba(255,61,243,.55)"/>
      <stop offset="1" stop-color="rgba(138,92,255,.75)"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="rgba(0,163,255,.9)"/>
      <stop offset=".5" stop-color="rgba(255,61,243,.65)"/>
      <stop offset="1" stop-color="rgba(0,255,213,.9)"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="rgba(0,0,0,.22)"/>
    </filter>
  </defs>

  <rect x="8" y="8" width="${width-16}" height="${height-16}" rx="26" fill="white" filter="url(#soft)"/>
  <rect x="8" y="8" width="${width-16}" height="${height-16}" rx="26" fill="url(#g)" opacity=".12"/>

  <text x="${pad}" y="${pad+28}" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="20" font-weight="900" fill="rgba(10,12,18,.92)">Music DNA</text>
  <text x="${pad}" y="${pad+50}" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="12" font-weight="700" fill="rgba(16,18,23,.55)">fingerprint v${dna.v}  •  ${new Date(dna.generated_at).toISOString().slice(0,10)}</text>

  <g transform="translate(${pad},${pad+74})">
    <text x="0" y="0" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="12" font-weight="900" fill="rgba(16,18,23,.65)">Top genres</text>
    <text x="0" y="20" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="14" font-weight="900" fill="rgba(10,12,18,.92)">${genres.length ? genres.join("  •  ") : "— (fetch genres for this)"} </text>
  </g>

  <g transform="translate(${pad},${pad+110})">
    <text x="0" y="0" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="12" font-weight="900" fill="rgba(16,18,23,.65)">Explicit ratio</text>
    <text x="0" y="20" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="14" font-weight="900" fill="rgba(10,12,18,.92)">${fmtPct(explicit)}</text>
  </g>

  <g transform="translate(${pad+240},${pad+110})">
    <text x="0" y="0" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="12" font-weight="900" fill="rgba(16,18,23,.65)">Tempo</text>
    <text x="0" y="20" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="14" font-weight="900" fill="rgba(10,12,18,.92)">${fmtTempo(dna.audio?.avg_tempo ?? null)}</text>
  </g>

  <g transform="translate(${pad+420},${pad+110})">
    <text x="0" y="0" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="12" font-weight="900" fill="rgba(16,18,23,.65)">Energy / Mood</text>
    <text x="0" y="20" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="14" font-weight="900" fill="rgba(10,12,18,.92)">${energy === null ? "—" : `${Math.round(energy*100)}%`} / ${valence === null ? "—" : `${Math.round(valence*100)}%`}</text>
  </g>

  <g transform="translate(${decadeStartX},${decadeBaseY})">
    <text x="0" y="0" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="12" font-weight="900" fill="rgba(16,18,23,.65)">Decades</text>
    <g transform="translate(0,12)">
      ${decadeBars.map((d, i) => {
        const h = (d.count || 0) / decadeMax * 34;
        const x = i * (decadeW + decadeGap);
        const y = 40 - h;
        return `<rect x="${x}" y="${y}" width="${decadeW}" height="${h}" rx="6" fill="url(#line)" opacity=".85"/>`;
      }).join("")}
    </g>
    ${decadeBars.map((d, i) => {
      const x = i * (decadeW + decadeGap) + (decadeW/2);
      const label = String(d.decade || "").slice(2);
      return `<text x="${x}" y="66" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="10" font-weight="800" fill="rgba(16,18,23,.55)">${label}</text>`;
    }).join("")}
  </g>

  <g>
    <rect x="${barcodeX}" y="${barcodeY}" width="${barcodeW}" height="${barcodeH}" rx="18" fill="rgba(255,255,255,.82)" stroke="rgba(0,0,0,.06)"/>
    ${bars.map(b => `<rect x="${b.x + 6}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.max(2, b.w/2)}" fill="url(#line)" opacity="${0.18 + b.v*0.78}"/>`).join("")}
  </g>

  <text x="${width-pad}" y="${height-pad+4}" text-anchor="end" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial" font-size="11" font-weight="800" fill="rgba(16,18,23,.45)">${(dna.vibe || "").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</text>
</svg>`;
}
