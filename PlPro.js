// Magma GrayJay Source v51
// Multi-servidor + HLS + diagnóstico
// Cambios v51:
//  - FIX: _siteParseGeneric calculaba mal la ventana de contexto (usaba
//    anchors[i].indexOf("href") dentro del tag en vez de la posicion real en
//    el HTML) -> los sitios generic (PelisPop, Kindor, VerUltra, etc.) no
//    devolvian items en home. Ahora usa posicion incremental real + ventana
//    hacia atras/adelante, extrae titulo de alt/h2/h3/imagen y normaliza URLs
//    con barra final.
//  - FIX: Home de Cuevana usa estructura TPostMv (no movie-item); se agregan
//    homeSplit/homeUrlRe/homeTitleRe/homeThumbRe para el feed del home.
//  - FIX: fixImg soporta URLs protocol-relative ("//host/...").
//  - FIX: dedupe por URL tambien en modo split (Cuevana mostraba el mismo
//    estreno varias veces en home).
// Cambios v50:
//  - FIX: stream/gen m3u8 requiere headers X-App/X-Version/X-Hash/X-Did
//    que el player nativo de GrayJay no envía. Se agrega MagmaHlsExecutor
//    (patrón de OkRuScript) para inyectar dichos headers en cada request HLS.
//  - FIX: Movies ahora intentan TODOS los embeds antes de stream/gen
//  - Se eliminó JkAnime (el usuario no lo usa)
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
var TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// =========================================================
// MAGMA X-Hash (capturado del APK original v10)
// La app original (libplpro.so) genera un hash HMAC por dispositivo
// que se envía como X-Hash en cada request al servidor.
// Sin este header, /stream/secure/ retorna 404.
// Este hash fue capturado del HAR del teléfono del usuario.
// Si no funciona en tu dispositivo, necesitarás capturar tu propio hash
// exportando un .har desde un proxy (e.g. mitmproxy/HTTP Toolkit)
// y buscando el header X-Hash en las requests a tv.m3uts.xyz.
// =========================================================
var MAGMA_X_APP = "ps";
var MAGMA_X_VERSION = "10/1.0.9";
var MAGMA_X_DID = "9f100e691008b1b8";
var MAGMA_X_HASH = "fyu8cis5qQWtEjNeSpg3ZGGXc9IduYXAd7LIn-CJJLKU6z9Jar3SJ8LZ_kCbG9-FS8joRKc_OAsgj6gFVnqSLl4Zw4wFIwXUWuN33Xzx0NQ83Yp5DK64pu3fs74KeE4RzHLNmYtqkBXFBTC8edygMYMnCdBJsvEPmqN_PRpvQjsdl8gkHa9XyvQhumiDIRh2bowwvGxR";
var MAGMA_PLAYER_UA = "Magma Player/10";
var _sgHashValid = null;

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

function httpPost(url, bodyStr, headers) {
    try {
        var h = headers || {};
        if (!h["User-Agent"] && !h["user-agent"]) {
            h["User-Agent"] = DALVIK_UA;
        }
        if (!h["Content-Type"]) {
            h["Content-Type"] = "application/x-www-form-urlencoded";
        }
        var r = http.post(url, bodyStr, h);
        return (r && r.body) ? r.body : "";
    } catch (e) {
        addDebug("HTTP POST Exception en " + url + ": " + String(e));
        return "";
    }
}

// =========================================================
// CUSTOM HLS SOURCE CLASSES (patrón OkRu)
// GrayJay puede inyectar headers en requests HLS mediante
// getRequestExecutor en HLSSource. Así el m3u8 y los TS
// segmentos obtienen los headers X-Hash necesarios.
// =========================================================

class MagmaHlsExecutor {
    constructor(url) { this.url = url; }
    executeRequest(url, headers) {
        try {
            var h = {};
            h["X-App"] = MAGMA_X_APP;
            h["X-Version"] = MAGMA_X_VERSION;
            h["X-Hash"] = MAGMA_X_HASH;
            h["X-Did"] = MAGMA_X_DID;
            h["User-Agent"] = MAGMA_PLAYER_UA;
            h["Accept-Encoding"] = "identity";
            var resp = http.GET(url, h, false);
            if (!resp || !resp.isOk) {
                addDebug("[MagmaExecutor] FAIL status=" + (resp ? resp.code : "null") + " url=" + url.substring(0, 120));
                throw new ScriptException("Magma fetch failed: " + (resp ? resp.code : "null"));
            }
            return resp.body || "";
        } catch(e) {
            addDebug("[MagmaExecutor] EXCEPTION: " + String(e));
            throw e;
        }
    }
}

function mkMagmaHls(url, name, duration) {
    if (!url) return null;
    try {
        var src = new HLSSource({
            name: name || "Magma HLS",
            url: url,
            duration: duration || 0
        });
        var executor = new MagmaHlsExecutor(url);
        src.getRequestExecutor = function() { return executor; };
        return src;
    } catch(e) {
        addDebug("[mkMagmaHls] Exception: " + String(e));
        return mkHls(url, name, duration);
    }
}

