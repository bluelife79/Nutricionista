"""judge_cache.py — TTL+LRU cache for judge verdicts.

Key shape: f"{db_version}:{origin_id}:{candidates_hash}"
where candidates_hash = sha256(",".join(sorted(candidate_ids)))[:16].

db_version is the MD5 of database.json computed at microservice startup.
Restart the microservice when database.json changes — cache invalidates
atomically (different prefix → all old entries become unreachable and
expire on TTL or LRU eviction).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from cachetools import TTLCache


def compute_db_version(db_path: Path) -> str:
    """MD5 of database.json bytes (16-char hex). Used as cache namespace prefix.

    Returns "no-db" if the file does not exist (safe default — cache still
    works, just with a fixed namespace).
    """
    if not db_path.exists():
        return "no-db"
    return hashlib.md5(db_path.read_bytes()).hexdigest()[:16]


def make_cache_key(origin_id: str, candidate_ids_sorted: list[str]) -> str:
    """Build the lookup key WITHOUT the db_version prefix.

    The db_version prefix is injected by JudgeCache._ns() so that every key
    in the cache is automatically namespaced to the current database snapshot.

    Parameters
    ----------
    origin_id: str — the origin food id
    candidate_ids_sorted: list[str] — candidate ids already sorted by caller
    """
    cand_hash = hashlib.sha256(
        ",".join(candidate_ids_sorted).encode()
    ).hexdigest()[:16]
    return f"{origin_id}:{cand_hash}"


class JudgeCache:
    """In-memory TTL+LRU cache wrapping cachetools.TTLCache.

    All keys are automatically namespaced with db_version so that restarting
    the microservice after a database.json change invalidates the old entries
    (they may linger until TTL but will never be hit — different namespace).

    Parameters
    ----------
    db_version: str — hex prefix from compute_db_version(); binds this cache
                      instance to a specific database snapshot.
    max_size: int   — maximum number of entries before LRU eviction (default 1000)
    ttl_s: int      — entry lifetime in seconds (default 86400 = 24h)
    """

    def __init__(self, db_version: str, max_size: int = 1000, ttl_s: int = 86400):
        self.db_version = db_version
        self._cache: TTLCache = TTLCache(maxsize=max_size, ttl=ttl_s)
        self._hits = 0
        self._misses = 0

    def _ns(self, key: str) -> str:
        """Prepend db_version to the key (namespace isolation)."""
        return f"{self.db_version}:{key}"

    def get(self, key: str) -> tuple[list[str], list[str]] | None:
        """Return the cached verdict or None on miss/expiry."""
        try:
            value = self._cache[self._ns(key)]
            self._hits += 1
            return value
        except KeyError:
            self._misses += 1
            return None

    def set(self, key: str, value: tuple[list[str], list[str]]) -> None:
        """Store a verdict. value = (ranked_ids, removed_ids)."""
        self._cache[self._ns(key)] = value

    def stats(self) -> dict:
        """Return hit/miss/size counters for observability."""
        total = self._hits + self._misses
        return {
            "hits": self._hits,
            "misses": self._misses,
            "total_lookups": total,
            "hit_rate": self._hits / total if total else 0.0,
            "total_entries": len(self._cache),
            "max_entries": self._cache.maxsize,
            "ttl_s": self._cache.ttl,
            "db_version": self.db_version,
        }


# ---------------------------------------------------------------------------
# Standalone smoke test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    from pathlib import Path

    db_path = Path(__file__).parent.parent / "database.json"
    version = compute_db_version(db_path)
    print(f"db_version (first 8 chars): {version[:8]}")

    c = JudgeCache(db_version=version, max_size=10, ttl_s=60)
    key = make_cache_key("bedca_papa_cruda", sorted(["bedca_batata", "bedca_yuca"]))
    assert c.get(key) is None, "expected miss on empty cache"

    c.set(key, (["bedca_batata", "bedca_yuca"], []))
    result = c.get(key)
    assert result == (["bedca_batata", "bedca_yuca"], []), f"unexpected: {result}"

    print(f"stats: {c.stats()}")
    print("[OK] judge_cache.py smoke test passed")
