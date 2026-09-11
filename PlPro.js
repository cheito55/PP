// MXL TV + PlPro Hybrid Source v3.0
// Portadas: TMDB (Mxltv) — Reproducción: PlPro (plpro.org)
// v3.0: Fusion MXL (portadas TMDB) + PlPro (reproducción).
//       - Home y búsqueda usan TMDB para portadas prolijas
//       - Detalle usa TMDB para metadata + portada
//       - Reproducción resuelve desde PlPro (movies/links, series/links)
//       - Búsqueda cruzada: busca por título en PlPro para encontrar el ID
//       - Fix: series/episodios ahora buscan en PlPro correctamente
//       - Autor: "PlPro" en todo el source

var PID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

var MXL_PID = new PlatformID("PlPro", "PlPro", PID);
var MXL_CHANNEL_URL = "https://plpro.org";
var _settings = {};
var _debugLog = "";

// =========================================================
// API CONFIGURACIÓN
// =========================================================

// PlPro
var IPTV_URL = "https://plpro.org";
var IPTV_USER = "p";
var IPTV_PASS = "p";

// TMDB
var TMDB_IMG = "https://image.tmdb.org/t/p/w500";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";

// Cache
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

function isM3u8(url) {
    return url && /\.m3u8(?:[?#]|$)/i.test(String(url));
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
    } catch (e) {
        log("TMDB Error: " + String(e));
        return null;
    }
}

function tmdbVideo(item) {
    if (!item) return null;
    var title = item.title || item.name || "Sin título";
    var year = (item.release_date || item.first_air_date || "").substring(0, 4);
    var poster = item.poster_path ? fixImg(item.poster_path) : "";
    var mediaType = item.media_type || "movie";
    var tmdbId = item.id;
    var url = mediaType === "tv"
        ? "mxl://tv/" + tmdbId
        : "mxl://movie/" + tmdbId;
    var display = title + (year ? " (" + year + ")" : "");
    return mkVideo(tmdbId, display, poster, url);
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
    } catch (e) {
        log("PlPro Error: " + String(e));
        return null;
    }
}

// Buscar en catálogo PlPro por título (películas + series)
function ppFindTitle(titleQuery) {
    var q = String(titleQuery || "").toLowerCase().replace(/\s*\(\d{4}\)\s*$/, "").trim();
    if (!q) return null;

    // Buscar en películas
    try {
        var mdata = ppGet("/movies/resume");
        if (mdata && mdata.movies) {
            for (var i = 0; i < mdata.movies.length; i++) {
                var m = mdata.movies[i];
                var mTitle = String(m.b || "").toLowerCase().replace(/\s*\(\d{4}\)\s*$/, "").trim();
                if (mTitle === q || mTitle.indexOf(q) !== -1 || q.indexOf(mTitle) !== -1) {
                    return { type: "movie", id: m.a, title: m.b, thumb: m.d || m.c || "" };
                }
            }
        }
    } catch (e) {}

    // Buscar en series
    try {
        var sdata = ppGet("/series");
        if (sdata && sdata.series) {
            for (var j = 0; j < sdata.series.length; j++) {
                var s = sdata.series[j];
                var sTitle = String(s.b || "").toLowerCase().replace(/\s*\(\d{4}\)\s*$/, "").trim();
                if (sTitle === q || sTitle.indexOf(q) !== -1 || q.indexOf(sTitle) !== -1) {
                    return { type: "series", id: s.a, title: s.b, thumb: s.d || s.c || "" };
                }
            }
        }
    } catch (e) {}

    return null;
}

// Obtener links de película desde PlPro
function ppMovieLinks(ppId) {
    var data = ppGet("/movies/" + ppId + "/links");
    if (!data || !data.length) return [];
    var sources = [];
    for (var i = 0; i < data.length && i < MAX_SERVERS; i++) {
        var link = data[i];
        var linkUrl = link.a || "";
        if (!linkUrl) continue;
        var serverName = (link.b || "Servidor") + (link.c ? " [" + link.c + "]" : "");
        var extracted = extractVideo(linkUrl);
        if (extracted) {
            var src = mkHls(extracted, serverName);
            if (src) sources.push(src);
        }
    }
    return sources;
}

// Obtener links de episodio desde PlPro
function ppEpisodeLinks(ppId, season, episode) {
    var data = ppGet("/series/" + ppId + "/links/" + season + "/" + episode);
    if (!data || !data.length) return [];
    var sources = [];
    for (var i = 0; i < data.length && i < MAX_SERVERS; i++) {
        var link = data[i];
        var linkUrl = link.a || "";
        if (!linkUrl) continue;
        var serverName = (link.b || "Servidor") + (link.c ? " [" + link.c + "]" : "");
        var extracted = extractVideo(linkUrl);
        if (extracted) {
            var src = mkHls(extracted, serverName);
            if (src) sources.push(src);
        }
    }
    return sources;
}

