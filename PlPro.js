// MXL TV + PlPro Hybrid Source v4.0
// Portadas: TMDB — Reproducción: PlPro (plpro.org) + JkAnime
// v4.0: Match directo por TMDB ID (campo 'j' de PlPro /movies/resume)
//       - Películas: lookup O(1) por TMDB ID → PlPro ID
//       - Series: title matching normalizado (sin acentos) + fallback JkAnime para anime
//       - Extractores vidhide exactos del PlPro original (base-36 decode)
//       - tmdbVideo con forcedType para home (movie/popular y tv/popular)

var PID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

var PPID = new PlatformID("PlPro", "PlPro", PID);
var _settings = {};
var _debugLog = "";

var IPTV_URL = "https://plpro.org";
var IPTV_USER = "p";
var IPTV_PASS = "p";

var TMDB_IMG = "https://image.tmdb.org/t/p/w500";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";

var MAX_SERVERS = 10;
var MXL_CACHE = {};
var CACHE_TTL = 1800000;

// =========================================================
// LOG
// =========================================================

function addDebug(msg) { _debugLog += String(msg) + "\n"; }

// =========================================================
// HTTP
// =========================================================

function httpGet(url, headers) {
    try {
        var h = headers || {};
        if (!h["User-Agent"] && !h["user-agent"]) h["User-Agent"] = UA;
        var r = http.GET(url, h);
        return (r && r.body) ? r.body : "";
    } catch (e) { addDebug("GET Error " + url + ": " + String(e)); return ""; }
}

// =========================================================
// UTILIDADES
// =========================================================

function safeParse(str) { try { return JSON.parse(str); } catch (e) { return null; } }

function cached(key) {
    var e = MXL_CACHE[key];
    if (e && (Date.now() - e.t) < CACHE_TTL) return e.d;
    return null;
}

function store(key, data) { MXL_CACHE[key] = { d: data, t: Date.now() }; }

function getHost(url) {
    try { var m = String(url).match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].toLowerCase() : ""; }
    catch (e) { return ""; }
}

