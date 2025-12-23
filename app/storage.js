import { DEFAULT_CONFIG } from "./constants.js";

const KEY_CFG = "spe_cfg_v1";
const KEY_TOKEN = "spe_token_v1";

export function loadConfig(){
  try{
    const raw = localStorage.getItem(KEY_CFG);
    if (!raw) return { ...DEFAULT_CONFIG };
    const cfg = JSON.parse(raw);

    // Migration: old configs stored redirectUri directly; new default is auto unless user explicitly overrides.
    const merged = { ...DEFAULT_CONFIG, ...cfg };
    if (!("redirectUriMode" in cfg)){
      merged.redirectUriMode = "auto";
    }
    if ((!merged.redirectUriOverride || merged.redirectUriOverride.trim() === "") && typeof cfg.redirectUri === "string" && cfg.redirectUri.trim()){
      merged.redirectUriOverride = cfg.redirectUri.trim();
    }
    return merged;
  }catch{
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg){
  localStorage.setItem(KEY_CFG, JSON.stringify(cfg));
}

export function getTokenStorage(cfg){
  return cfg.tokenStorage === "session" ? sessionStorage : localStorage;
}

export function loadToken(cfg){
  try{
    const store = getTokenStorage(cfg);
    const raw = store.getItem(KEY_TOKEN);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch{
    return null;
  }
}

export function saveToken(cfg, token){
  const store = getTokenStorage(cfg);
  store.setItem(KEY_TOKEN, JSON.stringify(token));
}

export function clearToken(cfg){
  const store = getTokenStorage(cfg);
  store.removeItem(KEY_TOKEN);
}
