// ============================================================
// PlPro GrayJay Source — versión fusionada
// Catálogo/portadas: TMDB, idéntico al de MxlTv (fixImg, tmdbVideo,
//                    doHome, doSearch) que ya se sabe que renderiza bien.
// Backend de reproducción: plpro.org (API PlPro: ppGet, plproFindMovie,
//                    plproFindSeries) — se usa SOLO para ubicar los
//                    servidores, no para el catálogo.
// Resolución de enlaces: extractor multi-etapa de MxlTv (resolveServer),
//                    más robusto que el extractVideo original de PlPro:
//                    valida m3u8/mp4 real, soporta hosts de CDN sin
//                    validar y sigue un iframe embebido.
// Se eliminó JkAnime (ya descartado en el resto de los proyectos).
// ============================================================

var PID = "5c8f2e14-9a3b-4d67-8e12-3f6a9c5b2e88"; // NUEVO — debe coincidir exacto con el "id" del manifest .json
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
var PP_UA = "PLPro/8"; // UA específico que espera el backend plpro.org

var PPID = new PlatformID("PlPro", "PlPro", PID);
var PLPRO_CHANNEL_URL = "https://plpro.org";

var _settings = {};
var _debugLog = "";

var IPTV_URL = "https://plpro.org";
var IPTV_USER = "p";
var IPTV_PASS = "p";

var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";
var TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Hosts de CDN de video sin WAF. Agregar acá los que aparezcan al
// testear (mirar el _debugLog cuando falle un episodio); se sirven
// directo, sin pasar por la validación HTTP.
var CDN_HOSTS = [];

var CACHE = {};
var CACHE_TTL = 1800000;
var MAX_SERVERS = 10;

// ============================================================
// LOG
// ============================================================
function log(s) { _debugLog += String(s) + "\n"; }

// ============================================================
// HTTP
// ============================================================
function httpGet(url, headers) {
    try {
        var h = headers || {};
        if (!h["User-Agent"] && !h["user-agent"]) h["User-Agent"] = UA;
        var r = http.GET(url, h);
        return (r && r.body) ? r.body : "";
    } catch (e) {
        log("[GET] " + url + " -> " + String(e));
        return "";
    }
}

// ============================================================
// JSON / CACHE
// ============================================================
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function cacheGet(k) {
    var x = CACHE[k];
    if (!x) return null;
    if ((Date.now() - x.t) > CACHE_TTL) { delete CACHE[k]; return null; }
    return x.d;
}
function cachePut(k, d) { CACHE[k] = { d: d, t: Date.now() }; }

