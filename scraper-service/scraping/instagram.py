import re

from scrapling.fetchers import StealthyFetcher

from .common import extract_id_from_href, page_text, parse_count

PINNED_ICON_SELECTOR = 'svg[aria-label="Pinned post icon"]'
REEL_LINK_SELECTOR = 'a[href*="/reel/"]'
REEL_ID_PATTERN = r"/reel/([^/?]+)"
COUNT_TEXT_PATTERN = re.compile(r"^[\d.,]+[kKmM]?$")
GLOBAL_TEXT_PATTERN = re.compile(r"([\d.,]+[kKmM]?)\s*(?:vues|views|plays)")

# "adaptive_domain" isole les sélecteurs appris pour instagram.com des
# autres domaines suivis par ce service (voir scraping/youtube.py) : si IG
# change son DOM, Scrapling relocalise les éléments par similarité plutôt
# que de renvoyer une page vide (adresse le problème documenté dans
# l'ancien src/instagram.js Node : "sélecteurs devenus obsolètes").
StealthyFetcher.configure(adaptive=True, adaptive_domain="instagram.com")


def _find_pinned_hrefs(page) -> set:
    """Reproduit la logique de l'ancien scraping Node (bug du 5 août 2026,
    voir git history de src/instagram.js) : associe chaque badge "Pinned"
    au plus petit ancêtre contenant EXACTEMENT un lien de reel, pour éviter
    de marquer à tort ses voisins de grille comme épinglés."""
    pinned = set()
    for icon in page.css(PINNED_ICON_SELECTOR):
        el = icon.parent
        depth = 0
        while el is not None and depth < 12:
            links = el.css(REEL_LINK_SELECTOR)
            if len(links) == 1:
                href = links[0].attrib.get("href")
                if href:
                    pinned.add(href)
                break
            if len(links) > 1:
                break
            el = el.parent
            depth += 1
    return pinned


def scrape_instagram(url: str, posts_limit: int, cookies: list) -> dict:
    clean_url = url.rstrip("/")

    try:
        page = StealthyFetcher.fetch(
            f"{clean_url}/reels/",
            headless=True,
            cookies=cookies or None,
            network_idle=True,
            wait_selector=REEL_LINK_SELECTOR,
            wait_selector_state="attached",
        )
    except Exception as e:
        return {"total": 0, "posts": [], "error": f"Échec du fetch Instagram (StealthyFetcher) : {e}"}

    total = 0
    counted = []
    pinned_hrefs = _find_pinned_hrefs(page)

    # 1. Grille des reels : chaque vignette est un lien dont le texte est le
    # nombre de vues (ex. "277K"). Sélecteur "adaptatif" (voir configure()
    # ci-dessus) : relocalisé automatiquement si la structure change.
    for link in page.css(REEL_LINK_SELECTOR, adaptive=True, auto_save=True):
        href = link.attrib.get("href")
        if href in pinned_hrefs:
            continue
        text = (link.text or "").strip()
        if COUNT_TEXT_PATTERN.match(text):
            val = parse_count(text)
            total += val
            counted.append({"href": href, "val": val})
            if len(counted) == posts_limit:
                break

    # 2. Fallback : ancien format JSON GraphQL embarqué avec play_count.
    if total == 0:
        for script in page.css('script[type="application/json"]'):
            content = script.text or ""
            if "play_count" not in content:
                continue
            for match in re.finditer(r'"play_count":\s*(\d+)', content):
                val = int(match.group(1))
                if val > 0:
                    total += val
                    counted.append({"href": None, "val": val})
                    if len(counted) == posts_limit:
                        break
            if len(counted) == posts_limit:
                break

    # 3. Fallback : recherche textuelle globale ("277K vues" / "277K views").
    # Aucun href fiable dans ce cas, donc pas d'ID exploitable pour le suivi
    # par vidéo (comportement identique à l'ancien code Node).
    if total == 0:
        for raw in GLOBAL_TEXT_PATTERN.findall(page_text(page))[:posts_limit]:
            val = parse_count(raw)
            total += val
            counted.append({"href": None, "val": val})

    posts = [
        {"id": extract_id_from_href(c["href"], REEL_ID_PATTERN), "views": c["val"]}
        for c in counted
        if extract_id_from_href(c["href"], REEL_ID_PATTERN)
    ]

    return {"total": total, "posts": posts, "error": None}
