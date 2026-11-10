import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  RefreshCw,
  Settings,
  Search,
  Bookmark,
  ExternalLink,
  Copy,
  Check,
  Share2,
  BookOpen,
  Languages,
  Sun,
  Moon,
  Flame,
  Wrench,
  Flag,
  User,
  Users,
  Scale,
  Repeat,
  Layers,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from "lucide-react";
import { TRANSLATIONS } from "./i18n";
import {
  loadStaticFeedData,
  filterAndGroupArticles,
  toggleFavoriteLocal,
  toggleReadLocal,
  markReadLocal,
  translateArticleClientSide,
  extractArticleClientSide,
  getLocalSettings,
  saveLocalSettings,
  getDisabledSources,
  setSourceEnabledLocal,
  clearLocalBrowserCache,
} from "./api";

const CATEGORIES = [
  { key: "All News", icon: Layers },
  { key: "Latest News", icon: Flame },
  { key: "Technical News", icon: Wrench },
  { key: "Race Weekend", icon: Flag },
  { key: "Driver News", icon: User },
  { key: "Team News", icon: Users },
  { key: "FIA & Regulations", icon: Scale },
  { key: "Transfers & Rumors", icon: Repeat },
  { key: "Saved Articles", icon: Bookmark },
];

const QUICK_TAGS = [
  "Ferrari",
  "Mercedes",
  "Red Bull",
  "McLaren",
  "Verstappen",
  "Hamilton",
  "Leclerc",
  "Norris",
  "Antonelli",
  "Aero",
  "FIA",
];

