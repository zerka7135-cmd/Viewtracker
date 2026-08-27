from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

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


# Le timeout côté client Node (scraperClient.js, 45s) ne protège que la
# requête HTTP vers ce service : si StealthyFetcher lui-même reste bloqué
# (navigateur qui ne répond plus), le process Python continue de tourner
# indéfiniment en tâche de fond après que Node a déjà abandonné, consommant
# un slot navigateur pour rien jusqu'au prochain restart. Un timeout dur ici
# garantit qu'un fetch qui pend est bien tué côté service, pas seulement
# abandonné côté appelant.
_FETCH_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scrapling-fetch")
FETCH_TIMEOUT_S = 40


def run_with_hard_timeout(fn, timeout_s: float = FETCH_TIMEOUT_S):
    """Exécute `fn()` (bloquant) avec un timeout dur, indépendant de tout
    paramètre de timeout supporté (ou non) par la lib appelée elle-même.
    Lève TimeoutError si `fn` n'a pas terminé dans le délai imparti — le
    thread sous-jacent continue en arrière-plan (Python ne peut pas tuer un
    thread de force) mais n'empêche plus la requête HTTP de répondre."""
    future = _FETCH_EXECUTOR.submit(fn)
    try:
        return future.result(timeout=timeout_s)
    except FutureTimeoutError:
        raise TimeoutError(f"Dépassement du délai de {timeout_s}s")


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


def detect_blocked_page(page, url_markers: list, text_markers: list) -> str | None:
    """Repère une page de login/challenge/blocage plutôt qu'un vrai profil,
    pour ne pas confondre "session invalide" avec "sélecteurs obsolètes" —
    ces deux cas remontaient jusqu'ici le même total=0 générique, ce qui
    fait chercher au mauvais endroit (régénérer les cookies n'a rien à voir
    avec corriger un sélecteur CSS). Retourne un message d'erreur explicite
    si une de ces pages est détectée, `None` sinon (page normale).
    `url_markers` : sous-chaînes attendues dans l'URL finale (après
    redirection) d'une page de blocage, ex. "/accounts/login".
    `text_markers` : phrases attendues dans le texte de la page pour ce cas.
    """
    final_url = getattr(page, "url", "") or ""
    if any(marker in final_url for marker in url_markers):
        return f"Redirigé vers une page de blocage/connexion ({final_url})"

    text = page_text(page)
    for marker in text_markers:
        if marker.lower() in text.lower():
            return f"Page de blocage/connexion détectée (texte : \"{marker}\")"

    return None
