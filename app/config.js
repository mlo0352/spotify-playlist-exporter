export function computeRedirectUri(){
  // Directory URL with trailing slash, no query/hash
  return new URL(".", window.location.href).toString();
}

export function normalizeRedirectUri(input){
  const url = new URL(String(input || ""), window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolveRedirectUri(cfg){
  if (cfg?.redirectUriMode === "override" && cfg?.redirectUriOverride){
    return normalizeRedirectUri(cfg.redirectUriOverride);
  }
  return computeRedirectUri();
}

export function isDev(){
  const h = window.location.hostname;
  return h === "127.0.0.1" || h === "localhost";
}

