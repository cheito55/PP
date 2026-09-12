// Magma GrayJay Source v48
// Multi-servidor + HLS + diagnóstico
// Cambios v45:
//  - FIX: IPTV_URL apuntaba a "https://tv.m3uts.xyz". Una captura de red de la
//    app original (com.magmaplayer) muestra que esta SIEMPRE habla con
//    tv.m3uts.xyz por HTTP plano en el puerto 80 (nunca HTTPS/TLS). Con https://
//    el pedido probablemente fallaba (o el servidor respondía distinto/vacío),
//    haciendo que mgGet() devolviera null -> mgHome()/mgSearch() vacíos (por
//    eso solo se veía anime de JkAnime) y sin fuentes en películas/series
//    ("video no disponible"). Corregido a "http://tv.m3uts.xyz".
// Cambios v43:
//  - FIX CRÍTICO: doDetails() usaba las regex /pp:\/\/movie\/(\d+)/, /pp:\/\/serie\/.../
//    para parsear las URLs internas "magma://movie/123" y "magma://serie/123/1/1".
//    La subcadena "pp://" NUNCA aparece dentro de "magma://" (no hay doble "p"),
//    así que esas regex siempre devolvían null y doDetails caía al detalle vacío
//    sin fuentes -> nada se reproducía nunca para películas ni series.
//    Corregido a /magma:\/\/movie\/(\d+)/ y /magma:\/\/serie\/.../ respectivamente.
// Cambios v42:
//  - fixImg: soporta paths tipo TMDB con barra inicial ("/xxx.jpg") que antes devolvían "" (portadas rotas)
//  - Nuevo source.getContentRecommendations: expone cada episodio como PlatformVideo navegable
//  - mgSerieDetails: ahora resuelve y precarga las fuentes del Episodio 1 (S1E1) para que la serie
//    arranque reproduciendo directamente al tocarla, en vez de quedar sin video
var PID = "8a2f4b7e-3c1d-4f6a-9b8e-5d2c1a9f6e40";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
var DALVIK_UA = "Dalvik/2.1.0 (Linux; U; Android 16; T522E Build/BP2A.250605.031.A3)";

var MGID = new PlatformID("Magma", "Magma", PID);
var _settings = {};
var _debugLog = "";

var IPTV_URL = "http://tv.m3uts.xyz";
var IPTV_USER = "m";
var IPTV_PASS = "m";
var JK = "https://jkanime.net";
var TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// =========================================================
// CONFIGURACIÓN
// =========================================================

// Ahora prueba hasta 10 servidores.
// Si hay menos, prueba los que existan.
var MAX_TRY = 10;

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
        addDebug("HTTP Exception en " + url + ": " + String(e));
        return "";
    }
}

// =========================================================
// UTILIDADES
// =========================================================

