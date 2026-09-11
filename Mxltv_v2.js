// MXL TV GrayJay Source v2.6
// API: prop.shiwaimov.com + TMDB + Firebase + CDN MXL
// v2.6: Fix resolveServer - URLs de CDN directo (no requieren
//       validación WAF), rutas relativas contra MXL_CDN, y no se
//       descartan 401/403 de CDNs como "no existe".
// v2: extractor de video multi-etapa (JSON/HTML/M3U8/embeds), diagnóstico
//     por servidor, validación real del manifest antes de entregarlo,
//     no se detiene en el primer servidor, y las temporadas ya no
//     dependen de que T1E1 resuelva para poder listarse.
// v2.5: Worker v4.1 relay + HttpsURLConnection proxy via phone APK
//       para saltar el WAF de Cloudflare (bloquea todo excepto OkHttp 4.12.0 en Android)
// v2.1: agregado soporte de canal (isChannelUrl/getChannel/getChannelContents)
//       para resolver "No hay fuente habilitada para admitir este canal
//       (https://mxl-apps.io)" al tocar el plugin/autor.

var PID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
// UA que manda el app MXL original (Retrofit + OkHttp 4.12.0)
var UA = "okhttp/4.12.0";

var MXL_PID = new PlatformID("MxlTv", "MxlTv", PID);
var MXL_CHANNEL_URL = "https://mxl-apps.io";
var _settings = {};
var _debugLog = "";

// =========================================================
// API CONFIGURACIÓN
// =========================================================
//
// IMPORTANTE: El WAF de Cloudflare en *.shiwaimov.com bloquea
// TODAS las conexiones excepto OkHttp 4.12.0 en Android.
// Ni Cloudflare Workers, ni curl, ni navegadores, ni tls_client
// pueden pasar el WAF (JA3/TLS fingerprint check).
//
// SOLUCIÓN: Usar un proxy en el celular que ejecute OkHttp.
// Instalar el proxy con: bash phone-proxy/setup-termux.sh
//
var MXL_BRIDGE = "https://mxl-bridge.cheito55.workers.dev";

var MXL_PROP = "https://prop.shiwaimov.com";
var MXL_CHECK = "https://check.shiwaimov.com";
var MXL_API = "https://api.shiwaimov.com";
var MXL_CDN = "https://2zo6sb3myz7fapc.acek-cdn.com";

// Hosts CDN de video (sin WAF de Cloudflare). Las URLs que entrega el
// backend en estos hosts son archivos m3u8/mp4 directos.
var CDN_HOSTS = [
    "acek-cdn.com",
    "kwcdn.com",
    "97bf1.com",
    "dramiyos-cdn.com"
];

function isCdnHost(url) {
    if (!url) return false;
    var h = String(url).replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
    for (var i = 0; i < CDN_HOSTS.length; i++) {
        var c = CDN_HOSTS[i];
        if (h === c || h.slice(-c.length - 1) === "." + c) return true;
    }
    return false;
}

// =========================================================
// PROXY VÍA CELULAR (RECOMENDADO - método principal)
// Poné acá la IP:puerto de tu celular en la red local.
// En Termux ejecutá: bash ~/mxl-proxy/start.sh
// =========================================================
var MXL_PHONE_PROXY = "";  // Ej: "192.168.1.50:9223"
var USE_PROXY = MXL_PHONE_PROXY.length > 0;
var MXL_FB = "https://mxlmovies-f5eef.firebaseio.com";

var TMDB_IMG = "https://image.tmdb.org/t/p/w500";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";

var MXL_CACHE = {};
var CACHE_TTL = 1800000;
var MAX_SERVERS = 10;

// =========================================================
// LOG
// =========================================================

function log(msg) {
    _debugLog += String(msg) + "\n";
}

// =========================================================
// HTTP
// =========================================================

function httpGet(url, headers) {
    try {
        var h = headers || {};
        if (!h["User-Agent"] && !h["user-agent"]) {
            h["User-Agent"] = UA;
        }
        var r = http.GET(url, h);
        return (r && r.body) ? r.body : "";
    } catch (e) {
        log("GET Error " + url + ": " + String(e));
        return "";
    }
}

// =========================================================
// UTILIDADES
// =========================================================

function safeParse(str) {
    try { return JSON.parse(str); }
    catch (e) { return null; }
}

function cached(key) {
    var e = MXL_CACHE[key];
    if (e && (Date.now() - e.t) < CACHE_TTL) return e.d;
    return null;
}

function store(key, data) {
    MXL_CACHE[key] = { d: data, t: Date.now() };
}