export default function App() {
  const initialSettings = getLocalSettings();
  const [uiLang, setUiLang] = useState(initialSettings.ui_language || "fa");
  const [theme, setTheme] = useState(initialSettings.theme || "dark");
  const [settings, setSettings] = useState(initialSettings);
  const t = TRANSLATIONS[uiLang] || TRANSLATIONS.fa;

  const [rawArticles, setRawArticles] = useState([]);
  const [sources, setSources] = useState([]);
  const [disabledSources, setDisabledSources] = useState(getDisabledSources());
  const [stateTick, setStateTick] = useState(0);

  // Filters
  const [activeCategory, setActiveCategory] = useState("All News");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState("all");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [sortOrder, setSortOrder] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // UI state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [currentClock, setCurrentClock] = useState(new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerArticle, setReaderArticle] = useState(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [translatingIds, setTranslatingIds] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [expandedClusters, setExpandedClusters] = useState({});

  useEffect(() => {
    const html = document.documentElement;
    html.lang = uiLang;
    html.dir = uiLang === "fa" ? "rtl" : "ltr";
    if (theme === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
    saveLocalSettings({ ui_language: uiLang, theme });
  }, [uiLang, theme]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchFeed = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await loadStaticFeedData();
      setRawArticles(data.articles || []);
      setSources(data.sources || []);
      if (data.last_global_update) {
        setLastUpdate(data.last_global_update);
      }
    } catch (err) {
      console.error("Failed loading static feed.json:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    const poll = setInterval(fetchFeed, 60000); // Re-check feed.json every 60s
    return () => clearInterval(poll);
  }, [fetchFeed]);

  const articles = useMemo(
    () =>
      filterAndGroupArticles(rawArticles, {
        search: searchQuery,
        source_id: selectedSource,
        category: activeCategory,
        language: selectedLanguage,
        date_from: dateFrom,
        date_to: dateTo,
        sort_order: sortOrder,
      }),
    [
      rawArticles,
      searchQuery,
      selectedSource,
      activeCategory,
      selectedLanguage,
      dateFrom,
      dateTo,
      sortOrder,
      stateTick,
      disabledSources,
    ]
  );

  const handleToggleFavorite = (article) => {
    toggleFavoriteLocal(article);
    setStateTick((x) => x + 1);
  };

  const handleToggleRead = (article) => {
    toggleReadLocal(article.id);
    setStateTick((x) => x + 1);
  };

  const handleTranslatePersian = async (article) => {
    setTranslatingIds((prev) => ({ ...prev, [article.id]: true }));
    try {
      const res = await translateArticleClientSide(article);
      setStateTick((x) => x + 1);
      if (readerArticle && readerArticle.id === article.id) {
        setReaderArticle((prev) => ({ ...prev, ...res }));
      }
    } finally {
      setTranslatingIds((prev) => ({ ...prev, [article.id]: false }));
    }
  };

  const handleOpenReader = async (article) => {
    markReadLocal(article.id);
    setStateTick((x) => x + 1);
    setReaderArticle(article);
    setReaderLoading(true);
    try {
      const extracted = await extractArticleClientSide(article);
      if (extracted) {
        setReaderArticle((prev) => ({ ...prev, extracted_content: extracted }));
      }
    } finally {
      setReaderLoading(false);
    }
  };

  const handleCopyUrl = (article) => {
    navigator.clipboard.writeText(article.original_url);
    setCopiedId(article.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShare = async (article) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: article.original_title,
          url: article.original_url,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    handleCopyUrl(article);
  };

  const isArticleNew = (pubDateIso) => {
    try {
      const diffMs = Date.now() - new Date(pubDateIso).getTime();
      return diffMs >= 0 && diffMs < 2 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  };

  const formatDateTime = (isoStr) => {
    if (!isoStr) return "";
    try {
      const dt = new Date(isoStr);
      return dt.toLocaleString(uiLang === "fa" ? "fa-IR" : "en-GB", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoStr;
    }
  };

  const sourceMap = Object.fromEntries(sources.map((s) => [s.source_id, s]));

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-f1dark text-slate-900 dark:text-slate-100">
      <div className="h-1 w-full bg-gradient-to-r from-f1red via-red-500 to-amber-500" />

      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-f1card/95 backdrop-blur border-b border-slate-200 dark:border-f1border px-4 lg:px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-f1red flex items-center justify-center text-white font-display font-black text-xl tracking-tighter shadow-sm">
              F1
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-bold text-lg lg:text-xl tracking-tight">
                  {t.appName}
                </h1>
                <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded bg-f1red/15 text-f1red border border-f1red/30">
                  16 SOURCES
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.appSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
              <Clock className="w-3.5 h-3.5 text-f1red" />
              <span>
                {currentClock.toLocaleString(uiLang === "fa" ? "fa-IR" : "en-GB", {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500 dark:text-slate-400">{t.lastUpdate}</span>
              <span className="font-semibold">
                {lastUpdate ? formatDateTime(lastUpdate) : t.neverUpdated}
              </span>
            </div>

            <button
              onClick={fetchFeed}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-f1red hover:bg-red-700 disabled:opacity-60 text-white font-medium transition shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? t.refreshing : t.refreshNow}</span>
            </button>

            <button
              onClick={() => setUiLang((prev) => (prev === "fa" ? "en" : "fa"))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 font-semibold transition"
            >
              <Languages className="w-4 h-4 text-f1red" />
              <span>{uiLang === "fa" ? "EN" : "فارسی"}</span>
            </button>

            <button
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className="p-2 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 transition"
            >
              {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 font-medium transition"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">{t.settings}</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="max-w-[1600px] w-full mx-auto flex-1 flex flex-col lg:flex-row gap-5 p-4 lg:p-6">
        {/* SIDEBAR */}
        <aside className="w-full lg:w-64 shrink-0 space-y-4">
          <nav className="bg-white dark:bg-f1card rounded-xl border border-slate-200 dark:border-f1border p-2.5 space-y-1">
            {CATEGORIES.map(({ key, icon: Icon }) => {
              const active = activeCategory === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveCategory(key)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                    active
                      ? "bg-f1red text-white shadow-sm"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{t.categories[key] || key}</span>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* 16 Sources Sidebar Filter */}
          <div className="bg-white dark:bg-f1card rounded-xl border border-slate-200 dark:border-f1border p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t.allSources}
              </h3>
              {selectedSource !== "all" && (
                <button
                  onClick={() => setSelectedSource("all")}
                  className="text-[11px] text-f1red hover:underline"
                >
                  {t.clearFilters}
                </button>
              )}
            </div>
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
              {sources.map((src) => {
                const isSelected = selectedSource === src.source_id;
                const statusDot =
                  src.status === "Online" ? "bg-emerald-500" : "bg-red-500";
                return (
                  <button
                    key={src.source_id}
                    onClick={() =>
                      setSelectedSource(isSelected ? "all" : src.source_id)
                    }
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                      isSelected
                        ? "bg-f1red/15 text-f1red font-bold border border-f1red/40"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
                      <span className="truncate">{src.source_name}</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      {src.articles_count || 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* MAIN FEED */}
        <main className="flex-1 min-w-0 space-y-4">
          {/* FILTER BAR */}
          <section className="bg-white dark:bg-f1card rounded-xl border border-slate-200 dark:border-f1border p-3.5 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
              <div className="md:col-span-5 relative">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3 rtl:right-3 ltr:left-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full pr-9 pl-3 rtl:pr-9 ltr:pl-9 py-2 rounded-lg text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-f1red"
                />
              </div>

              <div className="md:col-span-3">
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                >
                  <option value="all">{t.allSources}</option>
                  {sources.map((s) => (
                    <option key={s.source_id} value={s.source_id}>
                      {s.source_name} ({s.language.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                >
                  <option value="all">{t.allLanguages}</option>
                  <option value="en">{t.langEn}</option>
                  <option value="it">{t.langIt}</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                >
                  <option value="desc">{t.newestFirst}</option>
                  <option value="asc">{t.oldestFirst}</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400 font-medium">{t.quickTopics}</span>
                {QUICK_TAGS.map((tag) => {
                  const active = searchQuery.toLowerCase() === tag.toLowerCase();
                  return (
                    <button
                      key={tag}
                      onClick={() => setSearchQuery(active ? "" : tag)}
                      className={`text-[11px] px-2 py-0.5 rounded-md font-medium transition ${
                        active
                          ? "bg-f1red text-white"
                          : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]"
                />
                <span>—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]"
                />
                {(searchQuery ||
                  selectedSource !== "all" ||
                  selectedLanguage !== "all" ||
                  dateFrom ||
                  dateTo ||
                  activeCategory !== "All News") && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedSource("all");
                      setSelectedLanguage("all");
                      setDateFrom("");
                      setDateTo("");
                      setActiveCategory("All News");
                    }}
                    className="text-[11px] text-f1red font-semibold hover:underline px-1.5"
                  >
                    {t.clearFilters}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* ARTICLES */}
          {articles.length === 0 ? (
            <div className="bg-white dark:bg-f1card rounded-xl border border-slate-200 dark:border-f1border p-12 text-center text-slate-400">
              {t.noArticlesFound}
            </div>
          ) : (
            <div className="space-y-3">
              {articles.map((article) => {
                const srcMeta = sourceMap[article.source_id] || {};
                const isNew = isArticleNew(article.publication_date);
                const related = article.related_sources || [];
                const clusterOpen = Boolean(expandedClusters[article.id]);

                return (
                  <article
                    key={article.id}
                    className={`bg-white dark:bg-f1card rounded-xl border transition shadow-sm hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 ${
                      article.is_read
                        ? "border-slate-200/70 dark:border-f1border/60 opacity-80"
                        : "border-slate-200 dark:border-f1border"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row gap-4">
                      {article.thumbnail_url && (
                        <div className="sm:w-44 sm:h-28 shrink-0 rounded-lg overflow-hidden bg-slate-900 relative">
                          <img
                            src={article.thumbnail_url}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              style={{ backgroundColor: srcMeta.accent_color || "#e10600" }}
                              className="px-2 py-0.5 rounded text-[10px] font-display font-black text-white tracking-wider"
                            >
                              {srcMeta.logo_text || "F1"}
                            </span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {article.source_name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {article.original_language}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              {t.categories[article.category] || article.category}
                            </span>
                            {isNew && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                                {t.newBadge}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                            {formatDateTime(article.publication_date)}
                          </span>
                        </div>

                        <h2 className="latin-text text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                          <a
                            href={article.original_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-f1red transition"
                          >
                            {article.original_title}
                          </a>
                        </h2>

                        {article.description && (
                          <p className="latin-text text-xs sm:text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
                            {article.description}
                          </p>
                        )}

                        {(article.translated_title || article.persian_summary) && (
                          <div
                            dir="rtl"
                            className="mt-2 p-3 rounded-lg bg-slate-100/90 dark:bg-slate-900/90 border-r-4 border-f1red space-y-1.5 text-right font-persian"
                          >
                            {article.translated_title && (
                              <div>
                                <span className="text-[10px] text-f1red font-bold block">
                                  {t.persianHeadlineLabel}
                                </span>
                                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                  {article.translated_title}
                                </p>
                              </div>
                            )}
                            {article.persian_summary && (
                              <div>
                                <span className="text-[10px] text-slate-400 font-semibold block">
                                  {t.persianSummaryLabel}
                                </span>
                                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                                  {article.persian_summary}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <a
                              href={article.original_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-f1red/10 hover:bg-f1red hover:text-white text-f1red font-semibold transition"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>{t.openOriginalBtn}</span>
                            </a>

                            <button
                              onClick={() => handleOpenReader(article)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium transition"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              <span>{t.readArticleBtn}</span>
                            </button>

                            <button
                              onClick={() => handleTranslatePersian(article)}
                              disabled={translatingIds[article.id]}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium transition"
                            >
                              <Languages className="w-3.5 h-3.5" />
                              <span>
                                {translatingIds[article.id] ? t.translating : t.translateBtn}
                              </span>
                            </button>

                            {related.length > 0 && (
                              <button
                                onClick={() =>
                                  setExpandedClusters((prev) => ({
                                    ...prev,
                                    [article.id]: !prev[article.id],
                                  }))
                                }
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-500 border border-blue-500/30 font-semibold"
                              >
                                <span>+{related.length}</span>
                                {clusterOpen ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleToggleFavorite(article)}
                              className={`p-1.5 rounded-md transition ${
                                article.is_favorite
                                  ? "text-amber-400 bg-amber-500/10"
                                  : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                              }`}
                              title={t.saveFavorite}
                            >
                              <Bookmark
                                className="w-4 h-4"
                                fill={article.is_favorite ? "currentColor" : "none"}
                              />
                            </button>

                            <button
                              onClick={() => handleToggleRead(article)}
                              className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                              title={article.is_read ? t.markUnread : t.markRead}
                            >
                              {article.is_read ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              onClick={() => handleCopyUrl(article)}
                              className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                              title={t.copyUrl}
                            >
                              {copiedId === article.id ? (
                                <Check className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              onClick={() => handleShare(article)}
                              className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                              title={t.share}
                            >
                              <Share2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {clusterOpen && related.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                            <span className="text-[11px] font-bold text-slate-400 block">
                              {t.alsoCoveredBy}
                            </span>
                            {related.map((rel) => (
                              <div
                                key={rel.id}
                                className="flex items-center justify-between gap-2 text-xs bg-slate-50 dark:bg-slate-900/60 px-2.5 py-1.5 rounded"
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <span className="font-bold text-f1red shrink-0">
                                    {rel.source_name}
                                  </span>
                                  <span className="uppercase text-[10px] px-1 rounded bg-slate-200 dark:bg-slate-800">
                                    {rel.original_language}
                                  </span>
                                  <a
                                    href={rel.original_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="latin-text truncate hover:underline"
                                  >
                                    {rel.original_title}
                                  </a>
                                </div>
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  {formatDateTime(rel.publication_date)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* READER MODAL */}
      {readerArticle && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-f1card border border-slate-200 dark:border-f1border rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-f1border">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-f1red">{readerArticle.source_name}</span>
                <span>•</span>
                <span>{formatDateTime(readerArticle.publication_date)}</span>
              </div>
              <button
                onClick={() => setReaderArticle(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <h2 className="latin-text text-xl font-bold text-slate-900 dark:text-white">
                {readerArticle.original_title}
              </h2>

              {readerArticle.translated_title && (
                <div
                  dir="rtl"
                  className="p-3.5 rounded-lg bg-slate-100 dark:bg-slate-900 border-r-4 border-f1red font-persian"
                >
                  <p className="font-bold text-base">{readerArticle.translated_title}</p>
                  {readerArticle.persian_summary && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                      {readerArticle.persian_summary}
                    </p>
                  )}
                </div>
              )}

              {readerLoading ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  {t.extractingContent}
                </div>
              ) : readerArticle.extracted_content ? (
                <div className="latin-text prose dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-line text-slate-700 dark:text-slate-200">
                  {readerArticle.extracted_content}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="latin-text text-sm text-slate-700 dark:text-slate-300">
                    {readerArticle.description}
                  </p>
                  <p className="text-xs text-amber-500">{t.extractionFallbackNote}</p>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-f1border flex items-center justify-between">
              <button
                onClick={() => handleTranslatePersian(readerArticle)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-500 text-xs font-semibold"
              >
                <Languages className="w-4 h-4" />
                <span>{t.translateBtn}</span>
              </button>
              <a
                href={readerArticle.original_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-f1red text-white text-xs font-semibold"
              >
                <ExternalLink className="w-4 h-4" />
                <span>{t.openOriginalBtn}</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-f1card border border-slate-200 dark:border-f1border rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-f1border">
              <h2 className="font-bold text-base">{t.settingsModal.title}</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-xs sm:text-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block font-semibold mb-1.5">
                    {t.settingsModal.maxArticles}
                  </label>
                  <input
                    type="number"
                    min="30"
                    max="500"
                    value={settings.max_articles_displayed}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        max_articles_displayed: Number(e.target.value),
                      })
                    }
                    className="w-40 px-3 py-1.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>

                <button
                  onClick={() => {
                    clearLocalBrowserCache();
                    setStateTick((x) => x + 1);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25 font-medium"
                >
                  {t.settingsModal.clearLocalData}
                </button>
              </div>

              <div>
                <h3 className="font-bold mb-2.5">{t.settingsModal.sourcesHealthTitle}</h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-900">
                      <tr>
                        <th className="p-2.5 text-start">Source</th>
                        <th className="p-2.5 text-start">Status</th>
                        <th className="p-2.5 text-start">Method</th>
                        <th className="p-2.5 text-start">Articles</th>
                        <th className="p-2.5 text-center">Visible</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {sources.map((src) => {
                        const isEnabled = !disabledSources[src.source_id];
                        return (
                          <tr key={src.source_id}>
                            <td className="p-2.5 font-semibold">
                              {src.source_name}{" "}
                              <span className="text-[10px] text-slate-400 uppercase">
                                ({src.language})
                              </span>
                            </td>
                            <td className="p-2.5">
                              {src.status === "Online" ? (
                                <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {t.settingsModal.statusOnline}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-500 font-semibold">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {t.settingsModal.statusError}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-slate-400">{src.active_method}</td>
                            <td className="p-2.5 text-slate-400">{src.articles_count || 0}</td>
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={(e) => {
                                  const updated = setSourceEnabledLocal(
                                    src.source_id,
                                    e.target.checked
                                  );
                                  setDisabledSources({ ...updated });
                                }}
                                className="accent-f1red w-4 h-4 cursor-pointer"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 dark:border-f1border flex justify-end gap-2">
              <button
                onClick={() => {
                  saveLocalSettings(settings);
                  setStateTick((x) => x + 1);
                  setSettingsOpen(false);
                }}
                className="px-5 py-2 rounded-lg bg-f1red text-white text-xs font-bold"
              >
                {t.settingsModal.saveSettings}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}