function testStreamGenHash(id) {
    if (_sgHashValid !== null) return _sgHashValid;
    try {
        var testUrl = resolveStreamGen(id || "177");
        if (!testUrl) { return false; }
        var resp = http.GET(testUrl, {
            "User-Agent": MAGMA_PLAYER_UA,
            "X-App": MAGMA_X_APP,
            "X-Version": MAGMA_X_VERSION,
            "X-Hash": MAGMA_X_HASH,
            "X-Did": MAGMA_X_DID,
            "Accept-Encoding": "identity"
        });
        _sgHashValid = (resp && resp.isOk && resp.body && resp.body.indexOf("#EXTM3U") !== -1);
        addDebug("[testHash] X-Hash " + (_sgHashValid ? "VÁLIDA" : "inválida") + " (status=" + (resp ? resp.code : "?") + ")");
    } catch(e) {
        addDebug("[testHash] Exception: " + String(e));
    }
    return _sgHashValid === true;
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
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&(?:aacute|Aacute);/g, "á")
        .replace(/&(?:eacute|Eacute);/g, "é")
        .replace(/&(?:iacute|Iacute);/g, "í")
        .replace(/&(?:oacute|Oacute);/g, "ó")
        .replace(/&(?:uacute|Uacute);/g, "ú")
        .replace(/&(?:ntilde|Ntilde);/g, "ñ")
        .replace(/&(?:auml|Auml);/g, "ä")
        .replace(/&(?:uuml|Uuml);/g, "ü")
        .replace(/&(?:ouml|Ouml);/g, "ö")
        .replace(/&aring;/g, "å")
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .replace(/&hellip;/g, "…")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&ldquo;/g, '"')
        .replace(/&rdquo;/g, '"')
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

    if (s.indexOf("//") === 0) {
        s = "https:" + s;
    }

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

// =========================================================
// MULTI-SITE AGGREGATOR — búsqueda rica + dominios extra
// Parser universal + per-site regexes verificados.
// Los sitios cuyo home/search funciona se iteran
// automáticamente. Los que fallan se saltan sin error.
// =========================================================