// ============================================================
// TEXTO / URL
// ============================================================
function cleanUrl(url) {
    if (!url) return "";
    return String(url).trim()
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

function htmlDecode(s) {
    if (!s) return "";
    return String(s)
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, function(m, n) { return String.fromCharCode(parseInt(n, 10)); })
        .replace(/&#x([0-9a-fA-F]+);/g, function(m, n) { return String.fromCharCode(parseInt(n, 16)); });
}

function stripTags(s) {
    if (!s) return "";
    return htmlDecode(String(s)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function normalizeTitle(s) {
    if (!s) return "";
    var x = String(s).toLowerCase()
        .replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
        .replace(/ó/g, "o").replace(/ú/g, "u").replace(/ü/g, "u").replace(/ñ/g, "n");
    x = x.replace(/[^a-z0-9]+/g, " ");
    return x.replace(/\s+/g, " ").trim();
}

function titleScore(a, b) {
    var x = normalizeTitle(a), y = normalizeTitle(b);
    if (!x || !y) return 0;
    if (x === y) return 100;
    if (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return 80;
    var ax = x.split(" "), ay = y.split(" "), hit = 0;
    for (var i = 0; i < ax.length; i++) {
        if (ax[i].length < 2) continue;
        for (var j = 0; j < ay.length; j++) { if (ax[i] === ay[j]) { hit++; break; } }
    }
    var total = Math.max(ax.length, ay.length);
    return total ? Math.round((hit / total) * 70) : 0;
}

// ============================================================
// IMÁGENES — misma lógica que MxlTv (ya validada, portadas OK)
// ============================================================
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

// ============================================================
// TMDB
// ============================================================
function tmdb(path) {
    try {
        var key = "tmdb:" + path;
        var old = cacheGet(key);
        if (old) return old;
        var sep = path.indexOf("?") >= 0 ? "&" : "?";
        var url = TMDB_API + path + sep + "api_key=" + TMDB_KEY;
        var body = httpGet(url, { "User-Agent": UA, "Accept": "application/json" });
        if (!body) return null;
        var json = safeJson(body);
        if (json) cachePut(key, json);
        return json;
    } catch (e) { log("[TMDB] " + String(e)); return null; }
}

// ============================================================
// BACKEND PLPRO (plpro.org) — solo para ubicar servidores
// ============================================================
function ppGet(path) {
    try {
        var key = "pp:" + path;
        var old = cacheGet(key);
        if (old) { log("[PlPro] cache " + path); return old; }
        var sep = path.indexOf("?") >= 0 ? "&" : "?";
        var url = IPTV_URL + path + sep +
            "username=" + encodeURIComponent(IPTV_USER) +
            "&password=" + encodeURIComponent(IPTV_PASS);
        log("[PlPro] GET " + url);
        var body = httpGet(url, { "User-Agent": PP_UA, "Accept": "application/json, text/plain, */*" });
        if (!body) { log("[PlPro] respuesta vacía"); return null; }
        var json = safeJson(body);
        if (!json) { log("[PlPro] JSON inválido: " + body.substring(0, 120)); return null; }
        cachePut(key, json);
        return json;
    } catch (e) { log("[PlPro] error " + String(e)); return null; }
}

function getItemTitle(item) {
    if (!item) return "Sin título";
    return item.title || item.name || item.original_title || item.original_name || item.b || item.a || "Sin título";
}
function getItemYear(item) {
    if (!item) return "";
    var d = item.release_date || item.first_air_date || item.year || item.date || "";
    var m = String(d).match(/(19|20)\d{2}/);
    return m ? m[0] : "";
}

function plproFindMovie(tmdbId, title, year) {
    try {
        var data = ppGet("/movies/" + tmdbId);
        if (data) return { id: tmdbId, data: data };
    } catch (e) {}
    try {
        var q = ppGet("/movies/search/" + encodeURIComponent(title));
        if (q) {
            var list = q.results || q.movies || q.data || q;
            if (Object.prototype.toString.call(list) === "[object Array]") {
                var best = null, bestScore = 0;
                for (var i = 0; i < list.length; i++) {
                    var x = list[i];
                    var score = titleScore(title, getItemTitle(x));
                    if (year && getItemYear(x) && year === getItemYear(x)) score += 25;
                    if (score > bestScore) { bestScore = score; best = x; }
                }
                if (best && bestScore >= 60) return { id: best.id || best.a || best._id, data: best };
            }
        }
    } catch (e2) {}
    try {
        var resume = ppGet("/movies/resume");
        if (resume) {
            var arr = resume.results || resume.movies || resume.data || resume;
            if (Object.prototype.toString.call(arr) === "[object Array]") {
                var b = null, bs = 0;
                for (var j = 0; j < arr.length; j++) {
                    var it = arr[j];
                    var sc = titleScore(title, getItemTitle(it));
                    if (year && getItemYear(it) && year === getItemYear(it)) sc += 25;
                    if (sc > bs) { bs = sc; b = it; }
                }
                if (b && bs >= 60) return { id: b.id || b.a || b._id, data: b };
            }
        }
    } catch (e3) {}
    return null;
}

function plproFindSeries(tmdbId, title, year) {
    try {
        var direct = ppGet("/series/" + tmdbId);
        if (direct) return { id: tmdbId, data: direct };
    } catch (e) {}
    try {
        var q = ppGet("/series/search/" + encodeURIComponent(title));
        if (q) {
            var list = q.results || q.series || q.data || q;
            if (Object.prototype.toString.call(list) === "[object Array]") {
                var best = null, bestScore = 0;
                for (var i = 0; i < list.length; i++) {
                    var x = list[i];
                    var score = titleScore(title, getItemTitle(x));
                    if (year && getItemYear(x) && year === getItemYear(x)) score += 25;
                    if (score > bestScore) { bestScore = score; best = x; }
                }
                if (best && bestScore >= 60) return { id: best.id || best.a || best._id, data: best };
            }
        }
    } catch (e2) {}
    return null;
}

// ============================================================
// RESOLUCIÓN DE ENLACES — extractor multi-etapa de MxlTv
// ============================================================
function isM3u8(url) { return url && /\.m3u8(?:[?#]|$)/i.test(String(url)); }
function isMp4(url) { return url && /\.mp4(?:[?#]|$)/i.test(String(url)); }

function isCdnHost(url) {
    if (!url || !CDN_HOSTS.length) return false;
    var h = String(url).replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
    for (var i = 0; i < CDN_HOSTS.length; i++) {
        var c = CDN_HOSTS[i];
        if (h === c || h.slice(-c.length - 1) === "." + c) return true;
    }
    return false;
}

function unescapeJs(s) {
    if (!s) return "";
    return String(s).replace(/\\\//g, "/")
        .replace(/\\u([0-9a-fA-F]{4})/g, function(m, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function dedupPreserveOrder(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
        var u = cleanUrl(list[i]);
        if (u && !seen[u]) { seen[u] = true; out.push(u); }
    }
    return out;
}

function findM3u8InText(text) {
    var out = [];
    if (!text) return out;
    var t = unescapeJs(text), m;
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
    if (typeof obj === "string") { if (isM3u8(obj)) out.push(obj); return out; }
    if (typeof obj !== "object") return out;
    for (var k in obj) { if (obj.hasOwnProperty(k)) findM3u8InJson(obj[k], depth + 1, out); }
    return out;
}

function findMp4InText(text) {
    var out = [];
    if (!text) return out;
    var t = unescapeJs(text), m;
    var reKeyed = /(?:file|source|src|stream|url)\s*[:=]\s*['"]([^'"]+?\.mp4[^'"]*)['"]/gi;
    while ((m = reKeyed.exec(t)) !== null) out.push(m[1]);
    var reLoose = /https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/gi;
    while ((m = reLoose.exec(t)) !== null) out.push(m[0]);
    return dedupPreserveOrder(out);
}

function findMp4InJson(obj, depth, out) {
    out = out || [];
    if (obj === null || obj === undefined || depth > 4) return out;
    if (typeof obj === "string") { if (isMp4(obj)) out.push(obj); return out; }
    if (typeof obj !== "object") return out;
    for (var k in obj) { if (obj.hasOwnProperty(k)) findMp4InJson(obj[k], depth + 1, out); }
    return out;
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

function absolutizeServerUrl(url, base) {
    var s = cleanUrl(url);
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.indexOf("//") === 0) return "https:" + s;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\//i.test(s)) return "https://" + s;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(s)) return "https://" + s;
    if (!base) return s;
    var m = base.match(/^https?:\/\/[^\/]+/i);
    if (!m) return s;
    return m[0] + (s.indexOf("/") === 0 ? "" : "/") + s;
}

function validateM3u8(url, refererUrl) {
    try {
        var body = httpGet(url, { "User-Agent": UA, "Accept": "*/*", "Referer": refererUrl || url, "Range": "bytes=0-2048" });
        return !!(body && body.indexOf("#EXTM3U") !== -1);
    } catch (e) { return false; }
}

function validateMp4(url) {
    try {
        var body = httpGet(url, { "User-Agent": UA, "Accept": "*/*", "Range": "bytes=0-2048" });
        var kind = detectResponseKind(body);
        return kind !== "html" && kind !== "json" && kind !== "backend_error" && kind !== "empty";
    } catch (e) { return false; }
}

function resolveServer(srvUrl, srvName, depth) {
    depth = depth || 0;
    if (!srvUrl) { log("[resolve] " + srvName + ": URL vacía"); return null; }
    srvUrl = absolutizeServerUrl(srvUrl);
    log("[resolve] " + srvName + " -> " + srvUrl);

    if (isCdnHost(srvUrl)) {
        if (isM3u8(srvUrl)) { log("[resolve] " + srvName + ": CDN directo HLS"); return { type: "hls", url: srvUrl }; }
        log("[resolve] " + srvName + ": CDN directo MP4");
        return { type: "mp4", url: srvUrl };
    }
    if (isM3u8(srvUrl)) {
        if (validateM3u8(srvUrl)) { log("[resolve] " + srvName + ": m3u8 directo OK"); return { type: "hls", url: srvUrl }; }
        log("[resolve] " + srvName + ": m3u8 no validó"); return null;
    }
    if (isMp4(srvUrl)) {
        if (validateMp4(srvUrl)) { log("[resolve] " + srvName + ": mp4 directo OK"); return { type: "mp4", url: srvUrl }; }
        log("[resolve] " + srvName + ": mp4 no validó"); return null;
    }

    var originMatch = srvUrl.match(/^https?:\/\/[^\/]+/);
    var origin = originMatch ? originMatch[0] : srvUrl;
    var body = httpGet(srvUrl, { "User-Agent": UA, "Referer": origin + "/", "Origin": origin });
    var kind = detectResponseKind(body);
    log("[resolve] " + srvName + ": respuesta=" + kind + " (" + (body ? body.length : 0) + " bytes)");

    if (kind === "backend_error" || kind === "empty") return null;
    if (kind === "m3u8") return { type: "hls", url: srvUrl };

    var json = kind === "json" ? safeJson(body) : null;

    var m3u8Candidates = json ? findM3u8InJson(json, 0, []) : [];
    if (!m3u8Candidates.length) m3u8Candidates = findM3u8InText(body);
    for (var i = 0; i < m3u8Candidates.length; i++) {
        var cand = absolutizeServerUrl(m3u8Candidates[i], srvUrl);
        if (isCdnHost(cand)) return { type: "hls", url: cand };
        if (validateM3u8(cand, srvUrl)) return { type: "hls", url: cand };
    }

    var mp4Candidates = json ? findMp4InJson(json, 0, []) : [];
    if (!mp4Candidates.length) mp4Candidates = findMp4InText(body);
    for (var j = 0; j < mp4Candidates.length; j++) {
        var candMp4 = absolutizeServerUrl(mp4Candidates[j], srvUrl);
        if (isCdnHost(candMp4)) return { type: "mp4", url: candMp4 };
        if (validateMp4(candMp4)) return { type: "mp4", url: candMp4 };
    }

    if (!m3u8Candidates.length && !mp4Candidates.length && depth === 0) {
        var iframeM = body && body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeM && iframeM[1]) {
            var embedUrl = absolutizeServerUrl(iframeM[1], srvUrl);
            log("[resolve] " + srvName + ": probando iframe embebido -> " + embedUrl);
            return resolveServer(embedUrl, srvName + " (embed)", depth + 1);
        }
    }

    log("[resolve] " + srvName + ": sin manifest ni mp4 utilizable");
    return null;
}

// ============================================================
// HELPERS DE VIDEO
// ============================================================
function mkThumb(url) {
    return new Thumbnails([ new Thumbnail(url || TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100) ]);
}
function mkVideo(id, title, thumb, url) {
    return new PlatformVideo({
        id: new PlatformID("PlPro", id, PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(PPID, "PlPro", PLPRO_CHANNEL_URL, "", 0),
        uploadDate: 0, url: url, duration: 0, viewCount: 0, isLive: false
    });
}
function mkDetail(id, title, thumb, url, sources, desc) {
    return new PlatformVideoDetails({
        id: new PlatformID("PlPro", id, PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(PPID, "PlPro", PLPRO_CHANNEL_URL, "", 0),
        uploadDate: 0, url: url, duration: 0, viewCount: 0, isLive: false,
        description: desc || "",
        video: new VideoSourceDescriptor(sources || [])
    });
}
function mkHls(url, name) { return url ? new VideoSource({ url: url, name: name || "HLS", type: "HLS", extra: [] }) : null; }
function mkDirect(url, name) { return url ? new VideoSource({ url: url, name: name || "MP4", type: "MP4", extra: [] }) : null; }

// ============================================================
// TMDB → CATÁLOGO (idéntico a MxlTv)
// ============================================================
function tmdbVideo(item) {
    if (!item) return null;
    var title = item.title || item.name || "Sin título";
    var year = (item.release_date || item.first_air_date || "").substring(0, 4);
    var poster = item.poster_path ? fixImg(item.poster_path) : "";
    var type = item.media_type || (item.first_air_date ? "tv" : "movie");
    var id = item.id;
    var rating = item.vote_average ? Number(item.vote_average).toFixed(1) : "";
    var prefix = type === "tv" ? "[Serie] " : "[Película] ";
    var display = prefix + title + (year ? " (" + year + ")" : "") + (rating ? " ⭐" + rating : "");
    var url = type === "tv" ? "plpro://tv/" + id : "plpro://movie/" + id;
    return mkVideo("tmdb_" + type + "_" + id, display, poster, url);
}

// ============================================================
// PELÍCULA
// ============================================================
function movieDetails(tmdbId) {
    _debugLog = "";
    log("[movie] id=" + tmdbId);

    // El id que llega puede ser un id real de TMDB (recomendaciones/home)
    // o un id nativo de PlPro (viene de la búsqueda propia de PlPro).
    // Probamos TMDB primero; si no matchea, usamos los datos propios
    // de PlPro (raw) para no perder el detalle ni los servidores.
    var data = tmdb("/movie/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar");

    var plRaw = null;
    var plId = tmdbId;

    if (!data) {
        log("[movie] TMDB no matcheó ese id; probando como id nativo de PlPro");
        plRaw = ppGet("/movies/" + tmdbId);
        if (!plRaw) {
            return mkDetail("plpro_movie_" + tmdbId, "Sin resultado", "", "plpro://movie/" + tmdbId, [], "No se encontró ni en TMDB ni en PlPro.");
        }
    }

    var title = data ? (data.title || "Sin título") : getItemTitle(plRaw);
    var year = data ? (data.release_date || "").substring(0, 4) : getItemYear(plRaw);
    var poster = data && data.poster_path ? fixImg(data.poster_path) : getItemImage(plRaw);
    var rating = data && data.vote_average ? Number(data.vote_average).toFixed(1) : "N/A";

    var desc = "**" + title + "**" + (year ? " (" + year + ")" : "") + "\n⭐ " + rating + "/10";
    if (data && data.runtime) desc += " | " + data.runtime + " min";
    desc += "\n\n" + (data ? (data.overview || "Sin sinopsis") : "Sin sinopsis (sin datos de TMDB)");
    if (data && data.genres) {
        desc += "\n\n--- Géneros ---";
        for (var g = 0; g < data.genres.length; g++) desc += "\n• " + data.genres[g].name;
    }

    var sources = [];
    desc += "\n\n--- Servidores PlPro ---";

    // Si ya tenemos el objeto crudo de PlPro (porque el id era nativo),
    // no hace falta buscar de nuevo: el id de entrada YA es el id de PlPro.
    if (!plRaw) {
        var pl = plproFindMovie(tmdbId, title, year);
        plId = pl && pl.id ? pl.id : tmdbId;
    }
    log("[movie] PlPro ID = " + plId);

    var links = ppGet("/movies/" + plId + "/links");
    if (links) {
        var list = links.links || links.results || links.servers || links.data || links;
        if (Object.prototype.toString.call(list) === "[object Array]") {
            for (var i = 0; i < list.length && i < MAX_SERVERS; i++) {
                var item = list[i];
                var link = item.url || item.link || item.src || item.a || "";
                if (!link) continue;
                var name = item.name || item.label || item.server || ("Servidor " + (i + 1));
                var resolved = resolveServer(link, name);
                if (resolved) {
                    var src = resolved.type === "hls" ? mkHls(resolved.url, "PlPro - " + name) : mkDirect(resolved.url, "PlPro - " + name);
                    if (src) { sources.push(src); desc += "\n• " + name + " ✅ (" + resolved.type + ")"; }
                    else desc += "\n• " + name + " ❌";
                } else {
                    desc += "\n• " + name + " ❌";
                }
            }
        }
    } else {
        desc += "\n• Backend PlPro no disponible";
    }
    if (!sources.length) {
        desc += "\n• No se pudo resolver ningún servidor.";
        desc += "\n\n--- Diagnóstico ---\n" + _debugLog.substring(0, 2500);
    }

    if (data && data.videos && data.videos.results) {
        for (var v = 0; v < data.videos.results.length; v++) {
            var trailer = data.videos.results[v];
            if (trailer.site === "YouTube" && trailer.type === "Trailer") {
                desc += "\n\n🎬 Trailer: https://youtube.com/watch?v=" + trailer.key;
                break;
            }
        }
    }

    return mkDetail("plpro_movie_" + tmdbId, title + (year ? " (" + year + ")" : ""), poster, "plpro://movie/" + tmdbId, sources, desc);
}

// ============================================================
// SERIE
// ============================================================
function tvDetails(tmdbId) {
    _debugLog = "";
    log("[tv] id=" + tmdbId);
    var data = tmdb("/tv/" + tmdbId + "?language=es-ES&append_to_response=seasons,credits,similar");

    if (data) {
        var title = data.name || "Sin título";
        var year = (data.first_air_date || "").substring(0, 4);
        var poster = data.poster_path ? fixImg(data.poster_path) : "";
        var rating = data.vote_average ? Number(data.vote_average).toFixed(1) : "N/A";

        var desc = "**" + title + "**" + (year ? " (" + year + ")" : "") + "\n⭐ " + rating + "/10";
        desc += "\n\n" + (data.overview || "Sin sinopsis");
        if (data.genres) {
            desc += "\n\n--- Géneros ---";
            for (var g = 0; g < data.genres.length; g++) desc += "\n• " + data.genres[g].name;
        }

        desc += "\n\n--- Episodios ---";
        var seasonCount = 0;
        if (data.seasons) {
            for (var s = 0; s < data.seasons.length; s++) {
                var season = data.seasons[s];
                if (!season || season.season_number <= 0) continue;
                seasonCount++;
                var count = season.episode_count || 0;
                desc += "\n\nT" + season.season_number + " (" + count + " episodios):";
                for (var e = 1; e <= count; e++) {
                    desc += "\nE" + e + " → plpro://tv/" + tmdbId + "/" + season.season_number + "/" + e;
                }
            }
        }
        if (!seasonCount) desc += "\nNo se encontraron temporadas.";
        desc += "\n\nSeleccioná un episodio para reproducir.";

        return mkDetail("plpro_tv_" + tmdbId, title, poster, "plpro://tv/" + tmdbId, [], desc);
    }

    // El id no matcheó en TMDB: probamos como id nativo de PlPro.
    // No sabemos aún el formato exacto de la respuesta de /series/{id}
    // de PlPro, así que mostramos su contenido crudo para poder
    // armar el listado de temporadas/episodios en el próximo ajuste.
    log("[tv] TMDB no matcheó ese id; probando como id nativo de PlPro");
    var plRaw = ppGet("/series/" + tmdbId);
    if (!plRaw) {
        return mkDetail("plpro_tv_" + tmdbId, "Sin resultado", "", "plpro://tv/" + tmdbId, [], "No se encontró ni en TMDB ni en PlPro.");
    }

    var pTitle = getItemTitle(plRaw);
    var pPoster = getItemImage(plRaw);
    var pDesc = "**" + pTitle + "**\n\nNo se pudo obtener el listado de temporadas desde TMDB con este id.";
    pDesc += "\n\n--- Datos crudos de PlPro (para depurar) ---\n";
    try { pDesc += JSON.stringify(plRaw).substring(0, 1500); }
    catch (e) { pDesc += "No se pudo serializar la respuesta."; }

    return mkDetail("plpro_tv_" + tmdbId, pTitle, pPoster, "plpro://tv/" + tmdbId, [], pDesc);
}

// ============================================================
// EPISODIO
// ============================================================
function episodeDetails(tmdbId, seasonNum, episodeNum) {
    log("[episode] " + tmdbId + " S" + seasonNum + "E" + episodeNum);
    var data = tmdb("/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + episodeNum + "?language=es-ES");
    var title = "", thumb = "";
    if (data) {
        title = data.name || "";
        if (data.still_path) thumb = fixImg(data.still_path);
    }
    var display = "T" + seasonNum + "E" + episodeNum + (title ? " - " + title : "");
    var desc = "**" + display + "**";
    if (data && data.overview) desc += "\n\n" + data.overview;
    desc += "\n\n--- Servidores PlPro ---";

    var sources = [];
    var links = ppGet("/series/" + tmdbId + "/links/" + seasonNum + "/" + episodeNum);

    if (!links) {
        var seriesTitle = "";
        try {
            var tv = tmdb("/tv/" + tmdbId + "?language=es-ES");
            if (tv) seriesTitle = tv.name || "";
        } catch (e) {}
        if (seriesTitle) {
            var found = plproFindSeries(tmdbId, seriesTitle, data && data.air_date ? data.air_date.substring(0, 4) : "");
            if (found && found.id) {
                links = ppGet("/series/" + found.id + "/links/" + seasonNum + "/" + episodeNum);
            }
        }
    }

    if (links) {
        var list = links.links || links.results || links.servers || links.data || links;
        if (Object.prototype.toString.call(list) === "[object Array]") {
            for (var i = 0; i < list.length && i < MAX_SERVERS; i++) {
                var item = list[i];
                var link = item.url || item.link || item.src || item.a || "";
                if (!link) continue;
                var name = item.name || item.label || item.server || ("Servidor " + (i + 1));
                var resolved = resolveServer(link, name);
                if (resolved) {
                    var src = resolved.type === "hls" ? mkHls(resolved.url, "PlPro - " + name) : mkDirect(resolved.url, "PlPro - " + name);
                    if (src) { sources.push(src); desc += "\n• " + name + " ✅ (" + resolved.type + ")"; }
                    else desc += "\n• " + name + " ❌";
                } else {
                    desc += "\n• " + name + " ❌";
                }
            }
        }
    }
    if (!sources.length) {
        desc += "\n• Ningún servidor pudo ser resuelto.";
        desc += "\n\n--- Diagnóstico ---\n" + _debugLog.substring(0, 2500);
    }

    var prev = parseInt(episodeNum, 10) - 1;
    var next = parseInt(episodeNum, 10) + 1;
    if (prev >= 1) desc += "\n\n← Episodio anterior: plpro://tv/" + tmdbId + "/" + seasonNum + "/" + prev;
    desc += "\n→ Episodio siguiente: plpro://tv/" + tmdbId + "/" + seasonNum + "/" + next;

    return { title: display, thumb: thumb, sources: sources, desc: desc };
}

function episodeView(tmdbId, seasonNum, episodeNum) {
    _debugLog = "";
    var ep = episodeDetails(tmdbId, seasonNum, episodeNum);
    return mkDetail(
        "plpro_tv_" + tmdbId + "_" + seasonNum + "_" + episodeNum,
        ep.title, ep.thumb,
        "plpro://tv/" + tmdbId + "/" + seasonNum + "/" + episodeNum,
        ep.sources, ep.desc
    );
}

// ============================================================
// HOME
// ============================================================
function doHome() {
    var videos = [], seen = {};
    try {
        var trending = tmdb("/trending/all/week?language=es-ES");
        if (trending && trending.results) {
            for (var i = 0; i < trending.results.length && videos.length < 20; i++) {
                var r = trending.results[i];
                if (r.media_type !== "movie" && r.media_type !== "tv") continue;
                var key = r.media_type + "_" + r.id;
                if (seen[key]) continue;
                var v = tmdbVideo(r);
                if (v) { seen[key] = true; videos.push(v); }
            }
        }
    } catch (e) {}
    try {
        var movies = tmdb("/movie/popular?language=es-ES&page=1");
        if (movies && movies.results) {
            for (var m = 0; m < movies.results.length && videos.length < 40; m++) {
                var mk = "movie_" + movies.results[m].id;
                if (seen[mk]) continue;
                var mv = tmdbVideo(movies.results[m]);
                if (mv) { seen[mk] = true; videos.push(mv); }
            }
        }
    } catch (e2) {}
    try {
        var tv = tmdb("/tv/popular?language=es-ES&page=1");
        if (tv && tv.results) {
            for (var t = 0; t < tv.results.length && videos.length < 60; t++) {
                var tk = "tv_" + tv.results[t].id;
                if (seen[tk]) continue;
                var tvv = tmdbVideo(tv.results[t]);
                if (tvv) { seen[tk] = true; videos.push(tvv); }
            }
        }
    } catch (e3) {}
    return videos;
}

// ============================================================
// IMAGEN DE ITEM DE PLPRO (para mostrar algo mientras no haya match TMDB)
// ============================================================
function getItemImage(item) {
    if (!item) return "";
    var candidates = [
        item.poster, item.poster_path, item.image, item.img,
        item.thumbnail, item.thumb, item.cover, item.cover_url,
        item.picture, item.photo, item.logo, item.d, item.c
    ];
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i]) {
            var x = fixImg(candidates[i]);
            if (x) return x;
        }
    }
    return "";
}

// ============================================================
// SEARCH — SOLO catálogo real de PlPro (nunca resultados que
// PlPro no tenga, aunque existan en TMDB)
// ============================================================
function doSearch(query) {
    var videos = [], seen = {};
    if (!query) return videos;

    // Películas: catálogo propio de PlPro
    try {
        var mq = ppGet("/movies/search/" + encodeURIComponent(query));
        var mlist = mq ? (mq.results || mq.movies || mq.data || mq) : null;
        if (Object.prototype.toString.call(mlist) === "[object Array]") {
            for (var i = 0; i < mlist.length && videos.length < 30; i++) {
                var it = mlist[i];
                var id = it.id || it.a || it._id;
                if (!id || seen["m_" + id]) continue;
                seen["m_" + id] = true;
                var title = getItemTitle(it);
                var year = getItemYear(it);
                var poster = getItemImage(it);
                var display = "[Película] " + title + (year ? " (" + year + ")" : "");
                videos.push(mkVideo("plpro_m_" + id, display, poster, "plpro://movie/" + id));
            }
        }
    } catch (e) { log("[search movies] " + String(e)); }

    // Series: catálogo propio de PlPro
    try {
        var sq = ppGet("/series/search/" + encodeURIComponent(query));
        var slist = sq ? (sq.results || sq.series || sq.data || sq) : null;
        if (Object.prototype.toString.call(slist) === "[object Array]") {
            for (var j = 0; j < slist.length && videos.length < 50; j++) {
                var it2 = slist[j];
                var id2 = it2.id || it2.a || it2._id;
                if (!id2 || seen["s_" + id2]) continue;
                seen["s_" + id2] = true;
                var title2 = getItemTitle(it2);
                var year2 = getItemYear(it2);
                var poster2 = getItemImage(it2);
                var display2 = "[Serie] " + title2 + (year2 ? " (" + year2 + ")" : "");
                videos.push(mkVideo("plpro_s_" + id2, display2, poster2, "plpro://tv/" + id2));
            }
        }
    } catch (e2) { log("[search series] " + String(e2)); }

    // Si no encontramos nada, mostramos el diagnóstico como un
    // resultado "falso" en la lista para poder ver qué pasó sin
    // depender del DevServer.
    if (!videos.length) {
        videos.push(mkVideo(
            "plpro_debug",
            "[DEBUG] Sin resultados — abrir para ver detalle",
            "",
            "plpro://debug/search/" + encodeURIComponent(query)
        ));
    }

    return videos;
}

// ============================================================
// RECOMMENDATIONS
// ============================================================
function doRecommendations(url) {
    var videos = [];
    var mm = url.match(/plpro:\/\/movie\/(\d+)/);
    if (mm) {
        try {
            var data = tmdb("/movie/" + mm[1] + "/recommendations?language=es-ES");
            if (data && data.results) {
                for (var i = 0; i < data.results.length && videos.length < 15; i++) {
                    var v = tmdbVideo(data.results[i]);
                    if (v) videos.push(v);
                }
            }
        } catch (e) {}
    }
    var tt = url.match(/plpro:\/\/tv\/(\d+)/);
    if (tt) {
        try {
            var data2 = tmdb("/tv/" + tt[1] + "/recommendations?language=es-ES");
            if (data2 && data2.results) {
                for (var j = 0; j < data2.results.length && videos.length < 15; j++) {
                    var vv = tmdbVideo(data2.results[j]);
                    if (vv) videos.push(vv);
                }
            }
        } catch (e2) {}
    }
    return videos;
}

// ============================================================
// DETAILS ROUTER
// ============================================================
function doDetails(url) {
    if (!url) return mkDetail("", "", "", "", [], "URL vacía");

    var dbg = url.match(/^plpro:\/\/debug\/search\/(.+)$/);
    if (dbg) {
        var q = decodeURIComponent(dbg[1]);
        _debugLog = "";
        log("[debug] repitiendo búsqueda para: " + q);
        var mq2 = ppGet("/movies/search/" + encodeURIComponent(q));
        log("[debug] /movies/search respuesta cruda:\n" + (mq2 ? JSON.stringify(mq2).substring(0, 1200) : "null"));
        var sq2 = ppGet("/series/search/" + encodeURIComponent(q));
        log("[debug] /series/search respuesta cruda:\n" + (sq2 ? JSON.stringify(sq2).substring(0, 1200) : "null"));
        return mkDetail("plpro_debug", "Diagnóstico de búsqueda: " + q, "", url, [], _debugLog.substring(0, 3000));
    }

    var mm = url.match(/plpro:\/\/movie\/(\d+)/);
    if (mm) return movieDetails(mm[1]);
    var ep = url.match(/plpro:\/\/tv\/(\d+)\/(\d+)\/(\d+)/);
    if (ep) return episodeView(ep[1], ep[2], ep[3]);
    var tv = url.match(/plpro:\/\/tv\/(\d+)/);
    if (tv) return tvDetails(tv[1]);
    return mkDetail("", "PlPro", "", url, [], "");
}

// ============================================================
// CANAL
// ============================================================
function doChannel() {
    return new PlatformChannel({
        id: PPID,
        name: "PlPro",
        thumbnail: TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
        banner: "", subscribers: 0,
        description: "PlPro - Películas y series (catálogo TMDB + backend PlPro)",
        url: PLPRO_CHANNEL_URL, urlAlternatives: [], links: {}
    });
}

// ============================================================
// BINDINGS
// ============================================================
if (typeof source !== "undefined") {
    source.setSettings = function(s) { _settings = s || {}; };
    source.enable = function(c, s) { _settings = s || {}; };
    source.getSearchCapabilities = function() { return { types: [2], sorts: [], filters: [] }; };

    source.search = function(query) {
        try { return new VideoPager(doSearch(query || ""), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.isContentDetailsUrl = function(url) { return !!(url && url.indexOf("plpro://") === 0); };
    source.isVideoDetailsUrl = function(url) { return source.isContentDetailsUrl(url); };
    source.getVideoDetails = function(url) { return source.getContentDetails(url); };

    source.getHome = function() {
        try { return new VideoPager(doHome(), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.isChannelUrl = function(url) { return !!(url && (url === PLPRO_CHANNEL_URL || url.indexOf("plpro://channel/") === 0)); };
    source.getChannel = function(url) { try { return doChannel(); } catch (e) { return doChannel(); } };
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
                id: new PlatformID("PlPro", "error_fallo", PID),
                name: "Error PlPro",
                thumbnails: mkThumb(""),
                author: new PlatformAuthorLink(PPID, "PlPro", PLPRO_CHANNEL_URL, "", 0),
                uploadDate: 0, url: url || PLPRO_CHANNEL_URL, duration: 0, viewCount: 0, isLive: false,
                description: "Error: " + String(e) + "\n\n" + _debugLog,
                video: new VideoSourceDescriptor([])
            });
        }
    };
}
