// ============================================================
// PlPro GrayJay Source v43
// Catálogo TMDB mejorado + backend PlPro
// Multi-servidor + HLS/MP4 + series + JkAnime
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

var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "18d85af64ccb07f720d758e05bbec3ad";
var TMDB_IMG = "https://image.tmdb.org/t/p/w500";
var TMDB_BACKDROP = "https://image.tmdb.org/t/p/w1280";

var MAX_TRY = 10;
var MAX_EPISODES = 100;

var CACHE = {};
var CACHE_TTL = 1800000;


// ============================================================
// LOG
// ============================================================

function log(s) {
    _debugLog += String(s) + "\n";
}


// ============================================================
// HTTP
// ============================================================

function httpGet(url, headers) {
    try {
        var h = headers || {};

        if (!h["User-Agent"] && !h["user-agent"]) {
            h["User-Agent"] = UA;
        }

        var r = http.GET(url, h);

        if (r && r.body) {
            return r.body;
        }

        return "";
    } catch (e) {
        log("[GET] " + url + " -> " + String(e));
        return "";
    }
}


// ============================================================
// JSON
// ============================================================

function safeJson(s) {
    try {
        return JSON.parse(s);
    } catch (e) {
        return null;
    }
}


// ============================================================
// CACHE
// ============================================================

function cacheGet(k) {
    var x = CACHE[k];

    if (!x) return null;

    if ((Date.now() - x.t) > CACHE_TTL) {
        delete CACHE[k];
        return null;
    }

    return x.d;
}

function cachePut(k, d) {
    CACHE[k] = {
        d: d,
        t: Date.now()
    };
}


// ============================================================
// URL / TEXT
// ============================================================

function cleanUrl(url) {
    if (!url) return "";

    return String(url)
        .trim()
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/");
}

function htmlDecode(s) {
    if (!s) return "";

    return String(s)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, function(m, n) {
            return String.fromCharCode(parseInt(n, 10));
        })
        .replace(/&#x([0-9a-fA-F]+);/g, function(m, n) {
            return String.fromCharCode(parseInt(n, 16));
        });
}

function stripTags(s) {
    if (!s) return "";

    return htmlDecode(
        String(s)
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
    ).trim();
}

function slugify(s) {
    if (!s) return "";

    return String(s)
        .toLowerCase()
        .normalize ? String(s).normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
        : String(s)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
}

function normalizeTitle(s) {
    if (!s) return "";

    var x = String(s).toLowerCase();

    x = x
        .replace(/á/g, "a")
        .replace(/é/g, "e")
        .replace(/í/g, "i")
        .replace(/ó/g, "o")
        .replace(/ú/g, "u")
        .replace(/ü/g, "u")
        .replace(/ñ/g, "n");

    x = x.replace(/[^a-z0-9]+/g, " ");

    return x.replace(/\s+/g, " ").trim();
}

function titleScore(a, b) {
    var x = normalizeTitle(a);
    var y = normalizeTitle(b);

    if (!x || !y) return 0;
    if (x === y) return 100;

    if (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) {
        return 80;
    }

    var ax = x.split(" ");
    var ay = y.split(" ");
    var hit = 0;

    for (var i = 0; i < ax.length; i++) {
        if (ax[i].length < 2) continue;

        for (var j = 0; j < ay.length; j++) {
            if (ax[i] === ay[j]) {
                hit++;
                break;
            }
        }
    }

    var total = Math.max(ax.length, ay.length);

    if (!total) return 0;

    return Math.round((hit / total) * 70);
}


// ============================================================
// IMÁGENES
// ============================================================

function fixImg(u) {
    if (!u) return "";

    var s = String(u).trim();

    if (!s) return "";

    if (s.indexOf("ttps://") === 0) {
        s = "https" + s.substring(4);
    }

    if (s.indexOf("//") === 0) {
        return "https:" + s;
    }

    if (/^https?:\/\//i.test(s)) {
        return s;
    }

    s = s.replace(/^\/+/, "");

    if (!s) return "";

    // TMDB path
    if (/^(?:[0-9a-zA-Z]+\/)?[0-9a-zA-Z_-]+\.(jpg|jpeg|png|webp)(?:\?.*)?$/i.test(s)) {
        return TMDB_IMG + "/" + s;
    }

    // Path TMDB sin extensión
    if (s.indexOf(".") === -1) {
        return TMDB_IMG + "/" + s;
    }

    return TMDB_IMG + "/" + s;
}

function fixBackdrop(u) {
    if (!u) return "";

    var s = String(u).trim();

    if (/^https?:\/\//i.test(s)) {
        return s;
    }

    s = s.replace(/^\/+/, "");

    return TMDB_BACKDROP + "/" + s;
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

        var url = TMDB_API +
            path +
            sep +
            "api_key=" +
            TMDB_KEY;

        var body = httpGet(url, {
            "User-Agent": UA,
            "Accept": "application/json"
        });

        if (!body) return null;

        var json = safeJson(body);

        if (json) {
            cachePut(key, json);
        }

        return json;
    } catch (e) {
        log("[TMDB] " + String(e));
        return null;
    }
}


// ============================================================
// PLPRO BACKEND
// ============================================================