// Obtener info de serie desde PlPro (para listar temporadas/episodios)
function ppSerieInfo(ppId) {
    return ppGet("/series/" + ppId);
}

// =========================================================
// VIDEO EXTRACTORS (PlPro)
// =========================================================

function getHost(url) {
    try {
        var m = String(url).match(/^https?:\/\/([^\/?#]+)/i);
        return m ? m[1].toLowerCase() : "";
    } catch (e) { return ""; }
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

function directHls(url) {
    url = cleanUrl(url);
    if (isM3u8(url)) return url;
    return null;
}

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
        var html = httpGet(fetchUrl, { "User-Agent": UA, "Referer": refererBase });
        if (!html || html.length < 500) return null;

        var splitIdx = html.lastIndexOf(".split('|')");
        if (splitIdx === -1) return null;

        var keyEnd = html.lastIndexOf("'", splitIdx);
        var keyStart = html.lastIndexOf("'", keyEnd - 1) + 1;
        var key = html.substring(keyStart, keyEnd);
        var keyArr = key.split("|");
        if (keyArr.length < 50) return null;

        function decode(str) {
            return str.replace(/\$\./g, "|").replace(/\|/g, function() {
                return "";
            });
        }

        var canvas = new Array(keyArr.length);
        for (var i = 0; i < keyArr.length; i++) canvas[i] = keyArr[i];
        for (var a = 0; a < keyArr.length; a++) {
            var def = decode(canvas[a]);
            canvas[a] = "";
            var src = decode(canvas[keyArr[a]] || "");
            canvas[a] = src;
        }
        var joined = canvas.join("");
        var sources = joined.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/gi);
        if (sources && sources.length) {
            return cleanUrl(sources[0]);
        }
        var mp4s = joined.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi);
        if (mp4s && mp4s.length) {
            return cleanUrl(mp4s[0]);
        }
    } catch (e) {}
    return null;
}

function voeExtract(pageUrl) {
    try {
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        if (!html) return null;

        var m = html.match(/hls\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);

        var am = html.match(/atob\(['"]([^'"]+)['"]\)/);
        if (am) {
            try {
                var d = b64decode(am[1]);
                var u = d.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
                if (u) return cleanUrl(u[0]);
            } catch (e) {}
        }

        var fm = html.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (fm && fm[1]) return cleanUrl(fm[1]);
    } catch (e) {}
    return null;
}

