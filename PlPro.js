// ============================================================
// PlPro GrayJay Source v44
// ============================================================
// CATÁLOGO:
//   MXL TV / TMDB
//   - Portadas
//   - Títulos
//   - Año
//   - Búsqueda
//   - Películas
//   - Series
//
// REPRODUCCIÓN:
//   PlPro.org
//   - Búsqueda película
//   - Búsqueda serie
//   - Links de película
//   - Links de episodios
//   - HLS / MP4
//
// IMPORTANTE:
//   MXL NO participa en la reproducción.
//   PlPro.org NO participa en las portadas.
//
// ============================================================


// ============================================================
// CONFIGURACIÓN
// ============================================================

var PID = "b7ff0ea6-ff3d-46b5-bec4-bff3c197b5eb";

var UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/125.0.0.0 Safari/537.36";

var PPID = new PlatformID("PlPro", "PlPro", PID);


// ============================================================
// MXL / TMDB - SOLO CATÁLOGO
// ============================================================

var CAT_TMDB_API = "https://api.themoviedb.org/3";

var CAT_TMDB_KEY =
    "18d85af64ccb07f720d758e05bbec3ad";

var CAT_TMDB_IMG =
    "https://image.tmdb.org/t/p/w500";

var CAT_TMDB_BACKDROP =
    "https://image.tmdb.org/t/p/w1280";


// ============================================================
// PLPRO.ORG - SOLO REPRODUCCIÓN
// ============================================================

var PP_URL = "https://plpro.org";

var PP_USER = "p";
var PP_PASS = "p";


// ============================================================
// JKANIME
// ============================================================

var JK_URL = "https://jkanime.net";


// ============================================================
// CACHE
// ============================================================

var CAT_CACHE = {};
var PP_CACHE = {};

var CACHE_TTL = 1800000;

var MAX_TRY = 10;
var MAX_EPISODES = 100;


// ============================================================
// DEBUG
// ============================================================

var _settings = {};
var _debugLog = "";

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
        log("HTTP ERROR: " + url + " :: " + e);
        return null;
    }
}


function safeJson(text) {
    try {
        if (!text) return null;

        if (typeof text == "object") {
            return text;
        }

        return JSON.parse(String(text));
    } catch (e) {
        return null;
    }
}


// ============================================================
// CACHE
// ============================================================

