export function computeRedirectUri(){
  // Directory URL with trailing slash, no query/hash
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (url.pathname.endsWith("/index.html")){
    url.pathname = url.pathname.replace(/index\.html$/,"");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.origin + url.pathname;
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