function ppGet(path) {
    try {
        var key = "pp:" + path;

        var old = cacheGet(key);

        if (old) {
            log("[PlPro] cache " + path);
            return old;
        }

        var sep = path.indexOf("?") >= 0 ? "&" : "?";

        var url =
            IPTV_URL +
            path +
            sep +
            "username=" +
            encodeURIComponent(IPTV_USER) +
            "&password=" +
            encodeURIComponent(IPTV_PASS);

        log("[PlPro] GET " + url);

        var body = httpGet(url, {
            "User-Agent": "PLPro/8",
            "Accept": "application/json, text/plain, */*"
        });

        if (!body) {
            log("[PlPro] respuesta vacía");
            return null;
        }

        var json = safeJson(body);

        if (!json) {
            log("[PlPro] JSON inválido: " + body.substring(0, 120));
            return null;
        }

        cachePut(key, json);

        return json;

    } catch (e) {
        log("[PlPro] error " + String(e));
        return null;
    }
}


// ============================================================
// NORMALIZACIÓN DE IMAGEN DE PLPRO
// ============================================================

function getItemImage(item) {
    if (!item) return "";

    var candidates = [
        item.poster,
        item.poster_path,
        item.image,
        item.img,
        item.thumbnail,
        item.thumb,
        item.cover,
        item.cover_url,
        item.picture,
        item.photo,
        item.logo,
        item.d,
        item.c
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i]) {
            var x = fixImg(candidates[i]);

            if (x) return x;
        }
    }

    return "";
}

function getItemTitle(item) {
    if (!item) return "Sin título";

    return item.title ||
        item.name ||
        item.original_title ||
        item.original_name ||
        item.b ||
        item.a ||
        "Sin título";
}

function getItemYear(item) {
    if (!item) return "";

    var d =
        item.release_date ||
        item.first_air_date ||
        item.year ||
        item.date ||
        "";

    var m = String(d).match(/(19|20)\d{2}/);

    return m ? m[0] : "";
}


// ============================================================
// VIDEO UI
// ============================================================

function mkThumb(url) {
    return new Thumbnails([
        new Thumbnail(
            url || TMDB_IMG + "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
            100
        )
    ]);
}