function cacheGet(store, key) {
    try {
        var x = store[key];

        if (!x) return null;

        if (Date.now() - x.time > CACHE_TTL) {
            delete store[key];
            return null;
        }

        return x.value;
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
// URL
// ============================================================

function cleanUrl(url) {
    if (!url) return "";

    url = String(url).trim();

    url = url.replace(/\\u0026/g, "&");
    url = url.replace(/&amp;/g, "&");

    return url;
}


function absoluteUrl(base, url) {
    if (!url) return "";

    url = cleanUrl(url);

    if (/^https?:\/\//i.test(url)) {
        return url;
    }

    if (url.indexOf("//") == 0) {
        return "https:" + url;
    }

    if (url.charAt(0) == "/") {
        return base.replace(/\/+$/, "") + url;
    }

    return base.replace(/\/+$/, "") + "/" + url;
}


// ============================================================
// HTML
// ============================================================

function htmlDecode(s) {
    if (!s) return "";

    return String(s)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/");
}


function stripTags(s) {
    if (!s) return "";

    return String(s)
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


// ============================================================
// SLUGIFY
// Compatible con QuickJS / GrayJay
// ============================================================

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
        if (aw[i].length < 3) continue;

        for (j = 0; j < bw.length; j++) {
            if (aw[i] == bw[j]) {
                hits++;
                break;
            }
        }
    }

    if (aw.length == 0) return 0;

    return Math.floor((hits / aw.length) * 70);
}


// ============================================================
// IMÁGENES MXL / TMDB
// ============================================================

function CAT_fixImg(u) {
    if (!u) return "";

    u = String(u).trim();

    if (u.indexOf("ttps://") == 0) {
        u = "h" + u;
    }

    if (/^https?:\/\//i.test(u)) {
        return u;
    }

    if (u.indexOf("//") == 0) {
        return "https:" + u;
    }

    if (u.charAt(0) == "/") {
        return CAT_TMDB_IMG + u;
    }

    return u;
}


function CAT_fixBackdrop(u) {
    if (!u) return "";

    u = String(u).trim();

    if (u.indexOf("ttps://") == 0) {
        u = "h" + u;
    }

    if (/^https?:\/\//i.test(u)) {
        return u;
    }

    if (u.charAt(0) == "/") {
        return CAT_TMDB_BACKDROP + u;
    }

    return u;
}


// ============================================================
// TMDB
// ============================================================

function CAT_tmdb(path) {
    var key = CAT_TMDB_API + path;

    var cached = cacheGet(CAT_CACHE, key);

    if (cached) {
        return cached;
    }

    var sep = path.indexOf("?") >= 0 ? "&" : "?";

    var url =
        CAT_TMDB_API +
        path +
        sep +
        "api_key=" +
        encodeURIComponent(CAT_TMDB_KEY) +
        "&language=es-ES";

    var r = httpGet(url);

    if (!r) {
        return null;
    }

    var j = safeJson(r);

    if (j) {
        cachePut(CAT_CACHE, key, j);
    }

    return j;
}


// ============================================================
// CONSTRUCCIÓN DE ITEMS DEL CATÁLOGO
// ============================================================

function CAT_getTitle(item) {
    if (!item) return "";

    if (item.title) return item.title;

    if (item.name) return item.name;

    if (item.original_title) return item.original_title;

    if (item.original_name) return item.original_name;

    return "";
}


function CAT_getYear(item) {
    if (!item) return "";

    var d =
        item.release_date ||
        item.first_air_date ||
        "";

    if (!d) return "";

    return String(d).substring(0, 4);
}


function CAT_getImage(item) {
    if (!item) return "";

    return CAT_fixImg(
        item.poster_path ||
        item.backdrop_path ||
        item.poster ||
        item.image ||
        ""
    );
}


function CAT_getBackdrop(item) {
    if (!item) return "";

    return CAT_fixBackdrop(
        item.backdrop_path ||
        item.poster_path ||
        ""
    );
}


function CAT_makeUrl(item) {
    var id = item.id;

    if (!id) return "";

    var mediaType = item.media_type;

    if (!mediaType) {
        mediaType =
            item.first_air_date ||
            item.name ?
            "tv" :
            "movie";
    }

    if (mediaType == "tv") {
        return "plpro://tv/" + id;
    }

    return "plpro://movie/" + id;
}


function CAT_makeItem(item) {
    if (!item) return null;

    var title = CAT_getTitle(item);

    if (!title) return null;

    var year = CAT_getYear(item);

    var image = CAT_getImage(item);

    var url = CAT_makeUrl(item);

    return {
        url: url,
        title: title,
        image: image,
        year: year,
        tmdbId: item.id,
        mediaType: item.media_type ||
            (item.first_air_date ? "tv" : "movie")
    };
}


// ============================================================
// TMDB HOME
// ============================================================

function CAT_home() {
    var result = [];

    var trending =
        CAT_tmdb("/trending/all/week");

    if (trending && trending.results) {
        for (var i = 0;
             i < trending.results.length && result.length < 30;
             i++) {

            var x = trending.results[i];

            if (x.media_type != "movie" &&
                x.media_type != "tv") {
                continue;
            }

            var item = CAT_makeItem(x);

            if (item) {
                result.push(item);
            }
        }
    }

    if (result.length < 10) {
        var movies =
            CAT_tmdb("/movie/popular");

        if (movies && movies.results) {
            for (var m = 0;
                 m < movies.results.length && result.length < 40;
                 m++) {

                var mi = movies.results[m];

                mi.media_type = "movie";

                var mov = CAT_makeItem(mi);

                if (mov) result.push(mov);
            }
        }
    }

    if (result.length < 10) {
        var tv =
            CAT_tmdb("/tv/popular");

        if (tv && tv.results) {
            for (var t = 0;
                 t < tv.results.length && result.length < 40;
                 t++) {

                var ti = tv.results[t];

                ti.media_type = "tv";

                var show = CAT_makeItem(ti);

                if (show) result.push(show);
            }
        }
    }

    return result;
}


// ============================================================
// TMDB SEARCH
// ============================================================

function CAT_search(query) {
    if (!query) return [];

    var result = [];

    var q =
        CAT_tmdb(
            "/search/multi?query=" +
            encodeURIComponent(query)
        );

    if (!q || !q.results) {
        return result;
    }

    for (var i = 0;
         i < q.results.length && result.length < 50;
         i++) {

        var x = q.results[i];

        if (x.media_type != "movie" &&
            x.media_type != "tv") {
            continue;
        }

        var item = CAT_makeItem(x);

        if (item) {
            result.push(item);
        }
    }

    return result;
}


// ============================================================
// TMDB DETAILS
// ============================================================

function CAT_movieDetails(id) {
    return CAT_tmdb(
        "/movie/" +
        encodeURIComponent(id)
    );
}


function CAT_tvDetails(id) {
    return CAT_tmdb(
        "/tv/" +
        encodeURIComponent(id)
    );
}


// ============================================================
// TMDB EPISODES
// ============================================================

function CAT_getEpisodes(tvId, season) {
    var j =
        CAT_tmdb(
            "/tv/" +
            encodeURIComponent(tvId) +
            "/season/" +
            encodeURIComponent(season)
        );

    if (!j || !j.episodes) {
        return [];
    }

    return j.episodes;
}


// ============================================================
// PLPRO - HTTP
// ============================================================

function PP_get(path) {
    var key = PP_URL + path;

    var cached = cacheGet(PP_CACHE, key);

    if (cached) {
        return cached;
    }

    var url =
        PP_URL +
        "/" +
        String(path).replace(/^\/+/, "");

    var headers = {
        "User-Agent": UA,
        "Accept": "*/*"
    };

    var r = httpGet(url, headers);

    if (!r) return null;

    cachePut(PP_CACHE, key, r);

    return r;
}


// ============================================================
// PLPRO - BUSCAR PELÍCULA
// ============================================================

function PP_findMovie(title, year) {
    if (!title) return null;

    var slug = slugify(title);

    var candidates = [];

    candidates.push(
        "/search/" +
        encodeURIComponent(title)
    );

    if (slug && slug != title) {
        candidates.push(
            "/search/" +
            encodeURIComponent(slug)
        );
    }

    var best = null;
    var bestScore = 0;

    for (var i = 0;
         i < candidates.length;
         i++) {

        var r = PP_get(candidates[i]);

        if (!r) continue;

        var j = safeJson(r);

        if (j) {
            var arr = [];

            if (j.results) arr = j.results;
            else if (j.data) arr = j.data;
            else if (j.movies) arr = j.movies;

            for (var k = 0; k < arr.length; k++) {
                var x = arr[k];

                var xt =
                    x.title ||
                    x.name ||
                    x.movie_title ||
                    "";

                var score =
                    titleScore(title, xt);

                if (year) {
                    var xy =
                        x.year ||
                        x.release_year ||
                        x.release_date ||
                        "";

                    if (String(xy).indexOf(String(year)) >= 0) {
                        score += 20;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    best = x;
                }
            }

            if (best) {
                return best;
            }
        }

        var html = String(r);

        var ids =
            html.match(
                /(?:movie|pelicula)[^0-9]{0,30}([0-9]+)/ig
            );

        if (ids && ids.length) {
            return {
                id: ids[0].replace(/[^0-9]/g, ""),
                title: title
            };
        }
    }

    return best;
}


// ============================================================
// PLPRO - BUSCAR SERIE
// ============================================================

function PP_findSeries(title, year) {
    if (!title) return null;

    var slug = slugify(title);

    var candidates = [];

    candidates.push(
        "/search/" +
        encodeURIComponent(title)
    );

    if (slug) {
        candidates.push(
            "/search/" +
            encodeURIComponent(slug)
        );
    }

    var best = null;
    var bestScore = 0;

    for (var i = 0;
         i < candidates.length;
         i++) {

        var r = PP_get(candidates[i]);

        if (!r) continue;

        var j = safeJson(r);

        if (j) {
            var arr = [];

            if (j.results) arr = j.results;
            else if (j.data) arr = j.data;
            else if (j.series) arr = j.series;

            for (var k = 0; k < arr.length; k++) {
                var x = arr[k];

                var xt =
                    x.title ||
                    x.name ||
                    x.series_title ||
                    "";

                var score =
                    titleScore(title, xt);

                if (year) {
                    var xy =
                        x.year ||
                        x.release_year ||
                        x.first_air_date ||
                        "";

                    if (String(xy).indexOf(String(year)) >= 0) {
                        score += 20;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    best = x;
                }
            }

            if (best) {
                return best;
            }
        }
    }

    return best;
}


// ============================================================
// PLPRO - LINKS
// ============================================================

function PP_extractLinks(data) {
    var links = [];

    if (!data) return links;

    if (typeof data == "object") {
        var text = JSON.stringify(data);

        var a =
            text.match(
                /https?:[^"'\s\\]+/ig
            );

        if (a) {
            for (var i = 0; i < a.length; i++) {
                links.push(
                    cleanUrl(
                        a[i]
                            .replace(/\\u0026/g, "&")
                            .replace(/\\\//g, "/")
                    )
                );
            }
        }
    } else {
        var s = String(data);

        var b =
            s.match(
                /https?:[^"' <>\r\n]+/ig
            );

        if (b) {
            for (var j = 0; j < b.length; j++) {
                links.push(cleanUrl(b[j]));
            }
        }
    }

    return dedup(links);
}


// ============================================================
// VIDEO DETECTION
// ============================================================

function isM3u8(url) {
    if (!url) return false;

    return /\.m3u8(?:$|[?#])/i.test(
        String(url)
    );
}


function isMp4(url) {
    if (!url) return false;

    return /\.mp4(?:$|[?#])/i.test(
        String(url)
    );
}


function dedup(arr) {
    var out = [];
    var seen = {};

    if (!arr) return out;

    for (var i = 0; i < arr.length; i++) {
        var x = arr[i];

        if (!x) continue;

        x = String(x);

        if (seen[x]) continue;

        seen[x] = true;

        out.push(x);
    }

    return out;
}


// ============================================================
// PLPRO - EXTRAER M3U8
// ============================================================

function findM3u8(text) {
    if (!text) return [];

    var a =
        String(text).match(
            /https?:\/\/[^"' <>\r\n\\]+\.m3u8[^"' <>\r\n\\]*/ig
        );

    return dedup(a || []);
}


// ============================================================
// PLPRO - EXTRAER MP4
// ============================================================

function findMp4(text) {
    if (!text) return [];

    var a =
        String(text).match(
            /https?:\/\/[^"' <>\r\n\\]+\.mp4[^"' <>\r\n\\]*/ig
        );

    return dedup(a || []);
}


// ============================================================
// PLPRO - EXTRACTOR PRINCIPAL
// ============================================================

function PP_extractVideo(data) {
    var links = [];

    if (!data) return links;

    var text =
        typeof data == "string" ?
        data :
        JSON.stringify(data);

    var hls =
        findM3u8(text);

    var mp4 =
        findMp4(text);

    for (var i = 0; i < hls.length; i++) {
        links.push({
            url: hls[i],
            type: "hls"
        });
    }

    for (var j = 0; j < mp4.length; j++) {
        links.push({
            url: mp4[j],
            type: "mp4"
        });
    }

    return links;
}


// ============================================================
// PLPRO - PELÍCULA
// ============================================================

function PP_getMovieLinks(id) {
    if (!id) return [];

    var r =
        PP_get(
            "/movies/" +
            encodeURIComponent(id) +
            "/links"
        );

    if (!r) return [];

    return PP_extractVideo(r);
}


// ============================================================
// PLPRO - EPISODIO
// ============================================================

function PP_getEpisodeLinks(
    id,
    season,
    episode
) {
    if (!id) return [];

    var r =
        PP_get(
            "/series/" +
            encodeURIComponent(id) +
            "/links/" +
            encodeURIComponent(season) +
            "/" +
            encodeURIComponent(episode)
        );

    if (!r) return [];

    return PP_extractVideo(r);
}


// ============================================================
// JKANIME
// ============================================================

function JK_search(query) {
    if (!query) return [];

    var url =
        JK_URL +
        "/buscar/" +
        encodeURIComponent(
            slugify(query)
        );

    var r = httpGet(url);

    if (!r) return [];

    var out = [];

    var re =
        /href=["']([^"']+)["'][^>]*>([^<]+)/ig;

    var m;

    while ((m = re.exec(String(r))) != null) {
        var href = m[1];
        var title = stripTags(m[2]);

        if (!href || !title) continue;

        if (href.indexOf("http") != 0) {
            href = absoluteUrl(
                JK_URL,
                href
            );
        }

        out.push({
            url: href,
            title: title,
            image: ""
        });

        if (out.length >= 20) break;
    }

    return out;
}


// ============================================================
// GRAYJAY - HOME
// ============================================================

source.getHome = function () {
    clearLog();

    var items = CAT_home();

    return items;
};


// ============================================================
// GRAYJAY - SEARCH
// ============================================================

source.search = function (query) {
    clearLog();

    var items = CAT_search(query);

    if (items.length == 0) {
        return JK_search(query);
    }

    return items;
};


// ============================================================
// GRAYJAY - MOVIE DETAILS
// ============================================================

function makeMovieDetail(item) {
    var id = item.tmdbId;

    var d =
        CAT_movieDetails(id);

    var title =
        CAT_getTitle(d) ||
        item.title;

    var year =
        CAT_getYear(d) ||
        item.year;

    var image =
        CAT_getImage(d) ||
        item.image;

    return {
        title: title,
        image: image,
        year: year,
        description:
            d && d.overview ?
            d.overview :
            "",
        url:
            "plpro://movie/" +
            id,
        tmdbId: id
    };
}


// ============================================================
// GRAYJAY - TV DETAILS
// ============================================================

function makeTvDetail(item) {
    var id = item.tmdbId;

    var d =
        CAT_tvDetails(id);

    var title =
        CAT_getTitle(d) ||
        item.title;

    var image =
        CAT_getImage(d) ||
        item.image;

    var seasons = [];

    if (d && d.seasons) {
        for (var i = 0;
             i < d.seasons.length;
             i++) {

            var s = d.seasons[i];

            if (!s) continue;

            if (s.season_number === undefined) {
                continue;
            }

            if (s.season_number == 0) {
                continue;
            }

            seasons.push({
                season: s.season_number,
                name:
                    s.name ||
                    ("Temporada " +
                     s.season_number),
                image:
                    CAT_fixImg(
                        s.poster_path
                    )
            });
        }
    }

    return {
        title: title,
        image: image,
        description:
            d && d.overview ?
            d.overview :
            "",
        url:
            "plpro://tv/" +
            id,
        tmdbId: id,
        seasons: seasons
    };
}


// ============================================================
// GRAYJAY - DETAILS
// ============================================================

source.getDetails = function (url) {
    clearLog();

    if (!url) return null;

    var s = String(url);

    var mMovie =
        s.match(
            /^plpro:\/\/movie\/([0-9]+)$/i
        );

    if (mMovie) {
        return makeMovieDetail({
            tmdbId: mMovie[1],
            title: ""
        });
    }

    var mTv =
        s.match(
            /^plpro:\/\/tv\/([0-9]+)$/i
        );

    if (mTv) {
        return makeTvDetail({
            tmdbId: mTv[1],
            title: ""
        });
    }

    return null;
};


// ============================================================
// GRAYJAY - MOVIE VIDEO
// ============================================================

source.getVideo = function (url) {
    clearLog();

    var s = String(url);

    var m =
        s.match(
            /^plpro:\/\/movie\/([0-9]+)$/i
        );

    if (!m) return [];

    var tmdbId = m[1];

    var d =
        CAT_movieDetails(tmdbId);

    if (!d) return [];

    var title =
        CAT_getTitle(d);

    var year =
        CAT_getYear(d);

    log(
        "MXL/TMDB: " +
        title +
        " (" +
        year +
        ")"
    );

    // --------------------------------------------------------
    // AQUÍ MXL/TMDB TERMINA.
    // A PARTIR DE AQUÍ TODO ES PLPRO.ORG.
    // --------------------------------------------------------

    var found =
        PP_findMovie(
            title,
            year
        );

    if (!found) {
        log(
            "PlPro: película no encontrada"
        );

        return [];
    }

    var ppId =
        found.id ||
        found.movie_id ||
        found.movieId;

    if (!ppId) {
        log(
            "PlPro: ID no encontrado"
        );

        return [];
    }

    log(
        "PlPro ID: " +
        ppId
    );

    return PP_getMovieLinks(
        ppId
    );
};


// ============================================================
// GRAYJAY - EPISODE VIDEO
// ============================================================

source.getEpisodeVideo =
function (
    url,
    season,
    episode
) {
    clearLog();

    var s = String(url);

    var m =
        s.match(
            /^plpro:\/\/tv\/([0-9]+)$/i
        );

    if (!m) return [];

    var tmdbId = m[1];

    var d =
        CAT_tvDetails(
            tmdbId
        );

    if (!d) return [];

    var title =
        CAT_getTitle(d);

    var year =
        CAT_getYear(d);

    log(
        "MXL/TMDB: " +
        title +
        " S" +
        season +
        "E" +
        episode
    );

    // --------------------------------------------------------
    // BUSCAR LA SERIE EN PLPRO.ORG
    // --------------------------------------------------------

    var found =
        PP_findSeries(
            title,
            year
        );

    if (!found) {
        log(
            "PlPro: serie no encontrada"
        );

        return [];
    }

    var ppId =
        found.id ||
        found.series_id ||
        found.seriesId;

    if (!ppId) {
        log(
            "PlPro: ID de serie no encontrado"
        );

        return [];
    }

    log(
        "PlPro Series ID: " +
        ppId
    );

    return PP_getEpisodeLinks(
        ppId,
        season,
        episode
    );
};


// ============================================================
// RECOMMENDATIONS
// ============================================================

source.getRecommendations =
function () {
    var r =
        CAT_tmdb(
            "/movie/popular"
        );

    var out = [];

    if (!r || !r.results) {
        return out;
    }

    for (var i = 0;
         i < r.results.length && i < 30;
         i++) {

        var x = r.results[i];

        x.media_type = "movie";

        var item =
            CAT_makeItem(x);

        if (item) {
            out.push(item);
        }
    }

    return out;
};


// ============================================================
// CHANNEL
// ============================================================

source.getChannel =
function () {
    return {
        id: PID,
        name: "PlPro",
        url: PP_URL
    };
};


// ============================================================
// SETTINGS
// ============================================================

source.getSettings =
function () {
    return _settings;
};


// ============================================================
// DEBUG
// ============================================================

source.getDebug =
function () {
    return _debugLog;
};


// ============================================================
// CAPABILITIES
// ============================================================

source.getSearchCapabilities =
function () {
    return {
        types: [1, 2],
        allowMovies: true,
        allowSeries: true
    };
};


// ============================================================
// FIN
// ============================================================
