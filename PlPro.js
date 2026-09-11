// MXL TV + PlPro Hybrid Source v3.1
// Portadas: TMDB (Mxltv) — Reproducción: PlPro (plpro.org) + JkAnime
// v3.1 fixes:
//       - Extractores vidhide/voe/dood/generic copiados EXACTOS del PlPro original
//       - tmdbVideo recibe media_type explícito (fix home movies/series mezclados)
//       - ppFindTitle: matching por normalización completa (sin tildes, sin acentos)
//       - ppFindTitle: matching por palabras completas, NO substring suelto
//       - JkAnime fallback SOLO cuando TMDB tiene género Animation
//       - Defensive parsing de respuestas PlPro (array u objeto con .links)
//       - Fallback poster: backdrop_path cuando poster_path falta
//       - Pre-carga S1E1 con más caminos de retry

var PID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

var PPID = new PlatformID("PlPro", "PlPro", PID);
var _settings = {};
var _debugLog = "";

// =========================================================
// CONFIGURACIÓN
// =========================================================

var IPTV_URL = "https://plpro.org";
var IPTV_USER = "p";
var IPTV_PASS = "p";

var TMDB_IMG = "https://image.tmdb.org/t/p/w500";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";

var MXL_CACHE = {};
var CACHE_TTL = 1800000;
var MAX_SERVERS = 10;

// =========================================================
// DEBUG
// =========================================================

