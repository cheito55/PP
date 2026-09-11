// ============================================================
// PlPro GrayJay Source v45
// ============================================================
// MXL / TMDB:
//   - catálogo
//   - portadas
//   - títulos
//   - año
//   - búsqueda
//   - temporadas
//
// PlPro.org:
//   - búsqueda real de película/serie
//   - resolución de links
//   - HLS / MP4
//
// IMPORTANTE:
//   MXL NO reproduce.
//   PlPro.org NO proporciona las portadas.
// ============================================================


// ============================================================
// CONFIG
// ============================================================

var PID =
    "b7ff0ea6-ff3d-46b5-bec4-bff3c197b5eb";

var PLPRO_NAME = "PlPro";

var UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/125.0.0.0 Safari/537.36";

var PPID =
    new PlatformID(
        PLPRO_NAME,
        PLPRO_NAME,
        PID
    );


// ============================================================
// MXL / TMDB
// ============================================================

var CAT_TMDB_API =
    "https://api.themoviedb.org/3";

var CAT_TMDB_KEY =
    "18d85af64ccb07f720d758e05bbec3ad";

var CAT_TMDB_IMG =
    "https://image.tmdb.org/t/p/w500";

var CAT_TMDB_BACKDROP =
    "https://image.tmdb.org/t/p/w1280";


// ============================================================
// PLPRO.ORG
// ============================================================

var PP_URL =
    "https://plpro.org";

var PP_USER = "p";
var PP_PASS = "p";


// ============================================================
// CACHE
// ============================================================

var CAT_CACHE = {};
var PP_CACHE = {};

var CACHE_TTL = 1800000;


// ============================================================
// DEBUG
// ============================================================

var _debugLog = "";
var _settings = {};


function log(s) {
    try {
        _debugLog += String(s) + "\n";
    } catch (e) {}
}


function clearLog() {
    _debugLog = "";
}


// ============================================================
// HTTP
// ============================================================

function httpGet(url, headers) {
    try {
        var h = headers || {};

        if (!h["User-Agent"]) {
            h["User-Agent"] = UA;
        }

        return http.GET(url, h);

    } catch (e) {

        log(
            "HTTP ERROR: " +
            url +
            " :: " +
            e
        );

        return null;
    }
}


function safeJson(x) {
    try {

        if (!x) return null;

        if (typeof x == "object") {
            return x;
        }

        return JSON.parse(
            String(x)
        );

    } catch (e) {

        return null;
    }
}


// ============================================================
// CACHE
// ============================================================

function cacheGet(store, key) {

    try {

        var v = store[key];

        if (!v) return null;

        if (
            Date.now() - v.time >
            CACHE_TTL
        ) {
            delete store[key];
            return null;
        }

        return v.value;

    } catch (e) {

        return null;
    }
}


function cachePut(store, key, value) {

    try {

        store[key] = {
            time: Date.now(),
            value: value
        };

    } catch (e) {}
}


// ============================================================
// STRING
// ============================================================

function htmlDecode(s) {

    if (!s) return "";

    return String(s)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}


