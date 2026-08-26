/** @format */

/**
 * Domain → content-category mapping for the per-client DNS report.
 *
 * Pi-hole stores only the queried name, never a category, so the taxonomy has
 * to come from here. Two layers feed it:
 *
 *   1. The curated table below. DNS traffic is heavily long-tail skewed — a few
 *      hundred registrable domains account for the large majority of real
 *      lookups on a home network — so a hand-maintained table classifies most
 *      of the volume without downloading anything.
 *   2. An optional on-disk overlay, installed by lib/dnsCategoryOverlay.js.
 *      That hook lets a category-organised blocklist such as UT1 (whose
 *      `adult/domains` file is ~1M entries) layer on top of the table.
 *
 * Everything is matched on the registrable domain (eTLD+1), never the full
 * hostname, so `scontent-lhr8.cdninstagram.com` and `www.cdninstagram.com`
 * collapse to one entry.
 *
 * This module stays free of node builtins so the category metadata can be
 * imported by client components; the overlay loader is server-only.
 */

/* ------------------------------------------------------------------ */
/* Public suffixes                                                    */
/* ------------------------------------------------------------------ */

/**
 * Multi-label public suffixes, so `bbc.co.uk` yields `bbc.co.uk` rather than
 * `co.uk`. This is a pragmatic subset of the PSL covering the ccTLDs and
 * hosting suffixes that actually turn up in DNS logs — the full list is ~9k
 * entries and would need a dependency to stay current.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  // ccTLD second levels
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in',
  'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.ec',
  'co.za', 'org.za', 'net.za',
  'com.tr', 'com.tw', 'com.hk', 'com.sg', 'com.my', 'com.ph', 'com.vn',
  'co.kr', 'or.kr', 'ne.kr',
  'com.ua', 'com.pl', 'com.ru', 'net.ru', 'org.ru',
  'co.il', 'org.il', 'net.il',
  'com.eg', 'com.sa', 'com.qa', 'com.kw', 'com.ng', 'co.ke',
  'com.es', 'com.pt', 'com.gr', 'co.th', 'or.th', 'co.id',
  // hosting suffixes where each label is a separate owner
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app',
  'netlify.app', 'herokuapp.com', 'firebaseapp.com', 'web.app',
  'b-cdn.net', 'r2.dev',
]);

/** Three-label suffixes, checked before the two-label set. */
const TRIPLE_LABEL_SUFFIXES = new Set([
  's3.amazonaws.com',
  'blob.core.windows.net',
]);

/**
 * Reduce a hostname to its registrable domain (eTLD+1).
 * Returns null for IP literals, single-label names, and malformed input.
 */
export function registrableDomain(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!host || /\s/.test(host)) return null;

  // IPv4 literal, IPv6 literal, and reverse-lookup names are not websites.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (host.includes(':')) return null;
  if (host.endsWith('.in-addr.arpa') || host.endsWith('.ip6.arpa')) return null;

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;

  if (parts.length >= 4 && TRIPLE_LABEL_SUFFIXES.has(parts.slice(-3).join('.'))) {
    return parts.slice(-4).join('.');
  }
  if (parts.length >= 3 && MULTI_LABEL_SUFFIXES.has(parts.slice(-2).join('.'))) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/* ------------------------------------------------------------------ */
/* Category definitions                                               */
/* ------------------------------------------------------------------ */

/**
 * Display order and tone for the UI. `noise: true` marks categories that are
 * infrastructure rather than browsing — they are aggregated but collapsed by
 * default, because a raw histogram is dominated by CDNs and telemetry.
 */