function addDebug(msg) {
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
        addDebug("GET Error " + url + ": " + String(e));
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

function getHost(url) {
    try {
        var m = String(url).match(/^https?:\/\/([^\/?#]+)/i);
        return m ? m[1].toLowerCase() : "";
    } catch (e) { return ""; }
}

function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

function b64decode(s) {
    try {
        return decodeURIComponent(
            atob(s).split("").map(function(c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            }).join("")
        );
    } catch (e) {
        try { return atob(s); }
        catch (e2) { return ""; }
    }
}

// Normalizar título para matching: minúsculas, sin acentos, sin puntuación, colapsar espacios
function normalizeTitle(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Normalizar título para display (solo lowercase y quitar año)
function normMatch(s) {
    return normalizeTitle(s).replace(/\s*\d{4}\s*$/, "").trim();
}

function cleanUrl(url) {
    if (!url) return "";
    var s = String(url).trim();
    s = htmlDecode(s);
    s = s.replace(/\\u0026/g, "&");
    s = s.replace(/\\\//g, "/");
    return s;
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

function isM3u8Url(url) {
    try { return url && /\.m3u8(?:[?#]|$)/i.test(String(url)); }
    catch (e) { return false; }
}

function directHls(url) {
    try {
        url = cleanUrl(url);
        if (isM3u8Url(url)) return url;
        return null;
    } catch (e) { return null; }
}

// =========================================================
// EXTRACTORES (copiados EXACTOS del PlPro original)
// =========================================================

function vidhideExtract(pageUrl) {
    try {
        var fetchUrl = pageUrl;

        if (fetchUrl.indexOf("vidhidefast.com") !== -1) {
            fetchUrl = fetchUrl.replace("vidhidefast.com", "callistanise.com");
        }
        if (fetchUrl.indexOf("vidhide.com") !== -1 && fetchUrl.indexOf("callistanise") === -1) {
            fetchUrl = fetchUrl.replace("vidhide.com", "callistanise.com");
        }

        var embedHost = getHost(fetchUrl);
        var refererBase = "https://" + embedHost + "/";

        addDebug("[vidhide] fetch=" + fetchUrl);

        var html = httpGet(fetchUrl, { "User-Agent": UA, "Referer": refererBase });
        addDebug("[vidhide] htmlLen=" + (html ? html.length : 0));

        if (!html || html.length < 500) {
            addDebug("[vidhide] HTML insuficiente");
            return null;
        }

        var splitIdx = html.lastIndexOf(".split('|')");
        addDebug("[vidhide] splitIdx=" + splitIdx);
        if (splitIdx === -1) {
            addDebug("[vidhide] No se encontró .split('|')");
            return null;
        }

        var keyEnd = html.lastIndexOf("'", splitIdx);
        var keyStart = html.lastIndexOf("'", keyEnd - 1) + 1;
        var key = html.substring(keyStart, keyEnd);
        var keyArr = key.split("|");

        addDebug("[vidhide] keyArrLen=" + keyArr.length);
        if (keyArr.length < 50) {
            addDebug("[vidhide] Array demasiado corto");
            return null;
        }

        function decode(str) {
            return str.replace(/[a-z0-9]+/g, function(token) {
                var val = parseInt(token, 36);
                if (!isNaN(val) && val > 0 && val < keyArr.length && keyArr[val] && keyArr[val].length > 1) {
                    return keyArr[val];
                }
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
            addDebug("[vidhide] txtLen=" + (txt ? txt.length : 0));
            if (txt) {
                var m3u = txt.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
                if (m3u && m3u[0]) {
                    addDebug("[vidhide] m3u8 encontrada dentro de master.txt");
                    return cleanUrl(m3u[0]);
                }
            }
        }
        addDebug("[vidhide] No se pudo convertir la fuente");
        return null;
    } catch (e) {
        addDebug("[vidhide] EXCEPTION: " + String(e));
        return null;
    }
}

function voeExtract(pageUrl) {
    try {
        addDebug("[voe] fetch=" + pageUrl);
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        addDebug("[voe] htmlLen=" + (html ? html.length : 0));
        if (!html) return null;

        var m = html.match(/hls\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) { addDebug("[voe] match directo hls"); return cleanUrl(m[1]); }

        var am = html.match(/atob\(['"]([^'"]+)['"]\)/);
        addDebug("[voe] atobMatch=" + (am ? "si" : "no"));
        if (am) {
            try {
                var d = b64decode(am[1]);
                var u = d.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
                addDebug("[voe] atob m3u8=" + (u ? "si" : "no"));
                if (u) return cleanUrl(u[0]);
            } catch (e) { addDebug("[voe] atob exception=" + String(e)); }
        }

        var fm = html.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (fm && fm[1]) { addDebug("[voe] match file"); return cleanUrl(fm[1]); }

        addDebug("[voe] ningun patron encontro nada");
        return null;
    } catch (e) {
        addDebug("[voe] EXCEPTION: " + String(e));
        return null;
    }
}

function doodExtract(pageUrl) {
    try {
        addDebug("[dood] fetch=" + pageUrl);
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        addDebug("[dood] htmlLen=" + (html ? html.length : 0));
        if (!html) return null;

        var m = html.match(/(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) { addDebug("[dood] match m3u8"); return cleanUrl(m[1]); }

        var mp4 = html.match(/(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.mp4[^'"]*)['"]/i);
        if (mp4 && mp4[1]) { addDebug("[dood] match mp4"); return cleanUrl(mp4[1]); }

        addDebug("[dood] ningun patron encontro nada");
        return null;
    } catch (e) {
        addDebug("[dood] EXCEPTION: " + String(e));
        return null;
    }
}

function genericExtract(pageUrl) {
    try {
        addDebug("[generic] fetch=" + pageUrl);
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        addDebug("[generic] htmlLen=" + (html ? html.length : 0));
        if (!html) return null;

        var m = html.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) { addDebug("[generic] match file"); return cleanUrl(m[1]); }

        m = html.match(/source\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) { addDebug("[generic] match source"); return cleanUrl(m[1]); }

        m = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
        if (m) { addDebug("[generic] match suelto m3u8"); return cleanUrl(m[0]); }

        addDebug("[generic] ningun patron encontro nada");
        return null;
    } catch (e) {
        addDebug("[generic] EXCEPTION: " + String(e));
        return null;
    }
}

function extractVideo(pageUrl) {
    if (!pageUrl) { addDebug("[extract] URL vacia"); return null; }
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

function mkThumb(url) {
    if (!url) return new Thumbnails([]);
    return new Thumbnails([new Thumbnail(url, 100)]);
}

function mkVideo(id, title, thumb, url, authorName) {
    return new PlatformVideo({
        id: new PlatformID("PlPro", String(id), PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(PPID, authorName || "PlPro", "https://plpro.org", "", 0),
        uploadDate: 0,
        url: url,
        duration: 0,
        viewCount: 0,
        isLive: false
    });
}

function mkHls(url, name) {
    if (!url) return null;
    return new HLSSource({ name: name || "HLS", url: url, duration: 0 });
}

function mkDetail(id, name, thumb, url, videoSources, description) {
    var valid = [];
    var src = videoSources || [];
    for (var i = 0; i < src.length; i++) { if (src[i]) valid.push(src[i]); }
    var desc = description || "";
    if (valid.length === 0) {
        desc += "\n\n⚠️ No se encontró fuente de vídeo reproducible.";
    } else {
        desc += "\n\n✅ Fuentes encontradas: " + valid.length;
    }
    if (_debugLog.length > 0) desc += "\n\n=== REPORTE TÉCNICO ===\n" + _debugLog;

    return new PlatformVideoDetails({
        id: new PlatformID("PlPro", String(id), PID),
        name: name || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(PPID, "PlPro", "https://plpro.org", "", 0),
        uploadDate: 0,
        url: url,
        duration: 0,
        viewCount: 0,
        isLive: false,
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
        var url = IPTV_URL + path + sep +
            "username=" + encodeURIComponent(IPTV_USER) +
            "&password=" + encodeURIComponent(IPTV_PASS);
        var r = httpGet(url, { "User-Agent": "PLPro/8" });
        if (!r) return null;
        return JSON.parse(r);
    } catch (e) { return null; }
}

// Extraer links desde respuesta PlPro (array directo u objeto con .links/.data)
function ppExtractLinks(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    return resp.links || resp.data || resp.servers || [];
}

// Buscar en catálogo PlPro por título (sin acentos, matching por palabras)
function ppFindTitle(titleQuery, onlyType) {
    var q = normMatch(titleQuery);
    if (!q) return null;

    var qWords = q.split(" ").filter(function(w) { return w.length >= 3; });

    function scoreTitle(candidate) {
        var c = normMatch(candidate);
        if (c === q) return 100;
        // Todas las palabras del query están en el candidate
        if (qWords.length > 0 && qWords.every(function(w) { return c.indexOf(w) !== -1; })) {
            var ratio = qWords.length / Math.max(c.split(" ").length, qWords.length);
            if (ratio >= 0.6) return 70 + ratio * 25;
        }
        return 0;
    }

    var bestMovie = null, bestMovieScore = 0;
    var bestSeries = null, bestSeriesScore = 0;

    if (onlyType !== "series") {
        try {
            var mdata = ppGet("/movies/resume");
            if (mdata && mdata.movies) {
                for (var i = 0; i < mdata.movies.length; i++) {
                    var m = mdata.movies[i];
                    var sc = scoreTitle(m.b || "");
                    if (sc > bestMovieScore) { bestMovieScore = sc; bestMovie = m; }
                }
            }
        } catch (e) {}
    }

    if (onlyType !== "movie") {
        try {
            var sdata = ppGet("/series");
            if (sdata && sdata.series) {
                for (var j = 0; j < sdata.series.length; j++) {
                    var s = sdata.series[j];
                    var sc2 = scoreTitle(s.b || "");
                    if (sc2 > bestSeriesScore) { bestSeriesScore = sc2; bestSeries = s; }
                }
            }
        } catch (e) {}
    }

    // Preferir el mejor match (movie o series, el que tenga mayor score)
    if (bestMovieScore >= 60 && bestMovieScore >= bestSeriesScore) {
        return { type: "movie", id: bestMovie.a, title: bestMovie.b, thumb: bestMovie.d || bestMovie.c || "" };
    }
    if (bestSeriesScore >= 60) {
        return { type: "series", id: bestSeries.a, title: bestSeries.b, thumb: bestSeries.d || bestSeries.c || "" };
    }

    return null;
}

// Obtener links de película desde PlPro
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
        addDebug("[movie] probando " + (i+1) + ": " + linkUrl);
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

// Obtener links de episodio desde PlPro (con retry de paths)
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
                addDebug("[episode] probando " + (i+1) + ": " + linkUrl);
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
        var r = httpGet(url, { "User-Agent": UA });
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
    var tmdbId = item.id;
    var url = mediaType === "tv" ? "mxl://tv/" + tmdbId : "mxl://movie/" + tmdbId;
    var display = title + (year ? " (" + year + ")" : "");
    return mkVideo(tmdbId, display, poster, url);
}

// =========================================================
// DETALLE PELÍCULA (TMDB portada + PlPro reproducción)
// =========================================================

function movieDetails(tmdbId) {
    _debugLog = "";
    addDebug("[movie] tmdbId=" + tmdbId);

    var data = tmdb("/movie/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar");
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

    if (data.genres) {
        desc += "\n\n--- Géneros ---";
        for (var g = 0; g < data.genres.length; g++) desc += "\n• " + data.genres[g].name;
    }

    desc += "\n\n--- Reproducción (PlPro) ---";
    var sources = [];

    var ppMatch = ppFindTitle(title, "movie");
    if (ppMatch && ppMatch.type === "movie") {
        addDebug("[movie] PlPro match: id=" + ppMatch.id + " title=" + ppMatch.title);
        var ppSources = ppMovieLinks(ppMatch.id);
        for (var i = 0; i < ppSources.length; i++) sources.push(ppSources[i]);
        desc += "\n✅ Encontrado en PlPro: " + ppMatch.title + " (fuentes: " + ppSources.length + ")";
    } else {
        // Intentar buscar como serie también (a veces TMDB movie es serie en PlPro)
        var ppMatchSeries = ppFindTitle(title, "series");
        if (ppMatchSeries && ppMatchSeries.type === "series") {
            addDebug("[movie] PlPro match como serie: id=" + ppMatchSeries.id);
            var epSrc = ppEpisodeLinks(ppMatchSeries.id, 1, 1);
            for (var k = 0; k < epSrc.length; k++) sources.push(epSrc[k]);
            desc += "\n✅ Encontrado como serie en PlPro: " + ppMatchSeries.title;
        } else {
            desc += "\n⚠️ No se encontró en PlPro: \"" + title + "\"";
        }
    }

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
// DETALLE SERIE (TMDB portada + PlPro reproducción)
// =========================================================

function tvDetails(tmdbId) {
    _debugLog = "";
    addDebug("[tv] tmdbId=" + tmdbId);

    var data = tmdb("/tv/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar,seasons");
    if (!data) return mkDetail("tv_" + tmdbId, "Sin resultado", "", "mxl://tv/" + tmdbId, [], "Sin datos TMDB");

    var title = data.name || "Sin título";
    var poster = data.poster_path ? fixImg(data.poster_path) : (data.backdrop_path ? fixImg(data.backdrop_path) : "");
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

    // Detectar si es anime
    var isAnime = false;
    if (data.genres) {
        for (var gi = 0; gi < data.genres.length; gi++) {
            var gn = (data.genres[gi].name || "").toLowerCase();
            if (gn === "animation" || gn === "animación" || gn === "anime") { isAnime = true; break; }
        }
    }

    // Buscar en PlPro
    var ppMatch = ppFindTitle(title, "series");
    var ppSeriesId = null;
    if (ppMatch && ppMatch.type === "series") {
        ppSeriesId = ppMatch.id;
        desc += "\n\n--- Reproducción (PlPro) ---";
        desc += "\n✅ Serie encontrada en PlPro: " + ppMatch.title;
    } else {
        desc += "\n\n--- Reproducción ---";
        desc += "\n⚠️ No se encontró en PlPro: \"" + title + "\"";
    }

    desc += "\n\n--- Temporadas y Episodios ---";

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

    // Precargar S1E1
    var sources = [];
    var ppOk = false;
    if (ppSeriesId && seasonList.length > 0) {
        desc += "\n\n--- Reproduciendo S1E1 por defecto ---";
        var epSources = ppEpisodeLinks(ppSeriesId, seasonList[0].season_number, 1);
        for (var k = 0; k < epSources.length; k++) sources.push(epSources[k]);
        if (epSources.length > 0) {
            ppOk = true;
            desc += "\n✅ Fuentes S1E1: " + epSources.length;
        } else {
            desc += "\n⚠️ Sin fuentes S1E1 en PlPro";
        }
    }

    // JkAnime fallback SOLO si es anime y PlPro no lo tiene
    if (!ppOk && isAnime) {
        desc += "\n\n--- Intentando JkAnime (anime) ---";
        var jka = jkaFindEpisode(title, seasonList.length > 0 ? seasonList[0].season_number : 1, 1);
        if (jka) {
            desc += "\n✅ Anime encontrado en JkAnime";
            var jkaSrc = mkHls(jka.url, "JkAnime");
            if (jkaSrc) sources.push(jkaSrc);
        } else {
            desc += "\n⚠️ No se encontró en JkAnime tampoco";
        }
    }

    return mkDetail("tv_" + tmdbId, title, poster, "mxl://tv/" + tmdbId, sources, desc);
}

// =========================================================
// EPISODIO (TMDB metadata + PlPro reproducción)
// =========================================================

function episodeDetails(tmdbId, seasonNum, epNum) {
    addDebug("[ep] tmdb=" + tmdbId + " S" + seasonNum + "E" + epNum);

    var epData = tmdb("/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + epNum + "?language=es-ES");
    var epTitle = "", thumb = "";
    if (epData) {
        epTitle = epData.name || "";
        if (epData.still_path) thumb = fixImg(epData.still_path);
    }

    var display = "T" + seasonNum + "E" + epNum;
    if (epTitle) display += " - " + epTitle;

    var tvData = tmdb("/tv/" + tmdbId + "?language=es-ES");
    var seriesTitle = tvData ? (tvData.name || "") : "";

    // Detectar anime
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

    // Buscar en PlPro
    var ppMatch = ppFindTitle(seriesTitle, "series");
    if (ppMatch && ppMatch.type === "series") {
        var epSources = ppEpisodeLinks(ppMatch.id, seasonNum, epNum);
        for (var i = 0; i < epSources.length; i++) sources.push(epSources[i]);
        if (epSources.length > 0) {
            desc += "\n✅ Episodio encontrado en PlPro";
        } else {
            desc += "\n⚠️ Sin fuentes para este episodio en PlPro";
        }
    } else {
        desc += "\n⚠️ Serie no encontrada en PlPro: \"" + seriesTitle + "\"";
    }

    // JkAnime fallback SOLO para anime
    if (sources.length === 0 && isAnime) {
        var jka2 = jkaFindEpisode(seriesTitle, seasonNum, epNum);
        if (jka2) {
            desc += "\n✅ Fuente cargada desde JkAnime";
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
        var animeUrl = results[0].url;
        var ep = parseInt(epNum, 10) || 1;
        var epUrl = animeUrl + ep + "/";
        var url = jkaExtractVideo(epUrl);
        if (url) return { url: url, animeUrl: animeUrl };
    } catch (e) {}
    return null;
}

// =========================================================
// HOME (con media_type explícito)
// =========================================================

function doHome() {
    var videos = [];

    // TMDB trending (tiene media_type incluido)
    try {
        var trending = tmdb("/trending/all/week?language=es-ES");
        if (trending && trending.results) {
            for (var i = 0; i < trending.results.length && videos.length < 20; i++) {
                videos.push(tmdbVideo(trending.results[i]));
            }
        }
    } catch (e) {}

    // TMDB películas populares (force movie type)
    try {
        var movies = tmdb("/movie/popular?language=es-ES&page=1");
        if (movies && movies.results) {
            for (var i2 = 0; i2 < movies.results.length && videos.length < 40; i2++) {
                videos.push(tmdbVideo(movies.results[i2], "movie"));
            }
        }
    } catch (e) {}

    // TMDB series populares (force tv type)
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
// RECOMMENDATIONS
// =========================================================

function doRecommendations(url) {
    var videos = [];

    // Películas: recomendaciones TMDB
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

    // Series: lista de episodios navegable
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
        id: PPID,
        name: "PlPro",
        thumbnail: TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
        banner: "",
        subscribers: 0,
        description: "TMDB + PlayerPro + JkAnime",
        url: "https://plpro.org",
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

    source.getSearchCapabilities = function() { return { types: [2], sorts: [], filters: [] }; };

    source.search = function(query) {
        try { return new VideoPager(doSearch(query || ""), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.isContentDetailsUrl = function(url) { return url && url.indexOf("mxl://") !== -1; };
    source.isVideoDetailsUrl = function(url) { return source.isContentDetailsUrl(url); };
    source.getVideoDetails = function(url) { return source.getContentDetails(url); };

    source.getHome = function() {
        try { return new VideoPager(doHome(), false, null); }
        catch (e) { return new VideoPager([], false, null); }
    };

    source.isChannelUrl = function(url) { return false; };
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
                name: "Error",
                thumbnails: new Thumbnails([
                    new Thumbnail(TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100)
                ]),
                author: new PlatformAuthorLink(PPID, "PlPro", "https://plpro.org", "", 0),
                uploadDate: 0,
                url: url || "https://plpro.org",
                duration: 0, viewCount: 0, isLive: false,
                description: "Error: " + String(e) + "\n\nLog:\n" + _debugLog,
                video: new VideoSourceDescriptor([])
            });
        }
    };
}