function stripTags(s) {

    if (!s) return "";

    return String(s)
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function slugify(s) {

    if (!s) return "";

    return String(s)
        .toLowerCase()
        .replace(/á/g, "a")
        .replace(/é/g, "e")
        .replace(/í/g, "i")
        .replace(/ó/g, "o")
        .replace(/ú/g, "u")
        .replace(/ü/g, "u")
        .replace(/ñ/g, "n")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


function normalizeTitle(s) {

    if (!s) return "";

    return String(s)
        .toLowerCase()
        .replace(/á/g, "a")
        .replace(/é/g, "e")
        .replace(/í/g, "i")
        .replace(/ó/g, "o")
        .replace(/ú/g, "u")
        .replace(/ü/g, "u")
        .replace(/ñ/g, "n")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function titleScore(a, b) {

    a = normalizeTitle(a);
    b = normalizeTitle(b);

    if (!a || !b) return 0;

    if (a == b) return 100;

    if (a.indexOf(b) >= 0) return 80;

    if (b.indexOf(a) >= 0) return 75;

    var aw = a.split(" ");
    var bw = b.split(" ");

    var hits = 0;

    var i;
    var j;

    for (i = 0; i < aw.length; i++) {

        if (aw[i].length < 3) {
            continue;
        }

        for (j = 0; j < bw.length; j++) {

            if (aw[i] == bw[j]) {
                hits++;
                break;
            }
        }
    }

    if (aw.length == 0) {
        return 0;
    }

    return Math.floor(
        (hits / aw.length) * 70
    );
}


// ============================================================
// URL
// ============================================================

function cleanUrl(url) {

    if (!url) return "";

    return String(url)
        .trim()
        .replace(/\\u0026/g, "&")
        .replace(/&amp;/g, "&")
        .replace(/\\\//g, "/");
}


function absoluteUrl(base, url) {

    if (!url) return "";

    url = cleanUrl(url);

    if (
        /^https?:\/\//i.test(url)
    ) {
        return url;
    }

    if (url.indexOf("//") == 0) {
        return "https:" + url;
    }

    if (url.charAt(0) == "/") {
        return base.replace(/\/+$/, "") + url;
    }

    return base.replace(/\/+$/, "") +
        "/" +
        url;
}


// ============================================================
// MXL / TMDB
// ============================================================

function CAT_tmdb(path) {

    var key =
        CAT_TMDB_API +
        path;

    var cached =
        cacheGet(
            CAT_CACHE,
            key
        );

    if (cached) {
        return cached;
    }

    var sep =
        path.indexOf("?") >= 0 ?
        "&" :
        "?";

    var url =
        CAT_TMDB_API +
        path +
        sep +
        "api_key=" +
        encodeURIComponent(
            CAT_TMDB_KEY
        ) +
        "&language=es-ES";

    var r =
        httpGet(url);

    if (!r) {
        return null;
    }

    var j =
        safeJson(r);

    if (j) {
        cachePut(
            CAT_CACHE,
            key,
            j
        );
    }

    return j;
}


function CAT_fixImg(u) {

    if (!u) return "";

    u = String(u).trim();

    if (
        u.indexOf("ttps://") == 0
    ) {
        u = "h" + u;
    }

    if (
        /^https?:\/\//i.test(u)
    ) {
        return u;
    }

    if (
        u.indexOf("//") == 0
    ) {
        return "https:" + u;
    }

    if (
        u.charAt(0) == "/"
    ) {
        return CAT_TMDB_IMG + u;
    }

    return u;
}


function CAT_getTitle(item) {

    if (!item) return "";

    if (item.title) {
        return item.title;
    }

    if (item.name) {
        return item.name;
    }

    if (item.original_title) {
        return item.original_title;
    }

    if (item.original_name) {
        return item.original_name;
    }

    return "";
}


function CAT_getYear(item) {

    if (!item) return "";

    var d =
        item.release_date ||
        item.first_air_date ||
        "";

    if (!d) return "";

    return String(d)
        .substring(0, 4);
}


function CAT_getImage(item) {

    if (!item) return "";

    return CAT_fixImg(
        item.poster_path ||
        item.poster ||
        item.image ||
        item.backdrop_path ||
        ""
    );
}


function CAT_getType(item) {

    if (!item) return "movie";

    if (item.media_type) {
        return item.media_type;
    }

    if (
        item.first_air_date ||
        item.name ||
        item.original_name
    ) {
        return "tv";
    }

    return "movie";
}


// ============================================================
// ID DEL CONTENIDO
// ============================================================

function CAT_makeUrl(item) {

    if (!item || !item.id) {
        return "";
    }

    var type =
        CAT_getType(item);

    if (type == "tv") {

        return (
            "plpro://tv/" +
            String(item.id)
        );
    }

    return (
        "plpro://movie/" +
        String(item.id)
    );
}


// ============================================================
// PLATFORM AUTHOR
// ============================================================

function CAT_author() {

    return new PlatformAuthorLink(
        PPID,
        "PlPro",
        PP_URL,
        ""
    );
}


// ============================================================
// PLATFORM VIDEO
//
// ESTA ES LA CORRECCIÓN PRINCIPAL.
//
// Antes se devolvía un objeto JS simple.
// Ahora se devuelve PlatformVideo.
// ============================================================

function CAT_makePlatformVideo(item) {

    if (!item) {
        return null;
    }

    var title =
        CAT_getTitle(item);

    if (!title) {
        return null;
    }

    var url =
        CAT_makeUrl(item);

    if (!url) {
        return null;
    }

    var image =
        CAT_getImage(item);

    var thumbs = [];

    if (image) {

        thumbs.push(
            new Thumbnail(
                image,
                500
            )
        );
    }

    var year =
        CAT_getYear(item);

    var id =
        String(item.id);

    var type =
        CAT_getType(item);

    var internalId =
        type +
        ":" +
        id;

    return new PlatformVideo({

        id:
            new PlatformID(
                PLPRO_NAME,
                internalId,
                PID
            ),

        name:
            year ?
            title + " (" + year + ")" :
            title,

        thumbnails:
            new Thumbnails(
                thumbs
            ),

        author:
            CAT_author(),

        uploadDate:
            0,

        url:
            url,

        duration:
            -1,

        viewCount:
            -1,

        isLive:
            false
    });
}


// ============================================================
// HOME MXL
// ============================================================

function CAT_home() {

    var out = [];

    var j =
        CAT_tmdb(
            "/trending/all/week"
        );

    if (
        j &&
        j.results
    ) {

        for (
            var i = 0;
            i < j.results.length &&
            out.length < 40;
            i++
        ) {

            var x =
                j.results[i];

            var type =
                CAT_getType(x);

            if (
                type != "movie" &&
                type != "tv"
            ) {
                continue;
            }

            var v =
                CAT_makePlatformVideo(
                    x
                );

            if (v) {
                out.push(v);
            }
        }
    }

    return out;
}


// ============================================================
// SEARCH MXL
// ============================================================

function CAT_search(query) {

    var out = [];

    if (!query) {
        return out;
    }

    var j =
        CAT_tmdb(
            "/search/multi?query=" +
            encodeURIComponent(
                query
            )
        );

    if (
        !j ||
        !j.results
    ) {
        return out;
    }

    for (
        var i = 0;
        i < j.results.length &&
        out.length < 50;
        i++
    ) {

        var x =
            j.results[i];

        var type =
            CAT_getType(x);

        if (
            type != "movie" &&
            type != "tv"
        ) {
            continue;
        }

        var v =
            CAT_makePlatformVideo(
                x
            );

        if (v) {
            out.push(v);
        }
    }

    return out;
}


// ============================================================
// VIDEO PAGER
// ============================================================

function CAT_pager(
    results,
    context
) {

    if (!results) {
        results = [];
    }

    if (
        !Array.isArray(results)
    ) {
        results = [];
    }

    return new VideoPager(
        results,
        false,
        context || {}
    );
}


// ============================================================
// GRAYJAY HOME
// ============================================================

source.getHome =
function (continuationToken) {

    clearLog();

    var videos =
        CAT_home();

    return CAT_pager(
        videos,
        {
            continuationToken:
                continuationToken
        }
    );
};


// ============================================================
// GRAYJAY SEARCH
// ============================================================

source.search =
function (
    query,
    type,
    order,
    filters,
    continuationToken
) {

    clearLog();

    var videos =
        CAT_search(query);

    return CAT_pager(
        videos,
        {
            query:
                query,

            type:
                type,

            order:
                order,

            filters:
                filters,

            continuationToken:
                continuationToken
        }
    );
};


// ============================================================
// PLPRO - HTTP
// ============================================================

function PP_get(path) {

    var key =
        PP_URL +
        path;

    var cached =
        cacheGet(
            PP_CACHE,
            key
        );

    if (cached) {
        return cached;
    }

    var url =
        PP_URL +
        "/" +
        String(path)
            .replace(/^\/+/, "");

    var headers = {

        "User-Agent": UA,

        "Accept":
            "*/*"
    };

    var r =
        httpGet(
            url,
            headers
        );

    if (!r) {
        return null;
    }

    cachePut(
        PP_CACHE,
        key,
        r
    );

    return r;
}


// ============================================================
// PLPRO SEARCH RESULT
// ============================================================

function PP_findBest(
    data,
    title,
    year
) {

    if (!data) {
        return null;
    }

    var j =
        safeJson(data);

    if (!j) {
        return null;
    }

    var arr = [];

    if (
        j.results &&
        Array.isArray(j.results)
    ) {
        arr = j.results;
    }
    else if (
        j.data &&
        Array.isArray(j.data)
    ) {
        arr = j.data;
    }
    else if (
        j.movies &&
        Array.isArray(j.movies)
    ) {
        arr = j.movies;
    }
    else if (
        j.series &&
        Array.isArray(j.series)
    ) {
        arr = j.series;
    }

    var best = null;
    var bestScore = 0;

    for (
        var i = 0;
        i < arr.length;
        i++
    ) {

        var x =
            arr[i];

        var xt =
            x.title ||
            x.name ||
            x.movie_title ||
            x.series_title ||
            "";

        var score =
            titleScore(
                title,
                xt
            );

        var xy =
            x.year ||
            x.release_year ||
            x.release_date ||
            x.first_air_date ||
            "";

        if (
            year &&
            String(xy).indexOf(
                String(year)
            ) >= 0
        ) {
            score += 20;
        }

        if (
            score > bestScore
        ) {

            bestScore =
                score;

            best = x;
        }
    }

    return best;
}


// ============================================================
// PLPRO - MOVIE SEARCH
// ============================================================

function PP_findMovie(
    title,
    year
) {

    if (!title) {
        return null;
    }

    var paths = [];

    paths.push(
        "/search/" +
        encodeURIComponent(
            title
        )
    );

    var slug =
        slugify(title);

    if (
        slug &&
        slug != title
    ) {

        paths.push(
            "/search/" +
            encodeURIComponent(
                slug
            )
        );
    }

    for (
        var i = 0;
        i < paths.length;
        i++
    ) {

        var r =
            PP_get(
                paths[i]
            );

        if (!r) {
            continue;
        }

        var best =
            PP_findBest(
                r,
                title,
                year
            );

        if (best) {
            return best;
        }
    }

    return null;
}


// ============================================================
// PLPRO - SERIES SEARCH
// ============================================================

function PP_findSeries(
    title,
    year
) {

    if (!title) {
        return null;
    }

    var paths = [];

    paths.push(
        "/search/" +
        encodeURIComponent(
            title
        )
    );

    var slug =
        slugify(title);

    if (slug) {

        paths.push(
            "/search/" +
            encodeURIComponent(
                slug
            )
        );
    }

    for (
        var i = 0;
        i < paths.length;
        i++
    ) {

        var r =
            PP_get(
                paths[i]
            );

        if (!r) {
            continue;
        }

        var best =
            PP_findBest(
                r,
                title,
                year
            );

        if (best) {
            return best;
        }
    }

    return null;
}


// ============================================================
// VIDEO LINKS
// ============================================================

function dedup(arr) {

    var out = [];
    var seen = {};

    if (!arr) {
        return out;
    }

    for (
        var i = 0;
        i < arr.length;
        i++
    ) {

        var x =
            arr[i];

        if (!x) {
            continue;
        }

        x = String(x);

        if (seen[x]) {
            continue;
        }

        seen[x] = true;

        out.push(x);
    }

    return out;
}


function findM3u8(text) {

    if (!text) {
        return [];
    }

    var a =
        String(text).match(
            /https?:\/\/[^"' <>\r\n\\]+\.m3u8[^"' <>\r\n\\]*/ig
        );

    return dedup(
        a || []
    );
}


function findMp4(text) {

    if (!text) {
        return [];
    }

    var a =
        String(text).match(
            /https?:\/\/[^"' <>\r\n\\]+\.mp4[^"' <>\r\n\\]*/ig
        );

    return dedup(
        a || []
    );
}


// ============================================================
// EXTRACT VIDEO
// ============================================================

function PP_extractVideo(
    data
) {

    if (!data) {
        return [];
    }

    var text =
        typeof data == "string" ?
        data :
        JSON.stringify(data);

    var hls =
        findM3u8(text);

    var mp4 =
        findMp4(text);

    var out = [];

    for (
        var i = 0;
        i < hls.length;
        i++
    ) {

        out.push({
            type: "hls",
            url: hls[i]
        });
    }

    for (
        var j = 0;
        j < mp4.length;
        j++
    ) {

        out.push({
            type: "mp4",
            url: mp4[j]
        });
    }

    return out;
}


// ============================================================
// PLPRO MOVIE LINKS
// ============================================================

function PP_getMovieLinks(
    id
) {

    if (!id) {
        return [];
    }

    var r =
        PP_get(
            "/movies/" +
            encodeURIComponent(id) +
            "/links"
        );

    if (!r) {
        return [];
    }

    return PP_extractVideo(r);
}


// ============================================================
// PLPRO EPISODE LINKS
// ============================================================

function PP_getEpisodeLinks(
    id,
    season,
    episode
) {

    if (!id) {
        return [];
    }

    var r =
        PP_get(
            "/series/" +
            encodeURIComponent(id) +
            "/links/" +
            encodeURIComponent(season) +
            "/" +
            encodeURIComponent(episode)
        );

    if (!r) {
        return [];
    }

    return PP_extractVideo(r);
}


// ============================================================
// CONVERTIR LINK PLPRO A HLS/MUX
// ============================================================

function PP_makeSource(
    link
) {

    if (!link || !link.url) {
        return null;
    }

    if (
        link.type == "hls"
    ) {

        return new HLSSource({
            name:
                "PlPro HLS",

            duration:
                -1,

            url:
                link.url
        });
    }

    return null;
}


// ============================================================
// DETAILS + REPRODUCCIÓN
//
// GrayJay llama getVideoDetails().
// Aquí se hace:
//
// MXL/TMDB
//      ↓
// título / año / portada
//      ↓
// PlPro.org
//      ↓
// HLS
// ============================================================

source.isVideoDetailsUrl =
function (url) {

    if (!url) {
        return false;
    }

    return (
        /^plpro:\/\/movie\/[0-9]+$/i
            .test(String(url)) ||

        /^plpro:\/\/tv\/[0-9]+$/i
            .test(String(url))
    );
};


// ============================================================
// MOVIE DETAILS
// ============================================================

function PP_movieDetails(
    tmdbId,
    url
) {

    var d =
        CAT_tmdb(
            "/movie/" +
            encodeURIComponent(
                tmdbId
            )
        );

    if (!d) {
        return null;
    }

    var title =
        CAT_getTitle(d);

    var year =
        CAT_getYear(d);

    var image =
        CAT_getImage(d);

    log(
        "MXL/TMDB -> " +
        title +
        " (" +
        year +
        ")"
    );

    // ----------------------------------------
    // BUSCAR EN PLPRO
    // ----------------------------------------

    var found =
        PP_findMovie(
            title,
            year
        );

    if (!found) {

        log(
            "PLPRO -> película no encontrada"
        );

        return new PlatformVideoDetails({

            id:
                new PlatformID(
                    PLPRO_NAME,
                    "movie:" + tmdbId,
                    PID
                ),

            name:
                title,

            thumbnails:
                new Thumbnails([
                    new Thumbnail(
                        image,
                        500
                    )
                ]),

            author:
                CAT_author(),

            uploadDate:
                0,

            url:
                url,

            duration:
                -1,

            viewCount:
                -1,

            isLive:
                false,

            description:
                d.overview ||
                "",

            video:
                new UnMuxVideoSourceDescriptor(
                    []
                ),

            hls:
                null,

            dash:
                null,

            live:
                []
        });
    }

    var ppId =
        found.id ||
        found.movie_id ||
        found.movieId;

    log(
        "PLPRO ID -> " +
        ppId
    );

    var links =
        PP_getMovieLinks(
            ppId
        );

    var hls = null;

    for (
        var i = 0;
        i < links.length;
        i++
    ) {

        if (
            links[i].type ==
            "hls"
        ) {

            hls =
                PP_makeSource(
                    links[i]
                );

            if (hls) {
                break;
            }
        }
    }

    return new PlatformVideoDetails({

        id:
            new PlatformID(
                PLPRO_NAME,
                "movie:" + tmdbId,
                PID
            ),

        name:
            title,

        thumbnails:
            new Thumbnails([
                new Thumbnail(
                    image,
                    500
                )
            ]),

        author:
            CAT_author(),

        uploadDate:
            0,

        url:
            url,

        duration:
            -1,

        viewCount:
            -1,

        isLive:
            false,

        description:
            d.overview ||
            "",

        video:
            new UnMuxVideoSourceDescriptor(
                []
            ),

        hls:
            hls,

        dash:
            null,

        live:
            []
    });
}


// ============================================================
// TV DETAILS
// ============================================================

function PP_tvDetails(
    tmdbId,
    url
) {

    var d =
        CAT_tmdb(
            "/tv/" +
            encodeURIComponent(
                tmdbId
            )
        );

    if (!d) {
        return null;
    }

    var title =
        CAT_getTitle(d);

    var image =
        CAT_getImage(d);

    return new PlatformVideoDetails({

        id:
            new PlatformID(
                PLPRO_NAME,
                "tv:" + tmdbId,
                PID
            ),

        name:
            title,

        thumbnails:
            new Thumbnails([
                new Thumbnail(
                    image,
                    500
                )
            ]),

        author:
            CAT_author(),

        uploadDate:
            0,

        url:
            url,

        duration:
            -1,

        viewCount:
            -1,

        isLive:
            false,

        description:
            d.overview ||
            "",

        video:
            new UnMuxVideoSourceDescriptor(
                []
            ),

        hls:
            null,

        dash:
            null,

        live:
            []
    });
}


// ============================================================
// GET VIDEO DETAILS
// ============================================================

source.getVideoDetails =
function (url) {

    clearLog();

    if (!url) {
        return null;
    }

    var s =
        String(url);

    var movie =
        s.match(
            /^plpro:\/\/movie\/([0-9]+)$/i
        );

    if (movie) {

        return PP_movieDetails(
            movie[1],
            s
        );
    }

    var tv =
        s.match(
            /^plpro:\/\/tv\/([0-9]+)$/i
        );

    if (tv) {

        return PP_tvDetails(
            tv[1],
            s
        );
    }

    return null;
};


// ============================================================
// SEARCH CAPABILITIES
// ============================================================

source.getSearchCapabilities =
function () {

    return {
        types: [
            "Mixed"
        ],

        sorts: [],

        filters: []
    };
};


// ============================================================
// SETTINGS
// ============================================================

source.enable =
function (config) {

    _settings =
        config || {};
};


source.disable =
function () {};


// ============================================================
// DEBUG
// ============================================================

source.getDebug =
function () {

    return _debugLog;
};


// ============================================================
// CHANNEL
// ============================================================

source.isChannelUrl =
function (url) {

    return false;
};


// ============================================================
// END
// ============================================================
