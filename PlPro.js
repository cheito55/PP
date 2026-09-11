// ============================================================
// PLPRO / PLAYPELIS — CATÁLOGO MXL + REPRODUCCIÓN PLPRO
// Arquitectura:
//   MXL/TMDB -> títulos, posters, año, TMDB ID
//   PLPRO    -> ID interno + enlaces + HLS/MP4
//
// IMPORTANTE:
//   NO se utilizan mkVideo/mkDetail/fixImg/tmdb de MXL
//   directamente. Todo lo del catálogo tiene prefijo CAT_.
// ============================================================

var PID = "8a2f4b7e-3c1d-4f6a-9b8e-5d2c1a9f6e40";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

var PPID = new PlatformID("PlPro", "PlPro", PID);

var _settings = {};
var _debugLog = "";

var IPTV_URL = "https://plpro.org";
var IPTV_USER = "p";
var IPTV_PASS = "p";

var JK = "https://jkanime.net";

var TMDB_IMG = "https://image.tmdb.org/t/p/w500";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";

var MAX_TRY = 10;


// ============================================================
// HTTP PLPRO
// ============================================================

function ppHttpGet(url, headers) {
    try {
        var h = headers || {};
        if (!h["User-Agent"]) {
            h["User-Agent"] = UA;
        }

        var r = http.GET(url, h);

        if (!r) {
            return "";
        }

        return r;
    } catch (e) {
        return "";
    }
}


// ============================================================
// HTTP CATÁLOGO
// ============================================================

function CAT_httpGet(url, headers) {
    try {
        var h = headers || {};
        if (!h["User-Agent"]) {
            h["User-Agent"] = UA;
        }

        var r = http.GET(url, h);

        if (!r) {
            return "";
        }

        return r;
    } catch (e) {
        return "";
    }
}


// ============================================================
// UTILIDADES
// ============================================================

