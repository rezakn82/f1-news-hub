const STORAGE_KEYS = {
  READ_IDS: "f1_hub_read_ids_v2",
  FAVORITE_MAP: "f1_hub_favorites_v2",
  TRANSLATIONS: "f1_hub_translations_v2",
  DISABLED_SOURCES: "f1_hub_disabled_sources_v2",
  SETTINGS: "f1_hub_settings_v2",
};

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function getLocalSettings() {
  return readJsonStorage(STORAGE_KEYS.SETTINGS, {
    ui_language: "fa",
    theme: "dark",
    max_articles_displayed: 150,
  });
}

export function saveLocalSettings(newSettings) {
  const merged = { ...getLocalSettings(), ...newSettings };
  writeJsonStorage(STORAGE_KEYS.SETTINGS, merged);
  return merged;
}

export function getDisabledSources() {
  return readJsonStorage(STORAGE_KEYS.DISABLED_SOURCES, {});
}

export function setSourceEnabledLocal(sourceId, enabled) {
  const map = getDisabledSources();
  if (enabled) {
    delete map[sourceId];
  } else {
    map[sourceId] = true;
  }
  writeJsonStorage(STORAGE_KEYS.DISABLED_SOURCES, map);
  return map;
}

export function clearLocalBrowserCache() {
  localStorage.removeItem(STORAGE_KEYS.READ_IDS);
  localStorage.removeItem(STORAGE_KEYS.TRANSLATIONS);
}

export async function loadStaticFeedData() {
  const res = await fetch(`./data/feed.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Could not load static feed.json");
  }
  return res.json();
}

export function toggleFavoriteLocal(article) {
  const favMap = readJsonStorage(STORAGE_KEYS.FAVORITE_MAP, {});
  const isNowFav = !favMap[article.id];
  if (isNowFav) {
    favMap[article.id] = { ...article, is_favorite: true };
  } else {
    delete favMap[article.id];
  }
  writeJsonStorage(STORAGE_KEYS.FAVORITE_MAP, favMap);
  return isNowFav;
}

export function toggleReadLocal(articleId) {
  const readMap = readJsonStorage(STORAGE_KEYS.READ_IDS, {});
  const isNowRead = !readMap[articleId];
  if (isNowRead) {
    readMap[articleId] = true;
  } else {
    delete readMap[articleId];
  }
  writeJsonStorage(STORAGE_KEYS.READ_IDS, readMap);
  return isNowRead;
}

export function markReadLocal(articleId) {
  const readMap = readJsonStorage(STORAGE_KEYS.READ_IDS, {});
  readMap[articleId] = true;
  writeJsonStorage(STORAGE_KEYS.READ_IDS, readMap);
}

async function googleTranslateClientSide(text, sourceLang = "auto") {
  if (!text || !text.trim()) return "";
  const sl = sourceLang === "en" || sourceLang === "it" ? sourceLang : "auto";
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=fa&dt=t&q=${encodeURIComponent(
    text.trim()
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Translation request failed");
  const data = await res.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return data[0].map((part) => part[0]).join("");
  }
  return "";
}

export async function translateArticleClientSide(article) {
  const cache = readJsonStorage(STORAGE_KEYS.TRANSLATIONS, {});
  const existing = cache[article.id] || {};

  const translated_title =
    article.translated_title ||
    existing.translated_title ||
    (await googleTranslateClientSide(article.original_title, article.original_language));

  const sourceSummaryText = (article.extracted_content || article.description || article.original_title)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  const persian_summary =
    article.persian_summary ||
    existing.persian_summary ||
    (await googleTranslateClientSide(sourceSummaryText, article.original_language));

  cache[article.id] = { translated_title, persian_summary };
  writeJsonStorage(STORAGE_KEYS.TRANSLATIONS, cache);

  return { translated_title, persian_summary };
}

export async function extractArticleClientSide(article) {
  if (article.extracted_content) {
    return article.extracted_content;
  }
  try {
    const readerUrl = `https://r.jina.ai/${article.original_url}`;
    const res = await fetch(readerUrl, {
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const cleaned = text
      .replace(/^Title:.*$/gm, "")
      .replace(/^URL Source:.*$/gm, "")
      .replace(/^Markdown Content:.*$/gm, "")
      .trim();
    return cleaned.length > 150 ? cleaned.slice(0, 6000) : null;
  } catch {
    return null;
  }
}

export function filterAndGroupArticles(rawArticles, filters) {
  const readMap = readJsonStorage(STORAGE_KEYS.READ_IDS, {});
  const favMap = readJsonStorage(STORAGE_KEYS.FAVORITE_MAP, {});
  const transMap = readJsonStorage(STORAGE_KEYS.TRANSLATIONS, {});
  const disabledSources = getDisabledSources();
  const settings = getLocalSettings();

  // Merge saved articles so favorites persist even if they aged out of feed.json
  const combinedMap = new Map();
  rawArticles.forEach((a) => combinedMap.set(a.id, a));
  Object.values(favMap).forEach((favArt) => {
    if (!combinedMap.has(favArt.id)) {
      combinedMap.set(favArt.id, favArt);
    }
  });

  const enriched = Array.from(combinedMap.values()).map((a) => {
    const cachedTrans = transMap[a.id] || {};
    return {
      ...a,
      translated_title: a.translated_title || cachedTrans.translated_title || null,
      persian_summary: a.persian_summary || cachedTrans.persian_summary || null,
      is_read: Boolean(readMap[a.id]),
      is_favorite: Boolean(favMap[a.id]),
    };
  });

  const {
    search = "",
    source_id = "all",
    category = "All News",
    language = "all",
    date_from = "",
    date_to = "",
    sort_order = "desc",
  } = filters;

  const q = search.trim().toLowerCase();

  const filtered = enriched.filter((a) => {
    if (disabledSources[a.source_id]) return false;
    if (category === "Saved Articles" && !a.is_favorite) return false;
    if (
      category &&
      category !== "All News" &&
      category !== "Latest News" &&
      category !== "Saved Articles" &&
      a.category !== category
    ) {
      return false;
    }
    if (source_id && source_id !== "all" && a.source_id !== source_id) return false;
    if (language && language !== "all" && a.original_language !== language) return false;
    if (date_from && a.publication_date < date_from) return false;
    if (date_to && a.publication_date > `${date_to}T23:59:59`) return false;
    if (q) {
      const hay = `${a.original_title || ""} ${a.translated_title || ""} ${a.description || ""} ${
        a.persian_summary || ""
      } ${a.source_name || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const cmp = (a.publication_date || "").localeCompare(b.publication_date || "");
    return sort_order === "asc" ? cmp : -cmp;
  });

  // Group articles sharing the same cluster_id
  const clusters = new Map();
  const grouped = [];

  for (const item of filtered) {
    const cid = item.cluster_id || item.id;
    if (!clusters.has(cid)) {
      const primary = { ...item, related_sources: [] };
      clusters.set(cid, primary);
      grouped.push(primary);
    } else {
      clusters.get(cid).related_sources.push({
        id: item.id,
        source_id: item.source_id,
        source_name: item.source_name,
        original_title: item.original_title,
        original_url: item.original_url,
        publication_date: item.publication_date,
        original_language: item.original_language,
      });
    }
  }

  return grouped.slice(0, Number(settings.max_articles_displayed || 150));
}