function doodExtract(pageUrl) {
    try {
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        if (!html) return null;

        var m = html.match(/(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);

        var mp4 = html.match(/(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.mp4[^'"]*)['"]/i);
        if (mp4 && mp4[1]) return cleanUrl(mp4[1]);
    } catch (e) {}
    return null;
}

function genericExtract(pageUrl) {
    try {
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        if (!html) return null;

        var m = html.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);

        m = html.match(/source\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);

        m = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
        if (m) return cleanUrl(m[0]);
    } catch (e) {}
    return null;
}

function extractVideo(pageUrl) {
    if (!pageUrl) return null;
    pageUrl = cleanUrl(pageUrl);
    if (isM3u8(pageUrl)) return directHls(pageUrl);

    var host = getHost(pageUrl);
    if (host.indexOf("vidhide") !== -1 || host.indexOf("callistanise") !== -1) return vidhideExtract(pageUrl);
    if (host.indexOf("voe") !== -1) return voeExtract(pageUrl);
    if (host.indexOf("dood") !== -1 || host.indexOf("do7go") !== -1) return doodExtract(pageUrl);
    return genericExtract(pageUrl);
}


// =========================================================
// JKANIME (respaldo para animes)
// =========================================================

function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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
        var mp4 = playerHtml.match(/url\s*[:=]\s*['"]([^'"]+\.mp4[^'"]*)['"]/i);
        if (mp4 && mp4[1]) return cleanUrl(mp4[1]);
    } catch (e) {}
    return null;
}

// Buscar un anime en JkAnime por título y devolver el primer episodio reproducible
function jkaFindEpisode(titleQuery, seasonNum, epNum) {
    try {
        var results = jkaSearch(titleQuery);
        if (!results.length) return null;
        var animeUrl = results[0].url;
        var ep = parseInt(epNum, 10) || 1;
        var epUrl = animeUrl + ep + "/";
        if (parseInt(seasonNum, 10) > 1) {
            epUrl = animeUrl + ep + "/";
        }
        var url = jkaExtractVideo(epUrl);
        if (url) return { url: url, animeUrl: animeUrl, epUrl: epUrl };
    } catch (e) {}
    return null;
}


// =========================================================
// VIDEO OBJECTS
// =========================================================

function mkThumb(url) {
    if (!url) return new Thumbnails([]);
    return new Thumbnails([new Thumbnail(url, 100)]);
}

function mkVideo(id, title, thumb, url) {
    return new PlatformVideo({
        id: new PlatformID("PlPro", String(id), PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(MXL_PID, "PlPro", MXL_CHANNEL_URL, "", 0),
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
    for (var i = 0; i < src.length; i++) {
        if (src[i]) valid.push(src[i]);
    }
    var desc = description || "";
    if (valid.length === 0) {
        desc += "\n\n⚠️ No se encontró fuente de vídeo reproducible.";
    } else {
        desc += "\n\n✅ Fuentes encontradas: " + valid.length;
    }
    if (_debugLog.length > 0) {
        desc += "\n\n=== REPORTE TÉCNICO ===\n" + _debugLog;
    }
    return new PlatformVideoDetails({
        id: new PlatformID("PlPro", String(id), PID),
        name: name || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(MXL_PID, "PlPro", MXL_CHANNEL_URL, "", 0),
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
// DETALLE PELÍCULA (TMDB portada + PlPro reproducción)
// =========================================================

function movieDetails(tmdbId) {
    _debugLog = "";
    log("[movie] tmdbId=" + tmdbId);

    var data = tmdb("/movie/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar");
    if (!data) return mkDetail("m_" + tmdbId, "Sin resultado", "", "mxl://movie/" + tmdbId, [], "Sin datos TMDB");

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

    desc += "\n\n--- Reproducción (PlPro) ---";
    var sources = [];

    // Buscar título en PlPro para obtener links de reproducción
    var ppMatch = ppFindTitle(title);
    if (ppMatch && ppMatch.type === "movie") {
        log("[movie] PlPro match: id=" + ppMatch.id + " title=" + ppMatch.title);
        var ppSources = ppMovieLinks(ppMatch.id);
        for (var i = 0; i < ppSources.length; i++) sources.push(ppSources[i]);
        if (ppSources.length > 0) {
            desc += "\n✅ Encontrado en PlPro: " + ppMatch.title;
        } else {
            desc += "\n⚠️ PlPro: sin fuentes para \"" + title + "\"";
        }
    } else {
        desc += "\n⚠️ No se encontró en PlPro: \"" + title + "\"";
    }

    // Trailer
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

    return mkDetail("m_" + tmdbId, title + (year ? " (" + year + ")" : ""), poster, "mxl://movie/" + tmdbId, sources, desc);
}

// =========================================================
// DETALLE SERIE (TMDB portada + PlPro reproducción)
// =========================================================

function tvDetails(tmdbId) {
    _debugLog = "";
    log("[tv] tmdbId=" + tmdbId);

    var data = tmdb("/tv/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar,seasons");
    if (!data) return mkDetail("tv_" + tmdbId, "Sin resultado", "", "mxl://tv/" + tmdbId, [], "Sin datos TMDB");

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

    // Buscar serie en PlPro
    var ppMatch = ppFindTitle(title);
    var ppSeriesId = null;

    if (ppMatch && ppMatch.type === "series") {
        ppSeriesId = ppMatch.id;
        log("[tv] PlPro match: id=" + ppSeriesId + " title=" + ppMatch.title);
        desc += "\n\n--- Reproducción (PlPro) ---";
        desc += "\n✅ Serie encontrada en PlPro: " + ppMatch.title;
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

    // Precargar fuente del episodio S1E1
    var sources = [];
    var ppOk = false;
    if (ppSeriesId && seasonList.length > 0) {
        var firstSeason = seasonList[0];
        desc += "\n\n--- Reproduciendo S1E1 por defecto ---";
        var epSources = ppEpisodeLinks(ppSeriesId, firstSeason.season_number, 1);
        for (var k = 0; k < epSources.length; k++) sources.push(epSources[k]);
        if (epSources.length > 0) {
            ppOk = true;
            desc += "\n✅ Fuentes S1E1 cargadas desde PlPro: " + epSources.length;
        } else {
            desc += "\n⚠️ Sin fuentes para S1E1 en PlPro";
        }
    }

    // Si no hay match en PlPro, intentar con JkAnime (animes)
    if (!ppOk && !ppSeriesId) {
        var jka = jkaFindEpisode(title, 1, 1);
        if (jka) {
            desc = desc.replace("⚠️ No se encontró en PlPro: \"" + title + "\"", "✅ Encontrado en PlPro vía JkAnime: " + title);
            desc += "\n✅ Fuente S1E1 cargada desde JkAnime";
            var jkaSrc = mkHls(jka.url, "JkAnime");
            if (jkaSrc) sources.push(jkaSrc);
        } else {
            desc += "\n⚠️ No se encontró en PlPro ni en JkAnime: \"" + title + "\"";
        }
    }

    return mkDetail("tv_" + tmdbId, title, poster, "mxl://tv/" + tmdbId, sources, desc);
}

// =========================================================
// EPISODIO (TMDB metadata + PlPro reproducción)
// =========================================================

function episodeDetails(tmdbId, seasonNum, epNum) {
    log("[ep] tmdb=" + tmdbId + " S" + seasonNum + "E" + epNum);

    // Metadata de TMDB
    var epData = tmdb("/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + epNum + "?language=es-ES");
    var epTitle = "";
    var thumb = "";
    if (epData) {
        epTitle = epData.name || "";
        if (epData.still_path) thumb = fixImg(epData.still_path);
    }

    var display = "T" + seasonNum + "E" + epNum;
    if (epTitle) display += " - " + epTitle;

    // Obtener título de la serie desde TMDB
    var tvData = tmdb("/tv/" + tmdbId + "?language=es-ES");
    var seriesTitle = tvData ? (tvData.name || "") : "";

    var desc = display;
    if (epData && epData.overview) desc += "\n\n" + epData.overview;
    desc += "\n\n--- Reproducción (PlPro) ---";

    var sources = [];

    // Buscar serie en PlPro
    var ppMatch = ppFindTitle(seriesTitle);
    if (ppMatch && ppMatch.type === "series") {
        log("[ep] PlPro match: id=" + ppMatch.id + " title=" + ppMatch.title);
        var epSources = ppEpisodeLinks(ppMatch.id, seasonNum, epNum);
        for (var i = 0; i < epSources.length; i++) sources.push(epSources[i]);
        if (epSources.length > 0) {
            desc += "\n✅ Episodio encontrado en PlPro";
        } else {
            desc += "\n⚠️ Sin fuentes para este episodio en PlPro";
        }
    } else {
        desc += "\n⚠️ Serie no encontrada en PlPro: \"" + seriesTitle + "\"";
        // Fallback: anime vía JkAnime
        var jka2 = jkaFindEpisode(seriesTitle, seasonNum, epNum);
        if (jka2) {
            desc = desc.replace("⚠️ Serie no encontrada en PlPro: \"" + seriesTitle + "\"", "✅ Encontrado en JkAnime: " + seriesTitle);
            desc += "\n✅ Fuente de episodio cargada desde JkAnime";
            var jkaSrc2 = mkHls(jka2.url, "JkAnime");
            if (jkaSrc2) sources.push(jkaSrc2);
        }
    }

    // Navegación
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
            for (var i2 = 0; i2 < movies.results.length && videos.length < 40; i2++) {
                videos.push(tmdbVideo(movies.results[i2]));
            }
        }
    } catch (e) {}

    // TMDB series populares
    try {
        var tvs = tmdb("/tv/popular?language=es-ES&page=1");
        if (tvs && tvs.results) {
            for (var i3 = 0; i3 < tvs.results.length && videos.length < 60; i3++) {
                videos.push(tmdbVideo(tvs.results[i3]));
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

    // Series: lista de episodios navegable (TMDB)
    var ts = url.match(/mxl:\/\/tv\/(\d+)/);
    if (ts) {
        var tmdbId = ts[1];
        var sdata = tmdb("/tv/" + tmdbId + "?language=es-ES");
        var sTitle = sdata ? (sdata.name || "Serie") : "Serie";
        var poster = sdata && sdata.poster_path ? fixImg(sdata.poster_path) : "";

        // Si es URL de episodio concreto, extraer S/E
        var te2 = url.match(/mxl:\/\/tv\/(\d+)\/(\d+)\/(\d+)/);
        var curSeason = te2 ? parseInt(te2[2], 10) : 1;

        var seasons = sdata ? (sdata.seasons || []) : [];
        for (var si = 0; si < seasons.length; si++) {
            var sn = seasons[si];
            if (!sn.season_number) continue;
            // Buscar episodios de la temporada en TMDB
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
        id: MXL_PID,
        name: "PlPro",
        thumbnail: TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
        banner: "",
        subscribers: 0,
        description: "PlPro - Películas y Series (TMDB + PlPro)",
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
                id: new PlatformID("PlPro", "error_fallo", PID),
                name: "Error",
                thumbnails: new Thumbnails([
                    new Thumbnail(TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100)
                ]),
                author: new PlatformAuthorLink(MXL_PID, "PlPro", MXL_CHANNEL_URL, "", 0),
                uploadDate: 0,
                url: url || MXL_CHANNEL_URL,
                duration: 0, viewCount: 0, isLive: false,
                description: "Error: " + String(e) + "\n\nLog técnico:\n" + _debugLog,
                video: new VideoSourceDescriptor([])
            });
        }
    };
}