var _MULTI_SITES = [
    // -------- SEARCH verificados --------
    { name:"Cuevana3", base:"https://cuevana3l.pro",
      searchUrl:"https://cuevana3l.pro/explorar?s={q}", homeUrl:"https://cuevana3l.pro/",
      split:'class="movie-item">', urlRe:/href="([^"]+\/(?:pelicula|serie)\/[^"]+)"/, titleRe:/<p>([^<]+)<\/p>/, thumbRe:/src=([^ >]+)/, tStrip:/^["']/,
      homeSplit:'TPostMv', homeUrlRe:/href="(https?:\/\/[^"]+\/(?:pelicula|serie)\/[a-z0-9\-]+)"/i,
      homeTitleRe:/<div class="Title">([^<]{2,140})<\/div>|<h2 class="Title">([^<]{2,140})<\/h2>|<img[^>]*alt=["']([^"']{2,100})["']/i,
      homeThumbRe:/src=(https?:\/\/[^ >]+|\/\/[^ >]+)/ },
    { name:"PelisFlix", base:"https://pelisflix1.tv",
      searchUrl:"https://pelisflix1.tv/?s={q}", homeUrl:"https://pelisflix1.tv/",
      split:'TPostMv', urlRe:/href="(\/pelicula\/[^"]+|\/serie\/[^"]+|https?:\/\/[^"]+\/(?:pelicula|serie)\/[^"]+)"/,
      titleRe:/<div class="Title">([^<]{2,140})<\/div>|<h2 class="Title">([^<]{2,140})<\/h2>|<img[^>]*alt=["']([^"']{2,100})["']/i,
      thumbRe:/data-src="([^"]+)"|src=([^ >]+)/, tStrip:/^["']/ },
    { name:"PelisPlus", base:"https://pelisplusapk.net",
      searchUrl:"https://pelisplusapk.net/?s={q}", homeUrl:"https://pelisplusapk.net/inicio/",
      split:'TPostMv', urlRe:/href="(\/pelicula\/[^"]+|\/serie\/[^"]+|https?:\/\/[^"]+\/(?:pelicula|serie)\/[^"]+)"/,
      titleRe:/<div class="Title">([^<]{2,140})<\/div>|<h2 class="Title">([^<]{2,140})<\/h2>|<img[^>]*alt=["']([^"']{2,100})["']/i,
      thumbRe:/data-src="([^"]+)"|src=([^ >]+)/, tStrip:/^["']/ },
    // -------- HOME-only: contenido único, distinto servidor --------
    { name:"FullTV", base:"https://www.fulltv.com.mx", homeUrl:"https://www.fulltv.com.mx/",
      split:'last-item', skipUrlRe:/lista-|indice/i, urlRe:/<h3><a href="([^"]+\.html)">/, titleRe:/<h3><a href="[^"]*">([^<]+)<\/a>/, thumbRe:/src="(\/\/[^"]+\.(?:jpg|jpeg|png))"/, tPrefix:"https:" },
    { name:"PelisPop", base:"https://pelispop.mov", homeUrl:"https://pelispop.mov/",
      generic:true, navFilter:/^\/(?:peliculas?|series?|anime|estrenos|cine|genero)/ },
    { name:"Kindor", base:"https://kindor.pro", homeUrl:"https://kindor.pro/",
      generic:true, navFilter:/^\/(?:peliculas?|series?|anime|estrenos|cine|genero)/ },
    { name:"VerUltra", base:"https://verpeliculasultra.com", homeUrl:"https://verpeliculasultra.com/",
      generic:true, navFilter:/^\/(?:peliculas?|series?|estrenos?|cine|genero)/ },
    { name:"PelisOnline", base:"https://pelisonline.club", homeUrl:"https://pelisonline.club/",
      generic:true, navFilter:/^\/(?:peliculas?|series?)/ },
    { name:"Serielatino", base:"https://serielatino.com", homeUrl:"https://serielatino.com/serie/",
      generic:true, navFilter:/^\/(?:peliculas?|series?|genero)/ },
    { name:"SeriesPeru", base:"https://seriesperu.com", homeUrl:"https://seriesperu.com/",
      generic:true, navFilter:/^\/(?:series|genero)/ },
    { name:"TVSeriesLat", base:"https://www.tvserieslatino.com", homeUrl:"https://www.tvserieslatino.com/",
      generic:true, navFilter:/^\/(?:peliculas?|series?|genero|category|tag|page)/ },
    { name:"CineAntes", base:"https://cinedeantes2.weebly.com", homeUrl:"https://cinedeantes2.weebly.com/",
      generic:true, navFilter:/^\/(?!.*-[-][a-z]\.html)/ },
    { name:"PelisCris", base:"https://peliculascristianas.es", homeUrl:"https://peliculascristianas.es/",
      generic:true, navFilter:/^\/(?:peliculas?|series?|genero)/ },
    { name:"SeriesBib", base:"https://seriesbiblicas.net", homeUrl:"https://seriesbiblicas.net/",
      generic:true, navFilter:/^\/(?:series|genero|tag|page)/ },
    { name:"HistCine", base:"https://online.historiadelcine.es", homeUrl:"https://online.historiadelcine.es/",
      generic:true, navFilter:/^\/(?:peliculas|categor)/ },
];

var _NAV_SLUG_RE = /^(peliculas?|series?|anime|estrenos?|genero[s]?|categor[ií]as?|en-cartelera|proximamente|populares|tendencias|top|novedades|lista[s]?|todas|descargas?|releases?|movies?|pago|membresia|contacto|nosotros|login|registro|cuenta|politica|terminos|aviso|publicidad|\d{4}|\d{4}-\d{4}|\d{4}-\d{2})$/i;
var _NAV_PATH_RE = /^\/?(peliculas?|series?|anime|estrenos?|genero[s]?|categor[ií]as?|ver-peliculas|ultimas|proximas|todas|movies?)[\/\-]?$/i;
var _CAT_SINGLE_RE = /^\/?(?:cine|ciencia|pel[ií]culas?|series?|genre|generos?|category|categor[ií]as?|tags?|estrenos?|animes?|doramas?|novelas?|documentales?|populares|m[áa]s[-_]vistas)[\-a-z0-9]*\/?$/i;
var _NAV_WORD_RE = /\/?(?:pago[-_]de[-_]membresia|membresia|contacto|nosotros|solicitar|publicidad|cookies?|privacidad|terminos|aviso[-_]legal)/i;