function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function htmlDecode(s) {
    if (!s) return "";
    return String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, function(m, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&#x([0-9a-fA-F]+);/g, function(m, x) { return String.fromCharCode(parseInt(x, 16)); });
}

function cleanUrl(url) {
    if (!url) return "";
    return String(url).trim().replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
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

function isM3u8Url(url) { try { return url && /\.m3u8(?:[?#]|$)/i.test(String(url)); } catch (e) { return false; } }
function directHls(url) { try { url = cleanUrl(url); return isM3u8Url(url) ? url : null; } catch (e) { return null; } }

// Normalizar para matching: lowercase, quitar acentos (NFD), quitar puntuación
function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// =========================================================
// EXTRACTORES (del PlPro original)
// =========================================================

function vidhideExtract(pageUrl) {
    try {
        var fetchUrl = pageUrl;
        if (fetchUrl.indexOf("vidhidefast.com") !== -1) fetchUrl = fetchUrl.replace("vidhidefast.com", "callistanise.com");
        if (fetchUrl.indexOf("vidhide.com") !== -1 && fetchUrl.indexOf("callistanise") === -1) fetchUrl = fetchUrl.replace("vidhide.com", "callistanise.com");
        var embedHost = getHost(fetchUrl);
        var refererBase = "https://" + embedHost + "/";
        addDebug("[vidhide] fetch=" + fetchUrl);
        var html = httpGet(fetchUrl, { "User-Agent": UA, "Referer": refererBase });
        addDebug("[vidhide] htmlLen=" + (html ? html.length : 0));
        if (!html || html.length < 500) { addDebug("[vidhide] HTML insuficiente"); return null; }
        var splitIdx = html.lastIndexOf(".split('|')");
        addDebug("[vidhide] splitIdx=" + splitIdx);
        if (splitIdx === -1) { addDebug("[vidhide] No se encontró .split('|')"); return null; }
        var keyEnd = html.lastIndexOf("'", splitIdx);
        var keyStart = html.lastIndexOf("'", keyEnd - 1) + 1;
        var key = html.substring(keyStart, keyEnd);
        var keyArr = key.split("|");
        addDebug("[vidhide] keyArrLen=" + keyArr.length);
        if (keyArr.length < 50) { addDebug("[vidhide] Array demasiado corto"); return null; }
        function decode(str) {
            return str.replace(/[a-z0-9]+/g, function(token) {
                var val = parseInt(token, 36);
                if (!isNaN(val) && val > 0 && val < keyArr.length && keyArr[val] && keyArr[val].length > 1) return keyArr[val];
                return token;
            });
        }
        var urls = html.match(/["'][a-z0-9]+:\/\/[^"']+["']/gi) || [];
        addDebug("[vidhide] candidateUrls=" + urls.length);
        var best = null;
        for (var i = 0; i < urls.length; i++) {
            var raw = urls[i].substring(1, urls[i].length - 1);
            var dec = cleanUrl(decode(raw));
            if (dec.indexOf("master.") !== -1 && dec.indexOf(".m3u8") !== -1) { best = dec; break; }
            if (!best && dec.indexOf("master.") !== -1 && dec.indexOf(".txt") !== -1) { best = dec; }
        }
        addDebug("[vidhide] best=" + (best || "none"));
        if (!best) return null;
        if (isM3u8Url(best)) return best;
        if (/\.txt(?:[?#]|$)/i.test(best)) {
            addDebug("[vidhide] master.txt detectado");
            var txt = httpGet(best, { "User-Agent": UA, "Referer": refererBase });
            if (txt) {
                var m3u = txt.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
                if (m3u && m3u[0]) { addDebug("[vidhide] m3u8 dentro de master.txt"); return cleanUrl(m3u[0]); }
            }
        }
        addDebug("[vidhide] No se pudo convertir");
        return null;
    } catch (e) { addDebug("[vidhide] EXCEPTION: " + String(e)); return null; }
}

function voeExtract(pageUrl) {
    try {
        addDebug("[voe] fetch=" + pageUrl);
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        if (!html) return null;
        var m = html.match(/hls\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);
        var am = html.match(/atob\(['"]([^'"]+)['"]\)/);
        if (am) { try { var d = decodeURIComponent(atob(am[1]).split("").map(function(c){return "%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)}).join("")); var u = d.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i); if (u) return cleanUrl(u[0]); } catch(e){} }
        var fm = html.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (fm && fm[1]) return cleanUrl(fm[1]);
    } catch (e) { addDebug("[voe] EXCEPTION: " + String(e)); }
    return null;
}

function doodExtract(pageUrl) {
    try {
        addDebug("[dood] fetch=" + pageUrl);
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        if (!html) return null;
        var m = html.match(/(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);
        var mp4 = html.match(/(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.mp4[^'"]*)['"]/i);
        if (mp4 && mp4[1]) return cleanUrl(mp4[1]);
    } catch (e) { addDebug("[dood] EXCEPTION: " + String(e)); }
    return null;
}

function genericExtract(pageUrl) {
    try {
        addDebug("[generic] fetch=" + pageUrl);
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        if (!html) return null;
        var m = html.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);
        m = html.match(/source\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);
        m = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
        if (m) return cleanUrl(m[0]);
    } catch (e) { addDebug("[generic] EXCEPTION: " + String(e)); }
    return null;
}

function extractVideo(pageUrl) {
    if (!pageUrl) return null;
    pageUrl = cleanUrl(pageUrl);
    if (isM3u8Url(pageUrl)) return directHls(pageUrl);
    var host = getHost(pageUrl);
    addDebug("[extract] host=" + host);
    if (host.indexOf("vidhide") !== -1 || host.indexOf("callistanise") !== -1) return vidhideExtract(pageUrl);
    if (host.indexOf("voe") !== -1) return voeExtract(pageUrl);
    if (host.indexOf("dood") !== -1 || host.indexOf("do7go") !== -1) return doodExtract(pageUrl);
    return genericExtract(pageUrl);
}

// =========================================================
// VIDEO OBJECTS
// =========================================================

function mkThumb(url) { return url ? new Thumbnails([new Thumbnail(url, 100)]) : new Thumbnails([]); }

function mkVideo(id, title, thumb, url, authorName) {
    return new PlatformVideo({
        id: new PlatformID("PlPro", String(id), PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(PPID, authorName || "PlPro", "https://plpro.org", "", 0),
        uploadDate: 0, url: url, duration: 0, viewCount: 0, isLive: false
    });
}

function mkHls(url, name) { return url ? new HLSSource({ name: name || "HLS", url: url, duration: 0 }) : null; }

function mkDetail(id, name, thumb, url, videoSources, description) {
    var valid = [];
    var src = videoSources || [];
    for (var i = 0; i < src.length; i++) { if (src[i]) valid.push(src[i]); }
    var desc = description || "";
    desc += valid.length ? ("\n\n✅ Fuentes: " + valid.length) : "\n\n⚠️ Sin fuente reproducible.";
    if (_debugLog.length > 0) desc += "\n\n=== REPORTE TÉCNICO ===\n" + _debugLog;
    return new PlatformVideoDetails({
        id: new PlatformID("PlPro", String(id), PID),
        name: name || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(PPID, "PlPro", "https://plpro.org", "", 0),
        uploadDate: 0, url: url, duration: 0, viewCount: 0, isLive: false,
        video: new VideoSourceDescriptor(valid),
        description: desc
    });
}

// =========================================================
// PLPRO API
// =========================================================

function ppGet(path) {
    try {
        var sep = path.indexOf("?") !== -1 ? "&" : "?";
        var url = IPTV_URL + path + sep + "username=" + encodeURIComponent(IPTV_USER) + "&password=" + encodeURIComponent(IPTV_PASS);
        var r = httpGet(url, { "User-Agent": "PLPro/8" });
        return r ? JSON.parse(r) : null;
    } catch (e) { return null; }
}

function ppExtractLinks(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    return resp.links || resp.data || resp.servers || [];
}

// =========================================================
// MAPA TMDB ID → PLPRO (películas)
// =========================================================

// Construye un mapa { tmdbId: plproId } desde /movies/resume
// Campo 'j' = TMDB ID, campo 'a' = PlPro ID
var _movieMap = null;

function buildMovieMap() {
    if (_movieMap) return _movieMap;
    try {
        var data = ppGet("/movies/resume");
        if (data && data.movies) {
            _movieMap = {};
            for (var i = 0; i < data.movies.length; i++) {
                var m = data.movies[i];
                if (m.j) _movieMap[String(m.j)] = m;
            }
            addDebug("[movieMap] Construido: " + Object.keys(_movieMap).length + " películas");
        }
    } catch (e) { addDebug("[movieMap] Error: " + String(e)); }
    if (!_movieMap) _movieMap = {};
    return _movieMap;
}

// Buscar película por TMDB ID directo
function ppFindByTmdbId(tmdbId) {
    var map = buildMovieMap();
    var key = String(tmdbId);
    if (map[key]) {
        var m = map[key];
        addDebug("[movie] TMDB match directo: " + m.b + " (PlPro ID " + m.a + ")");
        return { type: "movie", id: m.a, title: m.b, thumb: m.d || m.c || "" };
    }
    return null;
}

// Buscar serie: título normalizado → verificar con campo 'tmdb' del detalle
function ppFindSeries(titleQuery, tmdbIdHint) {
    var q = norm(titleQuery).replace(/\s*\d{4}\s*$/, "").trim();
    if (!q) return null;

    // Paso 1: encontrar candidatos por título
    var candidates = [];
    try {
        var sdata = ppGet("/series");
        if (sdata && sdata.series) {
            for (var j = 0; j < sdata.series.length; j++) {
                var s = sdata.series[j];
                var c1 = norm(s.b || "");
                var c2 = norm(s.i || "");
                if (c1 === q || c2 === q) {
                    // Exacto: verificar directo
                    return { type: "series", id: s.a, title: s.b, thumb: s.d || s.c || "" };
                }
                // Score por palabras significativas (>=3 chars)
                var qWords = q.split(" ").filter(function(w) { return w.length >= 3; });
                if (qWords.length === 0) continue;
                var matched = 0;
                for (var w = 0; w < qWords.length; w++) {
                    if (c1.indexOf(qWords[w]) !== -1 || (c2 && c2.indexOf(qWords[w]) !== -1)) matched++;
                }
                var ratio = matched / qWords.length;
                if (ratio >= 0.7) candidates.push({ item: s, score: ratio });
            }
        }
    } catch (e) { addDebug("[series] Error: " + String(e)); }

    if (candidates.length === 0) return null;

    // Paso 2: ordenar por score, verificar con tmdb del detalle
    candidates.sort(function(a, b) { return b.score - a.score; });
    var limit = Math.min(candidates.length, 5);

    for (var c = 0; c < limit; c++) {
        var cand = candidates[c].item;
        try {
            var detail = ppGet("/series/" + cand.a);
            if (detail && detail.tmdb) {
                // Si tenemos el tmdb del TMDB, verificar que coincida
                if (tmdbIdHint && String(detail.tmdb) === String(tmdbIdHint)) {
                    addDebug("[series] tmdb verify OK: " + cand.b + " (tmdb=" + detail.tmdb + ")");
                    return { type: "series", id: cand.a, title: cand.b, thumb: cand.d || cand.c || "" };
                }
                // Sin tmdbHint: devolver el mejor candidato verificado
                addDebug("[series] verified by title: " + cand.b + " (tmdb=" + detail.tmdb + ")");
                return { type: "series", id: cand.a, title: cand.b, thumb: cand.d || cand.c || "" };
            }
        } catch (e) {}
    }

    // Fallback: mejor candidato sin verificar
    var best = candidates[0].item;
    addDebug("[series] fallback title match: " + best.b);
    return { type: "series", id: best.a, title: best.b, thumb: best.d || best.c || "" };
}

// =========================================================
// PLPRO: LINKS
// =========================================================

function ppMovieLinks(ppId) {
    var resp = ppGet("/movies/" + ppId + "/links");
    var links = ppExtractLinks(resp);
    if (!links.length) return [];
    var sources = [];
    for (var i = 0; i < links.length && i < MAX_SERVERS; i++) {
        var link = links[i];
        var linkUrl = link.a || "";
        if (!linkUrl) continue;
        var serverName = (link.b || "Servidor") + (link.c ? " [" + link.c + "]" : "");
        addDebug("[movie] probando " + (i+1) + ": " + serverName);
        var extracted = extractVideo(linkUrl);
        if (extracted) {
            var src = mkHls(extracted, serverName);
            if (src) { sources.push(src); addDebug("[movie] FUENTE OK: " + serverName); }
        } else {
            addDebug("[movie] FALLÓ: " + serverName);
        }
    }
    return sources;
}

function ppEpisodeLinks(ppId, season, episode) {
    var paths = [
        "/series/" + ppId + "/links/" + season + "/" + episode,
        "/series/" + ppId + "/links/" + season + "/" + episode + "/"
    ];
    for (var p = 0; p < paths.length; p++) {
        var resp = ppGet(paths[p]);
        var links = ppExtractLinks(resp);
        if (links.length) {
            var sources = [];
            for (var i = 0; i < links.length && i < MAX_SERVERS; i++) {
                var link = links[i];
                var linkUrl = link.a || "";
                if (!linkUrl) continue;
                var serverName = (link.b || "Servidor") + (link.c ? " [" + link.c + "]" : "");
                addDebug("[episode] probando " + (i+1) + ": " + serverName);
                var extracted = extractVideo(linkUrl);
                if (extracted) {
                    var src = mkHls(extracted, serverName);
                    if (src) { sources.push(src); addDebug("[episode] FUENTE OK: " + serverName); }
                } else {
                    addDebug("[episode] FALLÓ: " + serverName);
                }
            }
            if (sources.length) return sources;
        }
    }
    return [];
}

// =========================================================
// TMDB
// =========================================================

function tmdb(path) {
    try {
        var ck = "tmdb:" + path;
        var c = cached(ck);
        if (c) return c;
        var sep = path.indexOf("?") !== -1 ? "&" : "?";
        var url = TMDB_API + path + sep + "api_key=" + TMDB_KEY;
        var r = httpGet(url);
        var data = safeParse(r);
        if (data) store(ck, data);
        return data;
    } catch (e) { return null; }
}

function tmdbVideo(item, forcedType) {
    if (!item) return null;
    var title = item.title || item.name || "Sin título";
    var year = (item.release_date || item.first_air_date || "").substring(0, 4);
    var poster = item.poster_path ? fixImg(item.poster_path) : (item.backdrop_path ? fixImg(item.backdrop_path) : "");
    var mediaType = forcedType || item.media_type || "movie";
    var url = mediaType === "tv" ? "mxl://tv/" + item.id : "mxl://movie/" + item.id;
    return mkVideo(item.id, title + (year ? " (" + year + ")" : ""), poster, url);
}

// =========================================================
// DETALLE PELÍCULA: TMDB ID directo → PlPro
// =========================================================

function movieDetails(tmdbId) {
    _debugLog = "";
    addDebug("[movie] tmdbId=" + tmdbId);

    var data = tmdb("/movie/" + tmdbId + "?language=es-ES&append_to_response=videos,similar");
    if (!data) return mkDetail("m_" + tmdbId, "Sin resultado", "", "mxl://movie/" + tmdbId, [], "Sin datos TMDB");

    var title = data.title || "Sin título";
    var year = (data.release_date || "").substring(0, 4);
    var poster = data.poster_path ? fixImg(data.poster_path) : (data.backdrop_path ? fixImg(data.backdrop_path) : "");
    var rating = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
    var runtime = data.runtime ? data.runtime + " min" : "";

    var desc = "**" + title + "**";
    if (year) desc += " (" + year + ")";
    desc += "\n⭐ " + rating + "/10";
    if (runtime) desc += " | " + runtime;
    desc += "\n\n" + (data.overview || "Sin sinopsis");

    desc += "\n\n--- Reproducción (PlPro) ---";
    var sources = [];

    // 1) Match directo por TMDB ID (campo 'j' de PlPro)
    var ppMatch = ppFindByTmdbId(tmdbId);

    // 2) Fallback: buscar por título normalizado
    if (!ppMatch) {
        addDebug("[movie] TMDB ID " + tmdbId + " no encontrado en mapa, intentando título");
        try {
            var q = norm(title);
            var mdata = ppGet("/movies/resume");
            if (mdata && mdata.movies) {
                for (var i = 0; i < mdata.movies.length; i++) {
                    var m = mdata.movies[i];
                    var c = norm(m.b || "");
                    // Exacto o query contiene el título completo (no substring suelto)
                    if (c === q) {
                        ppMatch = { type: "movie", id: m.a, title: m.b, thumb: m.d || m.c || "" };
                        break;
                    }
                }
            }
        } catch (e) {}
    }

    if (ppMatch && ppMatch.type === "movie") {
        var ppSources = ppMovieLinks(ppMatch.id);
        for (var k = 0; k < ppSources.length; k++) sources.push(ppSources[k]);
        desc += "\n✅ " + ppMatch.title + " → " + ppSources.length + " fuentes";
    } else {
        desc += "\n⚠️ No encontrada en PlPro: \"" + title + "\"";
    }

    // Trailer
    if (data.videos && data.videos.results) {
        for (var v = 0; v < data.videos.results.length; v++) {
            if (data.videos.results[v].site === "YouTube" && data.videos.results[v].type === "Trailer") {
                desc += "\n\n🎬 Trailer: https://youtube.com/watch?v=" + data.videos.results[v].key;
                break;
            }
        }
    }

    return mkDetail("m_" + tmdbId, title + (year ? " (" + year + ")" : ""), poster, "mxl://movie/" + tmdbId, sources, desc);
}

// =========================================================
// DETALLE SERIE
// =========================================================

function tvDetails(tmdbId) {
    _debugLog = "";
    addDebug("[tv] tmdbId=" + tmdbId);

    var data = tmdb("/tv/" + tmdbId + "?language=es-ES&append_to_response=videos,similar,seasons");
    if (!data) return mkDetail("tv_" + tmdbId, "Sin resultado", "", "mxl://tv/" + tmdbId, [], "Sin datos TMDB");

    var title = data.name || "Sin título";
    var poster = data.poster_path ? fixImg(data.poster_path) : (data.backdrop_path ? fixImg(data.backdrop_path) : "");
    var rating = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
    var numSeasons = data.number_of_seasons || 0;
    var numEps = data.number_of_episodes || 0;

    var desc = "**" + title + "**";
    desc += "\n⭐ " + rating + "/10 | " + numSeasons + " temp. | " + numEps + " eps";
    desc += "\n\n" + (data.overview || "Sin sinopsis");

    if (data.genres) {
        desc += "\n\n--- Géneros ---";
        for (var g = 0; g < data.genres.length; g++) desc += "\n• " + data.genres[g].name;
    }

    // Detectar anime
    var isAnime = false;
    if (data.genres) {
        for (var gi = 0; gi < data.genres.length; gi++) {
            var gn = (data.genres[gi].name || "").toLowerCase();
            if (gn === "animation" || gn === "animación" || gn === "anime") { isAnime = true; break; }
        }
    }

    // Buscar serie en PlPro por título, verificar con tmdbId
    var ppMatch = ppFindSeries(title, tmdbId);
    var ppSeriesId = null;
    if (ppMatch) {
        ppSeriesId = ppMatch.id;
        desc += "\n\n--- Reproducción (PlPro) ---";
        desc += "\n✅ Serie encontrada: " + ppMatch.title;
    } else {
        desc += "\n\n--- Reproducción ---";
        desc += "\n⚠️ No encontrada en PlPro: \"" + title + "\"";
    }

    // Listar temporadas/episodios
    desc += "\n\n--- Temporadas y Episodios ---";
    var seasonList = [];
    if (data.seasons) {
        for (var si = 0; si < data.seasons.length; si++) {
            if (data.seasons[si].season_number > 0) seasonList.push(data.seasons[si]);
        }
    }
    for (var si2 = 0; si2 < seasonList.length; si2++) {
        var sn2 = seasonList[si2];
        desc += "\n\nT" + sn2.season_number + ":";
        for (var ep = 1; ep <= (sn2.episode_count || 20); ep++) {
            desc += "\n  E" + ep + " → mxl://tv/" + tmdbId + "/" + sn2.season_number + "/" + ep;
        }
    }

    // Precargar S1E1
    var sources = [];
    var ppOk = false;
    if (ppSeriesId && seasonList.length > 0) {
        desc += "\n\n--- Reproduciendo S1E1 ---";
        var epSources = ppEpisodeLinks(ppSeriesId, seasonList[0].season_number, 1);
        for (var k = 0; k < epSources.length; k++) sources.push(epSources[k]);
        if (epSources.length > 0) {
            ppOk = true;
            desc += "\n✅ S1E1: " + epSources.length + " fuentes";
        } else {
            desc += "\n⚠️ Sin fuentes S1E1";
        }
    }

    // JkAnime fallback solo para anime
    if (!ppOk && isAnime) {
        desc += "\n\n--- Intentando JkAnime ---";
        var jka = jkaFindEpisode(title, seasonList.length > 0 ? seasonList[0].season_number : 1, 1);
        if (jka) {
            desc += "\n✅ Anime en JkAnime";
            var jkaSrc = mkHls(jka.url, "JkAnime");
            if (jkaSrc) sources.push(jkaSrc);
        } else {
            desc += "\n⚠️ No encontrado en JkAnime";
        }
    }

    return mkDetail("tv_" + tmdbId, title, poster, "mxl://tv/" + tmdbId, sources, desc);
}

// =========================================================
// EPISODIO
// =========================================================

function episodeDetails(tmdbId, seasonNum, epNum) {
    addDebug("[ep] tmdb=" + tmdbId + " S" + seasonNum + "E" + epNum);

    var epData = tmdb("/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + epNum + "?language=es-ES");
    var epTitle = "", thumb = "";
    if (epData) { epTitle = epData.name || ""; if (epData.still_path) thumb = fixImg(epData.still_path); }

    var display = "T" + seasonNum + "E" + epNum;
    if (epTitle) display += " - " + epTitle;

    var tvData = tmdb("/tv/" + tmdbId + "?language=es-ES");
    var seriesTitle = tvData ? (tvData.name || "") : "";

    var isAnime = false;
    if (tvData && tvData.genres) {
        for (var gi = 0; gi < tvData.genres.length; gi++) {
            var gn = (tvData.genres[gi].name || "").toLowerCase();
            if (gn === "animation" || gn === "animación" || gn === "anime") { isAnime = true; break; }
        }
    }

    var desc = display;
    if (epData && epData.overview) desc += "\n\n" + epData.overview;
    desc += "\n\n--- Reproducción (PlPro) ---";

    var sources = [];

    var ppMatch = ppFindSeries(seriesTitle, tmdbId);
    if (ppMatch) {
        var epSources = ppEpisodeLinks(ppMatch.id, seasonNum, epNum);
        for (var i = 0; i < epSources.length; i++) sources.push(epSources[i]);
        desc += sources.length ? "\n✅ Episodio encontrado en PlPro" : "\n⚠️ Sin fuentes en PlPro";
    } else {
        desc += "\n⚠️ Serie no encontrada en PlPro: \"" + seriesTitle + "\"";
    }

    // JkAnime fallback solo para anime
    if (sources.length === 0 && isAnime) {
        var jka2 = jkaFindEpisode(seriesTitle, seasonNum, epNum);
        if (jka2) {
            desc += "\n✅ Fuente de JkAnime";
            var jkaSrc2 = mkHls(jka2.url, "JkAnime");
            if (jkaSrc2) sources.push(jkaSrc2);
        }
    }

    desc += "\n\n← T" + seasonNum + "E" + (epNum - 1) + ": mxl://tv/" + tmdbId + "/" + seasonNum + "/" + (epNum - 1);
    desc += "\n→ T" + seasonNum + "E" + (parseInt(epNum) + 1) + ": mxl://tv/" + tmdbId + "/" + seasonNum + "/" + (parseInt(epNum) + 1);

    return { sources: sources, desc: desc, title: display, thumb: thumb };
}

function episodeView(tmdbId, seasonNum, epNum) {
    _debugLog = "";
    var ep = episodeDetails(tmdbId, seasonNum, epNum);
    return mkDetail(
        "tv_" + tmdbId + "_" + seasonNum + "_" + epNum,
        ep.title || ("T" + seasonNum + "E" + epNum),
        ep.thumb || "",
        "mxl://tv/" + tmdbId + "/" + seasonNum + "/" + epNum,
        ep.sources,
        ep.desc
    );
}

// =========================================================
// JKANIME (respaldo solo para anime)
// =========================================================

function jkaSearch(query) {
    var out = [];
    try {
        var slug = slugify(query);
        if (!slug) return out;
        var html = httpGet("https://jkanime.net/buscar/" + slug + "/", { "Referer": "https://jkanime.net/" });
        if (!html) return out;
        var re = /<div class="anime__item">\s*<a\s+href="(https?:\/\/jkanime\.net\/[a-z0-9-]+\/)"[^>]*>[\s\S]*?<div[^>]*data-setbg="([^"]*)"[\s\S]*?<h5><a[^>]*>([^<]+)<\/a><\/h5>/gi;
        var m;
        while ((m = re.exec(html)) && out.length < 20) {
            out.push({ title: htmlDecode(m[3]), url: m[1], thumb: m[2] });
        }
    } catch (e) {}
    return out;
}

function jkaExtractVideo(episodeUrl) {
    try {
        var html = httpGet(episodeUrl, { "Referer": "https://jkanime.net/" });
        if (!html) return null;
        var re = /video\[\d+\]\s*=\s*'[^']*src="(https?:\/\/jkanime\.net\/jkplayer\/um[^"]*)"/i;
        var m = html.match(re);
        if (!m || !m[1]) return null;
        var playerUrl = m[1].replace(/&amp;/g, "&");
        var playerHtml = httpGet(playerUrl, { "Referer": episodeUrl });
        if (!playerHtml) return null;
        var m3u8 = playerHtml.match(/url\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m3u8 && m3u8[1]) return cleanUrl(m3u8[1]);
    } catch (e) {}
    return null;
}

function jkaFindEpisode(titleQuery, seasonNum, epNum) {
    try {
        var results = jkaSearch(titleQuery);
        if (!results.length) return null;
        var ep = parseInt(epNum, 10) || 1;
        var url = jkaExtractVideo(results[0].url + ep + "/");
        if (url) return { url: url };
    } catch (e) {}
    return null;
}

// =========================================================
// HOME (con forcedType)
// =========================================================

function doHome() {
    var videos = [];
    try {
        var trending = tmdb("/trending/all/week?language=es-ES");
        if (trending && trending.results) {
            for (var i = 0; i < trending.results.length && videos.length < 20; i++) {
                videos.push(tmdbVideo(trending.results[i]));
            }
        }
    } catch (e) {}
    try {
        var movies = tmdb("/movie/popular?language=es-ES&page=1");
        if (movies && movies.results) {
            for (var i2 = 0; i2 < movies.results.length && videos.length < 40; i2++) {
                videos.push(tmdbVideo(movies.results[i2], "movie"));
            }
        }
    } catch (e) {}
    try {
        var tvs = tmdb("/tv/popular?language=es-ES&page=1");
        if (tvs && tvs.results) {
            for (var i3 = 0; i3 < tvs.results.length && videos.length < 60; i3++) {
                videos.push(tmdbVideo(tvs.results[i3], "tv"));
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
    return videos;
}

// =========================================================
// RECOMMENDATIONS (episodios para series, similares para movies)
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
        return videos;
    }
    var ts = url.match(/mxl:\/\/tv\/(\d+)/);
    if (ts) {
        var tmdbId = ts[1];
        var sdata = tmdb("/tv/" + tmdbId + "?language=es-ES");
        var sTitle = sdata ? (sdata.name || "Serie") : "Serie";
        var poster = sdata && sdata.poster_path ? fixImg(sdata.poster_path) : "";
        var seasons = sdata ? (sdata.seasons || []) : [];
        for (var si = 0; si < seasons.length; si++) {
            var sn = seasons[si];
            if (!sn.season_number) continue;
            var epData = tmdb("/tv/" + tmdbId + "/season/" + sn.season_number + "?language=es-ES");
            var eps = (epData && epData.episodes) ? epData.episodes : [];
            for (var ei = 0; ei < eps.length && videos.length < 40; ei++) {
                var ep = eps[ei];
                var epThumb = ep.still_path ? fixImg(ep.still_path) : poster;
                videos.push(mkVideo(
                    "tv_" + tmdbId + "_" + sn.season_number + "_" + ep.episode_number,
                    sTitle + " S" + sn.season_number + "E" + ep.episode_number + (ep.name ? " - " + ep.name : ""),
                    epThumb,
                    "mxl://tv/" + tmdbId + "/" + sn.season_number + "/" + ep.episode_number
                ));
            }
        }
    }
    return videos;
}

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
        id: PPID, name: "PlPro",
        thumbnail: TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
        banner: "", subscribers: 0,
        description: "TMDB + PlayerPro + JkAnime",
        url: "https://plpro.org", urlAlternatives: [], links: {}
    });
}

// =========================================================
// BINDINGS
// =========================================================

if (typeof source !== "undefined") {
    source.setSettings = function(s) { _settings = s || {}; };
    source.enable = function(c, s) { _settings = s || {}; };
    source.getSearchCapabilities = function() { return { types: [2], sorts: [], filters: [] }; };
    source.search = function(q) { try { return new VideoPager(doSearch(q||""), false, null); } catch(e) { return new VideoPager([], false, null); } };
    source.isContentDetailsUrl = function(url) { return url && url.indexOf("mxl://") !== -1; };
    source.isVideoDetailsUrl = function(url) { return source.isContentDetailsUrl(url); };
    source.getVideoDetails = function(url) { return source.getContentDetails(url); };
    source.getHome = function() { try { return new VideoPager(doHome(), false, null); } catch(e) { return new VideoPager([], false, null); } };
    source.isChannelUrl = function() { return false; };
    source.searchSuggestions = function() { return []; };
    source.getContentRecommendations = function(url) { try { return new VideoPager(doRecommendations(url), false, null); } catch(e) { return new VideoPager([], false, null); } };
    source.getContentDetails = function(url) {
        try {
            var r = doDetails(url);
            if (r) return r;
            throw new Error("doDetails null");
        } catch (e) {
            return new PlatformVideoDetails({
                id: new PlatformID("PlPro", "error_fallo", PID),
                name: "Error",
                thumbnails: new Thumbnails([new Thumbnail(TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100)]),
                author: new PlatformAuthorLink(PPID, "PlPro", "https://plpro.org", "", 0),
                uploadDate: 0, url: url || "https://plpro.org",
                duration: 0, viewCount: 0, isLive: false,
                description: "Error: " + String(e) + "\n\n" + _debugLog,
                video: new VideoSourceDescriptor([])
            });
        }
    };
}
