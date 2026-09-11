// MxlTv GrayJay Source v1.1
// TMDB API (discovery + metadata) + MXL Backend (streaming)
// v1.1: Fix video no disponible - mejor manejo de errores

var PID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

var MXL_PID = new PlatformID("MxlTv", "MxlTv", PID);
var _settings = {};
var _debugLog = "";

// =========================================================
// API CONFIG
// =========================================================

var MXL_PROP = "https://prop.shiwaimov.com";
var MXL_CHECK = "https://check.shiwaimov.com";
var MXL_CDN = "https://hi3thh5oxxww.acek-cdn.com";
var MXL_FB = "https://mxlmovies-f5eef.firebaseio.com";

var TMDB_IMG = "https://image.tmdb.org/t/p/w500";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";

var _cache = {};
var CACHE_TTL = 1800000;
var MAX_SRV = 10;

// =========================================================
// DEBUG / HTTP
// =========================================================

function log(m) { _debugLog += String(m) + "\n"; }

function httpGet(url, h) {
    try {
        var hh = h || {};
        if (!hh["User-Agent"] && !hh["user-agent"]) hh["User-Agent"] = UA;
        var r = http.GET(url, hh);
        return (r && r.body) ? r.body : "";
    } catch (e) {
        log("GET ERR " + url + ": " + String(e));
        return "";
    }
}

// =========================================================
// UTILS
// =========================================================

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function ckGet(k) {
    var e = _cache[k];
    return (e && (Date.now() - e.t) < CACHE_TTL) ? e.d : null;
}

function ckSet(k, d) { _cache[k] = { d: d, t: Date.now() }; }

function cleanUrl(u) {
    if (!u) return "";
    return String(u).trim()
        .replace(/&amp;/g, "&")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/");
}