function ppCleanUrl(u) {
    if (!u) return "";

    var s = String(u);

    s = s.replace(/&amp;/g, "&");
    s = s.replace(/&quot;/g, "\"");
    s = s.replace(/&#39;/g, "'");
    s = s.replace(/\\u0026/g, "&");
    s = s.replace(/\\\//g, "/");
    s = s.replace(/\\\"/g, "\"");

    return s.trim();
}

function ppStripTags(s) {
    if (!s) return "";

    return String(s)
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function ppHtmlDecode(s) {
    if (!s) return "";

    return String(s)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/");
}

function ppFixImg(u) {
    if (!u) return "";

    var s = String(u).trim();

    if (s === "null" || s === "undefined") {
        return "";
    }

    s = ppHtmlDecode(s);

    if (s.indexOf("ttps://") === 0) {
        s = "h" + s;
    }

    if (s.indexOf("http://") === 0 ||
        s.indexOf("https://") === 0) {
        return s;
    }

    if (s.indexOf("//") === 0) {
        return "https:" + s;
    }

    if (s.charAt(0) === "/") {
        s = s.substring(1);
    }

    if (s.indexOf("image.tmdb.org") >= 0) {
        if (s.indexOf("http") !== 0) {
            return "https://" + s;
        }

        return s;
    }

    return TMDB_IMG + "/" + s;
}

function ppSlugify(s) {
    if (!s) return "";

    return String(s)
        .toLowerCase()
        .replace(/[áàäâ]/g, "a")
        .replace(/[éèëê]/g, "e")
        .replace(/[íìïî]/g, "i")
        .replace(/[óòöô]/g, "o")
        .replace(/[úùüû]/g, "u")
        .replace(/ñ/g, "n")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function ppNormalizeTitle(s) {
    if (!s) return "";

    var x = String(s).toLowerCase();

    x = x
        .replace(/[áàäâ]/g, "a")
        .replace(/[éèëê]/g, "e")
        .replace(/[íìïî]/g, "i")
        .replace(/[óòöô]/g, "o")
        .replace(/[úùüû]/g, "u")
        .replace(/ñ/g, "n");

    x = x.replace(/[^a-z0-9]+/g, "");

    return x;
}


// ============================================================
// PLPRO API
// ============================================================

function ppGet(path) {
    var sep = path.indexOf("?") >= 0 ? "&" : "?";

    var url = IPTV_URL + path +
        sep +
        "username=" + encodeURIComponent(IPTV_USER) +
        "&password=" + encodeURIComponent(IPTV_PASS);

    var text = ppHttpGet(url, {
        "User-Agent": "PLPro/8",
        "Accept": "application/json,text/plain,*/*"
    });

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}


// ============================================================
// CATÁLOGO TMDB
// ============================================================

function CAT_tmdb(path) {
    var sep = path.indexOf("?") >= 0 ? "&" : "?";

    var url = TMDB_API +
        path +
        sep +
        "api_key=" + encodeURIComponent(TMDB_KEY);

    var text = CAT_httpGet(url, {
        "User-Agent": UA,
        "Accept": "application/json"
    });

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}


// ============================================================
// VIDEO PLPRO
// ============================================================

function ppIsM3u8(url) {
    if (!url) return false;

    return /\.m3u8(\?|$)/i.test(String(url));
}

function ppIsMp4(url) {
    if (!url) return false;

    return /\.mp4(\?|$)/i.test(String(url));
}

function ppCleanVideoUrl(url) {
    if (!url) return "";

    var s = ppCleanUrl(url);

    s = s.replace(/^["']+/, "");
    s = s.replace(/["']+$/, "");

    return s;
}

function ppDirectHls(url, name) {
    var u = ppCleanVideoUrl(url);

    if (!u) return null;

    if (!ppIsM3u8(u)) return null;

    try {
        return new VideoSource({
            url: u,
            name: name || "PLPro HLS",
            type: "HLS",
            extra: []
        });
    } catch (e) {
        return null;
    }
}

function ppDirectMp4(url, name) {
    var u = ppCleanVideoUrl(url);

    if (!u) return null;

    if (!ppIsMp4(u)) return null;

    try {
        return new VideoSource({
            url: u,
            name: name || "PLPro MP4",
            type: "MP4",
            extra: []
        });
    } catch (e) {
        return null;
    }
}


// ============================================================
// EXTRACCIÓN HLS/MP4
// ============================================================

function ppFindM3u8(text) {
    if (!text) return "";

    var s = String(text);

    var patterns = [
        /["'](https?:\/\/[^"' ]+\.m3u8[^"' ]*)["']/i,
        /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i
    ];

    var i;

    for (i = 0; i < patterns.length; i++) {
        var m = s.match(patterns[i]);

        if (m && m[1]) {
            return ppCleanVideoUrl(m[1]);
        }
    }

    return "";
}

function ppFindMp4(text) {
    if (!text) return "";

    var s = String(text);

    var patterns = [
        /["'](https?:\/\/[^"' ]+\.mp4[^"' ]*)["']/i,
        /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
        /source\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
        /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i
    ];

    var i;

    for (i = 0; i < patterns.length; i++) {
        var m = s.match(patterns[i]);

        if (m && m[1]) {
            return ppCleanVideoUrl(m[1]);
        }
    }

    return "";
}

function ppExtractVideo(url, depth) {
    if (!url) return [];

    if (!depth) depth = 0;

    if (depth > 2) {
        return [];
    }

    var direct = ppCleanVideoUrl(url);

    if (ppIsM3u8(direct)) {
        var h = ppDirectHls(direct, "PLPro HLS");

        return h ? [h] : [];
    }

    if (ppIsMp4(direct)) {
        var m = ppDirectMp4(direct, "PLPro MP4");

        return m ? [m] : [];
    }

    var text = ppHttpGet(direct, {
        "User-Agent": UA,
        "Referer": IPTV_URL + "/"
    });

    if (!text) {
        return [];
    }

    var result = [];

    var hls = ppFindM3u8(text);

    if (hls) {
        var hs = ppDirectHls(hls, "PLPro HLS");

        if (hs) {
            result.push(hs);
        }
    }

    var mp4 = ppFindMp4(text);

    if (mp4) {
        var ms = ppDirectMp4(mp4, "PLPro MP4");

        if (ms) {
            result.push(ms);
        }
    }

    if (result.length > 0) {
        return result;
    }

    var iframe = text.match(
        /<iframe[^>]+src=["']([^"']+)["']/i
    );

    if (iframe && iframe[1]) {
        var iframeUrl = iframe[1];

        if (iframeUrl.indexOf("//") === 0) {
            iframeUrl = "https:" + iframeUrl;
        }

        if (iframeUrl.indexOf("http") !== 0) {
            iframeUrl = IPTV_URL + iframeUrl;
        }

        return ppExtractVideo(iframeUrl, depth + 1);
    }

    return [];
}


// ============================================================
// PLPRO LINK RESOLVER
// ============================================================

function ppResolveLinks(links) {
    var sources = [];
    var i;

    if (!links || !links.length) {
        return sources;
    }

    for (i = 0; i < links.length && i < MAX_TRY; i++) {
        var item = links[i];

        var url = "";

        if (typeof item === "string") {
            url = item;
        } else if (item) {
            url = item.url || item.link || item.src || item.file || "";
        }

        if (!url) continue;

        var found = ppExtractVideo(url, 0);

        var j;

        for (j = 0; j < found.length; j++) {
            sources.push(found[j]);
        }

        if (sources.length > 0) {
            break;
        }
    }

    return sources;
}


// ============================================================
// PLPRO VIDEO OBJECT
// ============================================================

function ppMakeVideo(id, title, poster, url) {
    return new PlatformVideo(
        new PlatformID("PlPro", id, PID),
        title || "PlPro",
        poster || "",
        url,
        new PlatformAuthorLink(
            PPID,
            "PlPro",
            IPTV_URL,
            "",
            0
        )
    );
}


// ============================================================
// PLPRO DETAIL
// ============================================================

function ppMakeDetail(id, title, poster, description, sources, url) {
    var d = new PlatformVideoDetails();

    d.id = new PlatformID("PlPro", id, PID);
    d.name = title || "PlPro";
    d.thumbnails = poster ? [poster] : [];
    d.description = description || "";
    d.videoSources = new VideoSourceDescriptor(sources || []);
    d.url = url || "";

    return d;
}


// ============================================================
// PLPRO HOME
// ============================================================

function ppHome() {
    var out = [];

    var data = ppGet("/movies/resume");

    if (!data) {
        return out;
    }

    var arr = data.results || data.movies || data.data || data;

    if (!arr || !arr.length) {
        return out;
    }

    var i;

    for (i = 0; i < arr.length; i++) {
        var m = arr[i];

        if (!m) continue;

        var id = m.a || m.id || m._id;
        var title = m.b || m.title || m.name;
        var poster = m.d || m.c || m.poster || m.image || "";

        if (!id || !title) continue;

        poster = ppFixImg(poster);

        out.push(
            ppMakeVideo(
                "movie_" + id,
                title,
                poster,
                "plpro://movie/" + id
            )
        );
    }

    return out;
}


// ============================================================
// PLPRO SEARCH
// ============================================================

function ppSearchRaw(query) {
    var out = [];

    var q = encodeURIComponent(query);

    var data = ppGet("/movies/resume?search=" + q);

    if (data) {
        var arr = data.results || data.movies || data.data || data;

        if (arr && arr.length) {
            var i;

            for (i = 0; i < arr.length; i++) {
                var m = arr[i];

                if (!m) continue;

                var id = m.a || m.id || m._id;
                var title = m.b || m.title || m.name;
                var poster = m.d || m.c || m.poster || m.image || "";

                if (!id || !title) continue;

                out.push(
                    ppMakeVideo(
                        "movie_" + id,
                        title,
                        ppFixImg(poster),
                        "plpro://movie/" + id
                    )
                );
            }
        }
    }

    return out;
}


// ============================================================
// CATÁLOGO TMDB -> PLPRO
//
// Esta función es SOLO para obtener metadata.
// No crea PlatformVideo con MxlTv.
// ============================================================

function CAT_makeCatalogItem(item, type) {
    if (!item) return null;

    var title = item.title || item.name || "";

    if (!title) return null;

    var date = item.release_date || item.first_air_date || "";
    var year = date ? date.substring(0, 4) : "";

    var poster = ppFixImg(item.poster_path);

    return {
        tmdbId: item.id,
        title: title,
        year: year,
        poster: poster,
        type: type || "movie"
    };
}


// ============================================================
// BUSCAR ID PLPRO A PARTIR DE TMDB
//
// Primero intenta búsqueda normal.
// Si no encuentra, compara títulos normalizados.
// ============================================================

function CAT_findPlproMovie(item) {
    if (!item) return null;

    var title = item.title || item.name || "";

    if (!title) return null;

    var results = ppSearchRaw(title);

    if (!results || !results.length) {
        return null;
    }

    var wanted = ppNormalizeTitle(title);

    var i;

    for (i = 0; i < results.length; i++) {
        var v = results[i];

        if (!v) continue;

        var name = v.name || "";

        if (ppNormalizeTitle(name) === wanted) {
            return v;
        }
    }

    return results[0];
}


// ============================================================
// CATÁLOGO HOME
// ============================================================

function CAT_home() {
    var out = [];

    var data = CAT_tmdb(
        "/trending/all/week?language=es-ES"
    );

    if (!data || !data.results) {
        return out;
    }

    var i;

    for (i = 0; i < data.results.length; i++) {
        var item = data.results[i];

        if (!item) continue;

        var type = item.media_type;

        if (type !== "movie" && type !== "tv") {
            continue;
        }

        var title = item.title || item.name || "";
        var poster = ppFixImg(item.poster_path);

        if (!title) continue;

        /*
         * IMPORTANTE:
         * Aquí mostramos catálogo TMDB pero mantenemos URL
         * interna de PlPro para resolver después.
         */

        var catalogUrl;

        if (type === "tv") {
            catalogUrl = "cat://tv/" + item.id;
        } else {
            catalogUrl = "cat://movie/" + item.id;
        }

        out.push(
            ppMakeVideo(
                "cat_" + type + "_" + item.id,
                title,
                poster,
                catalogUrl
            )
        );
    }

    return out;
}


// ============================================================
// CATÁLOGO SEARCH
// ============================================================

function CAT_search(query) {
    var out = [];

    if (!query) {
        return out;
    }

    var data = CAT_tmdb(
        "/search/multi?language=es-ES&query=" +
        encodeURIComponent(query)
    );

    if (!data || !data.results) {
        return out;
    }

    var i;

    for (i = 0; i < data.results.length; i++) {
        var item = data.results[i];

        if (!item) continue;

        var type = item.media_type;

        if (type !== "movie" && type !== "tv") {
            continue;
        }

        var title = item.title || item.name || "";

        if (!title) continue;

        var url;

        if (type === "tv") {
            url = "cat://tv/" + item.id;
        } else {
            url = "cat://movie/" + item.id;
        }

        out.push(
            ppMakeVideo(
                "cat_" + type + "_" + item.id,
                title,
                ppFixImg(item.poster_path),
                url
            )
        );
    }

    return out;
}


// ============================================================
// DETALLE PELÍCULA PLPRO
// ============================================================

function ppMovieDetails(id, posterOverride, titleOverride) {
    var data = ppGet("/movies/" + id);

    if (!data) {
        return null;
    }

    var title =
        titleOverride ||
        data.b ||
        data.title ||
        data.name ||
        "Película";

    var poster =
        posterOverride ||
        ppFixImg(
            data.d ||
            data.c ||
            data.poster ||
            data.image ||
            ""
        );

    var linksData = ppGet("/movies/" + id + "/links");

    var links = [];

    if (linksData) {
        links =
            linksData.links ||
            linksData.results ||
            linksData.data ||
            linksData;
    }

    var sources = ppResolveLinks(links);

    var description = "";

    if (data.description) {
        description = data.description;
    }

    if (!sources.length) {
        description +=
            "\n\n[PlPro] No se encontró una fuente reproducible.";
    }

    return ppMakeDetail(
        "movie_" + id,
        title,
        poster,
        description,
        sources,
        "plpro://movie/" + id
    );
}


// ============================================================
// RESOLVER CAT MOVIE
// ============================================================

function CAT_movieDetails(tmdbId) {
    var tmdb = CAT_tmdb(
        "/movie/" + tmdbId + "?language=es-ES"
    );

    if (!tmdb) {
        return null;
    }

    var title = tmdb.title || tmdb.original_title || "";

    var match = CAT_findPlproMovie(tmdb);

    if (!match) {
        return ppMakeDetail(
            "cat_movie_" + tmdbId,
            title,
            ppFixImg(tmdb.poster_path),
            "Título encontrado en catálogo, pero no se encontró coincidencia en PlPro.",
            [],
            "cat://movie/" + tmdbId
        );
    }

    /*
     * Recuperamos el ID real de PlPro.
     */
    var pid = "";

    if (match.id) {
        pid = match.id;
    }

    if (!pid && match.url) {
        var m = String(match.url).match(/plpro:\/\/movie\/([^\/]+)/);

        if (m) {
            pid = m[1];
        }
    }

    if (!pid) {
        return null;
    }

    return ppMovieDetails(
        pid,
        ppFixImg(tmdb.poster_path),
        title
    );
}


// ============================================================
// DETAILS
// ============================================================

function doDetails(url) {

    if (!url) {
        return null;
    }

    /*
     * Catálogo TMDB
     */
    var m = String(url).match(/^cat:\/\/movie\/(\d+)$/i);

    if (m) {
        return CAT_movieDetails(m[1]);
    }

    /*
     * PlPro directo
     */
    m = String(url).match(/^plpro:\/\/movie\/(.+)$/i);

    if (m) {
        return ppMovieDetails(m[1], "", "");
    }

    return null;
}


// ============================================================
// SEARCH
// ============================================================

function doSearch(query) {
    /*
     * IMPORTANTE:
     * No dependemos de PlPro para que aparezca el catálogo.
     * Primero TMDB/MXL.
     */

    var results = CAT_search(query);

    /*
     * Si TMDB no devuelve nada, intentamos PlPro directamente.
     */
    if (!results.length) {
        results = ppSearchRaw(query);
    }

    return results;
}


// ============================================================
// HOME
// ============================================================

function doHome() {
    var results = CAT_home();

    /*
     * Fallback: si falla TMDB, el plugin sigue mostrando
     * el catálogo propio de PlPro.
     */
    if (!results.length) {
        results = ppHome();
    }

    return results;
}


// ============================================================
// BINDINGS GRAYJAY
// ============================================================

source.setSettings = function(settings) {
    _settings = settings || {};
};

source.enable = function() {
    return true;
};

source.getSearchCapabilities = function() {
    return [
        new SearchCapability(
            "query",
            "Buscar",
            "text"
        )
    ];
};

source.search = function(query) {
    try {
        return new ContentPager(
            doSearch(query)
        );
    } catch (e) {
        return new ContentPager([]);
    }
};

source.isContentDetailsUrl = function(url) {
    if (!url) return false;

    return /^cat:\/\//i.test(url) ||
           /^plpro:\/\//i.test(url);
};

source.isVideoDetailsUrl = function(url) {
    if (!url) return false;

    return /^cat:\/\//i.test(url) ||
           /^plpro:\/\//i.test(url);
};

source.getVideoDetails = function(url) {
    try {
        return doDetails(url);
    } catch (e) {
        return null;
    }
};

source.getHome = function() {
    try {
        return new ContentPager(
            doHome()
        );
    } catch (e) {
        return new ContentPager([]);
    }
};

source.isChannelUrl = function(url) {
    return false;
};

source.searchSuggestions = function(query) {
    return [];
};

source.getContentRecommendations = function(url) {
    return [];
};

source.getContentDetails = function(url) {
    try {
        return doDetails(url);
    } catch (e) {
        return null;
    }
};