function cleanUrl(url) {
    if (!url) return "";
    var s = String(url).trim()
        .replace(/&amp;/g, "&")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/");
    return s;
}

function absolutizeServerUrl(url) {
    var s = cleanUrl(url);
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    // Empieza con un hostname sin esquema → agregar https://
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\//i.test(s)) return "https://" + s;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(s)) return "https://" + s;
    // Ruta relativa → contra el CDN base
    return MXL_CDN + (s.indexOf("/") === 0 ? "" : "/") + s;
}

function isM3u8(url) {
    return url && /\.m3u8(?:[?#]|$)/i.test(String(url));
}

function fixImg(u) {
    if (!u) return "";
    var s = String(u).trim();
    if (s.indexOf("ttps://") === 0) s = "https" + s.substring(4);
    if (/^https?:\/\//i.test(s)) return s;
    s = s.replace(/^\/+/, "");
    if (!s) return "";
    if (s.indexOf(".jpg") === -1 && s.indexOf(".png") === -1 && s.indexOf(".webp") === -1) s += ".jpg";
    return TMDB_IMG + "/" + s;
}

function htmlDecode(s) {
    if (!s) return "";
    return String(s)
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, function(m, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&#x([0-9a-fA-F]+);/g, function(m, x) { return String.fromCharCode(parseInt(x, 16)); });
}

function stripTags(s) {
    if (!s) return "";
    return htmlDecode(String(s)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")).trim();
}

function detectResponseKind(body) {
    if (!body) return "empty";
    var head = body.substring(0, 800);
    if (head.indexOf("#EXTM3U") !== -1) return "m3u8";
    if (/blocked_resolve|Sorry.*blocked|block_headline|cf-error-details|Attention Required|Cloudflare Ray ID/i.test(head)) return "cloudflare_block";
    if (/Backend\.max_conn|503 Service|upstream|bad gateway/i.test(head)) return "backend_error";
    if (/^\s*[\{\[]/.test(body)) return "json";
    if (/<html|<!doctype/i.test(head)) return "html";
    return "unknown";
}

// =========================================================
// API: MXL (con proxy del celular)
// =========================================================
//
// El WAF de Cloudflare bloquea todo excepto OkHttp 4.12.0
// en Android. La solución es usar un proxy en el celular
// que ejecute OkHttp nativamente (phone-proxy/MxlProxy.java).
//
// Formato del proxy:
//   http://{IP_CELULAR}:9223/proxy/{domain}/{api_path}?appid=xxx
//
function mxlGet(path) {
    try {
        var ck = "mxl:" + path;
        var c = cached(ck);
        if (c) { log("[api] cache " + path); return c; }

        var apiPath = path;
        if (apiPath.indexOf("?") === -1) apiPath += "?";
        else apiPath += "&";
        apiPath += "appid=" + PID;

        // ESTRATEGIA (v2.4):
        //  1) Cloudflare Worker relay — funciona desde cualquier red
        //  2) Proxy local del celular (mismo WiFi)
        //  3) Conexión directa (falla por WAF, último recurso)
        var targets = [];

        // Cloudflare Worker relay (funciona desde cualquier lugar)
        if (MXL_BRIDGE) {
            targets.push({
                url: MXL_BRIDGE + "/proxy/prop.shiwaimov.com" + apiPath,
                label: "worker→prop"
            });
            targets.push({
                url: MXL_BRIDGE + "/proxy/api.shiwaimov.com" + apiPath,
                label: "worker→api"
            });
            targets.push({
                url: MXL_BRIDGE + "/proxy/check.shiwaimov.com" + apiPath,
                label: "worker→check"
            });
        }

        if (USE_PROXY) {
            // Proxy del celular: /proxy/prop.shiwaimov.com/api/v1/...
            targets.push({
                url: "http://" + MXL_PHONE_PROXY + "/proxy/prop.shiwaimov.com" + apiPath,
                label: "proxy→prop"
            });
            targets.push({
                url: "http://" + MXL_PHONE_PROXY + "/proxy/api.shiwaimov.com" + apiPath,
                label: "proxy→api"
            });
            targets.push({
                url: "http://" + MXL_PHONE_PROXY + "/proxy/check.shiwaimov.com" + apiPath,
                label: "proxy→check"
            });
        }

        // Directo (sin proxy) — probablemente bloqueado por WAF
        targets.push({ url: MXL_PROP + apiPath, label: "direct→prop" });
        targets.push({ url: MXL_API + apiPath, label: "direct→api" });
        targets.push({ url: MXL_CHECK + apiPath, label: "direct→check" });

        for (var b = 0; b < targets.length; b++) {
            var target = targets[b];
            var body;

            log("[api] GET " + target.label + " " + target.url);
            body = httpGet(target.url, {
                "User-Agent": UA,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
            });

            if (!body) { log("[api] " + target.label + " vacío"); continue; }

            if (/blocked_resolve|Sorry.*blocked|block_headline|cf-error-details|Attention Required|Cloudflare Ray ID|cloudflare/i.test(body.substring(0, 800))) {
                log("[api] " + target.label + " bloqueado por Cloudflare");
                continue;
            }

            if (/Backend\.max_conn|503 Service|upstream/i.test(body.substring(0, 200))) {
                log("[api] " + target.label + " backend rechazó (503)");
                continue;
            }

            // Errores JSON del propio Worker/Proxy
            try {
                var errJson = JSON.parse(body);
                if (errJson && errJson.error) {
                    log("[api] " + target.label + " worker/proxy error: " + (errJson.message || errJson.error));
                    continue;  // nunca cachear errores ni tratarlos como data
                }
            } catch (pe) {}

            var json = safeParse(body);
            if (!json) { log("[api] " + target.label + " JSON inválido: " + body.substring(0, 80)); continue; }

            log("[api] OK desde " + target.label);
            store(ck, json);
            return json;
        }

        log("[api] TODOS los targets fallaron para " + path);
        log("[api] ⚠️  Verificá: 1) Worker online, 2) Celular conectado vía app, 3) Celular con internet");
        return null;
    } catch (e) { log("[api] Error: " + String(e)); return null; }
}

// =========================================================
// Firebase (no necesita proxy, no está detrás de Cloudflare)
// =========================================================
function mxlFb(path) {
    try {
        var body = httpGet(MXL_FB + path + ".json", {
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
        });
        if (!body) return null;
        var json = safeParse(body);
        if (json && json.error) { log("[fb] auth: " + json.error); return null; }
        return json;
    } catch (e) { return null; }
}

// =========================================================
// API: TMDB
// =========================================================

function tmdb(path) {
    try {
        var sep = path.indexOf("?") !== -1 ? "&" : "?";
        var url = TMDB_API + path + sep + "api_key=" + TMDB_KEY;
        var ck = "tmdb:" + path;
        var c = cached(ck);
        if (c) return c;

        var body = httpGet(url, { "User-Agent": UA, "Accept": "application/json" });
        if (!body) return null;
        var json = safeParse(body);
        if (json) store(ck, json);
        return json;
    } catch (e) { return null; }
}

// =========================================================
// TMDB → Video
// =========================================================

function tmdbVideo(item) {
    var title = item.title || item.name || "Sin título";
    var year = (item.release_date || item.first_air_date || "").substring(0, 4);
    var poster = item.poster_path ? fixImg(item.poster_path) : "";
    var type = item.media_type || "movie";
    var id = item.id;
    var rating = item.vote_average ? item.vote_average.toFixed(1) : "";

    var label = type === "tv" ? "[Serie] " : "[Película] ";
    var display = label + title;
    if (year) display += " (" + year + ")";
    if (rating) display += " ⭐" + rating;

    var url = type === "tv" ? "mxl://tv/" + id : "mxl://movie/" + id;
    return mkVideo("mxl_" + type + "_" + id, display, poster, url, "MxlTv");
}

// =========================================================
// EXTRACTOR DE VIDEO — v2 multi-etapa
// =========================================================

function unescapeJs(s) {
    if (!s) return "";
    return String(s)
        .replace(/\\\//g, "/")
        .replace(/\\u([0-9a-fA-F]{4})/g, function(m, h) {
            return String.fromCharCode(parseInt(h, 16));
        })
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function dedupPreserveOrder(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var u = cleanUrl(list[i]);
        if (u && !seen[u]) { seen[u] = true; out.push(u); }
    }
    return out;
}

function findM3u8InText(text) {
    var out = [];
    if (!text) return out;
    var t = unescapeJs(text);
    var m;

    var reKeyed = /(?:file|source|src|stream|playlist|hls)\s*[:=]\s*['"]([^'"]+?\.m3u8[^'"]*)['"]/gi;
    while ((m = reKeyed.exec(t)) !== null) out.push(m[1]);

    var reAtob = /atob\(['"]([^'"]+)['"]\)/g;
    while ((m = reAtob.exec(t)) !== null) {
        try {
            var decoded = decodeURIComponent(atob(m[1]).split("").map(function(c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(""));
            var um = decoded.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi);
            if (um) for (var k = 0; k < um.length; k++) out.push(um[k]);
        } catch (e) {}
    }

    var reLoose = /https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/gi;
    while ((m = reLoose.exec(t)) !== null) out.push(m[0]);

    return dedupPreserveOrder(out);
}

function findM3u8InJson(obj, depth, out) {
    out = out || [];
    if (obj === null || obj === undefined || depth > 4) return out;
    if (typeof obj === "string") {
        if (isM3u8(obj)) out.push(obj);
        return out;
    }
    if (typeof obj !== "object") return out;
    for (var k in obj) {
        if (!obj.hasOwnProperty(k)) continue;
        findM3u8InJson(obj[k], depth + 1, out);
    }
    return out;
}

function isMp4(url) {
    return url && /\.mp4(?:[?#]|$)/i.test(String(url));
}

function findMp4InText(text) {
    var out = [];
    if (!text) return out;
    var t = unescapeJs(text);
    var m;

    var reKeyed = /(?:file|source|src|stream|url)\s*[:=]\s*['"]([^'"]+?\.mp4[^'"]*)['"]/gi;
    while ((m = reKeyed.exec(t)) !== null) out.push(m[1]);

    var reLoose = /https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/gi;
    while ((m = reLoose.exec(t)) !== null) out.push(m[0]);

    return dedupPreserveOrder(out);
}

function findMp4InJson(obj, depth, out) {
    out = out || [];
    if (obj === null || obj === undefined || depth > 4) return out;
    if (typeof obj === "string") {
        if (isMp4(obj)) out.push(obj);
        return out;
    }
    if (typeof obj !== "object") return out;
    for (var k in obj) {
        if (!obj.hasOwnProperty(k)) continue;
        findMp4InJson(obj[k], depth + 1, out);
    }
    return out;
}

function validateM3u8(url, refererUrl) {
    try {
        var body = httpGet(url, {
            "User-Agent": UA,
            "Accept": "*/*",
            "Referer": refererUrl || url,
            "Range": "bytes=0-2048"
        });
        return !!(body && body.indexOf("#EXTM3U") !== -1);
    } catch (e) { return false; }
}

function validateMp4(url) {
    try {
        var body = httpGet(url, {
            "User-Agent": UA,
            "Accept": "*/*",
            "Range": "bytes=0-2048"
        });
        var kind = detectResponseKind(body);
        return kind !== "html" && kind !== "json" && kind !== "backend_error" && kind !== "empty";
    } catch (e) { return false; }
}

function resolveServer(srvUrl, srvName, depth) {
    depth = depth || 0;
    if (!srvUrl) { log("[resolve] " + srvName + ": URL vacía"); return null; }
    srvUrl = absolutizeServerUrl(srvUrl);
    log("[resolve] " + srvName + " -> " + srvUrl);

    // Etapa 0: URL directa en un CDN de video. Los CDNs NO tienen el
    // WAF de Cloudflare; un 401/403 en el root es normal (piden token
    // en la URL/via headers) y NO significa que el video no exista.
    if (isCdnHost(srvUrl)) {
        if (/\.m3u8(?:[?#]|$)/i.test(srvUrl)) {
            log("[resolve] " + srvName + ": CDN directo HLS -> " + srvUrl);
            return { type: "hls", url: srvUrl };
        }
        log("[resolve] " + srvName + ": CDN directo MP4 -> " + srvUrl);
        return { type: "mp4", url: srvUrl };
    }

    // Etapa 1a: la URL del servidor ya ES un manifest m3u8
    if (isM3u8(srvUrl)) {
        if (validateM3u8(srvUrl)) {
            log("[resolve] " + srvName + ": m3u8 directo, validado OK");
            return { type: "hls", url: srvUrl };
        }
        log("[resolve] " + srvName + ": parece m3u8 pero no validó (¿backend/CDN caído?)");
        return null;
    }

    // Etapa 1b: la URL del servidor ya ES un archivo mp4 directo
    if (isMp4(srvUrl)) {
        if (validateMp4(srvUrl)) {
            log("[resolve] " + srvName + ": mp4 directo, validado OK");
            return { type: "mp4", url: srvUrl };
        }
        log("[resolve] " + srvName + ": parece mp4 pero no validó (¿backend/CDN caído?)");
        return null;
    }

    var originMatch = srvUrl.match(/^https?:\/\/[^\/]+/);
    var origin = originMatch ? originMatch[0] : srvUrl;

    var body = httpGet(srvUrl, { "User-Agent": UA, "Referer": origin + "/", "Origin": origin });
    var kind = detectResponseKind(body);
    log("[resolve] " + srvName + ": respuesta=" + kind + " (" + (body ? body.length : 0) + " bytes)");

    if (kind === "backend_error") {
        log("[resolve] " + srvName + ": backend rechazó la conexión (503 / max_conn)");
        return null;
    }
    if (kind === "empty") {
        log("[resolve] " + srvName + ": respuesta vacía");
        return null;
    }
    if (kind === "m3u8") {
        log("[resolve] " + srvName + ": el link del servidor ES el manifest");
        return { type: "hls", url: srvUrl };
    }

    var json = null;
    if (kind === "json") json = safeParse(body);

    // --- 1ero probamos m3u8 (streaming preferido) ---
    var m3u8Candidates = json ? findM3u8InJson(json, 0, []) : [];
    if (m3u8Candidates.length === 0) m3u8Candidates = findM3u8InText(body);

    for (var i = 0; i < m3u8Candidates.length; i++) {
        var cand = absolutizeServerUrl(m3u8Candidates[i]);
        if (isCdnHost(cand)) {
            log("[resolve] " + srvName + ": candidato m3u8 en CDN, sin validación");
            return { type: "hls", url: cand };
        }
        if (validateM3u8(cand, srvUrl)) {
            log("[resolve] " + srvName + ": candidato m3u8 #" + (i + 1) + "/" + m3u8Candidates.length + " válido");
            return { type: "hls", url: cand };
        }
        log("[resolve] " + srvName + ": candidato m3u8 #" + (i + 1) + " no validó");
    }

    // --- si no hay m3u8, probamos mp4 directo ---
    var mp4Candidates = json ? findMp4InJson(json, 0, []) : [];
    if (mp4Candidates.length === 0) mp4Candidates = findMp4InText(body);

    for (var j = 0; j < mp4Candidates.length; j++) {
        var candMp4 = absolutizeServerUrl(mp4Candidates[j]);
        if (isCdnHost(candMp4)) {
            log("[resolve] " + srvName + ": candidato mp4 en CDN, sin validación");
            return { type: "mp4", url: candMp4 };
        }
        if (validateMp4(candMp4)) {
            log("[resolve] " + srvName + ": candidato mp4 #" + (j + 1) + "/" + mp4Candidates.length + " válido");
            return { type: "mp4", url: candMp4 };
        }
        log("[resolve] " + srvName + ": candidato mp4 #" + (j + 1) + " no validó");
    }

    // --- página intermedia con iframe/embed — un solo salto ---
    if (m3u8Candidates.length === 0 && mp4Candidates.length === 0 && depth === 0) {
        var iframeM = body && body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeM && iframeM[1]) {
            var embedUrl = cleanUrl(iframeM[1]);
            if (embedUrl.indexOf("http") !== 0) {
                embedUrl = origin + (embedUrl.indexOf("/") === 0 ? "" : "/") + embedUrl;
            }
            log("[resolve] " + srvName + ": sin candidatos directos, probando iframe embebido -> " + embedUrl);
            return resolveServer(embedUrl, srvName + " (embed)", depth + 1);
        }
    }

    log("[resolve] " + srvName + ": sin manifest ni mp4 utilizable (" + m3u8Candidates.length + " m3u8 / " + mp4Candidates.length + " mp4 probados)");
    return null;
}

// =========================================================
// HELPERS: mkVideo, mkDetail, mkHls, mkDirect
// =========================================================

function mkVideo(id, title, thumb, url, author) {
    return new PlatformVideo({
        id: new PlatformID("MxlTv", id, PID),
        name: title,
        thumbnails: new Thumbnails([
            new Thumbnail(thumb || TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100)
        ]),
        author: new PlatformAuthorLink(MXL_PID, author || "MxlTv", MXL_CHANNEL_URL, "", 0),
        uploadDate: 0,
        url: url,
        duration: 0,
        viewCount: 0,
        isLive: false
    });
}

function mkDetail(id, title, thumb, url, sources, desc) {
    return new PlatformVideoDetails({
        id: new PlatformID("MxlTv", id, PID),
        name: title,
        thumbnails: new Thumbnails([
            new Thumbnail(thumb || TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100)
        ]),
        author: new PlatformAuthorLink(MXL_PID, "MxlTv", MXL_CHANNEL_URL, "", 0),
        uploadDate: 0,
        url: url,
        duration: 0,
        viewCount: 0,
        isLive: false,
        description: desc || "",
        video: new VideoSourceDescriptor(sources || [])
    });
}

function mkHls(url, name) {
    if (!url) return null;
    return new VideoSource({
        url: url,
        name: name || "HLS",
        type: "HLS",
        extra: []
    });
}

function mkDirect(url, name) {
    if (!url) return null;
    return new VideoSource({
        url: url,
        name: name || "Direct",
        type: "MP4",
        extra: []
    });
}

// =========================================================
// PELÍCULA
// =========================================================

function movieDetails(tmdbId) {
    _debugLog = "";
    log("[movie] tmdbId=" + tmdbId);

    var data = tmdb("/movie/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar");
    if (!data) return mkDetail("mxl_m_" + tmdbId, "Sin resultado", "", "mxl://movie/" + tmdbId, [], "Sin datos TMDB");

    var title = data.title || "Sin título";
    var year = (data.release_date || "").substring(0, 4);
    var poster = data.poster_path ? fixImg(data.poster_path) : "";
    var rating = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
    var runtime = data.runtime ? data.runtime + " min" : "";

    var desc = "**" + title + "**";
    if (year) desc += " (" + year + ")";
    desc += "\n⭐ " + rating + "/10";
    if (runtime) desc += " | " + runtime;
    desc += "\n\n" + (data.overview || "Sin sinopsis");

    if (data.genres) {
        desc += "\n\n--- Géneros ---";
        for (var g = 0; g < data.genres.length; g++) desc += "\n• " + data.genres[g].name;
    }

    // Servidores MXL
    desc += "\n\n--- Servidores ---";
    var sources = [];

    var servers = mxlGet("/api/v1/movie/" + tmdbId + "/servers");
    if (servers && servers.servers) {
        var srvs = servers.servers;
        for (var i = 0; i < srvs.length && i < MAX_SERVERS; i++) {
            var srv = srvs[i];
            var srvUrl = srv.url || srv.link || srv.a || "";
            if (!srvUrl) continue;
            var srvName = srv.name || srv.label || srv.b || ("S" + (i + 1));

            var resolved = resolveServer(srvUrl, srvName);
            if (resolved) {
                var src = resolved.type === "mp4"
                    ? mkDirect(resolved.url, "MXL - " + srvName)
                    : mkHls(resolved.url, "MXL - " + srvName);
                if (src) { sources.push(src); desc += "\n• " + srvName + " ✅ (" + resolved.type + ")"; }
                else desc += "\n• " + srvName + " ❌";
            } else {
                desc += "\n• " + srvName + " ❌";
            }
        }
    } else {
        desc += "\n• Backend no disponible";
    }

    // Trailers
    if (data.videos && data.videos.results) {
        var vids = data.videos.results;
        for (var v = 0; v < vids.length; v++) {
            if (vids[v].site === "YouTube" && vids[v].type === "Trailer") {
                desc += "\n\n🎬 Trailer: https://youtube.com/watch?v=" + vids[v].key;
                break;
            }
        }
    }

    // Similares
    if (data.similar && data.similar.results) {
        desc += "\n\n--- Similares ---";
        for (var r = 0; r < data.similar.results.length && r < 5; r++) {
            var rec = data.similar.results[r];
            var rt = rec.title || rec.name || "?";
            var ry = (rec.release_date || rec.first_air_date || "").substring(0, 4);
            desc += "\n• " + rt + (ry ? " (" + ry + ")" : "");
        }
    }

    return mkDetail("mxl_m_" + tmdbId, title + (year ? " (" + year + ")" : ""), poster, "mxl://movie/" + tmdbId, sources, desc);
}

// =========================================================
// SERIE
// =========================================================

function tvDetails(tmdbId) {
    _debugLog = "";
    log("[tv] tmdbId=" + tmdbId);

    var data = tmdb("/tv/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar,seasons");
    if (!data) return mkDetail("mxl_tv_" + tmdbId, "Sin resultado", "", "mxl://tv/" + tmdbId, [], "Sin datos TMDB");

    var title = data.name || "Sin título";
    var poster = data.poster_path ? fixImg(data.poster_path) : "";
    var rating = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
    var numSeasons = data.number_of_seasons || 0;
    var numEps = data.number_of_episodes || 0;

    var desc = "**" + title + "**";
    desc += "\n⭐ " + rating + "/10 | " + numSeasons + " temporadas | " + numEps + " episodios";
    desc += "\n\n" + (data.overview || "Sin sinopsis");

    if (data.genres) {
        desc += "\n\n--- Géneros ---";
        for (var g = 0; g < data.genres.length; g++) desc += "\n• " + data.genres[g].name;
    }

    desc += "\n\n--- Temporadas ---";
    var seasonList = [];
    if (data.seasons) {
        for (var si = 0; si < data.seasons.length; si++) {
            var sn = data.seasons[si];
            if (sn.season_number > 0) seasonList.push(sn);
        }
    }

    for (var si2 = 0; si2 < seasonList.length; si2++) {
        var sn2 = seasonList[si2];
        desc += "\n\nT" + sn2.season_number + ":";
        for (var ep = 1; ep <= (sn2.episode_count || 20); ep++) {
            desc += "\n  E" + ep + " → mxl://tv/" + tmdbId + "/" + sn2.season_number + "/" + ep;
        }
    }

    if (seasonList.length > 0) {
        desc += "\n\nElegí un episodio de la lista de arriba para reproducir.";
    }

    return mkDetail("mxl_tv_" + tmdbId, title, poster, "mxl://tv/" + tmdbId, [], desc);
}

// =========================================================
// EPISODIO
// =========================================================

function episodeDetails(tmdbId, seasonNum, epNum) {
    log("[ep] tmdb=" + tmdbId + " S" + seasonNum + "E" + epNum);

    var epData = tmdb("/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + epNum + "?language=es-ES");
    var title = "";
    var thumb = "";
    if (epData) {
        title = epData.name || "";
        if (epData.still_path) thumb = fixImg(epData.still_path);
    }

    var display = "T" + seasonNum + "E" + epNum;
    if (title) display += " - " + title;

    var desc = display;
    if (epData && epData.overview) desc += "\n\n" + epData.overview;
    desc += "\n\n--- Servidores ---";

    var sources = [];

    var servers = mxlGet("/api/v1/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + epNum + "/servers");
    if (servers && servers.servers) {
        var srvs = servers.servers;
        for (var i = 0; i < srvs.length && i < MAX_SERVERS; i++) {
            var srv = srvs[i];
            var srvUrl = srv.url || srv.link || srv.a || "";
            if (!srvUrl) continue;
            var srvName = srv.name || srv.label || srv.b || ("S" + (i + 1));

            var resolved = resolveServer(srvUrl, srvName);
            if (resolved) {
                var src = resolved.type === "mp4"
                    ? mkDirect(resolved.url, "MXL - " + srvName)
                    : mkHls(resolved.url, "MXL - " + srvName);
                if (src) { sources.push(src); desc += "\n• " + srvName + " ✅ (" + resolved.type + ")"; }
                else desc += "\n• " + srvName + " ❌";
            } else {
                desc += "\n• " + srvName + " ❌";
            }
        }
    } else {
        desc += "\n• Backend no disponible";
    }

    desc += "\n\n← T" + seasonNum + "E" + (epNum - 1) + ": mxl://tv/" + tmdbId + "/" + seasonNum + "/" + (epNum - 1);
    desc += "\n→ T" + seasonNum + "E" + (parseInt(epNum) + 1) + ": mxl://tv/" + tmdbId + "/" + seasonNum + "/" + (parseInt(epNum) + 1);

    return { sources: sources, desc: desc, title: display, thumb: thumb };
}

function episodeView(tmdbId, seasonNum, epNum) {
    _debugLog = "";
    var ep = episodeDetails(tmdbId, seasonNum, epNum);
    return mkDetail(
        "mxl_tv_" + tmdbId + "_" + seasonNum + "_" + epNum,
        ep.title || ("T" + seasonNum + "E" + epNum),
        ep.thumb || "",
        "mxl://tv/" + tmdbId + "/" + seasonNum + "/" + epNum,
        ep.sources,
        ep.desc
    );
}

// =========================================================
// HOME
// =========================================================

function doHome() {
    var videos = [];


    // TMDB trending
    try {
        var trending = tmdb("/trending/all/week?language=es-ES");
        if (trending && trending.results) {
            for (var i = 0; i < trending.results.length && videos.length < 20; i++) {
                videos.push(tmdbVideo(trending.results[i]));
            }
        }
    } catch (e) {}

    // TMDB películas populares
    try {
        var movies = tmdb("/movie/popular?language=es-ES&page=1");
        if (movies && movies.results) {
            for (var i = 0; i < movies.results.length && videos.length < 40; i++) {
                videos.push(tmdbVideo(movies.results[i]));
            }
        }
    } catch (e) {}

    // TMDB series populares
    try {
        var tvs = tmdb("/tv/popular?language=es-ES&page=1");
        if (tvs && tvs.results) {
            for (var i = 0; i < tvs.results.length && videos.length < 60; i++) {
                videos.push(tmdbVideo(tvs.results[i]));
            }
        }
    } catch (e) {}

    return videos;
}

// =========================================================
// SEARCH
// =========================================================

function doSearch(query) {
    var videos = [];

    try {
        var results = tmdb("/search/multi?query=" + encodeURIComponent(query) + "&language=es-ES");
        if (results && results.results) {
            for (var i = 0; i < results.results.length && videos.length < 30; i++) {
                var r = results.results[i];
                if (r.media_type === "movie" || r.media_type === "tv") {
                    videos.push(tmdbVideo(r));
                }
            }
        }
    } catch (e) {}

    // También buscar en MXL backend
    try {
        var mxl = mxlGet("/api/v1/search?q=" + encodeURIComponent(query));
        if (mxl && mxl.results) {
            for (var j = 0; j < mxl.results.length && videos.length < 50; j++) {
                var item = mxl.results[j];
                var mUrl = item.type === "tv" ? "mxl://tv/" + item.id : "mxl://movie/" + item.id;
                videos.push(mkVideo("mxl_s_" + item.id, item.title || item.name || "?", item.poster || "", mUrl, "MxlTv"));
            }
        }
    } catch (e) {}

    return videos;
}

// =========================================================
// RECOMMENDATIONS
// =========================================================

function doRecommendations(url) {
    var videos = [];
    var mm = url.match(/mxl:\/\/movie\/(\d+)/);
    if (mm) {
        try {
            var data = tmdb("/movie/" + mm[1] + "/recommendations?language=es-ES");
            if (data && data.results) {
                for (var i = 0; i < data.results.length && videos.length < 15; i++) {
                    videos.push(tmdbVideo(data.results[i]));
                }
            }
        } catch (e) {}
    }
    var ts = url.match(/mxl:\/\/tv\/(\d+)/);
    if (ts) {
        try {
            var data2 = tmdb("/tv/" + ts[1] + "/recommendations?language=es-ES");
            if (data2 && data2.results) {
                for (var j = 0; j < data2.results.length && videos.length < 15; j++) {
                    videos.push(tmdbVideo(data2.results[j]));
                }
            }
        } catch (e) {}
    }
    return videos;
}

// =========================================================

// =========================================================
// DETALLE UNIFICADO
// =========================================================

function doDetails(url) {
    if (!url) return mkDetail("", "", "", "", [], "URL vacía");


    var mm = url.match(/mxl:\/\/movie\/(\d+)/);
    if (mm) return movieDetails(mm[1]);

    var te = url.match(/mxl:\/\/tv\/(\d+)\/(\d+)\/(\d+)/);
    if (te) return episodeView(te[1], te[2], te[3]);

    var ts = url.match(/mxl:\/\/tv\/(\d+)/);
    if (ts) return tvDetails(ts[1]);

    return mkDetail("", "", "", url, [], "");
}

// =========================================================
// CANAL
// =========================================================

function doChannel() {
    return new PlatformChannel({
        id: MXL_PID,
        name: "MxlTv",
        thumbnail: TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
        banner: "",
        subscribers: 0,
        description: "MXL Movies API - Películas y Series",
        url: MXL_CHANNEL_URL,
        urlAlternatives: [],
        links: {}
    });
}

// =========================================================
// BINDINGS
// =========================================================

if (typeof source !== "undefined") {
    source.setSettings = function(s) { _settings = s || {}; };
    source.enable = function(c, s) { _settings = s || {}; };

    source.getSearchCapabilities = function() {
        return { types: [2], sorts: [], filters: [] };
    };

    source.search = function(query) {
        try { return new VideoPager(doSearch(query || ""), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.isContentDetailsUrl = function(url) {
        return url && url.indexOf("mxl://") !== -1;
    };

    source.isVideoDetailsUrl = function(url) {
        return source.isContentDetailsUrl(url);
    };

    source.getVideoDetails = function(url) {
        return source.getContentDetails(url);
    };

    source.getHome = function() {
        try { return new VideoPager(doHome(), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.isChannelUrl = function(url) {
        return url && (url === MXL_CHANNEL_URL || url.indexOf("mxl://channel/") !== -1);
    };

    source.getChannel = function(url) {
        try { return doChannel(); }
        catch (e) { return doChannel(); }
    };

    source.getChannelContents = function(url) {
        try { return new VideoPager(doHome(), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.searchSuggestions = function(query) { return []; };

    source.getContentRecommendations = function(url) {
        try { return new VideoPager(doRecommendations(url), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.getContentDetails = function(url) {
        try {
            var r = doDetails(url);
            if (r) return r;
            throw new Error("doDetails retornó null");
        } catch (e) {
            return new PlatformVideoDetails({
                id: new PlatformID("MxlTv", "error_fallo", PID),
                name: "Error",
                thumbnails: new Thumbnails([
                    new Thumbnail(TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100)
                ]),
                author: new PlatformAuthorLink(MXL_PID, "MxlTv", MXL_CHANNEL_URL, "", 0),
                uploadDate: 0,
                url: url || MXL_CHANNEL_URL,
                duration: 0, viewCount: 0, isLive: false,
                description: "Error: " + String(e) + "\n\nServidores MXL no disponibles. Verificá que el celular esté conectado.",
                video: new VideoSourceDescriptor([])
            });
        }
    };
}
