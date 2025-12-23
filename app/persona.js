function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function avg(nums){
  const xs = nums.filter(n => typeof n === "number" && Number.isFinite(n));
  if (!xs.length) return null;
  return xs.reduce((a,b) => a+b, 0) / xs.length;
}

function fmtPct01(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${Math.round(clamp(v,0,1) * 100)}%`;
}

function fmtTempo(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${Math.round(v)} bpm`;
}

function parseYear(releaseDate){
  const m = String(releaseDate || "").match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  if (!Number.isFinite(y) || y < 1000 || y > 3000) return null;
  return y;
}

function keyForOcc(occ, dedupeRule){
  if (dedupeRule === "track_uri") return occ.track_uri || occ.track_id || null;
  return occ.track_id || occ.track_uri || null;
}

function topN(map, n){
  return Array.from(map.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0,n);
}

function moodLabel(energy, valence){
  if (energy === null || valence === null) return "Unknown mood (enable Audio features)";
  if (energy >= 0.70 && valence >= 0.62) return "Golden-hour hype";
  if (energy >= 0.70 && valence < 0.45) return "Intense catharsis";
  if (energy < 0.42 && valence >= 0.62) return "Soft sunshine";
  if (energy < 0.42 && valence < 0.45) return "Midnight introspection";
  return "Balanced vibes";
}

function personaName(energy, valence, yearSpan){
  const tt = (yearSpan !== null && yearSpan >= 25);
  if (energy === null || valence === null){
    return tt ? "The Time Traveler" : "The Mystery Curator";
  }
  if (energy >= 0.70 && valence >= 0.62) return tt ? "Neon Time Traveler" : "Neon Sprinter";
  if (energy >= 0.70 && valence < 0.45) return tt ? "Storm Time Traveler" : "Storm Runner";
  if (energy < 0.42 && valence >= 0.62) return tt ? "Sunday Time Traveler" : "Sunday Brunch DJ";
  if (energy < 0.42 && valence < 0.45) return tt ? "Midnight Time Traveler" : "Midnight Librarian";
  return tt ? "Eclectic Time Traveler" : "The Balanced Builder";
}

export function computePlaylistPersona({
  name,
  occurrences,
  audioFeaturesByTrackId,
  artistGenresById,
  dedupeRule = "track_id",
}){
  const total = occurrences.length;
  const unique = new Set();
  let explicitKnown = 0;
  let explicitCount = 0;
  const years = [];

  const trackIds = new Set();
  for (const occ of occurrences){
    const k = keyForOcc(occ, dedupeRule);
    if (k) unique.add(k);
    if (typeof occ.explicit === "boolean"){ explicitKnown++; if (occ.explicit) explicitCount++; }
    const y = parseYear(occ.album_release_date);
    if (y) years.push(y);
    if (occ.track_id) trackIds.add(occ.track_id);
  }

  const explicitRatio = explicitKnown ? (explicitCount / explicitKnown) : null;
  const uniqRatio = total ? (unique.size / total) : null;

  // audio features
  const tempos = [];
  const energies = [];
  const valences = [];
  const dance = [];
  if (audioFeaturesByTrackId){
    for (const id of trackIds){
      const f = audioFeaturesByTrackId.get(id);
      if (!f) continue;
      if (typeof f.tempo === "number") tempos.push(f.tempo);
      if (typeof f.energy === "number") energies.push(f.energy);
      if (typeof f.valence === "number") valences.push(f.valence);
      if (typeof f.danceability === "number") dance.push(f.danceability);
    }
  }
  const avgTempo = avg(tempos);
  const avgEnergy = avg(energies);
  const avgValence = avg(valences);
  const avgDance = avg(dance);

  // era spread
  const minYear = years.length ? Math.min(...years) : null;
  const maxYear = years.length ? Math.max(...years) : null;
  const yearSpan = (minYear && maxYear) ? (maxYear - minYear) : null;

  // genres (best-effort)
  const genreCounts = new Map();
  if (artistGenresById && artistGenresById.size){
    for (const occ of occurrences){
      const primaryArtistId = occ.artist_ids?.[0] || null;
      if (!primaryArtistId) continue;
      const genres = artistGenresById.get(primaryArtistId) || [];
      for (const g of genres){
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      }
    }
  }
  const topGenres = topN(genreCounts, 6).map(([g,c]) => ({ genre: g, count: c }));

  const mood = moodLabel(avgEnergy, avgValence);
  const who = personaName(avgEnergy, avgValence, yearSpan);

  const badges = [];
  if (avgEnergy !== null) badges.push(`Energy ${fmtPct01(avgEnergy)}`);
  if (avgValence !== null) badges.push(`Mood ${fmtPct01(avgValence)}`);
  if (avgTempo !== null) badges.push(`Tempo ${fmtTempo(avgTempo)}`);
  badges.push(`${unique.size} unique / ${total} total`);
  if (explicitRatio !== null) badges.push(`Explicit ${Math.round(explicitRatio*100)}%`);
  if (minYear && maxYear) badges.push(`${minYear}–${maxYear}`);

  const traits = [
    { k: "Persona", v: who },
    { k: "Mood", v: mood },
    { k: "Tempo", v: avgTempo === null ? "Enable Audio features for tempo" : fmtTempo(avgTempo) },
    { k: "Danceability", v: avgDance === null ? "Enable Audio features for danceability" : fmtPct01(avgDance) },
    { k: "Explicit ratio", v: explicitRatio === null ? "Unknown" : `${Math.round(explicitRatio*100)}%` },
    { k: "Uniqueness", v: uniqRatio === null ? "Unknown" : `${Math.round(uniqRatio*100)}%` },
    { k: "Era range", v: (minYear && maxYear) ? `${minYear} to ${maxYear} (span ${yearSpan}y)` : "Unknown" },
    { k: "Top genres", v: topGenres.length ? topGenres.map(g => g.genre).join(" | ") : "Fetch genres to derive this" },
  ];

  const summary = `If “${name}” were a person: ${who}. ${mood}.`;
  return { summary, badges, traits };
}