function mkVideo(id, title, thumb, url) {
    return new PlatformVideo({
        id: new PlatformID("PlPro", id, PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(
            PPID,
            "PlPro",
            IPTV_URL,
            "",
            0
        ),
        uploadDate: 0,
        url: url,
        duration: 0,
        viewCount: 0,
        isLive: false
    });
}

function mkDetail(id, title, thumb, url, sources, desc) {
    return new PlatformVideoDetails({
        id: new PlatformID("PlPro", id, PID),
        name: title || "Sin título",
        thumbnails: mkThumb(thumb),
        author: new PlatformAuthorLink(
            PPID,
            "PlPro",
            IPTV_URL,
            "",
            0
        ),
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
        name: name || "MP4",
        type: "MP4",
        extra: []
    });
}


// ============================================================
// TMDB → VIDEO
// ============================================================

function tmdbVideo(item) {
    if (!item) return null;

    var title = item.title || item.name || "Sin título";

    var year = (
        item.release_date ||
        item.first_air_date ||
        ""
    ).substring(0, 4);

    var poster = item.poster_path
        ? fixImg(item.poster_path)
        : "";

    var type = item.media_type || "";

    if (type !== "tv" && type !== "movie") {
        type = item.first_air_date ? "tv" : "movie";
    }

    var id = item.id;

    var rating = "";

    if (item.vote_average) {
        rating = Number(item.vote_average).toFixed(1);
    }

    var prefix = type === "tv"
        ? "[Serie] "
        : "[Película] ";

    var display = prefix + title;

    if (year) {
        display += " (" + year + ")";
    }

    if (rating) {
        display += " ⭐" + rating;
    }

    var url = type === "tv"
        ? "plpro://tv/" + id
        : "plpro://movie/" + id;

    return mkVideo(
        "tmdb_" + type + "_" + id,
        display,
        poster,
        url
    );
}


// ============================================================
// PLPRO SEARCH / MATCHING
// ============================================================

function plproFindMovie(tmdbId, title, year) {
    var data = null;

    // Intento directo por TMDB ID.
    try {
        data = ppGet("/movies/" + tmdbId);

        if (data) {
            return {
                id: tmdbId,
                data: data
            };
        }
    } catch (e) {}

    // Búsqueda general.
    try {
        var q = ppGet(
            "/movies/search/" +
            encodeURIComponent(title)
        );

        if (q) {
            var list = q.results || q.movies || q.data || q;

            if (Object.prototype.toString.call(list) === "[object Array]") {
                var best = null;
                var bestScore = 0;

                for (var i = 0; i < list.length; i++) {
                    var x = list[i];

                    var xt = getItemTitle(x);
                    var xy = getItemYear(x);

                    var score = titleScore(title, xt);

                    if (year && xy && year === xy) {
                        score += 25;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        best = x;
                    }
                }

                if (best && bestScore >= 60) {
                    return {
                        id: best.id || best.a || best._id,
                        data: best
                    };
                }
            }
        }
    } catch (e2) {}

    // Fallback al endpoint que usa PlPro como catálogo.
    try {
        var resume = ppGet("/movies/resume");

        if (resume) {
            var arr = resume.results || resume.movies || resume.data || resume;

            if (Object.prototype.toString.call(arr) === "[object Array]") {
                var b = null;
                var bs = 0;

                for (var j = 0; j < arr.length; j++) {
                    var it = arr[j];

                    var st = getItemTitle(it);
                    var sy = getItemYear(it);

                    var sc = titleScore(title, st);

                    if (year && sy && year === sy) {
                        sc += 25;
                    }

                    if (sc > bs) {
                        bs = sc;
                        b = it;
                    }
                }

                if (b && bs >= 60) {
                    return {
                        id: b.id || b.a || b._id,
                        data: b
                    };
                }
            }
        }
    } catch (e3) {}

    return null;
}

function plproFindSeries(tmdbId, title, year) {
    try {
        var direct = ppGet("/series/" + tmdbId);

        if (direct) {
            return {
                id: tmdbId,
                data: direct
            };
        }
    } catch (e) {}

    try {
        var q = ppGet(
            "/series/search/" +
            encodeURIComponent(title)
        );

        if (q) {
            var list = q.results || q.series || q.data || q;

            if (Object.prototype.toString.call(list) === "[object Array]") {
                var best = null;
                var bestScore = 0;

                for (var i = 0; i < list.length; i++) {
                    var x = list[i];

                    var xt = getItemTitle(x);
                    var xy = getItemYear(x);

                    var score = titleScore(title, xt);

                    if (year && xy && year === xy) {
                        score += 25;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        best = x;
                    }
                }

                if (best && bestScore >= 60) {
                    return {
                        id: best.id || best.a || best._id,
                        data: best
                    };
                }
            }
        }
    } catch (e2) {}

    return null;
}


// ============================================================
// EXTRACTORES DE VIDEO
// ============================================================

function isM3u8(url) {
    return url && /\.m3u8(?:[?#]|$)/i.test(String(url));
}

function isMp4(url) {
    return url && /\.mp4(?:[?#]|$)/i.test(String(url));
}

function dedup(list) {
    var out = [];
    var seen = {};

    for (var i = 0; i < list.length; i++) {
        var x = cleanUrl(list[i]);

        if (x && !seen[x]) {
            seen[x] = true;
            out.push(x);
        }
    }

    return out;
}

function findM3u8(text) {
    var out = [];

    if (!text) return out;

    var t = htmlDecode(String(text))
        .replace(/\\\//g, "/")
        .replace(/\\u0026/g, "&");

    var m;

    var r1 =
        /(?:file|source|src|url|stream|playlist|hls)\s*[:=]\s*["']([^"']+?\.m3u8[^"']*)["']/gi;

    while ((m = r1.exec(t)) !== null) {
        out.push(m[1]);
    }

    var r2 =
        /https?:\/\/[^"'<>\\\s]+\.m3u8[^"'<>\\\s]*/gi;

    while ((m = r2.exec(t)) !== null) {
        out.push(m[0]);
    }

    return dedup(out);
}

function findMp4(text) {
    var out = [];

    if (!text) return out;

    var t = htmlDecode(String(text))
        .replace(/\\\//g, "/");

    var m;

    var r1 =
        /(?:file|source|src|url|stream)\s*[:=]\s*["']([^"']+?\.mp4[^"']*)["']/gi;

    while ((m = r1.exec(t)) !== null) {
        out.push(m[1]);
    }

    var r2 =
        /https?:\/\/[^"'<>\\\s]+\.mp4[^"'<>\\\s]*/gi;

    while ((m = r2.exec(t)) !== null) {
        out.push(m[0]);
    }

    return dedup(out);
}

function findM3u8Json(obj, depth, out) {
    out = out || [];

    if (depth > 5 || obj === null || obj === undefined) {
        return out;
    }

    if (typeof obj === "string") {
        if (isM3u8(obj)) {
            out.push(obj);
        }

        return out;
    }

    if (typeof obj !== "object") {
        return out;
    }

    for (var k in obj) {
        if (!obj.hasOwnProperty(k)) continue;

        findM3u8Json(obj[k], depth + 1, out);
    }

    return out;
}

function findMp4Json(obj, depth, out) {
    out = out || [];

    if (depth > 5 || obj === null || obj === undefined) {
        return out;
    }

    if (typeof obj === "string") {
        if (isMp4(obj)) {
            out.push(obj);
        }

        return out;
    }

    if (typeof obj !== "object") {
        return out;
    }

    for (var k in obj) {
        if (!obj.hasOwnProperty(k)) continue;

        findMp4Json(obj[k], depth + 1, out);
    }

    return out;
}

function absoluteUrl(url, base) {
    if (!url) return "";

    var s = cleanUrl(url);

    if (/^https?:\/\//i.test(s)) {
        return s;
    }

    if (s.indexOf("//") === 0) {
        return "https:" + s;
    }

    if (!base) return s;

    var m = base.match(/^https?:\/\/[^\/]+/i);

    if (!m) return s;

    if (s.charAt(0) === "/") {
        return m[0] + s;
    }

    return m[0] + "/" + s;
}


// ============================================================
// EXTRACTOR UNIFICADO
// ============================================================

function extractVideo(url, depth) {
    depth = depth || 0;

    if (!url || depth > 2) {
        return null;
    }

    var u = cleanUrl(url);

    if (isM3u8(u)) {
        return {
            type: "hls",
            url: u
        };
    }

    if (isMp4(u)) {
        return {
            type: "mp4",
            url: u
        };
    }

    var body = httpGet(u, {
        "User-Agent": UA,
        "Referer": u,
        "Accept": "text/html,application/json,*/*"
    });

    if (!body) return null;

    var json = safeJson(body);

    var hls = json
        ? findM3u8Json(json, 0, [])
        : findM3u8(body);

    hls = dedup(hls);

    for (var i = 0; i < hls.length; i++) {
        var hu = absoluteUrl(hls[i], u);

        if (hu) {
            return {
                type: "hls",
                url: hu
            };
        }
    }

    var mp4 = json
        ? findMp4Json(json, 0, [])
        : findMp4(body);

    mp4 = dedup(mp4);

    for (var j = 0; j < mp4.length; j++) {
        var mu = absoluteUrl(mp4[j], u);

        if (mu) {
            return {
                type: "mp4",
                url: mu
            };
        }
    }

    // iframe
    var iframe =
        body.match(/<iframe[^>]+src=["']([^"']+)["']/i);

    if (iframe && iframe[1]) {
        var iu = absoluteUrl(iframe[1], u);

        if (iu && iu !== u) {
            return extractVideo(iu, depth + 1);
        }
    }

    // video/source HTML
    var source =
        body.match(/<source[^>]+src=["']([^"']+)["']/i);

    if (source && source[1]) {
        var su = absoluteUrl(source[1], u);

        if (isM3u8(su)) {
            return {
                type: "hls",
                url: su
            };
        }

        if (isMp4(su)) {
            return {
                type: "mp4",
                url: su
            };
        }
    }

    return null;
}


// ============================================================
// PLPRO MOVIE DETAILS
// ============================================================

function movieDetails(tmdbId) {
    _debugLog = "";

    log("[movie] TMDB " + tmdbId);

    var data = tmdb(
        "/movie/" +
        tmdbId +
        "?language=es-ES&append_to_response=videos,credits,similar"
    );

    if (!data) {
        return mkDetail(
            "plpro_movie_" + tmdbId,
            "Sin resultado",
            "",
            "plpro://movie/" + tmdbId,
            [],
            "No se pudo consultar TMDB."
        );
    }

    var title = data.title || "Sin título";

    var year = (
        data.release_date || ""
    ).substring(0, 4);

    var poster = data.poster_path
        ? fixImg(data.poster_path)
        : "";

    var rating = data.vote_average
        ? Number(data.vote_average).toFixed(1)
        : "N/A";

    var desc =
        "**" +
        title +
        "**" +
        (year ? " (" + year + ")" : "") +
        "\n⭐ " +
        rating +
        "/10";

    if (data.runtime) {
        desc += " | " + data.runtime + " min";
    }

    desc += "\n\n" +
        (data.overview || "Sin sinopsis");

    if (data.genres) {
        desc += "\n\n--- Géneros ---";

        for (var g = 0; g < data.genres.length; g++) {
            desc += "\n• " + data.genres[g].name;
        }
    }

    var sources = [];

    desc += "\n\n--- PlPro ---";

    var pl = plproFindMovie(
        tmdbId,
        title,
        year
    );

    var plId = pl && pl.id
        ? pl.id
        : tmdbId;

    log("[movie] PlPro ID = " + plId);

    var links = ppGet(
        "/movies/" +
        plId +
        "/links"
    );

    if (links) {
        var list =
            links.links ||
            links.results ||
            links.servers ||
            links.data ||
            links;

        if (Object.prototype.toString.call(list) === "[object Array]") {

            for (
                var i = 0;
                i < list.length && i < MAX_TRY;
                i++
            ) {
                var item = list[i];

                var link =
                    item.url ||
                    item.link ||
                    item.src ||
                    item.a ||
                    "";

                if (!link) continue;

                var name =
                    item.name ||
                    item.label ||
                    item.server ||
                    ("Servidor " + (i + 1));

                var resolved = extractVideo(link);

                if (resolved) {
                    if (resolved.type === "hls") {
                        sources.push(
                            mkHls(
                                resolved.url,
                                "PlPro - " + name
                            )
                        );

                        desc +=
                            "\n• " +
                            name +
                            " ✅ HLS";
                    } else {
                        sources.push(
                            mkDirect(
                                resolved.url,
                                "PlPro - " + name
                            )
                        );

                        desc +=
                            "\n• " +
                            name +
                            " ✅ MP4";
                    }
                } else {
                    desc +=
                        "\n• " +
                        name +
                        " ❌";
                }
            }
        }
    }

    if (sources.length === 0) {
        desc +=
            "\n• No se pudo resolver ningún servidor.";
    }

    if (data.videos && data.videos.results) {
        for (
            var v = 0;
            v < data.videos.results.length;
            v++
        ) {
            var trailer = data.videos.results[v];

            if (
                trailer.site === "YouTube" &&
                trailer.type === "Trailer"
            ) {
                desc +=
                    "\n\n🎬 Trailer: https://youtube.com/watch?v=" +
                    trailer.key;

                break;
            }
        }
    }

    return mkDetail(
        "plpro_movie_" + tmdbId,
        title + (year ? " (" + year + ")" : ""),
        poster,
        "plpro://movie/" + tmdbId,
        sources,
        desc
    );
}


// ============================================================
// SERIE DETAILS
// ============================================================

function tvDetails(tmdbId) {
    _debugLog = "";

    log("[tv] TMDB " + tmdbId);

    var data = tmdb(
        "/tv/" +
        tmdbId +
        "?language=es-ES&append_to_response=seasons,credits,similar"
    );

    if (!data) {
        return mkDetail(
            "plpro_tv_" + tmdbId,
            "Sin resultado",
            "",
            "plpro://tv/" + tmdbId,
            [],
            "No se pudo consultar TMDB."
        );
    }

    var title = data.name || "Sin título";

    var year = (
        data.first_air_date || ""
    ).substring(0, 4);

    var poster = data.poster_path
        ? fixImg(data.poster_path)
        : "";

    var rating = data.vote_average
        ? Number(data.vote_average).toFixed(1)
        : "N/A";

    var desc =
        "**" +
        title +
        "**" +
        (year ? " (" + year + ")" : "");

    desc +=
        "\n⭐ " +
        rating +
        "/10";

    desc +=
        "\n\n" +
        (data.overview || "Sin sinopsis");

    if (data.genres) {
        desc += "\n\n--- Géneros ---";

        for (var g = 0; g < data.genres.length; g++) {
            desc +=
                "\n• " +
                data.genres[g].name;
        }
    }

    desc += "\n\n--- Episodios ---";

    var seasonCount = 0;

    if (data.seasons) {

        for (var s = 0; s < data.seasons.length; s++) {

            var season = data.seasons[s];

            if (
                !season ||
                season.season_number <= 0
            ) {
                continue;
            }

            seasonCount++;

            var count =
                season.episode_count || 0;

            desc +=
                "\n\nT" +
                season.season_number +
                " (" +
                count +
                " episodios):";

            if (count > MAX_EPISODES) {
                count = MAX_EPISODES;
            }

            for (
                var e = 1;
                e <= count;
                e++
            ) {
                desc +=
                    "\nE" +
                    e +
                    " → plpro://tv/" +
                    tmdbId +
                    "/" +
                    season.season_number +
                    "/" +
                    e;
            }
        }
    }

    if (seasonCount === 0) {
        desc +=
            "\nNo se encontraron temporadas.";
    }

    desc +=
        "\n\nSeleccioná un episodio para reproducir.";

    return mkDetail(
        "plpro_tv_" + tmdbId,
        title,
        poster,
        "plpro://tv/" + tmdbId,
        [],
        desc
    );
}


// ============================================================
// EPISODE
// ============================================================

function episodeDetails(
    tmdbId,
    seasonNum,
    episodeNum
) {
    log(
        "[episode] " +
        tmdbId +
        " S" +
        seasonNum +
        "E" +
        episodeNum
    );

    var data = tmdb(
        "/tv/" +
        tmdbId +
        "/season/" +
        seasonNum +
        "/episode/" +
        episodeNum +
        "?language=es-ES"
    );

    var title = "";

    var thumb = "";

    if (data) {
        title = data.name || "";

        if (data.still_path) {
            thumb = fixImg(data.still_path);
        }
    }

    var display =
        "T" +
        seasonNum +
        "E" +
        episodeNum;

    if (title) {
        display +=
            " - " +
            title;
    }

    var desc =
        "**" +
        display +
        "**";

    if (data && data.overview) {
        desc +=
            "\n\n" +
            data.overview;
    }

    desc +=
        "\n\n--- Servidores PlPro ---";

    var sources = [];

    // Intento directo con TMDB ID.
    var links = ppGet(
        "/series/" +
        tmdbId +
        "/links/" +
        seasonNum +
        "/" +
        episodeNum
    );

    // Si el ID de TMDB no coincide con el interno,
    // buscamos la serie.
    if (!links) {

        var seriesTitle = "";

        try {
            var tv = tmdb(
                "/tv/" +
                tmdbId +
                "?language=es-ES"
            );

            if (tv) {
                seriesTitle =
                    tv.name || "";
            }
        } catch (e) {}

        if (seriesTitle) {

            var found =
                plproFindSeries(
                    tmdbId,
                    seriesTitle,
                    data && data.air_date
                        ? data.air_date.substring(0, 4)
                        : ""
                );

            if (found && found.id) {

                links = ppGet(
                    "/series/" +
                    found.id +
                    "/links/" +
                    seasonNum +
                    "/" +
                    episodeNum
                );
            }
        }
    }

    if (links) {

        var list =
            links.links ||
            links.results ||
            links.servers ||
            links.data ||
            links;

        if (
            Object.prototype.toString.call(list) ===
            "[object Array]"
        ) {

            for (
                var i = 0;
                i < list.length && i < MAX_TRY;
                i++
            ) {

                var item = list[i];

                var link =
                    item.url ||
                    item.link ||
                    item.src ||
                    item.a ||
                    "";

                if (!link) continue;

                var name =
                    item.name ||
                    item.label ||
                    item.server ||
                    ("Servidor " + (i + 1));

                var resolved =
                    extractVideo(link);

                if (resolved) {

                    if (
                        resolved.type ===
                        "hls"
                    ) {

                        sources.push(
                            mkHls(
                                resolved.url,
                                "PlPro - " +
                                name
                            )
                        );

                        desc +=
                            "\n• " +
                            name +
                            " ✅ HLS";

                    } else {

                        sources.push(
                            mkDirect(
                                resolved.url,
                                "PlPro - " +
                                name
                            )
                        );

                        desc +=
                            "\n• " +
                            name +
                            " ✅ MP4";
                    }

                } else {

                    desc +=
                        "\n• " +
                        name +
                        " ❌";
                }
            }
        }
    }

    if (sources.length === 0) {
        desc +=
            "\n• Ningún servidor pudo ser resuelto.";
    }

    var prev =
        parseInt(episodeNum, 10) - 1;

    var next =
        parseInt(episodeNum, 10) + 1;

    if (prev >= 1) {
        desc +=
            "\n\n← Episodio anterior: plpro://tv/" +
            tmdbId +
            "/" +
            seasonNum +
            "/" +
            prev;
    }

    desc +=
        "\n→ Episodio siguiente: plpro://tv/" +
        tmdbId +
        "/" +
        seasonNum +
        "/" +
        next;

    return {
        title: display,
        thumb: thumb,
        sources: sources,
        desc: desc
    };
}

function episodeView(
    tmdbId,
    seasonNum,
    episodeNum
) {
    _debugLog = "";

    var ep =
        episodeDetails(
            tmdbId,
            seasonNum,
            episodeNum
        );

    return mkDetail(
        "plpro_tv_" +
        tmdbId +
        "_" +
        seasonNum +
        "_" +
        episodeNum,
        ep.title,
        ep.thumb,
        "plpro://tv/" +
        tmdbId +
        "/" +
        seasonNum +
        "/" +
        episodeNum,
        ep.sources,
        ep.desc
    );
}


// ============================================================
// JKANIME
// ============================================================

function jkaSearch(query) {
    var out = [];

    if (!query) return out;

    var url =
        JK +
        "/buscar/" +
        slugify(query) +
        "/";

    var body = httpGet(url, {
        "User-Agent": UA,
        "Referer": JK + "/"
    });

    if (!body) return out;

    var re =
        /href=["'](https?:\/\/jkanime\.net\/[^"']+)["'][^>]*>([\s\S]{0,500})/gi;

    var m;

    while ((m = re.exec(body)) !== null) {

        var u = m[1];

        if (
            !u ||
            /\/episodio\//i.test(u) ||
            /\/ver\//i.test(u)
        ) {
            continue;
        }

        var block = m[2];

        var title =
            stripTags(block);

        if (!title) {
            title = u.split("/")[3] || "Anime";
        }

        title = title.substring(0, 120);

        out.push(
            mkVideo(
                "jka_" + slugify(title),
                "[Anime] " + title,
                "",
                u
            )
        );

        if (out.length >= 20) break;
    }

    return out;
}


// ------------------------------------------------------------
// JkAnime extractor mejorado
// ------------------------------------------------------------

function jkaExtractVideo(episodeUrl) {
    if (!episodeUrl) return null;

    var body = httpGet(
        episodeUrl,
        {
            "User-Agent": UA,
            "Referer": JK + "/"
        }
    );

    if (!body) return null;

    var candidates = [];

    var m;

    // M3U8 directo
    var r1 =
        /https?:\/\/[^"'<>\\\s]+\.m3u8[^"'<>\\\s]*/gi;

    while ((m = r1.exec(body)) !== null) {
        candidates.push(m[0]);
    }

    // url:
    var r2 =
        /(?:url|file|src|source|playlist|hls)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/gi;

    while ((m = r2.exec(body)) !== null) {
        candidates.push(m[1]);
    }

    // player
    var r3 =
        /(?:video|player)\s*\[[^\]]+\][\s\S]{0,1000}?src=["']([^"']+)["']/gi;

    while ((m = r3.exec(body)) !== null) {
        candidates.push(m[1]);
    }

    candidates = dedup(candidates);

    // Si encontramos M3U8 directamente.
    for (var i = 0; i < candidates.length; i++) {

        var u =
            absoluteUrl(
                candidates[i],
                episodeUrl
            );

        if (isM3u8(u)) {
            return {
                type: "hls",
                url: u
            };
        }
    }

    // Buscar iframe / jkplayer.
    var iframe =
        body.match(
            /<iframe[^>]+src=["']([^"']+)["']/i
        );

    if (iframe && iframe[1]) {

        var iu =
            absoluteUrl(
                iframe[1],
                episodeUrl
            );

        if (iu) {

            var pbody =
                httpGet(iu, {
                    "User-Agent": UA,
                    "Referer": episodeUrl
                });

            if (pbody) {

                var pm =
                    findM3u8(pbody);

                if (pm.length) {

                    return {
                        type: "hls",
                        url: absoluteUrl(
                            pm[0],
                            iu
                        )
                    };
                }
            }
        }
    }

    // Buscar cualquier URL de jkplayer.
    var player =
        body.match(
            /https?:\/\/jkanime\.net\/jkplayer\/[^"'<>]+/i
        );

    if (player && player[0]) {

        var p =
            httpGet(
                player[0],
                {
                    "User-Agent": UA,
                    "Referer": episodeUrl
                }
            );

        if (p) {

            var pp =
                findM3u8(p);

            if (pp.length) {

                return {
                    type: "hls",
                    url: absoluteUrl(
                        pp[0],
                        player[0]
                    )
                };
            }
        }
    }

    return null;
}


// ============================================================
// JKANIME DETAILS
// ============================================================

function jkaDetails(url) {

    var body =
        httpGet(
            url,
            {
                "User-Agent": UA,
                "Referer": JK + "/"
            }
        );

    if (!body) {
        return mkDetail(
            "jka_error",
            "Anime",
            "",
            url,
            [],
            "No se pudo cargar el anime."
        );
    }

    var title = "Anime";

    var mt =
        body.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
        );

    if (mt) {
        title =
            stripTags(mt[1])
                .replace(/\s*\|\s*Jkanime.*$/i, "")
                .trim();
    }

    var poster = "";

    var mp =
        body.match(
            /(?:property=["']og:image["']|name=["']twitter:image["'])[^>]+content=["']([^"']+)["']/i
        );

    if (mp) {
        poster = fixImg(mp[1]);
    }

    var episodes = [];

    var re =
        /href=["'](https?:\/\/jkanime\.net\/[^"']*episodio[^"']*)["']/gi;

    var m;

    while ((m = re.exec(body)) !== null) {

        if (episodes.indexOf(m[1]) === -1) {
            episodes.push(m[1]);
        }

        if (episodes.length >= 100) break;
    }

    // Si no detectó episodios con la URL completa,
    // busca rutas relativas.
    if (episodes.length === 0) {

        var rr =
            /href=["'](\/[^"']*episodio[^"']*)["']/gi;

        while ((m = rr.exec(body)) !== null) {

            var eu =
                absoluteUrl(
                    m[1],
                    JK
                );

            if (episodes.indexOf(eu) === -1) {
                episodes.push(eu);
            }

            if (episodes.length >= 100) break;
        }
    }

    var sources = [];

    if (episodes.length > 0) {

        var first =
            jkaExtractVideo(
                episodes[0]
            );

        if (first) {

            if (first.type === "hls") {
                sources.push(
                    mkHls(
                        first.url,
                        "JkAnime HLS"
                    )
                );
            } else {
                sources.push(
                    mkDirect(
                        first.url,
                        "JkAnime MP4"
                    )
                );
            }
        }
    }

    var desc =
        "**" +
        title +
        "**\n\n";

    if (episodes.length) {

        desc +=
            "--- Episodios ---";

        for (
            var i = 0;
            i < episodes.length;
            i++
        ) {

            desc +=
                "\nE" +
                (i + 1) +
                " → " +
                episodes[i];
        }

    } else {

        desc +=
            "No se detectaron episodios.";
    }

    return mkDetail(
        "jka_" + slugify(title),
        title,
        poster,
        url,
        sources,
        desc
    );
}


// ============================================================
// SEARCH
// ============================================================

function doSearch(query) {

    var videos = [];
    var seen = {};

    if (!query) return videos;

    // TMDB primero: catálogo visual mejorado.
    try {

        var results =
            tmdb(
                "/search/multi?query=" +
                encodeURIComponent(query) +
                "&language=es-ES&include_adult=false"
            );

        if (
            results &&
            results.results
        ) {

            for (
                var i = 0;
                i < results.results.length &&
                videos.length < 30;
                i++
            ) {

                var r =
                    results.results[i];

                if (
                    r.media_type !== "movie" &&
                    r.media_type !== "tv"
                ) {
                    continue;
                }

                var v =
                    tmdbVideo(r);

                if (!v) continue;

                var key =
                    r.media_type +
                    "_" +
                    r.id;

                if (!seen[key]) {

                    seen[key] = true;
                    videos.push(v);
                }
            }
        }

    } catch (e) {
        log("[search TMDB] " + String(e));
    }

    // JkAnime al final.
    try {

        var anime =
            jkaSearch(query);

        for (
            var j = 0;
            j < anime.length &&
            videos.length < 50;
            j++
        ) {

            videos.push(
                anime[j]
            );
        }

    } catch (e2) {
        log("[search JKA] " + String(e2));
    }

    return videos;
}


// ============================================================
// HOME
// ============================================================

function doHome() {

    var videos = [];
    var seen = {};

    // Trending.
    try {

        var trending =
            tmdb(
                "/trending/all/week?language=es-ES"
            );

        if (
            trending &&
            trending.results
        ) {

            for (
                var i = 0;
                i < trending.results.length &&
                videos.length < 20;
                i++
            ) {

                var r =
                    trending.results[i];

                if (
                    r.media_type !== "movie" &&
                    r.media_type !== "tv"
                ) {
                    continue;
                }

                var key =
                    r.media_type +
                    "_" +
                    r.id;

                if (seen[key]) continue;

                var v =
                    tmdbVideo(r);

                if (v) {

                    seen[key] = true;
                    videos.push(v);
                }
            }
        }

    } catch (e) {}

    // Películas populares.
    try {

        var movies =
            tmdb(
                "/movie/popular?language=es-ES&page=1"
            );

        if (
            movies &&
            movies.results
        ) {

            for (
                var m = 0;
                m < movies.results.length &&
                videos.length < 40;
                m++
            ) {

                var movie =
                    movies.results[m];

                var mk =
                    "movie_" +
                    movie.id;

                if (seen[mk]) continue;

                var mv =
                    tmdbVideo(movie);

                if (mv) {

                    seen[mk] = true;
                    videos.push(mv);
                }
            }
        }

    } catch (e2) {}

    // Series populares.
    try {

        var tv =
            tmdb(
                "/tv/popular?language=es-ES&page=1"
            );

        if (
            tv &&
            tv.results
        ) {

            for (
                var t = 0;
                t < tv.results.length &&
                videos.length < 60;
                t++
            ) {

                var serie =
                    tv.results[t];

                var tk =
                    "tv_" +
                    serie.id;

                if (seen[tk]) continue;

                var tvv =
                    tmdbVideo(serie);

                if (tvv) {

                    seen[tk] = true;
                    videos.push(tvv);
                }
            }
        }

    } catch (e3) {}

    return videos;
}


// ============================================================
// RECOMMENDATIONS
// ============================================================

function doRecommendations(url) {

    var videos = [];

    var mm =
        url.match(
            /plpro:\/\/movie\/(\d+)/
        );

    if (mm) {

        try {

            var data =
                tmdb(
                    "/movie/" +
                    mm[1] +
                    "/recommendations?language=es-ES"
                );

            if (
                data &&
                data.results
            ) {

                for (
                    var i = 0;
                    i < data.results.length &&
                    videos.length < 15;
                    i++
                ) {

                    var v =
                        tmdbVideo(
                            data.results[i]
                        );

                    if (v) {
                        videos.push(v);
                    }
                }
            }

        } catch (e) {}
    }

    var tt =
        url.match(
            /plpro:\/\/tv\/(\d+)/
        );

    if (tt) {

        try {

            var data2 =
                tmdb(
                    "/tv/" +
                    tt[1] +
                    "/recommendations?language=es-ES"
                );

            if (
                data2 &&
                data2.results
            ) {

                for (
                    var j = 0;
                    j < data2.results.length &&
                    videos.length < 15;
                    j++
                ) {

                    var vv =
                        tmdbVideo(
                            data2.results[j]
                        );

                    if (vv) {
                        videos.push(vv);
                    }
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

    if (!url) {
        return mkDetail(
            "",
            "",
            "",
            "",
            [],
            "URL vacía"
        );
    }

    // PlPro movie.
    var mm =
        url.match(
            /plpro:\/\/movie\/(\d+)/
        );

    if (mm) {
        return movieDetails(
            mm[1]
        );
    }

    // PlPro episode.
    var ep =
        url.match(
            /plpro:\/\/tv\/(\d+)\/(\d+)\/(\d+)/
        );

    if (ep) {

        return episodeView(
            ep[1],
            ep[2],
            ep[3]
        );
    }

    // PlPro series.
    var tv =
        url.match(
            /plpro:\/\/tv\/(\d+)/
        );

    if (tv) {

        return tvDetails(
            tv[1]
        );
    }

    // JkAnime.
    if (
        url.indexOf("jkanime.net") !== -1
    ) {

        return jkaDetails(
            url
        );
    }

    return mkDetail(
        "",
        "PlPro",
        "",
        url,
        [],
        ""
    );
}


// ============================================================
// CHANNEL
// ============================================================

function doChannel() {

    return new PlatformChannel({
        id: PPID,
        name: "PlPro",
        thumbnail:
            TMDB_IMG +
            "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
        banner: "",
        subscribers: 0,
        description:
            "PlPro - Películas, series y anime",
        url: IPTV_URL,
        urlAlternatives: [],
        links: {}
    });
}


// ============================================================
// BINDINGS
// ============================================================

if (typeof source !== "undefined") {

    source.setSettings =
        function(s) {
            _settings = s || {};
        };

    source.enable =
        function(c, s) {
            _settings = s || {};
        };

    source.getSearchCapabilities =
        function() {
            return {
                types: [2],
                sorts: [],
                filters: []
            };
        };

    source.search =
        function(query) {

            try {

                return new VideoPager(
                    doSearch(query || ""),
                    false,
                    null
                );

            } catch (e) {

                return new VideoPager(
                    [],
                    false,
                    null
                );
            }
        };

    source.isContentDetailsUrl =
        function(url) {

            return !!(
                url &&
                (
                    url.indexOf("plpro://") === 0 ||
                    url.indexOf("jkanime.net") !== -1
                )
            );
        };

    source.isVideoDetailsUrl =
        function(url) {

            return source.isContentDetailsUrl(
                url
            );
        };

    source.getVideoDetails =
        function(url) {

            return source.getContentDetails(
                url
            );
        };

    source.getHome =
        function() {

            try {

                return new VideoPager(
                    doHome(),
                    false,
                    null
                );

            } catch (e) {

                return new VideoPager(
                    [],
                    false,
                    null
                );
            }
        };

    source.isChannelUrl =
        function(url) {

            return !!(
                url &&
                (
                    url === IPTV_URL ||
                    url.indexOf("plpro://channel/") === 0
                )
            );
        };

    source.getChannel =
        function(url) {

            try {
                return doChannel();
            } catch (e) {
                return doChannel();
            }
        };

    source.getChannelContents =
        function(url) {

            try {

                return new VideoPager(
                    doHome(),
                    false,
                    null
                );

            } catch (e) {

                return new VideoPager(
                    [],
                    false,
                    null
                );
            }
        };

    source.searchSuggestions =
        function(query) {
            return [];
        };

    source.getContentRecommendations =
        function(url) {

            try {

                return new VideoPager(
                    doRecommendations(url),
                    false,
                    null
                );

            } catch (e) {

                return new VideoPager(
                    [],
                    false,
                    null
                );
            }
        };

    source.getContentDetails =
        function(url) {

            try {

                var r =
                    doDetails(url);

                if (r) {
                    return r;
                }

                throw new Error(
                    "doDetails retornó null"
                );

            } catch (e) {

                return new PlatformVideoDetails({

                    id:
                        new PlatformID(
                            "PlPro",
                            "error_fallo",
                            PID
                        ),

                    name: "Error PlPro",

                    thumbnails:
                        new Thumbnails([
                            new Thumbnail(
                                TMDB_IMG +
                                "/wwemzKWzjKYJFfCeiB57q3r4Bcm.png",
                                100
                            )
                        ]),

                    author:
                        new PlatformAuthorLink(
                            PPID,
                            "PlPro",
                            IPTV_URL,
                            "",
                            0
                        ),

                    uploadDate: 0,
                    url: url || IPTV_URL,
                    duration: 0,
                    viewCount: 0,
                    isLive: false,

                    description:
                        "Error: " +
                        String(e) +
                        "\n\n" +
                        _debugLog,

                    video:
                        new VideoSourceDescriptor([])
                });
            }
        };
}