function getHost(url) {
    try {
        var m = String(url).match(/^https?:\/\/([^\/?#]+)/i);
        return m ? m[1].toLowerCase() : "";
    } catch (e) {
        return "";
    }
}

function slugify(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function slugToTitle(s) {
    return String(s || "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, function(c) {
            return c.toUpperCase();
        });
}

function b64decode(s) {
    try {
        return decodeURIComponent(
            atob(s).split("").map(function(c) {
                return "%" +
                    ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            }).join("")
        );
    } catch (e) {
        try {
            return atob(s);
        } catch (e2) {
            return "";
        }
    }
}

function htmlDecode(s) {
    if (!s) return "";

    return String(s)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, function(m, d) {
            return String.fromCharCode(parseInt(d, 10));
        })
        .replace(/&#x([0-9a-fA-F]+);/g, function(m, x) {
            return String.fromCharCode(parseInt(x, 16));
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

// FIX v42: antes, cualquier path que contuviera una "/" (por ejemplo
// "/9BBTtGToQIz3lyIt.jpg", el formato típico que devuelve TMDB) fallaba
// la condición y la función devolvía "" -> portada rota. Ahora se
// interpreta como path relativo estilo TMDB independientemente de si
// trae o no la barra inicial.
function fixImg(u) {
    if (!u) return "";

    var s = String(u).trim();

    if (s.indexOf("ttps://") === 0) {
        s = "https" + s.substring(4);
    }

    if (/^https?:\/\//i.test(s)) {
        return s;
    }

    s = s.replace(/^\/+/, "");

    if (!s) return "";

    if (
        s.indexOf(".jpg") === -1 &&
        s.indexOf(".png") === -1 &&
        s.indexOf(".webp") === -1
    ) {
        s += ".jpg";
    }

    return TMDB_IMG + "/" + s;
}

// =========================================================
// VIDEO OBJECTS
// =========================================================

function mkThumb(url) {
    if (!url) {
        return new Thumbnails([]);
    }

    return new Thumbnails([
        new Thumbnail(url, 100)
    ]);
}

function mkVideo(id, title, thumb, url, authorName) {
    return new PlatformVideo({
        id: new PlatformID(
            "Magma",
            String(id),
            PID
        ),

        name: title || "Sin titulo",

        thumbnails: mkThumb(thumb),

        author: new PlatformAuthorLink(
            MGID,
            authorName || "Magma",
            "https://magma.app",
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

function mkHls(url, name, duration) {
    if (!url) return null;

    return new HLSSource({
        name: name || "HLS",
        url: url,
        duration: duration || 0
    });
}

// =========================================================
// URL / HLS
// =========================================================

function isM3u8Url(url) {
    try {
        if (!url) return false;

        return /\.m3u8(?:[?#]|$)/i.test(
            String(url)
        );
    } catch (e) {
        return false;
    }
}

function cleanUrl(url) {
    if (!url) return "";

    var s = String(url).trim();

    s = htmlDecode(s);

    s = s.replace(/\\u0026/g, "&");
    s = s.replace(/\\\//g, "/");

    return s;
}

function directHls(url) {
    try {
        url = cleanUrl(url);

        if (!isM3u8Url(url)) {
            return null;
        }

        addDebug("[hls] m3u8 directa detectada");

        return url;
    } catch (e) {
        addDebug("[hls] EXCEPTION: " + String(e));
        return null;
    }
}

// =========================================================
// Vidhide
// =========================================================

function vidhideExtract(pageUrl) {
    try {
        var fetchUrl = pageUrl;

        if (
            fetchUrl.indexOf("vidhidefast.com") !== -1
        ) {
            fetchUrl = fetchUrl.replace(
                "vidhidefast.com",
                "callistanise.com"
            );
        }

        if (
            fetchUrl.indexOf("vidhide.com") !== -1 &&
            fetchUrl.indexOf("callistanise") === -1
        ) {
            fetchUrl = fetchUrl.replace(
                "vidhide.com",
                "callistanise.com"
            );
        }

        var embedHost = getHost(fetchUrl);

        var refererBase =
            "https://" + embedHost + "/";

        addDebug(
            "[vidhide] fetch=" + fetchUrl
        );

        var html = httpGet(
            fetchUrl,
            {
                "User-Agent": UA,
                "Referer": refererBase
            }
        );

        addDebug(
            "[vidhide] htmlLen=" +
            (html ? html.length : 0)
        );

        if (
            !html ||
            html.length < 500
        ) {
            addDebug(
                "[vidhide] HTML insuficiente"
            );

            return null;
        }

        var splitIdx =
            html.lastIndexOf(".split('|')");

        addDebug(
            "[vidhide] splitIdx=" +
            splitIdx
        );

        if (splitIdx === -1) {
            addDebug(
                "[vidhide] No se encontró .split('|')"
            );

            return null;
        }

        var keyEnd =
            html.lastIndexOf(
                "'",
                splitIdx
            );

        var keyStart =
            html.lastIndexOf(
                "'",
                keyEnd - 1
            ) + 1;

        var key =
            html.substring(
                keyStart,
                keyEnd
            );

        var keyArr =
            key.split("|");

        addDebug(
            "[vidhide] keyArrLen=" +
            keyArr.length
        );

        if (keyArr.length < 50) {
            addDebug(
                "[vidhide] Array demasiado corto"
            );

            return null;
        }

        function decode(str) {
            return str.replace(
                /[a-z0-9]+/g,
                function(token) {
                    var val =
                        parseInt(token, 36);

                    if (
                        !isNaN(val) &&
                        val > 0 &&
                        val < keyArr.length &&
                        keyArr[val] &&
                        keyArr[val].length > 1
                    ) {
                        return keyArr[val];
                    }

                    return token;
                }
            );
        }

        var urls =
            html.match(
                /["'][a-z0-9]+:\/\/[^"']+["']/gi
            ) || [];

        addDebug(
            "[vidhide] candidateUrls=" +
            urls.length
        );

        var best = null;

        for (
            var i = 0;
            i < urls.length;
            i++
        ) {
            var raw =
                urls[i].substring(
                    1,
                    urls[i].length - 1
                );

            var dec =
                cleanUrl(
                    decode(raw)
                );

            if (
                dec.indexOf("master.") !== -1 &&
                dec.indexOf(".m3u8") !== -1
            ) {
                best = dec;
                break;
            }

            if (
                !best &&
                dec.indexOf("master.") !== -1 &&
                dec.indexOf(".txt") !== -1
            ) {
                best = dec;
            }
        }

        addDebug(
            "[vidhide] best=" +
            (best || "none")
        );

        if (!best) {
            return null;
        }

        // Si ya es M3U8, devolver directamente.
        if (isM3u8Url(best)) {
            return best;
        }

        // Algunos servidores entregan master.txt.
        if (/\.txt(?:[?#]|$)/i.test(best)) {
            addDebug(
                "[vidhide] master.txt detectado"
            );

            var txt = httpGet(
                best,
                {
                    "User-Agent": UA,
                    "Referer": refererBase
                }
            );

            addDebug(
                "[vidhide] txtLen=" +
                (txt ? txt.length : 0)
            );

            if (txt) {
                var m3u =
                    txt.match(
                        /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i
                    );

                if (m3u && m3u[0]) {
                    var finalUrl =
                        cleanUrl(m3u[0]);

                    addDebug(
                        "[vidhide] m3u8 encontrada dentro de master.txt"
                    );

                    return finalUrl;
                }
            }
        }

        addDebug(
            "[vidhide] No se pudo convertir la fuente"
        );

        return null;

    } catch (e) {
        addDebug(
            "[vidhide] EXCEPTION: " +
            String(e)
        );

        return null;
    }
}

// =========================================================
// VOE
// =========================================================

function voeExtract(pageUrl) {
    try {
        addDebug(
            "[voe] fetch=" + pageUrl
        );

        var html = httpGet(
            pageUrl,
            {
                "User-Agent": UA,
                "Referer": pageUrl
            }
        );

        addDebug(
            "[voe] htmlLen=" +
            (html ? html.length : 0)
        );

        if (!html) {
            return null;
        }

        var m =
            html.match(
                /hls\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
            );

        if (m && m[1]) {
            addDebug(
                "[voe] match directo hls"
            );

            return cleanUrl(m[1]);
        }

        var am =
            html.match(
                /atob\(['"]([^'"]+)['"]\)/
            );

        addDebug(
            "[voe] atobMatch=" +
            (am ? "si" : "no")
        );

        if (am) {
            try {
                var d =
                    b64decode(am[1]);

                var u =
                    d.match(
                        /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i
                    );

                addDebug(
                    "[voe] atob m3u8=" +
                    (u ? "si" : "no")
                );

                if (u) {
                    return cleanUrl(u[0]);
                }
            } catch (e) {
                addDebug(
                    "[voe] atob exception=" +
                    String(e)
                );
            }
        }

        var fm =
            html.match(
                /file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
            );

        if (fm && fm[1]) {
            addDebug(
                "[voe] match file"
            );

            return cleanUrl(fm[1]);
        }

        addDebug(
            "[voe] ningun patron encontro nada"
        );

        return null;

    } catch (e) {
        addDebug(
            "[voe] EXCEPTION: " +
            String(e)
        );

        return null;
    }
}

// =========================================================
// DOOD / DO7GO
// =========================================================

function doodExtract(pageUrl) {
    try {
        addDebug(
            "[dood] fetch=" + pageUrl
        );

        var html = httpGet(
            pageUrl,
            {
                "User-Agent": UA,
                "Referer": pageUrl
            }
        );

        addDebug(
            "[dood] htmlLen=" +
            (html ? html.length : 0)
        );

        if (!html) {
            return null;
        }

        var m =
            html.match(
                /(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
            );

        if (m && m[1]) {
            addDebug(
                "[dood] match m3u8"
            );

            return cleanUrl(m[1]);
        }

        var mp4 =
            html.match(
                /(?:file|link|source)\s*[:=]\s*['"]([^'"]+\.mp4[^'"]*)['"]/i
            );

        if (mp4 && mp4[1]) {
            addDebug(
                "[dood] match mp4"
            );

            return cleanUrl(mp4[1]);
        }

        addDebug(
            "[dood] ningun patron encontro nada"
        );

        return null;

    } catch (e) {
        addDebug(
            "[dood] EXCEPTION: " +
            String(e)
        );

        return null;
    }
}

// =========================================================
// GENERIC
// =========================================================

function genericExtract(pageUrl) {
    try {
        addDebug(
            "[generic] fetch=" + pageUrl
        );

        var html = httpGet(
            pageUrl,
            {
                "User-Agent": UA,
                "Referer": pageUrl
            }
        );

        addDebug(
            "[generic] htmlLen=" +
            (html ? html.length : 0)
        );

        if (!html) {
            return null;
        }

        var m =
            html.match(
                /file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
            );

        if (m && m[1]) {
            addDebug(
                "[generic] match file"
            );

            return cleanUrl(m[1]);
        }

        m =
            html.match(
                /source\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
            );

        if (m && m[1]) {
            addDebug(
                "[generic] match source"
            );

            return cleanUrl(m[1]);
        }

        m =
            html.match(
                /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i
            );

        if (m) {
            addDebug(
                "[generic] match suelto m3u8"
            );

            return cleanUrl(m[0]);
        }

        addDebug(
            "[generic] ningun patron encontro nada"
        );

        return null;

    } catch (e) {
        addDebug(
            "[generic] EXCEPTION: " +
            String(e)
        );

        return null;
    }
}

// =========================================================
// EXTRACTOR UNIFICADO
// =========================================================

// =========================================================
// STREAMWISH / HOSTER EMBED (desofuscación de packers)
// =========================================================

function unpackPacked(js) {
    try {
        var m =
            String(js || "").match(
                /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)(?:,[^)]*)?\)\)/
            );

        if (!m) {
            return null;
        }

        var p = m[1];
        var a = parseInt(m[2], 10);
        var c = parseInt(m[3], 10);
        var k = m[4].replace(/\\'/g, "'").split("|");
        var out = p;

        for (var idx = c - 1; idx >= 0; idx--) {
            if (k[idx]) {
                var w =
                    new RegExp(
                        "\\b" +
                        idx.toString(a) +
                        "\\b",
                        "g"
                    );

                out = out.replace(w, k[idx]);
            }
        }

        return out;

    } catch (e) {
        return null;
    }
}

function streamwishExtract(pageUrl) {
    try {
        var html =
            httpGet(
                pageUrl,
                {
                    "User-Agent": UA,
                    "Referer": pageUrl
                }
            );

        if (!html || html.length < 500) {
            return null;
        }

        var dec =
            unpackPacked(html);

        if (!dec || dec.length < 100) {
            return null;
        }

        var linksRe =
            /"(hls4|hls3|hls2)"\s*:\s*"(https?:\/\/[^"]+)"/g;

        var lm;
        var best = null;

        while ((lm = linksRe.exec(dec))) {
            var u = cleanUrl(lm[2]);

            if (!u) continue;

            if (best === null) {
                best = u;
            }

            if (u.indexOf(".m3u8") !== -1) {
                return u;
            }
        }

        if (best) {
            return best;
        }

        var fm =
            dec.match(
                /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i
            );

        if (fm && fm[1]) {
            return cleanUrl(fm[1]);
        }

        return null;

    } catch (e) {
        return null;
    }
}

function extractVideo(pageUrl) {

    if (!pageUrl) {
        addDebug(
            "[extract] URL vacia"
        );

        return null;
    }

    pageUrl = cleanUrl(pageUrl);

    // Si ya es un manifest HLS.
    if (isM3u8Url(pageUrl)) {
        return directHls(pageUrl);
    }

    var host = getHost(pageUrl);

    addDebug(
        "[extract] host=" + host
    );

    if (
        host.indexOf("vidhide") !== -1 ||
        host.indexOf("callistanise") !== -1
    ) {
        return vidhideExtract(pageUrl);
    }

    if (
        host.indexOf("voe") !== -1
    ) {
        return voeExtract(pageUrl);
    }

    if (
        host.indexOf("dood") !== -1 ||
        host.indexOf("do7go") !== -1
    ) {
        return doodExtract(pageUrl);
    }

    var sw =
        streamwishExtract(pageUrl);

    if (sw) {
        return sw;
    }

    return genericExtract(pageUrl);
}

// =========================================================
// DETAIL
// =========================================================

function mkDetail(
    id,
    name,
    thumb,
    url,
    videoSources,
    description
) {
    var valid = [];
    var src = videoSources || [];

    for (
        var i = 0;
        i < src.length;
        i++
    ) {
        if (src[i]) {
            valid.push(src[i]);
        }
    }

    var desc =
        description || "";

    // IMPORTANTE:
    // Ya no se agrega el vídeo de prueba.
    if (valid.length === 0) {
        desc +=
            "\n\n⚠️ No se encontró una fuente de vídeo reproducible.";
    } else {
        desc +=
            "\n\n✅ Fuentes reproducibles encontradas: " +
            valid.length;
    }

    if (_debugLog.length > 0) {
        desc +=
            "\n\n=== REPORTE TÉCNICO ===\n" +
            _debugLog;
    }

    return new PlatformVideoDetails({
        id: new PlatformID(
            "Magma",
            String(id),
            PID
        ),

        name: name || "Sin titulo",

        thumbnails: mkThumb(thumb),

        author: new PlatformAuthorLink(
            MGID,
            "Magma",
            "https://magma.app",
            "",
            0
        ),

        uploadDate: 0,
        url: url,
        duration: 0,
        viewCount: 0,
        isLive: false,

        video:
            new VideoSourceDescriptor(valid),

        description: desc
    });
}

// =========================================================
// PLAYERPRO
// =========================================================
// API Xtream (player_api.php) - port v46
//  - Listados reales del servidor: get_live_streams / get_vod_streams / get_series
//  - Detalles y reproducción: candidatas Xtream (/live/, /stream/gen/, /movie/, get.php)

var _xtCache = {};

function xtGet(action, extra) {
    try {
        var cacheKey = action;

        if (extra) {
            var ek = Object.keys(extra).sort();
            for (var ei = 0; ei < ek.length; ei++) {
                cacheKey += "|" + ek[ei] + "=" + extra[ek[ei]];
            }
        }

        if (_xtCache[cacheKey] !== undefined) {
            return _xtCache[cacheKey];
        }

        var q =
            "username=" +
            encodeURIComponent(IPTV_USER) +
            "&password=" +
            encodeURIComponent(IPTV_PASS) +
            "&action=" +
            encodeURIComponent(action);

        if (extra) {
            for (var k in extra) {
                if (extra.hasOwnProperty(k)) {
                    q += "&" + k + "=" + encodeURIComponent(extra[k]);
                }
            }
        }

        var url =
            IPTV_URL +
            "/player_api.php?" +
            q;

        var response =
            http.GET(
                url,
                {
                    "User-Agent": DALVIK_UA,
                    "Accept": "application/json"
                }
            );

        var body =
            (response && response.body)
                ? response.body
                : "";

        if (!body) {
            return null;
        }

        var data = null;

        try {
            data = JSON.parse(body);
        } catch (e) {
            addDebug("[xt] JSON inválido action=" + action);
            return null;
        }

        _xtCache[cacheKey] = data;

        return data;

    } catch (e) {
        addDebug("[xt] EXCEPTION action=" + action + ": " + String(e));
        return null;
    }
}

function xtLists() {
    return {
        live: xtGet("get_live_streams") || [],
        vod: xtGet("get_vod_streams") || [],
        series: xtGet("get_series") || []
    };
}

function xtThumb(item) {
    if (!item) return "";
    return fixImg(
        item.stream_icon ||
        item.cover ||
        item.backdrop_path ||
        item.backdrop ||
        item.icon ||
        ""
    );
}

function xtFind(list, id) {
    id = String(id);

    for (var i = 0; i < list.length; i++) {
        var item = list[i];

        if (
            String(item.stream_id) === id ||
            String(item.series_id) === id
        ) {
            return item;
        }
    }

    return null;
}

function xtLiveUrl(id) {
    return (
        IPTV_URL +
        "/live/" +
        encodeURIComponent(IPTV_USER) +
        "/" +
        encodeURIComponent(IPTV_PASS) +
        "/" +
        id +
        ".m3u8"
    );
}

function xtGetPlayCandidates(kind, id) {
    var u = encodeURIComponent(IPTV_USER);
    var p = encodeURIComponent(IPTV_PASS);
    var out = [];

    out.push({
        url: IPTV_URL + "/stream/gen/" + id,
        name: "stream/gen",
        hls: true
    });

    if (kind === "live") {
        out.push({
            url: xtLiveUrl(id),
            name: "Live HLS",
            hls: true
        });
        out.push({
            url:
                IPTV_URL +
                "/get.php?username=" + u +
                "&password=" + p +
                "&type=live&stream_id=" + id,
            name: "get.php live",
            hls: true
        });
    }

    if (kind === "vod") {
        out.push({
            url:
                IPTV_URL +
                "/movie/" + u + "/" + p + "/" + id + ".mp4",
            name: "mp4",
            hls: false
        });
        out.push({
            url:
                IPTV_URL +
                "/movie/" + u + "/" + p + "/" + id + ".mkv",
            name: "mkv",
            hls: false
        });
        out.push({
            url:
                IPTV_URL +
                "/get.php?username=" + u +
                "&password=" + p +
                "&type=movie&stream_id=" + id,
            name: "get.php movie",
            hls: false
        });
    }

    return out;
}

function xtAddSource(sources, cand) {
    try {
        if (!cand || !cand.url) return;

        if (cand.hls) {
            var h = mkHls(cand.url, cand.name);

            if (h) {
                sources.push(h);
            }
        } else {
            var mp4 = new MP4Source({
                url: cand.url,
                name: cand.name,
                duration: 0
            });

            sources.push(mp4);
        }

    } catch (e) {
        addDebug("[xt] source falló: " + (cand && cand.name));
    }
}

function mgHome() {
    var videos = [];
    var L = xtLists();

    for (
        var i = 0;
        i < L.live.length && videos.length < 40;
        i++
    ) {
        var lv = L.live[i];

        videos.push(
            mkVideo(
                "mg_live_" + lv.stream_id,
                "[Live] " + (lv.name || ""),
                xtThumb(lv),
                "magma://live/" + lv.stream_id,
                "Magma"
            )
        );
    }

    for (
        var j = 0;
        j < L.vod.length && videos.length < 80;
        j++
    ) {
        var v = L.vod[j];

        videos.push(
            mkVideo(
                "mg_m_" + v.stream_id,
                v.name || "",
                xtThumb(v),
                "magma://movie/" + v.stream_id,
                "Magma"
            )
        );
    }

    for (
        var k = 0;
        k < L.series.length && videos.length < 100;
        k++
    ) {
        var s = L.series[k];

        videos.push(
            mkVideo(
                "mg_s_" + s.series_id,
                "[Serie] " + (s.name || ""),
                xtThumb(s),
                "magma://serie/" + s.series_id,
                "Magma"
            )
        );
    }

    return videos;
}

function mgSearch(query) {
    var videos = [];
    var q = String(query || "").toLowerCase().trim();

    if (!q) return videos;

    var L = xtLists();

    for (var i = 0; i < L.live.length; i++) {
        var lv = L.live[i];

        if (
            String(lv.name || "")
                .toLowerCase()
                .indexOf(q) !== -1
        ) {
            videos.push(
                mkVideo(
                    "mg_live_" + lv.stream_id,
                    "[Live] " + (lv.name || ""),
                    xtThumb(lv),
                    "magma://live/" + lv.stream_id,
                    "Magma"
                )
            );
        }
    }

    for (var j = 0; j < L.vod.length; j++) {
        var v = L.vod[j];

        if (
            String(v.name || "")
                .toLowerCase()
                .indexOf(q) !== -1
        ) {
            videos.push(
                mkVideo(
                    "mg_m_" + v.stream_id,
                    v.name || "",
                    xtThumb(v),
                    "magma://movie/" + v.stream_id,
                    "Magma"
                )
            );
        }
    }

    for (var k = 0; k < L.series.length; k++) {
        var s = L.series[k];

        if (
            String(s.name || "")
                .toLowerCase()
                .indexOf(q) !== -1
        ) {
            videos.push(
                mkVideo(
                    "mg_s_" + s.series_id,
                    "[Serie] " + (s.name || ""),
                    xtThumb(s),
                    "magma://serie/" + s.series_id,
                    "Magma"
                )
            );
        }
    }

    return videos;
}

function mgMovieDetails(id) {
    var item = xtFind(xtLists().vod, id);

    var title = item ? (item.name || "") : ("Película " + id);
    var thumb = xtThumb(item);
    var url = "magma://movie/" + id;

    var desc = title;

    var info =
        xtGet("get_vod_info", { vod_id: id });

    var infoObj =
        (info && info.info)
            ? info.info
            : (item || {});

    if (infoObj) {
        if (infoObj.plot) {
            desc += "\n\n" + infoObj.plot;
        }

        var release =
            infoObj.releaseDate ||
            infoObj.release;

        if (release) {
            desc += "\nAño: " + release;
        }

        if (infoObj.rating) {
            desc += "\nRating: " + infoObj.rating + "/10";
        } else if (item && item.rating_5based) {
            desc += "\nRating: " + (item.rating_5based / 2) + "/5";
        }
    }

    desc += "\n\nServidor: " + IPTV_URL;

    var sources = [];

    var linksData =
        xtGet("get_vod_links", { vod_id: id });

    if (linksData && linksData.length) {
        desc += "\n\n--- Servidores ---";

        var tried = 0;

        for (
            var i = 0;
            i < linksData.length && tried < MAX_TRY;
            i++
        ) {
            var link = linksData[i];

            var linkUrl = link.url || "";

            if (!linkUrl) {
                continue;
            }

            tried++;

            var serverName =
                getHost(linkUrl) +
                " [" +
                (link.language || "") +
                "/" +
                (link.quality || "") +
                "]";

            addDebug(
                "[movie] probando " +
                tried +
                "/" +
                MAX_TRY +
                ": " +
                linkUrl
            );

            var extracted =
                extractVideo(linkUrl);

            if (extracted) {
                var h =
                    mkHls(
                        extracted,
                        serverName
                    );

                if (h) {
                    sources.push(h);
                }

                addDebug(
                    "[movie] FUENTE OK: " +
                    serverName
                );

                break;
            } else {
                addDebug(
                    "[movie] FALLÓ: " +
                    serverName
                );
            }
        }
    }

    if (sources.length === 0) {
        var cands =
            xtGetPlayCandidates("vod", id);

        for (var c = 0; c < cands.length; c++) {
            xtAddSource(sources, cands[c]);
        }
    }

    return mkDetail(
        "mg_m_" + id,
        title,
        thumb,
        url,
        sources,
        desc
    );
}

function mgLiveDetails(id) {
    var item = xtFind(xtLists().live, id);

    var title = item ? (item.name || "") : ("Canal " + id);
    var thumb = xtThumb(item);
    var url = "magma://live/" + id;

    var desc = title;

    desc +=
        "\nCategoría: " +
        ((item && item.category_id) || "-");

    desc += "\n\nServidor: " + IPTV_URL;

    var sources = [];

    var direct =
        (item &&
            (item.direct_source ||
                item.url)) ||
        "";

    if (direct) {
        desc += "\nFuente directa: " + direct;

        var h =
            mkHls(
                cleanUrl(direct),
                "Directo"
            );

        if (h) {
            sources.push(h);
        }
    }

    if (sources.length === 0) {
        var cands =
            xtGetPlayCandidates("live", id);

        for (var i = 0; i < cands.length; i++) {
            xtAddSource(sources, cands[i]);
        }
    }

    return mkDetail(
        "mg_live_" + id,
        title,
        thumb,
        url,
        sources,
        desc
    );
}

function mgSerieDetails(id) {
    var item = xtFind(xtLists().series, id);

    var title = item ? (item.name || "") : ("Serie " + id);
    var thumb = xtThumb(item);
    var url = "magma://serie/" + id;

    var desc = title;

    var info =
        xtGet("get_series_info", { series_id: id });

    var infoObj =
        (info && info.info)
            ? info.info
            : (item || {});

    if (infoObj) {
        if (infoObj.plot) {
            desc += "\n\n" + infoObj.plot;
        }

        var release =
            infoObj.releaseDate ||
            infoObj.release;

        if (release) {
            desc += "\nAño: " + release;
        }

        if (infoObj.rating) {
            desc += "\nRating: " + infoObj.rating + "/10";
        } else if (item && item.rating_5based) {
            desc += "\nRating: " + (item.rating_5based / 2) + "/5";
        }
    }

    desc += "\n\nServidor: " + IPTV_URL;
    desc += "\n\n⚠️ El servidor no expone listado de episodios (" + IPTV_URL + " no responde get_series_links).";

    return mkDetail(
        "mg_s_" + id,
        title,
        thumb,
        url,
        [],
        desc
    );
}

function mgEpisodeLinks(id, season, episode) {
    return mgSerieDetails(id);
}

// =========================================================
// JKANIME
// =========================================================

function jkaSearch(query) {
    var out = [];

    try {
        var slug =
            slugify(query);

        if (!slug) {
            return out;
        }

        var html =
            httpGet(
                JK +
                "/buscar/" +
                slug +
                "/",
                {
                    "Referer":
                        JK + "/"
                }
            );

        if (!html) {
            return out;
        }

        var re =
            /<div class="anime__item">\s*<a\s+href="(https?:\/\/jkanime\.net\/[a-z0-9-]+\/)"[^>]*>[\s\S]*?<div[^>]*data-setbg="([^"]*)"[\s\S]*?<h5><a[^>]*>([^<]+)<\/a><\/h5>/gi;

        var m;

        while (
            (m = re.exec(html)) &&
            out.length < 30
        ) {
            out.push({
                title:
                    htmlDecode(m[3]),

                url:
                    m[1],

                thumb:
                    m[2]
            });
        }

    } catch (e) {}

    return out;
}

function jkaExtractVideo(
    episodeUrl
) {
    addDebug(
        "JKA: Extrayendo episodio " +
        episodeUrl
    );

    var html =
        httpGet(
            episodeUrl,
            {
                "Referer":
                    JK + "/"
            }
        );

    if (!html) {
        addDebug(
            "JKA: HTML nulo"
        );

        return null;
    }

    var re =
        /video\[\d+\]\s*=\s*'[^']*src="(https?:\/\/jkanime\.net\/jkplayer\/um[^"]*)"/i;

    var m =
        html.match(re);

    if (
        !m ||
        !m[1]
    ) {
        addDebug(
            "JKA: No se encontró iframe"
        );

        return null;
    }

    var playerUrl =
        m[1].replace(
            /&amp;/g,
            "&"
        );

    addDebug(
        "JKA: Cargando reproductor: " +
        playerUrl
    );

    var playerHtml =
        httpGet(
            playerUrl,
            {
                "Referer":
                    episodeUrl
            }
        );

    if (!playerHtml) {
        addDebug(
            "JKA: Player HTML nulo"
        );

        return null;
    }

    addDebug(
        "JKA Player HTML length: " +
        playerHtml.length
    );

    var m3u8 =
        playerHtml.match(
            /url\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
        );

    if (
        m3u8 &&
        m3u8[1]
    ) {
        return mkHls(
            cleanUrl(m3u8[1]),
            "JkAnime"
        );
    }

    addDebug(
        "JKA: No se encontró m3u8"
    );

    return null;
}

function jkaDetails(url) {
    _debugLog = "";

    var html =
        httpGet(
            url,
            {
                "Referer":
                    JK + "/"
            }
        );

    if (!html) {
        return mkDetail(
            "jk_" + url,
            "Sin resultado",
            "",
            url,
            [],
            "No se pudo cargar"
        );
    }

    var title = "";

    var tm =
        html.match(
            /<h1[^>]*>([\s\S]*?)<\/h1>/i
        );

    if (tm) {
        title =
            stripTags(tm[1]);
    }

    title =
        (title || "")
            .replace(
                /\s*-\s*anime.*JkAnime/i,
                ""
            )
            .replace(
                /JkAnime/i,
                ""
            )
            .trim();

    var thumb = "";

    var im =
        html.match(
            /<img[^>]*src=["']([^"']*animes\/(?:image|video)\/[^"']+)["']/i
        );

    if (im) {
        thumb =
            im[1].indexOf("http") === 0
                ? im[1]
                : JK +
                  "/" +
                  im[1].replace(
                      /^\/+/,
                      ""
                  );
    }

    var desc = "";

    var seriesMatch =
        url.match(
            /jkanime\.net\/([a-z0-9-]+)\/?$/i
        );

    var episodeMatch =
        url.match(
            /jkanime\.net\/([a-z0-9-]+)\/(\d+)\/?$/i
        );

    if (
        seriesMatch &&
        !episodeMatch
    ) {
        var episodes = [];

        var re =
            /<a[^>]*href="\/([a-z0-9-]+)\/(\d+)\/?"[^>]*>/gi;

        var slug =
            seriesMatch[1];

        var m;

        while (
            (m = re.exec(html)) &&
            episodes.length < 200
        ) {
            if (
                m[1] === slug
            ) {
                episodes.push({
                    number:
                        parseInt(
                            m[2],
                            10
                        ),

                    url:
                        JK +
                        "/" +
                        m[1] +
                        "/" +
                        m[2] +
                        "/"
                });
            }
        }

        episodes.sort(
            function(a, b) {
                return (
                    a.number -
                    b.number
                );
            }
        );

        desc +=
            "\n\n--- Episodios (" +
            episodes.length +
            ") ---";

        for (
            var ei = 0;
            ei < episodes.length;
            ei++
        ) {
            desc +=
                "\nEp " +
                episodes[ei].number +
                " → " +
                episodes[ei].url;
        }

        var sources = [];

        if (
            episodes.length > 0
        ) {
            var firstSrc =
                jkaExtractVideo(
                    episodes[0].url
                );

            if (firstSrc) {
                sources.push(
                    firstSrc
                );
            }
        }

        return mkDetail(
            "jk_" + url,
            title ||
                slugToTitle(slug),
            thumb,
            url,
            sources,
            desc
        );
    }

    var episodeSources =
        jkaExtractVideo(url);

    var srcArray =
        episodeSources
            ? [episodeSources]
            : [];

    return mkDetail(
        "jk_" + url,
        title || "Anime",
        thumb,
        url,
        srcArray,
        desc
    );
}

// =========================================================
// UNIFIED
// =========================================================

function doSearch(query) {
    var results = [];

    try {
        var r =
            mgSearch(query);

        for (
            var i = 0;
            i < r.length;
            i++
        ) {
            results.push(
                r[i]
            );
        }
    } catch (e) {}

    try {
        var jka =
            jkaSearch(query);

        for (
            var j = 0;
            j < jka.length;
            j++
        ) {
            results.push(
                mkVideo(
                    "jk_" +
                    jka[j].url,

                    "[Anime] " +
                    jka[j].title,

                    jka[j].thumb,

                    jka[j].url,

                    "JkAnime"
                )
            );
        }

    } catch (e) {}

    return results;
}

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

    if (
        url.indexOf(
            "jkanime.net"
        ) !== -1
    ) {
        return jkaDetails(url);
    }

    if (
        url.indexOf(
            "magma://movie/"
        ) === 0
    ) {
        var mm =
            url.match(
                /magma:\/\/movie\/(\d+)/
            );

        if (mm) {
            return mgMovieDetails(
                mm[1]
            );
        }
    }

    if (
        url.indexOf(
            "magma://live/"
        ) === 0
    ) {
        var ml =
            url.match(
                /magma:\/\/live\/(\d+)/
            );

        if (ml) {
            return mgLiveDetails(
                ml[1]
            );
        }
    }

    if (
        url.indexOf(
            "magma://serie/"
        ) === 0
    ) {
        var ss =
            url.match(
                /magma:\/\/serie\/(\d+)/
            );

        if (ss) {
            return mgSerieDetails(
                ss[1]
            );
        }
    }

    return mkDetail(
        "",
        "",
        "",
        url,
        [],
        ""
    );
}

// =========================================================
// HOME
// =========================================================

function doHome() {
    var videos = [];

    try {
        var r =
            mgHome();

        for (
            var i = 0;
            i < r.length;
            i++
        ) {
            videos.push(
                r[i]
            );
        }

    } catch (e) {}

    try {
        var jkHtml =
            httpGet(
                JK + "/",
                {
                    "Referer":
                        JK + "/"
                }
            );

        if (jkHtml) {
            var re =
                /data-setbg="([^"]*)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi;

            var m;

            while (
                (m = re.exec(jkHtml)) &&
                videos.length < 60
            ) {
                var linkRe =
                    /href="(https?:\/\/jkanime\.net\/[a-z0-9-]+\/?)"/i;

                var pos =
                    jkHtml.indexOf(
                        m[0]
                    );

                var anchor =
                    jkHtml.substring(
                        Math.max(
                            0,
                            pos - 500
                        ),
                        pos +
                        m[0].length
                    );

                var lm =
                    anchor.match(
                        linkRe
                    );

                videos.push(
                    mkVideo(
                        "jk_home_" +
                        (
                            lm
                                ? lm[1]
                                : JK + "/"
                        ),

                        "[Anime] " +
                        stripTags(m[2]),

                        m[1],

                        lm
                            ? lm[1]
                            : JK + "/",

                        "JkAnime"
                    )
                );
            }
        }

    } catch (e) {}

    return videos;
}

