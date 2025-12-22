export const APP = {
  name: "Spotify Playlist Exporter",
  version: "0.1.0",
};

export const DEFAULT_CONFIG = {
  clientId: "",
  redirectUri: "",
  exportPrefix: "spotify-export",
  dedupeRule: "track_id", // track_id | track_uri
  tokenStorage: "local",  // local | session
};

export const SPOTIFY = {
  authUrl: "https://accounts.spotify.com/authorize",
  tokenUrl: "https://accounts.spotify.com/api/token",
  apiBase: "https://api.spotify.com/v1",
  scopes: [
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
  ],
};
