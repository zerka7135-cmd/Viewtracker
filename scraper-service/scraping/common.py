import re

# Portage exact de src/instagram.js#parseCount (bot Node) : sans suffixe K/M,
# la virgule est un séparateur de milliers ("2,479" = 2479), pas un séparateur
# décimal. Avec un suffixe K/M, elle sert de séparateur décimal ("1,2M" = 1.2M).
def parse_count(raw: str) -> int:
    val = (raw or "").strip()
    mult = 1

    if re.search(r"k", val, re.I):
        mult = 1_000
        val = re.sub(r"k", "", val, flags=re.I)
    if re.search(r"m", val, re.I):
        mult = 1_000_000
        val = re.sub(r"m", "", val, flags=re.I)

    val = val.replace(",", "") if mult == 1 else val.replace(",", ".")

    try:
        return round(float(val) * mult)
    except ValueError:
        return 0


# Portage de src/instagram.js#extractIdFromHref : extrait l'identifiant
# unique d'une vidéo depuis son URL, pour le suivi de croissance par vidéo
# côté bot Node (voir history.js#computeGrowth24h). `None` si l'URL n'a pas
# le format attendu.
def extract_id_from_href(href, pattern: str):
    if not href:
        return None
    match = re.search(pattern, href)
    return match.group(1) if match else None


def page_text(page) -> str:
    """Texte brut de la page entière, utilisé uniquement par les fallbacks
    de dernier recours (recherche textuelle globale) quand les sélecteurs
    structurés ne trouvent rien."""
    for attr in ("get_all_text", "text"):
        value = getattr(page, attr, None)
        if callable(value):
            try:
                result = value()
                if result:
                    return result
            except Exception:
                continue
        elif value:
            return value
    try:
        return " ".join(t for t in page.css("*::text"))
    except Exception:
        return ""