export const CATEGORIES = [
  { key: 'adult', label: 'Adult', tone: 'red' },
  { key: 'gambling', label: 'Gambling', tone: 'red' },
  { key: 'piracy', label: 'Piracy / torrents', tone: 'amber' },
  { key: 'vpn', label: 'VPN / proxy', tone: 'amber' },
  { key: 'social', label: 'Social media', tone: 'blue' },
  { key: 'media', label: 'Streaming / media', tone: 'violet' },
  { key: 'gaming', label: 'Gaming', tone: 'violet' },
  { key: 'messaging', label: 'Messaging', tone: 'blue' },
  { key: 'ai', label: 'AI tools', tone: 'teal' },
  { key: 'shopping', label: 'Shopping', tone: 'teal' },
  { key: 'news', label: 'News', tone: 'teal' },
  { key: 'ads', label: 'Ads / tracking', tone: 'gray', noise: true },
  { key: 'cdn', label: 'CDN / infrastructure', tone: 'gray', noise: true },
  { key: 'telemetry', label: 'OS / telemetry', tone: 'gray', noise: true },
  { key: 'other', label: 'Uncategorised', tone: 'gray', noise: true },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const NOISE_CATEGORIES = new Set(CATEGORIES.filter((c) => c.noise).map((c) => c.key));

const TABLE = {
  adult: [
    'pornhub.com', 'phncdn.com', 'xvideos.com', 'xvideos-cdn.com', 'xnxx.com', 'xnxx-cdn.com',
    'xhamster.com', 'xhcdn.com', 'xhamsterlive.com', 'redtube.com', 'youporn.com', 'tube8.com',
    'spankbang.com', 'sb-cd.com', 'eporner.com', 'txxx.com', 'upornia.com', 'hclips.com',
    'porntrex.com', 'thumbzilla.com', 'youjizz.com', 'tnaflix.com', 'empflix.com', 'drtuber.com',
    'sunporno.com', 'motherless.com', 'porn.com', 'sex.com', 'beeg.com', 'porn300.com',
    'pornone.com', 'hqporner.com', 'porngo.com', 'anyporn.com', 'vjav.com',
    'chaturbate.com', 'highwebmedia.com', 'stripchat.com', 'doppiocdn.com', 'bongacams.com',
    'cam4.com', 'myfreecams.com', 'livejasmin.com', 'camsoda.com', 'flirt4free.com',
    'streamate.com', 'xlovecam.com', 'jerkmate.com',
    'onlyfans.com', 'onlyfanscdn.com', 'fansly.com', 'manyvids.com', 'fanvue.com',
    'brazzers.com', 'realitykings.com', 'naughtyamerica.com', 'bangbros.com', 'adulttime.com',
    'blacked.com', 'tushy.com', 'vixen.com', 'digitalplayground.com', 'evilangel.com',
    'nhentai.net', 'e-hentai.org', 'exhentai.org', 'hanime.tv', 'hentaihaven.xxx',
    'rule34.xxx', 'gelbooru.com', 'luscious.net', 'iwara.tv',
    'missav.com', 'javhd.com', 'jav-guru.com', 'supjav.com',
    'imagefap.com', 'fapello.com', 'erome.com', 'coomer.su', 'kemono.su', 'simpcity.su',
    'adultfriendfinder.com', 'ashleymadison.com', 'fetlife.com', 'literotica.com',
    // Ad networks that serve adult inventory almost exclusively.
    'exoclick.com', 'exdynsrv.com', 'realsrv.com', 'trafficjunky.net', 'trafficjunky.com',
    'juicyads.com', 'ero-advertising.com', 'eroadvertising.com', 'trafficfactory.biz',
    'tsyndicate.com', 'popcash.net', 'clickadu.com',
  ],
  gambling: [
    'bet365.com', 'williamhill.com', 'ladbrokes.com', 'paddypower.com', 'betfair.com',
    'pokerstars.com', 'partypoker.com', '888casino.com', '888poker.com', 'bwin.com',
    'unibet.com', 'betway.com', 'draftkings.com', 'fanduel.com', 'bovada.lv',
    'stake.com', 'roobet.com', 'rollbit.com', 'csgoempire.com', 'betano.com',
    '1xbet.com', 'melbet.com', 'parimatch.com', 'bet9ja.com',
  ],
  piracy: [
    'thepiratebay.org', '1337x.to', '1337x.st', 'rarbg.to', 'yts.mx', 'nyaa.si',
    'torrentgalaxy.to', 'limetorrents.lol', 'kickasstorrents.to', 'torlock.com',
    'rutracker.org', 'fitgirl-repacks.site', 'dodi-repacks.site', 'igg-games.com',
    'libgen.is', 'libgen.rs', 'sci-hub.se', 'annas-archive.org', 'z-lib.io',
    'fmovies.to', '123movies.net', 'putlocker.vip', 'soap2day.to', 'sflix.to',
    'lookmovie.to', 'primewire.tf', 'gomovies.sx', 'aniwatch.to', 'gogoanime.cl',
    'real-debrid.com', 'alldebrid.com',
  ],
  vpn: [
    'nordvpn.com', 'expressvpn.com', 'surfshark.com', 'protonvpn.com', 'mullvad.net',
    'cyberghostvpn.com', 'privateinternetaccess.com', 'windscribe.com', 'tunnelbear.com',
    'hide.me', 'ipvanish.com', 'purevpn.com', 'atlasvpn.com', 'torproject.org',
    'psiphon3.com', 'hola.org', 'zenmate.com',
  ],
  social: [
    'facebook.com', 'fbcdn.net', 'fb.com', 'fbsbx.com', 'messenger.com',
    'instagram.com', 'cdninstagram.com', 'threads.net',
    'twitter.com', 'x.com', 'twimg.com', 't.co',
    'tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'byteoversea.com', 'musical.ly',
    'snapchat.com', 'sc-cdn.net', 'snap.com',
    'reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com',
    'linkedin.com', 'licdn.com', 'pinterest.com', 'pinimg.com',
    'tumblr.com', 'mastodon.social', 'bsky.app', 'bsky.network',
    'vk.com', 'weibo.com', 'quora.com', 'ok.ru', 'nextdoor.com',
  ],
  media: [
    'youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'youtube-nocookie.com',
    'netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com', 'nflxso.net',
    'hulu.com', 'disneyplus.com', 'dssott.com', 'bamgrid.com',
    'primevideo.com', 'aiv-cdn.net', 'aiv-delivery.net',
    'max.com', 'hbomax.com', 'hbo.com', 'paramountplus.com', 'peacocktv.com',
    'twitch.tv', 'ttvnw.net', 'jtvnw.net', 'twitchcdn.net',
    'spotify.com', 'scdn.co', 'spotifycdn.com', 'soundcloud.com', 'sndcdn.com',
    'deezer.com', 'tidal.com', 'pandora.com', 'audible.com', 'last.fm',
    'crunchyroll.com', 'vrv.co', 'vimeo.com', 'vimeocdn.com', 'dailymotion.com',
    'plex.tv', 'jellyfin.org', 'emby.media', 'sling.com', 'fubo.tv', 'mubi.com',
  ],
  gaming: [
    'steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamcontent.com',
    'epicgames.com', 'unrealengine.com',
    'riotgames.com', 'leagueoflegends.com', 'valorant.com',
    'blizzard.com', 'battle.net',
    'ea.com', 'origin.com',
    'ubisoft.com', 'ubi.com', 'ubisoft-store.com',
    'xboxlive.com', 'xbox.com', 'playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com',
    'nintendo.net', 'nintendo.com',
    'roblox.com', 'rbxcdn.com', 'minecraft.net', 'mojang.com', 'minecraftservices.com',
    'curseforge.com', 'gog.com', 'itch.io', 'humblebundle.com', 'nexusmods.com',
  ],
  messaging: [
    'whatsapp.com', 'whatsapp.net', 'telegram.org', 'telegram.me', 't.me', 'tdesktop.com',
    'signal.org', 'signalusercontent.org', 'discord.com', 'discordapp.com', 'discordapp.net',
    'discord.gg', 'discordcdn.com', 'slack.com', 'slack-edge.com', 'slack-msgs.com',
    'zoom.us', 'zoomgov.com', 'webex.com', 'skype.com', 'viber.com', 'line.me',
    'wechat.com', 'qq.com', 'element.io', 'matrix.org',
  ],
  ai: [
    'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com',
    'anthropic.com', 'claude.ai', 'perplexity.ai', 'midjourney.com',
    'stability.ai', 'huggingface.co', 'character.ai', 'x.ai', 'grok.com',
    'deepseek.com', 'mistral.ai', 'runwayml.com', 'elevenlabs.io', 'suno.com',
  ],
  shopping: [
    'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.co.jp',
    'media-amazon.com', 'ssl-images-amazon.com', 'images-amazon.com',
    'ebay.com', 'ebayimg.com', 'ebaystatic.com',
    'aliexpress.com', 'alicdn.com', 'alibaba.com', 'taobao.com', 'tmall.com',
    'walmart.com', 'target.com', 'bestbuy.com', 'costco.com', 'homedepot.com',
    'etsy.com', 'etsystatic.com', 'shein.com', 'temu.com', 'wish.com',
    'shopify.com', 'shopifycdn.com', 'myshopify.com',
    'paypal.com', 'paypalobjects.com', 'stripe.com', 'stripe.network', 'klarna.com',
    'newegg.com', 'ikea.com', 'wayfair.com', 'asos.com', 'zalando.com',
    'noon.com', 'jumia.com', 'mercadolibre.com',
  ],
  news: [
    'bbc.com', 'bbc.co.uk', 'bbci.co.uk', 'cnn.com', 'nytimes.com', 'nyt.com',
    'washingtonpost.com', 'theguardian.com', 'guim.co.uk', 'reuters.com', 'apnews.com',
    'bloomberg.com', 'wsj.com', 'ft.com', 'economist.com', 'forbes.com',
    'aljazeera.com', 'aljazeera.net', 'foxnews.com', 'nbcnews.com', 'cbsnews.com',
    'npr.org', 'dw.com', 'france24.com', 'lemonde.fr', 'spiegel.de', 'elpais.com',
    'corriere.it', 'businessinsider.com', 'techcrunch.com', 'arstechnica.com',
    'theverge.com', 'engadget.com',
  ],
  ads: [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
    'googletagmanager.com', 'googletagservices.com', '2mdn.net',
    'scorecardresearch.com', 'quantserve.com', 'quantcount.com',
    'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'zemanta.com',
    'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com',
    '33across.com', 'adsrvr.org', 'bluekai.com', 'demdex.net', 'omtrdc.net', 'adobedtm.com',
    'branch.io', 'appsflyer.com', 'adjust.com', 'amplitude.com', 'mixpanel.com',
    'segment.com', 'segment.io', 'hotjar.com', 'fullstory.com', 'mouseflow.com',
    'crazyegg.com', 'chartbeat.com', 'parsely.com', 'moatads.com', 'serving-sys.com',
    'flashtalking.com', 'sharethrough.com', 'teads.tv', 'smartadserver.com', 'indexww.com',
    'yieldmo.com', 'media.net', 'applovin.com', 'ironsrc.com', 'vungle.com',
    'chartboost.com', 'inmobi.com', 'adcolony.com', 'tapjoy.com', 'unity3d.com',
    'onesignal.com', 'braze.com', 'clevertap.com', 'newrelic.com', 'nr-data.net',
    'sentry.io', 'bugsnag.com', 'datadoghq.com',
  ],
  cdn: [
    'akamai.net', 'akamaiedge.net', 'akamaihd.net', 'akamaized.net', 'edgekey.net',
    'edgesuite.net', 'akadns.net', 'akstat.io',
    'cloudflare.com', 'cloudflare-dns.com', 'cloudflareinsights.com',
    'fastly.net', 'fastlylb.net', 'fastly-edge.com',
    'cloudfront.net', 'amazonaws.com', 'awsstatic.com',
    'azureedge.net', 'azurefd.net', 'windows.net', 'trafficmanager.net', 'msedge.net',
    'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'gvt1.com', 'gvt2.com', 'ggpht.com',
    'jsdelivr.net', 'unpkg.com', 'bootstrapcdn.com', 'jquery.com', 'fontawesome.com',
    'llnwd.net', 'stackpathdns.com', 'cdn77.org', 'bunnycdn.com',
    'digitaloceanspaces.com', 'wp.com', 'wordpress.com', 'gravatar.com', 'typekit.net',
    'cloudinary.com', 'imgix.net', 'imgur.com',
  ],
  telemetry: [
    'windowsupdate.com', 'msftncsi.com', 'msftconnecttest.com',
    'microsoft.com', 'live.com', 'office.com', 'office365.com', 'onedrive.com',
    'apple.com', 'mzstatic.com', 'icloud.com', 'cdn-apple.com', 'apple-dns.net',
    'google.com', 'googlezip.net', 'android.com', 'crashlytics.com', 'firebaseio.com',
    'firebase.com', 'dns.google',
    'ntp.org', 'pool.ntp.org',
    'samsungcloud.com', 'samsungqbe.com', 'samsungdm.com',
    'ubuntu.com', 'canonical.com', 'debian.org', 'archlinux.org',
    'mozilla.com', 'mozilla.org', 'mozilla.net',
    'roku.com', 'lgtvsdp.com',
  ],
};

/**
 * Last-resort heuristics for domains the table misses. Kept deliberately tight
 * — a loose /sex/ would match essex.com and middlesex.gov.uk — and applied to
 * the registrable domain only.
 */
const HEURISTICS = [
  // High-signal tokens, matched anywhere in the name. Very few legitimate
  // domains contain these, so "myporn-site.com" is worth catching.
  [/(porn|hentai|xvideos|xnxx|camgirl|jizz|milf)/, 'adult'],
  // Ambiguous tokens, anchored to a label boundary so essex.gov.uk,
  // middlesex.ac.uk and sussex.com do not match.
  [/(^|[.-])(xxx|nsfw|sexcam|sexcams|escort|escorts|boobs|nude|nudes|anal|tits)([.-]|$)/, 'adult'],
  [/\.(xxx|porn|sex|adult|cam|tube)$/, 'adult'],
  [/(^|[.-])(casino|betting|poker|slots|gamble|gambling)([.-]|$)/, 'gambling'],
  [/(^|[.-])(torrent|torrents|piratebay|watchfree|putlocker|solarmovie)([.-]|$)/, 'piracy'],
  [/(^|[.-])vpn([.-]|$)/, 'vpn'],
];

/* ------------------------------------------------------------------ */
/* Lookup                                                             */
/* ------------------------------------------------------------------ */

/** registrable domain -> category key */
const baseIndex = new Map();
for (const [category, domains] of Object.entries(TABLE)) {
  for (const d of domains) {
    // The table is authored by hand, so normalise defensively and let the
    // first definition win if a domain is listed twice.
    const key = registrableDomain(d) || d;
    if (!baseIndex.has(key)) baseIndex.set(key, category);
  }
}

/** Overlay entries loaded from disk, layered over the curated table. */
let overlayIndex = new Map();
let overlayMeta = { loaded: false, counts: {}, dir: null, error: null };

/**
 * Classify a hostname.
 * @returns {{ domain: string|null, category: string }}
 */
export function categorize(hostname) {
  const domain = registrableDomain(hostname);
  if (!domain) return { domain: null, category: 'other' };

  // The curated table is authoritative — an overlay list of a million domains
  // is far more likely to hold a stale or over-broad entry than this is.
  const direct = baseIndex.get(domain) || overlayIndex.get(domain);
  if (direct) return { domain, category: direct };

  for (const [pattern, category] of HEURISTICS) {
    if (pattern.test(domain)) return { domain, category };
  }

  return { domain, category: 'other' };
}

/* ------------------------------------------------------------------ */
/* Overlay installation                                               */
/* ------------------------------------------------------------------ */

/**
 * Replace the overlay index. Called by lib/dnsCategoryOverlay.js, which owns
 * the filesystem side; kept here so the lookup path has a single source.
 *
 * @param {Map<string,string>} index registrable domain -> category key
 * @param {object} meta
 */
export function installOverlay(index, meta = {}) {
  overlayIndex = index instanceof Map ? index : new Map();
  overlayMeta = { loaded: overlayIndex.size > 0, counts: {}, dir: null, error: null, ...meta };
  return getOverlayMeta();
}

export function getOverlayMeta() {
  return { ...overlayMeta, size: overlayIndex.size };
}

export function categoryMeta(key) {
  return CATEGORIES.find((c) => c.key === key) || { key, label: key, tone: 'gray' };
}