function _siteGenericTitleH3(html, startAt, anchorLen, raw) {
    var t = null;
    // 1) <h2>/<h3> DENTRO del propio anchor (Serielatino: sd-card-title)
    var endA = html.indexOf("</a>", startAt + anchorLen);
    if (endA > 0 && endA - startAt < 4000) {
        var innerHtml = html.substring(startAt + anchorLen, endA);
        var ih = innerHtml.match(/<h[23][^>]*>([\s\S]{2,300}?)<\/h[23]>/i);
        if (ih) {
            var seg = ih[1].split(/<[^>]+>/).map(function(x) { return x.trim(); }).filter(Boolean)[0];
            if (seg && /[a-záéíóúüñ0-9]/i.test(seg) && !/^(tv\s+series|series|pel[ií]culas?|inicio|home|men[uú]|resultados?\s+encontrados?)$/i.test(seg)) t = seg;
        }
    }
    if (t) return t;
    var fwd = html.substring(startAt + anchorLen, startAt + anchorLen + 1500);
    // 2) <h2>/<h3> que enlaza al MISMO url (Kindor, Cuevana home, etc.)
    var fRe = /<h[23][^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]{2,150})<\/a>\s*<\/h[23]>/gi;
    var m;
    while ((m = fRe.exec(fwd))) {
        if (m[1] === raw || raw.indexOf(m[1]) !== -1 || m[1].indexOf(raw) !== -1) return m[2].trim();
    }
    // 3) <h2>/<h3> mas cercano hacia ATRAS (PelisPop: titulo antes del anchor)
    var back = html.substring(Math.max(0, startAt - 2400), startAt);
    var bRe = /<h[23][^>]*>([\s\S]{2,400}?)<\/h[23]>/gi;
    var cands = [];
    while ((m = bRe.exec(back))) cands.push({ text: m[1], pos: m.index });
    for (var k = cands.length - 1; k >= 0; k--) {
        var inner = cands[k].text;
        var lk = inner.match(/href="([^"]+)"/);
        if (lk && lk[1] !== raw && lk[1].indexOf(raw) === -1 && raw.indexOf(lk[1]) === -1) continue;
        var seg2 = inner.split(/<[^>]+>/).map(function(x) { return x.trim(); }).filter(Boolean)[0];
        if (seg2 && seg2.length >= 2) return seg2;
    }
    return null;
}

