import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher
from typing import Dict, Any, List
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

from deep_translator import GoogleTranslator

from config import (
    FEED_JSON_PATH,
    SOURCES_CONFIG,
    MAX_STORED_ARTICLES,
    MAX_NEW_TRANSLATIONS_PER_RUN,
)
from adapters import get_all_adapters

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("f1_hub.static_collector")

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "mc_cid", "mc_eid", "_ga", "ref", "source"
}

STOPWORDS = {
    "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or", "with", "after",
    "as", "by", "from", "is", "are", "was", "were", "il", "lo", "la", "i", "gli", "le",
    "di", "da", "con", "su", "per", "tra", "fra", "un", "una", "del", "della", "f1", "formula", "gp"
}


def normalize_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url.strip())
    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    path = re.sub(r"/+$", "", parsed.path) or "/"
    q_params = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() not in TRACKING_PARAMS]
    q_params.sort()
    return urlunparse(("https", netloc, path, "", urlencode(q_params), ""))


def title_tokens(title: str) -> set:
    clean = re.sub(r"[^\w\s]", " ", title.lower())
    return {t for t in clean.split() if len(t) > 2 and t not in STOPWORDS}


def find_cluster_id(title: str, pub_date_iso: str, existing_articles: List[Dict[str, Any]]) -> str:
    try:
        dt = datetime.fromisoformat(pub_date_iso.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)

    t_tokens = title_tokens(title)
    if not t_tokens:
        return hashlib.sha1(f"{title}-{pub_date_iso}".encode("utf-8")).hexdigest()[:16]

    best_cluster = None
    best_score = 0.0

    for art in existing_articles[:250]:
        try:
            cand_dt = datetime.fromisoformat(art["publication_date"].replace("Z", "+00:00"))
            if abs((dt - cand_dt).total_seconds()) > 36 * 3600:
                continue
        except Exception:
            pass

        c_tokens = title_tokens(art["original_title"])
        if not c_tokens:
            continue

        inter = len(t_tokens & c_tokens)
        union = len(t_tokens | c_tokens)
        jaccard = inter / union if union else 0.0
        seq = SequenceMatcher(None, title.lower(), art["original_title"].lower()).ratio()
        score = (jaccard * 0.65) + (seq * 0.35)

        if score > best_score and (score >= 0.44 or inter >= 4):
            best_score = score
            best_cluster = art.get("cluster_id")

    if best_cluster:
        return best_cluster
    return hashlib.sha1(f"{title.lower().strip()}-{pub_date_iso[:10]}".encode("utf-8")).hexdigest()[:16]


def load_existing_feed() -> Dict[str, Any]:
    if FEED_JSON_PATH.exists():
        try:
            return json.loads(FEED_JSON_PATH.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning(f"Could not parse existing feed.json: {exc}")
    return {"last_global_update": None, "sources": [], "articles": []}


def translate_to_persian_safe(text: str, source_lang: str) -> str:
    if not text:
        return ""
    try:
        lang = source_lang if source_lang in ("en", "it") else "auto"
        return GoogleTranslator(source=lang, target="fa").translate(text[:480]) or ""
    except Exception:
        return ""


async def main():
    existing_data = load_existing_feed()
    existing_articles: List[Dict[str, Any]] = existing_data.get("articles", [])
    existing_by_norm_url = {a["normalized_url"]: a for a in existing_articles if "normalized_url" in a}
    existing_title_keys = {
        f"{a['source_id']}::{a['original_title'].strip().lower()}" for a in existing_articles
    }

    adapters = get_all_adapters()
    sem = asyncio.Semaphore(5)

    async def run_adapter(adapter):
        async with sem:
            try:
                items, method = await adapter.collect()
                return adapter, items, method, None
            except Exception as exc:
                return adapter, [], "Error", str(exc)

    results = await asyncio.gather(*(run_adapter(a) for a in adapters))

    now_iso = datetime.now(timezone.utc).isoformat()
    new_articles: List[Dict[str, Any]] = []
    sources_status: List[Dict[str, Any]] = []
    translations_done = 0

    for adapter, items, method, err in results:
        cfg = adapter.cfg
        added_for_source = 0

        for item in items:
            norm_url = normalize_url(item["original_url"])
            title_key = f"{item['source_id']}::{item['original_title'].strip().lower()}"
            if not norm_url or norm_url in existing_by_norm_url or title_key in existing_title_keys:
                continue

            article_id = hashlib.sha256(norm_url.encode("utf-8")).hexdigest()[:20]
            cluster_id = find_cluster_id(
                item["original_title"],
                item["publication_date"],
                new_articles + existing_articles,
            )

            translated_title = None
            if translations_done < MAX_NEW_TRANSLATIONS_PER_RUN:
                translated_title = await asyncio.to_thread(
                    translate_to_persian_safe,
                    item["original_title"],
                    item["original_language"],
                )
                if translated_title:
                    translations_done += 1

            record = {
                "id": article_id,
                "original_title": item["original_title"],
                "translated_title": translated_title,
                "original_url": item["original_url"],
                "normalized_url": norm_url,
                "source_id": item["source_id"],
                "source_name": item["source_name"],
                "publication_date": item["publication_date"],
                "collection_date": item["collection_date"],
                "thumbnail_url": item.get("thumbnail_url"),
                "description": item.get("description", ""),
                "original_language": item["original_language"],
                "category": item["category"],
                "persian_summary": None,
                "cluster_id": cluster_id,
            }
            new_articles.append(record)
            existing_by_norm_url[norm_url] = record
            existing_title_keys.add(title_key)
            added_for_source += 1

        all_Merged_Temp = new_articles + existing_articles
        total_for_source = sum(1 for a in all_Merged_Temp if a["source_id"] == cfg["id"])

        sources_status.append(
            {
                "source_id": cfg["id"],
                "source_name": cfg["name"],
                "url": cfg["url"],
                "language": cfg["language"],
                "logo_text": cfg["logo_text"],
                "accent_color": cfg["accent_color"],
                "enabled": True,
                "status": "Online" if items else "Error",
                "active_method": method,
                "last_checked": now_iso,
                "last_success": now_iso if items else None,
                "last_error": err if not items else None,
                "articles_count": total_for_source,
            }
        )
        logger.info(f"[{cfg['name']}] Status={'Online' if items else 'Error'} ({method}) | +{added_for_source} new")

    combined_articles = new_articles + existing_articles
    combined_articles.sort(key=lambda x: x.get("publication_date", ""), reverse=True)
    combined_articles = combined_articles[:MAX_STORED_ARTICLES]

    # Recompute exact per-source counts after trimming
    for s in sources_status:
        s["articles_count"] = sum(1 for a in combined_articles if a["source_id"] == s["source_id"])

    output_payload = {
        "last_global_update": now_iso,
        "total_articles": len(combined_articles),
        "sources": sources_status,
        "articles": combined_articles,
    }

    FEED_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    FEED_JSON_PATH.write_text(
        json.dumps(output_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(f"Saved {len(combined_articles)} articles (+{len(new_articles)} new) to {FEED_JSON_PATH}")


if __name__ == "__main__":
    asyncio.run(main())