import re

from scrapling.fetchers import StealthyFetcher

from .common import detect_blocked_page, extract_id_from_href, parse_count, run_with_hard_timeout

SHORTS_ITEM_SELECTOR = "ytm-shorts-lockup-view-model"
SHORTS_LINK_SELECTOR = 'a[href*="/shorts/"]'
SHORTS_ID_PATTERN = r"/shorts/([^/?]+)"
VIEWS_TEXT_PATTERN = re.compile(r"([\d.,]+)\s*([kKmM]?)\s*(?:vues|views)", re.I)

# YouTube ne demande pas de session, donc pas de "cookie expiré" possible
# ici — mais une chaîne inexistante/supprimée ou un mur de consentement non
# géré par CONSENT_COOKIES redirige/affiche une page très différente d'une
# vraie page Shorts, avec le même risque de confusion avec un DOM cassé.
BLOCKED_URL_MARKERS = ["/consent.youtube.com", "/accounts.google.com"]
BLOCKED_TEXT_MARKERS = [
    "This channel does not exist",
    "Cette chaîne n'existe pas",
    "Avant de continuer sur YouTube",
    "Before you continue to YouTube",
]

# Mêmes cookies de consentement que l'ancien scraping Node
# (src/instagram.js) : évitent le bandeau cookies qui masque le contenu.
CONSENT_COOKIES = [
    {"name": "SOCS", "value": "CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzEaAmZyIAEaBgiAo_CmBg", "domain": ".youtube.com", "path": "/"},
    {"name": "CONSENT", "value": "YES+cb.20210328-17-p0.fr+FX+678", "domain": ".youtube.com", "path": "/"},
]

StealthyFetcher.configure(adaptive=True, adaptive_domain="youtube.com")


def _parse_views(text: str) -> int:
    match = VIEWS_TEXT_PATTERN.search(text or "")
    if not match:
        return 0
    return parse_count(f"{match.group(1)}{match.group(2)}")


def scrape_youtube(url: str, posts_limit: int) -> dict:
    clean_url = url.rstrip("/")

    try:
        page = run_with_hard_timeout(lambda: StealthyFetcher.fetch(
            f"{clean_url}/shorts",
            headless=True,
            cookies=CONSENT_COOKIES,
            network_idle=True,
        ))
    except Exception as e:
        return {"total": 0, "posts": [], "error": f"Échec du fetch YouTube (StealthyFetcher) : {e}"}

    blocked = detect_blocked_page(page, BLOCKED_URL_MARKERS, BLOCKED_TEXT_MARKERS)
    if blocked:
        return {
            "total": 0,
            "posts": [],
            "error": f"Chaîne YouTube inaccessible pour {clean_url} (mur de consentement ou chaîne "
                     f"introuvable) plutôt qu'un vrai échec de sélecteurs. Détail : {blocked}",
        }

    total = 0
    counted = []
    fallback_level = 0

    # 1. Grille des shorts, sélecteur "adaptatif" — voir instagram.py pour
    # le même mécanisme et la raison d'être (relocalisation automatique si
    # YouTube change son DOM).
    for item in page.css(SHORTS_ITEM_SELECTOR, adaptive=True, auto_save=True):
        val = _parse_views(item.text)
        if val <= 0:
            continue
        link = item.css_first(SHORTS_LINK_SELECTOR)
        href = link.attrib.get("href") if link else None
        counted.append({"href": href, "val": val})
        total += val
        if len(counted) == posts_limit:
            break

    # 2. Fallback : ancienne structure générique par span, sans lien fiable
    # vers la vidéo (pas d'ID, comme dans l'ancien code Node).
    if not counted:
        fallback_level = 2
        for span in page.css("span"):
            text = (span.text or "").strip()
            if not re.search(r"vue|views", text, re.I):
                continue
            val = _parse_views(text)
            if val > 0:
                counted.append({"href": None, "val": val})
                total += val
                if len(counted) == posts_limit:
                    break

    posts = [
        {"id": extract_id_from_href(c["href"], SHORTS_ID_PATTERN), "views": c["val"]}
        for c in counted
        if extract_id_from_href(c["href"], SHORTS_ID_PATTERN)
    ]

    warning = None
    if fallback_level > 0 and total > 0:
        warning = f"Sélecteur principal des shorts sans résultat, repli niveau {fallback_level} utilisé"

    return {"total": total, "posts": posts, "error": None, "fallbackLevel": fallback_level, "warning": warning}