function _siteParseGeneric(html, base, navFilter, skipUrlRe) {
    var items = [];
    var seen = {};
    var anchors = html.match(/<a[^>]*href="([^"]+)"[^>]*>/gi) || [];
    var searchFrom = 0;
    for (var i = 0; i < anchors.length && items.length < 12; i++) {
        var hrefM = anchors[i].match(/href="([^"]+)"/);
        if (!hrefM) continue;
        var raw = hrefM[1];
        if (!raw || raw.charAt(0) === '#' || raw.indexOf("javascript") === 0 || raw.indexOf("mailto") === 0) continue;
        var url = raw.indexOf("http") === 0 ? raw : base + (raw.charAt(0) === "/" ? "" : "/") + raw;
        // Solo enlaces del mismo sitio (evita anuncios/nav cross-domain)
        if (url.indexOf("http") === 0 && url.indexOf(base) !== 0) continue;
        if (_NAV_WORD_RE.test(url)) continue;
        if (skipUrlRe && skipUrlRe.test(url)) continue;
        // Filter nav links (tolera URLs con barra final: kindor /pelicula/x/)
        var parts = url.replace(/https?:\/\//, "").split("/");
        while (parts.length && !parts[parts.length - 1]) parts.pop();
        var last = ((parts[parts.length - 1] || "") + "").toLowerCase().replace(/\.html?$/, "").replace(/\?.*$/, "");
        if (_NAV_SLUG_RE.test(last)) continue;
        if (last.length < 3 && !/\d/.test(last)) continue;
        if (/^peliculas?-|^ver-peliculas/i.test(last)) continue;
        var plaus = /(?:pelicula|serie|ver|ver-|episode|capitulo|estrenos?)\/|\/[a-z0-9]+[-_][a-z0-9]+[\-\/]|\/\d{3,5}-[a-z]/i;
        if (!plaus.test(url) && !/\.html?(\?|#|$)/i.test(url)) continue;
        // Evitar enlaces a episodios (mejor landing de la serie)
        if (/\/temporada\/|\/capitulo\/|\/episodio/i.test(url)) continue;
        if (/\/xfsearch\//i.test(url)) continue;
        if (/\/category\//i.test(url)) continue;
        // Categoria de un solo segmento (cine-antiguo, ciencia-ficcion, etc.)
        if (parts.length === 2 && _CAT_SINGLE_RE.test("/" + parts[1].toLowerCase().replace(/\.html?$/, ""))) continue;
        if (navFilter && navFilter.test("/" + last)) continue;
        if (seen[url]) continue;
        seen[url] = 1;

        var startAt = html.indexOf(anchors[i], searchFrom);
        if (startAt < 0) startAt = html.indexOf(anchors[i]);
        if (startAt < 0) continue;
        searchFrom = startAt + anchors[i].length;

        var back = html.substring(Math.max(0, startAt - 1800), startAt);
        var fwd = html.substring(startAt + anchors[i].length, startAt + anchors[i].length + 900);
        var title = "";
        var tm;
        // 1) h2/h3 dentro del anchor / enlazado al mismo url / mas cercano atras
        var ht = _siteGenericTitleH3(html, startAt, anchors[i].length, raw);
        if (ht) title = ht;
        // 2) img alt dentro del propio anchor (Kindor: alt="Poster X Online")
        if (!title) { tm = anchors[i].match(/<img[^>]*alt=["']([^"']{2,140})["']/i); if (tm) title = tm[1]; }
        // 3) img alt justo despues del anchor
        if (!title) { tm = fwd.match(/<img[^>]*alt=["']([^"']{2,140})["']/i); if (tm) title = tm[1]; }
        // 4) img alt del poster que esta ANTES del anchor (PelisPop)
        if (!title) {
            var bImgs = back.match(/<img[^>]*>/gi);
            if (bImgs && bImgs.length) {
                var lastImg = bImgs[bImgs.length - 1];
                tm = lastImg.match(/\balt=["']([^"']{2,140})["']/i) || lastImg.match(/\btitle=["']([^"']{2,140})["']/i);
                if (tm) {
                    var altT = tm[1];
                    // Solo aceptar alt/title que parezcan CONTENIDO, no logos/nav
                    // (ej. PelisPop: "Ver X online en HD - Pelicula completa")
                    if (/^\s*(ver|watch|play)\s/i.test(altT) || /online\s+en\s+hd|pel[ií]cula\s+completa|ver\s+online/i.test(altT)) title = altT;
                }
            }
        }
        // 5) texto plano del anchor (VerUltra: "Mayday ver online")
        if (!title) {
            var txt = "";
            if (fwd.trim().charAt(0) !== '<') {
                var aEnd = fwd.indexOf("</a>");
                txt = stripTags((aEnd >= 0 ? fwd.substring(0, aEnd) : fwd).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).replace(/\s+/g, " ").trim();
            }
            txt = txt.replace(/^(ver|watch|play|descargar)\s+/i, "").replace(/\s+(ver online|ver|online|pel[ií]cula|serie|descargar)\s*$/i, "").trim();
            if (txt.length >= 3 && txt.length <= 90 && !/[=;{}]/.test(txt)) title = txt;
        }
        // 6) atributo title del anchor
        if (!title) { tm = anchors[i].match(/\btitle=["']([^"']{2,140})["']/i); if (tm) title = tm[1]; }
        // 7) slug
        if (!title) title = last.replace(/[-_]/g, " ");
        title = htmlDecode(title)
            .replace(/^\s*(pel[ií]cula|serie|ver|poster|image|logo|portada|hd|miniatura)\s+/i, "")
            .replace(/^\s*pel[ií]cula\s+destacada\s+/i, "")
            .replace(/\s+online\s+en\s+hd\s*[-–—]\s*(?:pel[ií]cula|serie)\s+completa$/i, "")
            .replace(/\s*[-–—]\s*(?:ver\s+online\s+gratis|pel[ií]cula completa)$/i, "")
            .replace(/\s+en\s+hd$/i, "")
            .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+/u, "")
            .replace(/\s{2,}/g, " ").trim();
        if (/^(ingrese\s+a\s+su\s+cuenta|iniciar\s+sesi[oó]n|registrarse|crear\s+cuenta|bienvenid[oa]|resultados?\s+de\s+b[uú]squeda)/i.test(title)) title = "";
        // limpieza en bucle de sufijos (latino completo, online hd, etc.)
        var prev = "";
        while (title !== prev) {
            prev = title;
            title = title.replace(/\s+(ver online|ver|online|latino|espa[nñ]ol|subtitulad[oa]|completa?|hd|pel[ií]cula|serie|1080p|720p)\s*$/i, "").trim();
        }
        if (title.length < 2) continue;
        title = title.charAt(0).toUpperCase() + title.slice(1);
        // thumb
        var img = anchors[i].match(/<img[^>]*src=["']?([^"'\s>]+)["']?/i)
            || fwd.match(/<img[^>]*src=["']?([^"'\s>]+)["']?/i)
            || back.match(/<img[^>]*src=["']?([^"'\s>]+)["']?/i);
        var thumb = img ? img[1] : "";
        if (thumb.indexOf("//") === 0) thumb = "https:" + thumb;
        items.push({ url: url, title: title, thumb: thumb });
    }
    return items;
}

function _siteParseItems(site, html, max, home) {
    var split = (home && site.homeSplit) ? site.homeSplit : site.split;
    var urlRe = (home && site.homeUrlRe) ? site.homeUrlRe : site.urlRe;
    var titleRe = (home && site.homeTitleRe) ? site.homeTitleRe : site.titleRe;
    var thumbRe = (home && site.homeThumbRe) ? site.homeThumbRe : site.thumbRe;
    if (site.generic || !split) return _siteParseGeneric(html, site.base, site.navFilter || null);
    var out = [];
    var seen = {};
    var parts = html.split(split);
    for (var i = 1; i < parts.length && out.length < (max || 15); i++) {
        var chunk = parts[i].substring(0, 2000);
        var urlM = chunk.match(urlRe);
        if (!urlM) continue;
        // Buscar el titulo DESPUES de la url del item (evita encabezados de
        // seccion tipo "Ver Estrenos Online Pelisflix" que viven antes)
        var afterUrl = chunk.substring(chunk.indexOf(urlM[1]) + urlM[1].length);
        var titleM = afterUrl.match(titleRe) || chunk.match(titleRe);
        var thumbM = chunk.match(thumbRe);
        if (!titleM) continue;
        var url = urlM[1].replace(/\/(?:episodio|temporada)[\/\-][^\/]*$/i, "");
        if (url.indexOf("http") !== 0) url = site.base + (url.charAt(0) === "/" ? "" : "/") + url;
        if (site.skipUrlRe && site.skipUrlRe.test(url)) continue;
        if (seen[url]) continue;
        seen[url] = 1;
        var title = (titleM[1] || titleM[2] || titleM[3] || "").trim().replace(/^\s*(pel[ií]cula|serie|ver|Poster)\s+/i, "").trim();
        // Encabezado de seccion -> usar slug
        if (/^(ver\s+)?(pel[ií]culas?|series?|estrenos?|episodios?|novedades|tendencias|populares|en\s+cartelera|los\s+m[áa]s\s+vistos|ultimas|proximamente|animes?|documentales?)\s+(online|en\s+espa[nñ]ol|latino|hd)?/i.test(title)) title = "";
        if (!title) { var sl = url.split("/").pop().replace(/[-_]/g, " "); title = sl.charAt(0).toUpperCase() + sl.slice(1); }
        title = htmlDecode(title);
        var thumb = (thumbM ? (thumbM[1] || thumbM[2] || "") : "").trim();
        if (site.tStrip) thumb = thumb.replace(site.tStrip, "").replace(/["']$/, "");
        if (thumb && thumb.indexOf("http") !== 0) thumb = (site.tPrefix || "") + thumb;
        thumb = fixImg(thumb);
        out.push({ title: title, url: url, thumb: thumb, site: site.name, host: site.base.replace(/^https?:\/\//, "").replace(/\/$/, "") });
    }
    return out.length ? out : _siteParseGeneric(html, site.base, site.navFilter || null, site.skipUrlRe);
}

function _matchSite(host) {
    for (var i = 0; i < _MULTI_SITES.length; i++) {
        var h = _MULTI_SITES[i].base.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (host.indexOf(h) !== -1 || h.indexOf(host) !== -1) return _MULTI_SITES[i];
    }
    return null;
}

function siteSearch(query) {
    var results = [];
    var q = String(query || "").trim();
    if (!q) return results;
    for (var i = 0; i < _MULTI_SITES.length; i++) {
        var site = _MULTI_SITES[i];
        if (!site.searchUrl) continue;
        try {
            var html = httpGet(site.searchUrl.replace("{q}", encodeURIComponent(q)), { "User-Agent": UA, "Referer": site.base + "/" });
            if (!html || html.length < 500) continue;
            var items = _siteParseItems(site, html, 12);
            for (var j = 0; j < items.length; j++) {
                items[j].site = site.name;
                items[j].host = site.base.replace(/^https?:\/\//, "").replace(/\/$/, "");
                items[j].thumb = fixImg(items[j].thumb);
                results.push(items[j]);
            }
        } catch(e) { addDebug("[site:" + site.name + "] search err: " + String(e).substring(0,50)); }
    }
    return results;
}

function siteHomeFeed() {
    var results = [];
    for (var i = 0; i < _MULTI_SITES.length; i++) {
        var site = _MULTI_SITES[i];
        if (!site.homeUrl) continue;
        try {
            var html = httpGet(site.homeUrl, { "User-Agent": UA, "Referer": site.base + "/" });
            if (!html || html.length < 1000) continue;
            var items = _siteParseItems(site, html, 12, true);
            for (var j = 0; j < items.length; j++) {
                items[j].site = site.name;
                items[j].host = site.base.replace(/^https?:\/\//, "").replace(/\/$/, "");
                results.push(items[j]);
            }
        } catch(e) {}
    }
    return results;
}

function _siteExtractPlay(html, pageUrl, siteName) {
    var sources = [];
    // 1. Direct m3u8
    var m3 = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
    if (m3) { var h = mkHls(cleanUrl(m3[0]), "HLS"); if (h) sources.push(h); return sources; }
    // 2. Direct mp4
    var mp4 = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
    if (mp4) { sources.push(new MP4Source({ url: cleanUrl(mp4[0]), name: "MP4", duration: 0 })); return sources; }
    // 3. iframes
    var ifRe = /<iframe[^>]*src=["']([^"']+)["']/gi;
    var ifm; var ct = 0;
    while ((ifm = ifRe.exec(html)) && ct < 6) { ct++;
        var href = cleanUrl(ifm[1]);
        if (href.indexOf("http") !== 0) href = "https:" + href;
        var ex = extractVideo(href);
        if (ex) { var h2 = mkHls(ex, getHost(href)); if (h2) { sources.push(h2); break; } }
    }
    // 4. data-* embeds
    if (!sources.length) {
        var dRe = /data-(?:src|url|video|embed|player|link)=["']([^"']+)["']/gi;
        var dm; while ((dm = dRe.exec(html)) && ct < 8) { ct++;
            var href2 = cleanUrl(dm[1]);
            if (href2.indexOf("http") === 0 && (href2.indexOf(".m3u8") !== -1 || href2.indexOf(".mp4") !== -1)) {
                var h3 = isM3u8Url(href2) ? mkHls(href2, "HLS") : null;
                if (h3) { sources.push(h3); break; }
            }
        }
    }
    // 5. /ver/ links (family Cuevana)
    if (!sources.length) {
        var verRe = /href="(https?:\/\/[^"'\s]+\/ver\/[^"'\s]+)"/gi;
        var vm; while ((vm = verRe.exec(html)) && ct < 3) { ct++;
            var verUrl = cleanUrl(vm[1]);
            var vHtml = httpGet(verUrl, { "User-Agent": UA, "Referer": pageUrl });
            if (!vHtml) continue;
            var if2 = /<iframe[^>]*src=["']([^"']+)["']/gi;
            var im2;
            if ((im2 = if2.exec(vHtml))) {
                var ex2 = extractVideo(cleanUrl(im2[1]));
                if (ex2) { var h4 = mkHls(ex2, getHost(verUrl)); if (h4) { sources.push(h4); break; } }
            }
        }
    }
    return sources;
}

function siteDetail(url) {
    var host = String(url).replace(/https?:\/\//, "").split("/")[0];
    _debugLog = "";
    var site = _matchSite(host);
    if (!site) return mkDetail("site_" + url, host, "", url, [], "Sitio no soportado: " + host);
    var html = httpGet(url, { "User-Agent": UA, "Referer": site.base + "/" });
    if (!html || html.length < 300) return mkDetail("site_" + url, host, "", url, [], "No se pudo cargar");
    var title = ""; var tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (tm) title = stripTags(tm[1]).trim();
    if (!title) { tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (tm) title = htmlDecode(stripTags(tm[1]).replace(/\s*[-|–].*/,"")).trim(); }
    if (!title) title = url.split("/").pop().replace(/[-_]/g, " ").trim();
    title = htmlDecode(title);
    var thumb = ""; var ti = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
    if (ti) thumb = cleanUrl(ti[1]);
    var sources = _siteExtractPlay(html, url, site.name);
    var desc = "Sitio: " + site.name + "\n" + url;
    if (!sources.length) desc += "\n\n⚠️ No se encontró fuente reproducible (puede requerir WebView).";
    return mkDetail("site_" + url, title || host, thumb, url, sources, desc);
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


function resolveStreamGen(id) {
    try {
        var body = "id=" + encodeURIComponent(id) + "&cast=false&device=9f100e691008b1b8&code=";
        var resp = httpPost(IPTV_URL + "/stream/gen/" + id, body);
        if (!resp) return null;
        resp = resp.trim();
        if (/^https?:\/\/.*\.m3u8/i.test(resp)) {
            addDebug("[streamGen] URL resuelta: " + resp);
            return resp;
        }
        addDebug("[streamGen] respuesta no es m3u8: " + resp.substring(0, 100));
        return null;
    } catch (e) {
        addDebug("[streamGen] error: " + String(e));
        return null;
    }
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

    var sg = resolveStreamGen(id);

    if (sg) {
        out.push({
            url: sg,
            name: "stream/gen (firmada)",
            hls: true
        });
    } else {
        out.push({
            url: IPTV_URL + "/stream/gen/" + id,
            name: "stream/gen",
            hls: true
        });
    }

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

function embedPriority(url) {
    var h = getHost(url);
    if (!h) return 99;
    // Hosts que responden bien a HTTP simple (Streamwish y clones)
    if (h.indexOf("hgplaycdn") !== -1) return 1;
    if (h.indexOf("streamwish") !== -1) return 1;
    if (h.indexOf("bysejikuar") !== -1) return 2;
    if (h.indexOf("josephseveralconcern") !== -1) return 3;
    if (h.indexOf("zpjid") !== -1) return 4;
    if (h.indexOf("premilkyway") !== -1) return 2;
    if (h.indexOf("commerceplatform") !== -1) return 2;
    // Hosts conocidos con métodos de extracción
    if (h.indexOf("vidhide") !== -1) return 5;
    if (h.indexOf("callistanise") !== -1) return 5;
    if (h.indexOf("voe") !== -1) return 6;
    if (h.indexOf("dood") !== -1 || h.indexOf("do7go") !== -1) return 6;
    if (h.indexOf("wolfstream") !== -1) return 7;
    return 8;
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

    desc += "\n\n--- Servidores ---";

    var linksData =
        xtGet("get_vod_links", { vod_id: id });

    if (linksData && linksData.length) {
        linksData.sort(function(a, b) {
            return embedPriority(a.url || "") - embedPriority(b.url || "");
        });

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
                    desc += "\n" + serverName;
                }

                addDebug(
                    "[movie] FUENTE OK: " +
                    serverName
                );
            } else {
                addDebug(
                    "[movie] FALLÓ: " +
                    serverName
                );
            }
        }
    }

    // stream/gen como ÚLTIMO recurso (requiere X-Hash válido).
    if (sources.length === 0) {
        if (testStreamGenHash(id)) {
            var sgUrl = resolveStreamGen(id);
            if (sgUrl) {
                var sgHls = mkMagmaHls(sgUrl, "stream/gen (interna)");
                if (sgHls) {
                    sources.push(sgHls);
                    desc += "\nstream/gen [interna]";
                    addDebug("[movie] stream/gen OK: " + sgUrl);
                }
            }
        } else {
            addDebug("[movie] stream/gen saltado: X-Hash no válida en este dispositivo");
        }
    }

    if (sources.length === 0) {
        if (testStreamGenHash(id)) {
            var cands =
                xtGetPlayCandidates("vod", id);

            for (var c = 0; c < cands.length; c++) {
                xtAddSource(sources, cands[c]);
            }
        } else {
            desc += "\n\n⚠️ No hay servidores reproducibles desde GrayJay.";
            desc += "\nEl servidor solo entrega stream/gen cifrado con X-Hash,";
            desc += "\nque no es compatible con el player de GrayJay sin un";
            desc += "\nX-Hash propio del dispositivo (ver Reporte Técnico).";
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

    // stream/gen con executor que inyecta X-App/X-Version/X-Hash/X-Did.
    // Sin un X-Hash válido para este dispositivo, el m3u8 devuelve 404.
    if (testStreamGenHash(id)) {
        var sgLive = resolveStreamGen(id);
        if (sgLive) {
            var sgH = mkMagmaHls(sgLive, "Live stream/gen (firmada)");
            if (sgH) {
                sources.push(sgH);
                desc += "\nFuente: stream/gen (firmada)";
                addDebug("[live] stream/gen OK: " + sgLive);
            }
        }
    } else {
        addDebug("[live] stream/gen saltado: X-Hash no válida en este dispositivo");
    }

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
        if (testStreamGenHash(id)) {
            var cands =
                xtGetPlayCandidates("live", id);

            for (var i = 0; i < cands.length; i++) {
                xtAddSource(sources, cands[i]);
            }
        } else {
            desc += "\n\n⚠️ Canal sin fuente reproducible desde GrayJay.";
            desc += "\nstream/gen cifrado requiere X-Hash válido del";
            desc += "\ndispositivo (ver Reporte Técnico).";
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
// UNIFIED
// =========================================================

function doSearch(query) {
    var results = [];
    var seen = {};

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
            seen[r[i].url] = true;
        }
    } catch (e) {}

    try {
        var web = siteSearch(query);
        for (var j = 0; j < web.length; j++) {
            if (seen[web[j].url]) continue;
            seen[web[j].url] = true;
            results.push(
                mkVideo(
                    "site_" + web[j].url,
                    "[" + web[j].site + "] " + web[j].title,
                    web[j].thumb,
                    web[j].url,
                    web[j].site
                )
            );
        }
    } catch(e) {}

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

    // Detalles de sitios web (Cuevana, PelisFlix, FullTV, etc.)
    if (url.indexOf("site_") === 0 || url.indexOf("cuevana3") !== -1 || url.indexOf("pelisflix") !== -1 || url.indexOf("fulltv.com.mx") !== -1 || url.indexOf("pelisplusapk") !== -1) {
        var realUrl = url.indexOf("site_") === 0 ? url.substring(5) : url;
        try { return siteDetail(realUrl); } catch(e) { return mkDetail("", "", "", url, [], String(e)); }
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
    var seen = {};

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
            seen[r[i].url] = true;
        }

    } catch (e) {}

    try {
        var web = siteHomeFeed();
        for (var j = 0; j < web.length && videos.length < 120; j++) {
            if (seen[web[j].url]) continue;
            seen[web[j].url] = true;
            videos.push(
                mkVideo(
                    "site_" + web[j].url,
                    "[" + web[j].site + "] " + web[j].title,
                    web[j].thumb,
                    web[j].url,
                    web[j].site
                )
            );
        }
    } catch(e) {}

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
            if (!url) return false;
            if (url.indexOf("magma://") !== -1) return true;
            if (url.indexOf("site_") === 0) return true;
            if (url.indexOf("cuevana3") !== -1) return true;
            if (url.indexOf("pelisflix") !== -1) return true;
            if (url.indexOf("fulltv.com.mx") !== -1) return true;
            if (url.indexOf("pelisplusapk") !== -1) return true;
            return false;
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