// =========================================================
// RECOMENDACIONES (lista de episodios navegable)
// =========================================================

// FIX v42: nuevo. GrayJay usa este hook para mostrar la lista de
// "siguientes videos" debajo del detalle. Sin esto, los episodios de
// una serie solo existían como texto suelto en la descripción y no
// eran tocables.
function doRecommendations(url) {
    var videos = [];

    try {
        var se =
            String(url || "").match(
                /magma:\/\/serie\/(\d+)$/
            );

        if (!se) {
            return videos;
        }

        var id = se[1];

        var L = xtLists();

        for (
            var i = 0;
            i < L.series.length && videos.length < 12;
            i++
        ) {
            var s = L.series[i];

            if (
                String(s.series_id) ===
                String(id)
            ) {
                continue;
            }

            videos.push(
                mkVideo(
                    "mg_s_" + s.series_id,
                    "[Serie] " + (s.name || ""),
                    xtThumb(s),
                    "magma://serie/" + s.series_id,
                    "Magma"
                )
            );
        }

    } catch (e) {}

    return videos;
}

// =========================================================
// BINDINGS
// =========================================================

if (
    typeof source !== "undefined"
) {
    source.setSettings =
        function(s) {
            _settings =
                s || {};
        };

    source.enable =
        function(c, s) {
            _settings =
                s || {};
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
                    doSearch(
                        query || ""
                    ),
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
            return (
                url &&
                (
                    url.indexOf(
                        "jkanime.net"
                    ) !== -1 ||

                    url.indexOf(
                        "magma://"
                    ) !== -1
                )
            );
        };

    source.isVideoDetailsUrl =
        function(url) {
            return source
                .isContentDetailsUrl(
                    url
                );
        };

    source.getVideoDetails =
        function(url) {
            return source
                .getContentDetails(
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
            return false;
        };

    source.searchSuggestions =
        function(query) {
            return [];
        };

    // FIX v42: nuevo binding. Ver doRecommendations().
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
                    id: new PlatformID(
                        "Magma",
                        "error_fallo",
                        PID
                    ),

                    name:
                        "Error de Extractor",

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
                            MGID,
                            "Magma",
                            "https://magma.app",
                            "",
                            0
                        ),

                    uploadDate: 0,
                    url:
                        url ||
                        "https://magma.app",
                    duration: 0,
                    viewCount: 0,
                    isLive: false,

                    description:
                        "CRASH CRÍTICO: " +
                        String(e) +
                        "\n\nLOG TÉCNICO:\n" +
                        _debugLog,

                    // Sin vídeo falso.
                    video:
                        new VideoSourceDescriptor([])
                });
            }
        };
}
