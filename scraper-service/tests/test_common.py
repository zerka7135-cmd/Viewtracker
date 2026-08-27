"""Tests du parsing central (scraping/common.py), au coeur de tout calcul de
vues (Instagram + YouTube) — un changement de format non couvert ici (ex.
virgule vs point décimal selon la langue de la page) casserait silencieusement
tous les totaux en production. Lancer avec : `pytest` depuis scraper-service/.
"""

import time

import pytest

from scraping.common import (
    extract_id_from_href,
    parse_count,
    run_with_hard_timeout,
)


class TestParseCount:
    def test_plain_number_with_comma_as_thousands_separator(self):
        # Sans suffixe K/M, la virgule est un séparateur de milliers.
        assert parse_count("2,479") == 2479

    def test_plain_number_without_separator(self):
        assert parse_count("847") == 847

    def test_k_suffix(self):
        assert parse_count("277K") == 277_000

    def test_k_suffix_lowercase(self):
        assert parse_count("15k") == 15_000

    def test_m_suffix(self):
        assert parse_count("3M") == 3_000_000

    def test_m_suffix_with_comma_as_decimal_separator(self):
        # Avec suffixe K/M, la virgule sert cette fois de séparateur
        # décimal ("1,2M" = 1.2 million, pas 12 millions).
        assert parse_count("1,2M") == 1_200_000

    def test_k_suffix_with_dot_as_decimal_separator(self):
        assert parse_count("1.5K") == 1_500

    def test_empty_string_returns_zero(self):
        assert parse_count("") == 0

    def test_none_returns_zero(self):
        assert parse_count(None) == 0

    def test_garbage_returns_zero(self):
        assert parse_count("abonnés") == 0

    def test_whitespace_is_trimmed(self):
        assert parse_count("  1.2K  ") == 1_200


class TestExtractIdFromHref:
    REEL_PATTERN = r"/reel/([^/?]+)"
    SHORTS_PATTERN = r"/shorts/([^/?]+)"

    def test_extracts_reel_id(self):
        assert extract_id_from_href("/reel/Cx7aBcD3fGh/", self.REEL_PATTERN) == "Cx7aBcD3fGh"

    def test_extracts_shorts_id(self):
        assert extract_id_from_href("/shorts/abc123XYZ", self.SHORTS_PATTERN) == "abc123XYZ"

    def test_strips_query_string(self):
        assert extract_id_from_href("/reel/Cx7aBcD3fGh/?igsh=xyz", self.REEL_PATTERN) == "Cx7aBcD3fGh"

    def test_none_href_returns_none(self):
        assert extract_id_from_href(None, self.REEL_PATTERN) is None

    def test_empty_href_returns_none(self):
        assert extract_id_from_href("", self.REEL_PATTERN) is None

    def test_non_matching_href_returns_none(self):
        assert extract_id_from_href("/p/somepost/", self.REEL_PATTERN) is None


class TestRunWithHardTimeout:
    def test_returns_result_when_fast_enough(self):
        assert run_with_hard_timeout(lambda: 42, timeout_s=1) == 42

    def test_raises_timeout_error_when_too_slow(self):
        with pytest.raises(TimeoutError):
            run_with_hard_timeout(lambda: time.sleep(1), timeout_s=0.05)

    def test_propagates_exception_from_fn(self):
        def boom():
            raise ValueError("échec attendu")

        with pytest.raises(ValueError):
            run_with_hard_timeout(boom, timeout_s=1)