function isM3u8(u) { return u && /\.m3u8(?:[?#]|$)/i.test(String(u)); }

function fixImg(u) {
    if (!u) return "";
    var s = String(u).trim();
    if (s.indexOf("ttps://") === 0) s = "https" + s.substring(4);
    if (/^https?:\/\//i.test(s)) return s;
    s = s.replace(/^\/+/, "");
    if (!s) return "";
    if (!/\.(jpg|png|webp)$/i.test(s)) s += ".jpg";
    return TMDB_IMG + "/" + s;
}

function stripTags(s) {
    if (!s) return "";
    return String(s)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ").trim();
}

// =========================================================
// VIDEO OBJECTS
// =========================================================

function mkThumb(u) {
    return u ? new Thumbnails([new Thumbnail(u, 100)]) : new Thumbnails([]);
}

function mkVideo(id, title, thumb, url, author) {
    return new PlatformVideo({
        id: new PlatformID("MxlTv", String(id), PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(MXL_PID, author || "MxlTv", "https://mxl-apps.io", "", 0),
        uploadDate: 0, url: url, duration: 0, viewCount: 0, isLive: false
    });
}

function mkHls(u, n) {
    return u ? new HLSSource({ name: n || "MxlTv", url: u, duration: 0 }) : null;
}

function mkDetail(id, name, thumb, url, sources, desc) {
    var valid = [];
    for (var i = 0; i < (sources || []).length; i++) {
        if (sources[i]) valid.push(sources[i]);
    }
    var d = desc || "";
    if (valid.length === 0) {
        d += "\n\n⚠️ Sin fuente de vídeo reproducible.";
        d += "\n💡 Para usar la API de MXL se requiere interceptar";
        d += "\n   el tráfico con mitmproxy para obtener los endpoints.";
        d += "\n\n📊 Datos de TMDB cargados correctamente.";
    } else {
        d += "\n\n✅ Fuentes: " + valid.length;
    }
    if (_debugLog.length > 0) d += "\n\n=== DEBUG ===\n" + _debugLog;

    return new PlatformVideoDetails({
        id: new PlatformID("MxlTv", String(id), PID),
        name: name || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(MXL_PID, "MxlTv", "https://mxl-apps.io", "", 0),
        uploadDate: 0, url: url, duration: 0, viewCount: 0, isLive: false,
        video: new VideoSourceDescriptor(valid),
        description: d
    });
}

// =========================================================
// TMDB API
// =========================================================

function tmdb(path) {
    try {
        var sep = path.indexOf("?") !== -1 ? "&" : "?";
        var url = TMDB_API + path + sep + "api_key=" + TMDB_KEY;
        var k = "tmdb:" + path;
        var c = ckGet(k);
        if (c) return c;
        var body = httpGet(url, { "User-Agent": UA, "Accept": "application/json" });
        if (!body) return null;
        var json = safeParse(body);
        if (json) ckSet(k, json);
        return json;
    } catch (e) { log("[tmdb] " + String(e)); return null; }
}

function tmdbVideo(item) {
    var t = item.title || item.name || "Sin título";
    var yr = (item.release_date || item.first_air_date || "").substring(0, 4);
    var p = item.poster_path ? fixImg(item.poster_path) : "";
    var id = item.id;
    var r = item.vote_average ? item.vote_average.toFixed(1) : "";
    var tp = item.media_type || "movie";
    var lbl = tp === "tv" ? "[Serie] " : "[Película] ";
    var d = lbl + t;
    if (yr) d += " (" + yr + ")";
    if (r) d += " ⭐" + r;
    var u = tp === "tv" ? "mxl://tv/" + id : "mxl://movie/" + id;
    return mkVideo("mxl_" + tp + "_" + id, d, p, u, "MxlTv");
}

// =========================================================
// MXL BACKEND (requiere autenticación real del APK)
// =========================================================

function mxlGet(path) {
    try {
        var k = "mxl:" + path;
        var c = ckGet(k);
        if (c) return c;
        var url = MXL_PROP + path;
        var body = httpGet(url, {
            "User-Agent": "MxlTv/1.0",
            "Accept": "application/json",
            "Referer": MXL_PROP + "/"
        });
        if (!body) return null;
        var json = safeParse(body);
        if (json && !json.error) { ckSet(k, json); return json; }
        return null;
    } catch (e) { log("[mxl] " + String(e)); return null; }
}

// =========================================================
// EXTRACTOR VIDEO GENÉRICO
// =========================================================

function extractVideo(pageUrl) {
    if (!pageUrl) return null;
    pageUrl = cleanUrl(pageUrl);
    if (isM3u8(pageUrl)) return pageUrl;

    try {
        var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
        if (!html) return null;

        var m = html.match(/(?:file|source|hls)\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (m && m[1]) return cleanUrl(m[1]);

        var am = html.match(/atob\(['"]([^'"]+)['"]\)/);
        if (am) {
            try {
                var d = decodeURIComponent(atob(am[1]).split("").map(function(c) {
                    return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(""));
                var u = d.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
                if (u) return cleanUrl(u[0]);
            } catch (e) {}
        }

        var loose = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
        if (loose) return cleanUrl(loose[0]);
    } catch (e) { log("[ext] " + String(e)); }
    return null;
}

// =========================================================
// PELÍCULA
// =========================================================

function movieDetails(tmdbId) {
    _debugLog = "";
    log("[movie] tmdbId=" + tmdbId);

    var data = tmdb("/movie/" + tmdbId + "?language=es-ES&append_to_response=videos,credits,similar");
    if (!data) {
        return mkDetail("mxl_m_" + tmdbId, "Sin resultado", "", "mxl://movie/" + tmdbId, [], "Error cargando datos de TMDB");
    }

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

    desc += "\n\n--- Servidores MXL ---";
    var sources = [];

    var servers = mxlGet("/api/v1/movie/" + tmdbId + "/servers");
    if (servers && servers.servers) {
        for (var i = 0; i < servers.servers.length && i < MAX_SRV; i++) {
            var srv = servers.servers[i];
            var srvUrl = srv.url || srv.link || srv.a || "";
            if (!srvUrl) continue;
            var srvName = srv.name || srv.label || srv.b || ("S" + (i + 1));
            desc += "\n• " + srvName;
            var extracted = extractVideo(srvUrl);
            if (extracted) {
                var src = mkHls(extracted, "MXL - " + srvName);
                if (src) { sources.push(src); log("[movie] OK: " + srvName); }
            }
        }
    }

    if (data.videos && data.videos.results) {
        for (var v = 0; v < data.videos.results.length; v++) {
            var vid = data.videos.results[v];
            if (vid.site === "YouTube" && vid.type === "Trailer") {
                desc += "\n\n🎬 Trailer: https://youtube.com/watch?v=" + vid.key;
                break;
            }
        }
    }

    if (data.similar && data.similar.results) {
        desc += "\n\n--- Similares ---";
        for (var r = 0; r < data.similar.results.length && r < 5; r++) {
            var rec = data.similar.results[r];
            desc += "\n• " + (rec.title || rec.name || "?") + " (" + ((rec.release_date || rec.first_air_date || "").substring(0, 4)) + ")";
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
    if (!data) {
        return mkDetail("mxl_tv_" + tmdbId, "Sin resultado", "", "mxl://tv/" + tmdbId, [], "Error cargando datos de TMDB");
    }

    var title = data.name || "Sin título";
    var poster = data.poster_path ? fixImg(data.poster_path) : "";
    var rating = data.vote_average ? data.vote_average.toFixed(1) : "N/A";

    var desc = "**" + title + "**";
    desc += "\n⭐ " + rating + "/10 | " + (data.number_of_seasons || 0) + " temporadas | " + (data.number_of_episodes || 0) + " episodios";
    desc += "\n\n" + (data.overview || "Sin sinopsis");

    if (data.genres) {
        desc += "\n\n--- Géneros ---";
        for (var g = 0; g < data.genres.length; g++) desc += "\n• " + data.genres[g].name;
    }

    desc += "\n\n--- Temporadas ---";
    var seasonList = [];
    if (data.seasons) {
        for (var si = 0; si < data.seasons.length; si++) {
            if (data.seasons[si].season_number > 0) seasonList.push(data.seasons[si]);
        }
    }

    for (var si = 0; si < seasonList.length; si++) {
        var sn = seasonList[si];
        desc += "\n\nT" + sn.season_number + ":";
        for (var ep = 1; ep <= (sn.episode_count || 20); ep++) {
            desc += "\n  E" + ep + " → mxl://tv/" + tmdbId + "/" + sn.season_number + "/" + ep;
        }
    }

    var sources = [];
    if (seasonList.length > 0) {
        var firstS = seasonList[0].season_number;
        desc += "\n\n--- Reproduciendo T" + firstS + "E1 ---";
        var epResult = episodeDetails(tmdbId, firstS, 1);
        sources = epResult.sources;
        desc += epResult.desc;
    }

    return mkDetail("mxl_tv_" + tmdbId, title, poster, "mxl://tv/" + tmdbId, sources, desc);
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
        for (var i = 0; i < servers.servers.length && i < MAX_SRV; i++) {
            var srv = servers.servers[i];
            var srvUrl = srv.url || srv.link || srv.a || "";
            if (!srvUrl) continue;
            var srvName = srv.name || srv.label || srv.b || ("S" + (i + 1));
            desc += "\n• " + srvName;
            var extracted = extractVideo(srvUrl);
            if (extracted) {
                var src = mkHls(extracted, "MXL - " + srvName);
                if (src) sources.push(src);
            }
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
            for (var i = 0; i < movies.results.length && videos.length < 40; i++) {
                videos.push(tmdbVideo(movies.results[i]));
            }
        }
    } catch (e) {}

    try {
        var series = tmdb("/tv/popular?language=es-ES&page=1");
        if (series && series.results) {
            for (var i = 0; i < series.results.length && videos.length < 60; i++) {
                videos.push(tmdbVideo(series.results[i]));
            }
        }
    } catch (e) {}

    try {
        var mxlHome = mxlGet("/api/v1/home");
        if (mxlHome && mxlHome.categories) {
            for (var c = 0; c < mxlHome.categories.length; c++) {
                var items = mxlHome.categories[c].items || mxlHome.categories[c].movies || [];
                for (var j = 0; j < items.length && videos.length < 80; j++) {
                    var it = items[j];
                    var t = it.title || it.name || it.b || "";
                    var id = it.id || it.tmdb_id || it.a || "";
                    if (t && id) videos.push(mkVideo("mxl_b_" + id, t, fixImg(it.poster || it.d || ""), "mxl://movie/" + id, "MxlTv"));
                }
            }
        }
    } catch (e) {}

    return videos;
}

// =========================================================
// SEARCH
// =========================================================

function doSearch(query) {
    var results = [];

    try {
        var data = tmdb("/search/multi?query=" + encodeURIComponent(query) + "&language=es-ES&include_adult=false");
        if (data && data.results) {
            for (var i = 0; i < data.results.length && results.length < 30; i++) {
                var item = data.results[i];
                if (item.media_type === "movie" || item.media_type === "tv") {
                    results.push(tmdbVideo(item));
                }
            }
        }
    } catch (e) {}

    try {
        var mxl = mxlGet("/api/v1/search?q=" + encodeURIComponent(query));
        if (mxl && mxl.results) {
            for (var j = 0; j < mxl.results.length && results.length < 60; j++) {
                var it = mxl.results[j];
                var t = it.title || it.name || it.b || "";
                var id = it.id || it.tmdb_id || it.a || "";
                var tp = it.type || it.media_type || "movie";
                if (t && id) {
                    var u = tp === "tv" ? "mxl://tv/" + id : "mxl://movie/" + id;
                    results.push(mkVideo("mxl_s_" + id, (tp === "tv" ? "[Serie] " : "[Película] ") + t, fixImg(it.poster || it.d || ""), u, "MxlTv"));
                }
            }
        }
    } catch (e) {}

    return results;
}

// =========================================================
// RECOMMENDATIONS
// =========================================================

function doRecommendations(url) {
    var videos = [];

    try {
        var tvM = String(url || "").match(/mxl:\/\/tv\/(\d+)$/);
        if (tvM) {
            var data = tmdb("/tv/" + tvM[1] + "?language=es-ES&append_to_response=seasons");
            if (data && data.seasons) {
                for (var si = 0; si < data.seasons.length; si++) {
                    var sn = data.seasons[si];
                    if (sn.season_number > 0 && sn.episode_count) {
                        for (var ep = 1; ep <= sn.episode_count; ep++) {
                            videos.push(mkVideo("mxl_tv_" + tvM[1] + "_" + sn.season_number + "_" + ep,
                                "T" + sn.season_number + "E" + ep,
                                data.poster_path ? fixImg(data.poster_path) : "",
                                "mxl://tv/" + tvM[1] + "/" + sn.season_number + "/" + ep, "MxlTv"));
                        }
                    }
                }
            }
        }
    } catch (e) {}

    try {
        var mvM = String(url || "").match(/mxl:\/\/movie\/(\d+)$/);
        if (mvM) {
            var data = tmdb("/movie/" + mvM[1] + "?language=es-ES&append_to_response=similar");
            if (data && data.similar && data.similar.results) {
                for (var i = 0; i < data.similar.results.length; i++) {
                    videos.push(tmdbVideo(data.similar.results[i]));
                }
            }
        }
    } catch (e) {}

    return videos;
}

// =========================================================
// DETAILS
// =========================================================

function doDetails(url) {
    if (!url) return mkDetail("", "", "", "", [], "URL vacía");

    try {
        var mm = url.match(/mxl:\/\/movie\/(\d+)/);
        if (mm) return movieDetails(mm[1]);

        var te = url.match(/mxl:\/\/tv\/(\d+)\/(\d+)\/(\d+)/);
        if (te) return episodeView(te[1], te[2], te[3]);

        var ts = url.match(/mxl:\/\/tv\/(\d+)/);
        if (ts) return tvDetails(ts[1]);
    } catch (e) {
        log("[details] CRASH: " + String(e));
        return mkDetail("mxl_err", "Error", "", url, [], "Error: " + String(e));
    }

    return mkDetail("", "", "", url, [], "URL no reconocida: " + url);
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
        catch (e) { log("[search] " + String(e)); return new VideoPager([], false, null); }
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
        catch (e) { log("[home] " + String(e)); return new VideoPager([], false, null); }
    };

    source.isChannelUrl = function() { return false; };
    source.searchSuggestions = function() { return []; };

    source.getContentRecommendations = function(url) {
        try { return new VideoPager(doRecommendations(url), false, null); }
        catch (e) { log("[recs] " + String(e)); return new VideoPager([], false, null); }
    };

    source.getContentDetails = function(url) {
        try {
            var r = doDetails(url);
            if (r) return r;
            throw new Error("doDetails retornó null para: " + url);
        } catch (e) {
            log("[getContentDetails] CRASH: " + String(e));
            return new PlatformVideoDetails({
                id: new PlatformID("MxlTv", "error_" + Date.now(), PID),
                name: "Error de Extractor",
                thumbnails: new Thumbnails([
                    new Thumbnail(TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png", 100)
                ]),
                author: new PlatformAuthorLink(MXL_PID, "MxlTv", "https://mxl-apps.io", "", 0),
                uploadDate: 0,
                url: url || "https://mxl-apps.io",
                duration: 0, viewCount: 0, isLive: false,
                description: "CRASH: " + String(e) + "\n\nDEBUG:\n" + _debugLog,
                video: new VideoSourceDescriptor([])
            });
        }
    };
}
