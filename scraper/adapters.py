import logging
import re
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urljoin

import httpx
import feedparser
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

from classifier import classify_article, is_f1_relevant
from config import SOURCES_CONFIG, REQUEST_TIMEOUT

logger = logging.getLogger("f1_hub.adapters")

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36 F1NewsHub/2.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,it-IT,it;q=0.8",
}


class SourceAdapter:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.source_id = cfg["id"]
        self.source_name = cfg["name"]
        self.base_url = cfg["url"]
        self.language = cfg["language"]
        self.default_category = cfg.get("default_category", "Latest News")
        self.rss_urls = cfg.get("rss_urls", [])
        self.sitemap_urls = cfg.get("sitemap_urls", [])

    def parse_datetime(self, raw_date: Any) -> str:
        if not raw_date:
            return datetime.now(timezone.utc).isoformat()
        try:
            dt = date_parser.parse(str(raw_date))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            now = datetime.now(timezone.utc)
            return (now if dt > now else dt).isoformat()
        except Exception:
            return datetime.now(timezone.utc).isoformat()

    def clean_html(self, raw_html: str) -> str:
        if not raw_html:
            return ""
        soup = BeautifulSoup(raw_html, "html.parser")
        text = soup.get_text(separator=" ", strip=True)
        return re.sub(r"\s+", " ", text).strip()[:650]

    def extract_thumbnail(self, entry: Any) -> Optional[str]:
        if hasattr(entry, "media_content") and entry.media_content:
            for m in entry.media_content:
                if m.get("url"):
                    return m["url"]
        if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
            for m in entry.media_thumbnail:
                if m.get("url"):
                    return m["url"]
        if hasattr(entry, "links"):
            for link in entry.links:
                if link.get("type", "").startswith("image/") and link.get("href"):
                    return link["href"]
        html_blob = ""
        if hasattr(entry, "content") and entry.content:
            html_blob = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            html_blob = entry.summary
        if html_blob:
            soup = BeautifulSoup(html_blob, "html.parser")
            img = soup.find("img")
            if img and img.get("src") and img["src"].startswith("http"):
                return img["src"]
        return None

    def is_entry_valid(self, title: str, description: str, url: str) -> bool:
        if self.source_id in ("autoracer", "fia_official", "formulapassion", "skysport_f1_it"):
            return is_f1_relevant(title, description, url) or "/f1/" in url.lower() or "/formula-1/" in url.lower()
        return True

    async def fetch_rss(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for rss_url in self.rss_urls:
            try:
                resp = await client.get(rss_url, timeout=REQUEST_TIMEOUT)
                if resp.status_code != 200 or not resp.text.strip():
                    continue
                feed = feedparser.parse(resp.text)
                if not feed.entries:
                    continue
                now_iso = datetime.now(timezone.utc).isoformat()
                for entry in feed.entries[:30]:
                    title = getattr(entry, "title", "").strip()
                    link = getattr(entry, "link", "").strip()
                    if not title or not link:
                        continue
                    raw_desc = getattr(entry, "summary", "") or getattr(entry, "description", "")
                    desc = self.clean_html(raw_desc)
                    if not self.is_entry_valid(title, desc, link):
                        continue
                    pub_raw = (
                        getattr(entry, "published", None)
                        or getattr(entry, "updated", None)
                        or getattr(entry, "pubDate", None)
                    )
                    items.append(
                        {
                            "original_title": title,
                            "original_url": link,
                            "source_id": self.source_id,
                            "source_name": self.source_name,
                            "publication_date": self.parse_datetime(pub_raw),
                            "collection_date": now_iso,
                            "thumbnail_url": self.extract_thumbnail(entry),
                            "description": desc,
                            "original_language": self.language,
                            "category": classify_article(title, desc, self.default_category),
                        }
                    )
                if items:
                    return items
            except Exception as exc:
                logger.debug(f"[{self.source_id}] RSS failed ({rss_url}): {exc}")
        return items

    async def fetch_sitemap(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for sm_url in self.sitemap_urls:
            try:
                resp = await client.get(sm_url, timeout=REQUEST_TIMEOUT)
                if resp.status_code != 200:
                    continue
                soup = BeautifulSoup(resp.text, "xml")
                now_iso = datetime.now(timezone.utc).isoformat()
                for u in soup.find_all("url")[:70]:
                    loc = u.find("loc")
                    if not loc or not loc.text:
                        continue
                    link = loc.text.strip()
                    t_tag = u.find("news:title") or u.find("title") or u.find("image:title")
                    title = t_tag.text.strip() if t_tag and t_tag.text else ""
                    if not title:
                        slug = link.rstrip("/").split("/")[-1]
                        title = re.sub(r"[-_]+", " ", slug).title()
                    if not self.is_entry_valid(title, "", link):
                        continue
                    pub_tag = u.find("news:publication_date") or u.find("lastmod")
                    img_tag = u.find("image:loc")
                    items.append(
                        {
                            "original_title": title,
                            "original_url": link,
                            "source_id": self.source_id,
                            "source_name": self.source_name,
                            "publication_date": self.parse_datetime(pub_tag.text.strip() if pub_tag else None),
                            "collection_date": now_iso,
                            "thumbnail_url": img_tag.text.strip() if img_tag and img_tag.text else None,
                            "description": "",
                            "original_language": self.language,
                            "category": classify_article(title, "", self.default_category),
                        }
                    )
                if items:
                    return items[:30]
            except Exception as exc:
                logger.debug(f"[{self.source_id}] Sitemap failed ({sm_url}): {exc}")
        return items

    async def fetch_html(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        target_url = self.base_url
        if self.source_id == "formula1_official":
            target_url = "https://www.formula1.com/en/latest"
        elif self.source_id == "fia_official":
            target_url = "https://www.fia.com/news/f1"

        try:
            resp = await client.get(target_url, timeout=REQUEST_TIMEOUT)
            if resp.status_code != 200:
                return []
            soup = BeautifulSoup(resp.text, "html.parser")
            items: List[Dict[str, Any]] = []
            seen = set()
            now_iso = datetime.now(timezone.utc).isoformat()

            for card in soup.select("article, .post, .td-module-container, .ms-item, .c-card, a[href*='/latest/article/'], a[href*='/formula-1/']"):
                a_tag = card if card.name == "a" else card.find("a", href=True)
                if not a_tag or not a_tag.get("href"):
                    continue
                href = urljoin(target_url, a_tag["href"].strip())
                if href in seen or href.rstrip("/") == target_url.rstrip("/"):
                    continue
                h_tag = card.find(["h1", "h2", "h3", "h4"]) if card.name != "a" else None
                title = h_tag.get_text(" ", strip=True) if h_tag else a_tag.get_text(" ", strip=True)
                if not title or len(title) < 18:
                    continue
                if not self.is_entry_valid(title, "", href):
                    continue
                seen.add(href)
                img = card.find("img") if card.name != "a" else None
                thumb = (img.get("data-src") or img.get("src")) if img else None
                if thumb and not thumb.startswith("http"):
                    thumb = urljoin(target_url, thumb)
                items.append(
                    {
                        "original_title": title,
                        "original_url": href,
                        "source_id": self.source_id,
                        "source_name": self.source_name,
                        "publication_date": now_iso,
                        "collection_date": now_iso,
                        "thumbnail_url": thumb,
                        "description": "",
                        "original_language": self.language,
                        "category": classify_article(title, "", self.default_category),
                    }
                )
                if len(items) >= 25:
                    break
            return items
        except Exception as exc:
            logger.debug(f"[{self.source_id}] HTML fallback failed: {exc}")
            return []

    async def collect(self) -> Tuple[List[Dict[str, Any]], str]:
        async with httpx.AsyncClient(headers=DEFAULT_HEADERS, follow_redirects=True) as client:
            if self.rss_urls:
                res = await self.fetch_rss(client)
                if res:
                    return res, "RSS/Atom Feed"
            if self.sitemap_urls:
                res = await self.fetch_sitemap(client)
                if res:
                    return res, "XML News Sitemap"
            res = await self.fetch_html(client)
            if res:
                return res, "HTML DOM Parser"
        return [], "Unavailable"


def get_all_adapters() -> List[SourceAdapter]:
    return [SourceAdapter(cfg) for cfg in SOURCES_CONFIG]