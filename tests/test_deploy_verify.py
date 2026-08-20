"""§12.1 verification: the served tree, not the three fields a tamper preserves.

Every fixture here is an origin built out of an ``httpx.MockTransport`` behind a
real ``httpx.Client`` — real redirect policy, real content decoding, no socket
(``tests/conftest.py`` blocks those, and a test that reached one would fail
loudly rather than report ``unavailable``: ``verify._fetch`` re-raises
``AssertionError`` for exactly that reason).

The tests are organised by the defect each one exists to catch:

* **R19** — a footer replaced wholesale while the page-level JSON blob still
  carries the right ``build_id``. ``build_id in document`` passes on that page;
  reading the named ``<meta>`` does not.
* **R15** — a deployment whose ``build_id``, ``code_sha`` and ``stats.json`` are
  all correct and whose HTML/JS/CSS/JSON files are not. One file at a time, so
  the exact reported path is the assertion.
* **R16** — the three closure-narrowing provider checks, each control path
  poisoned on its own so one probe cannot mask another.
* **R17** — an outage is not an accusation.
* **TD-10** — the sweep cannot see *additions*. That is asserted as **not
  detected**, so the limit stays pinned instead of drifting into a claim.
* **The served-URL mapping** — Cloudflare Pages 307s HTML away from its literal
  path, so a verbatim sweep of this dashboard (8,170 of 12,543 files are
  `<route>/index.html`) reported a divergence per page and never reached the
  marker check at all. The fixture origin therefore *is* a Pages origin: it
  serves at the mapped URL and answers the literal HTML path with the
  provider's own 307. Both halves are pinned — the mapping, and the fact that
  the mapping bought nothing: a 3xx on the *mapped* URL is still a divergence.
"""

from __future__ import annotations

import ast
import gzip
import hashlib
import importlib.util  # `.util` explicitly: plain `importlib` does not bind it
import json
import re
from pathlib import Path

import httpx
import pytest

from populus.deploy import verify as verify_module
from populus.deploy.verify import (
    CACHE_BUST_PARAM,
    ALLOWED_RESPONSE_HEADERS,
    CONTROL_PATHS,
    LOCKED_CONTENT_SECURITY_POLICY,
    MARKER_BUILD_ID,
    MARKER_CODE_SHA,
    VERIFICATION_SCOPE,
    VerificationResult,
    VerifyInputError,
    check_markers,
    check_stats,
    read_markers,
    served_path,
    verify_deployment,
)
from populus.publish import attestation
from populus.publish.inventory import build_inventory

REPO_ROOT = Path(__file__).resolve().parents[1]
RECORDED_DEPLOYMENTS = REPO_ROOT / "tests" / "fixtures" / "deploy" / "cf_deployments.json"

BUILD_ID = "20260805.1"
CODE_SHA = "4f1a8c2e6b3d4a7f9e0c5b2d8a6f1c34a9e7d013"
SHORT_SHA = CODE_SHA[:7]

# Two origins, one routine: the preview deployment (R9) and the live custom
# domain (R11). Nothing in verify.py knows which is which.
PREVIEW_URL = "https://6d2f8b41.publicfilings.pages.dev"
DOMAIN_URL = "https://publicfilings.org"

STATS_JSON = (
    json.dumps(
        {
            "stats_version": "3",
            "build_id": BUILD_ID,
            "site_file_count": 6,
            "counts": {"filings": 41230, "transactions": 118442},
        },
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    + "\n"
).encode()


def _page(*, markers: bool = True, blob: bool = True, extra: str = "") -> bytes:
    """A page shaped like the real one: markers in ``<head>``, blob in ``<body>``.

    The blob is what makes the tampered-footer fixture a trap rather than a
    formality — the correct ``build_id`` is still in the bytes.
    """
    head = '<meta charset="utf-8">'
    if markers:
        head += (
            f'<meta name="{MARKER_BUILD_ID}" content="{BUILD_ID}">'
            f'<meta name="{MARKER_CODE_SHA}" content="{CODE_SHA}">'
        )
    body = ""
    if blob:
        payload = json.dumps({"build_id": BUILD_ID, "generated": "2026-08-05T04:00:00Z"})
        body += f'<script type="application/json" id="page-data">{payload}</script>'
    body += f"<footer>build {BUILD_ID} &middot; code {CODE_SHA}</footer>{extra}"
    return f"<!doctype html><html><head>{head}</head><body>{body}</body></html>".encode()


def _site() -> dict[str, bytes]:
    return {
        "index.html": _page(),
        "congress/index.html": _page(extra="<h1>Congress</h1>"),
        "assets/app.js": b"export const buildId = '20260805.1';\nconsole.log(buildId);\n",
        "assets/site.css": b":root{--populus-ink:#101418}\n",
        "congress/data/feed.v1.json": b'{"rows":[],"page":1}\n',
        "stats.json": STATS_JSON,
    }


def recorded_deployment() -> dict:
    """The production deployment object from the recorded Cloudflare response.

    R16 pins the provider checks to a *recorded* shape rather than a shape we
    imagined; ``uses_functions`` only exists on the deployment object, which is
    why the check reads it there.
    """
    payload = json.loads(RECORDED_DEPLOYMENTS.read_text(encoding="utf-8"))
    return payload["result"][0]


class _Origin:
    """A Cloudflare Pages origin: byte map at the *served* URL, 404 otherwise.

    Its tables are keyed by **inventory** path (``congress/index.html``) — the
    coordinates the build and the envelope speak — and it answers at the path
    Pages actually serves them from (``/congress/``), because that is what the
    real provider does and a fixture that served HTML at its literal path would
    make every test here a statement about a server that does not exist.

    The literal HTML path is answered with the provider's own **307**, carrying
    the documented ``location`` (``/contact.html`` → ``/contact``,
    ``/about/index.html`` → ``/about/``, ``/index.html`` → ``/``) — verified by
    probe against a live Pages origin, cache-busting query string and all. So a
    verifier that forgot to map gets exactly the 3xx production would hand it.

    ``overrides`` replaces the response for one path (poisoning a control path,
    injecting a redirect, adding a header); ``raiser`` makes the transport fail
    the way a broken network does.
    """

    def __init__(
        self,
        served: dict[str, bytes],
        *,
        overrides: dict[str, httpx.Response] | None = None,
        extra_headers: dict[str, dict[str, str]] | None = None,
        raiser: Exception | None = None,
        catch_all: bytes | None = None,
        content_security_policy: str | None = LOCKED_CONTENT_SECURITY_POLICY,
    ) -> None:
        self.served = dict(served)
        self.overrides = dict(overrides or {})
        self.extra_headers = dict(extra_headers or {})
        # A real Pages deployment applies the `/*` rule in `_headers` to every
        # served asset, so the faithful default is "present on every 200".
        # `None` models a deployment that lost the policy; a different string
        # models one whose policy was altered.
        self.content_security_policy = content_security_policy
        self.raiser = raiser
        self.catch_all = catch_all
        self.seen: list[str] = []

    @staticmethod
    def _by_served(table: dict) -> dict:
        """Re-key an inventory-path table by the URL path Pages answers on.

        Rebuilt per request rather than cached: several tests add a path after
        construction, and a cached map would quietly serve the stale tree.
        """
        return {served_path(key): value for key, value in table.items()}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(str(request.url))
        if self.raiser is not None:
            raise self.raiser
        path = request.url.path.lstrip("/")
        overrides = self._by_served(self.overrides)
        if path in overrides:
            return overrides[path]
        served = self._by_served(self.served)
        if path in served:
            headers = dict(self._by_served(self.extra_headers).get(path, {}))
            if self.content_security_policy is not None:
                headers.setdefault(
                    "content-security-policy", self.content_security_policy
                )
            return httpx.Response(200, content=served[path], headers=headers)
        if served_path(path) != path:
            # The provider quirk, reproduced: an HTML path is never served at
            # its literal URL. Query string preserved, exactly as probing a
            # live Pages origin showed (`?populus-verify=…` does not suppress
            # the hop; it is carried onto the target).
            target = f"/{served_path(path)}"
            if request.url.query:
                target += f"?{request.url.query.decode()}"
            return httpx.Response(307, headers={"location": target})
        if self.catch_all is not None:
            return httpx.Response(200, content=self.catch_all)
        return httpx.Response(404, content=b"<!doctype html><title>404</title>")

    def client(self) -> "_RecordingClient":
        return _RecordingClient(httpx.Client(transport=httpx.MockTransport(self.handler)))


class _RecordingClient:
    """A real ``httpx.Client`` plus a record of the kwargs verify.py passed.

    A MockTransport cannot observe ``follow_redirects`` (the client resolves it
    before the transport is reached), so the flag is pinned here.
    """

    def __init__(self, client: httpx.Client) -> None:
        self._client = client
        self.calls: list[tuple[str, bool]] = []

    def get(self, url, *, headers, follow_redirects):
        self.calls.append((url, follow_redirects))
        return self._client.get(url, headers=headers, follow_redirects=follow_redirects)


def _inventory(tmp_path: Path, site: dict[str, bytes], name: str = "site") -> dict:
    """The real §12.1 envelope, built by the real builder over a real tree."""
    root = tmp_path / name
    for path, body in site.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    return build_inventory(root)


def _run(
    origin: _Origin,
    inventory: dict,
    *,
    base_url: str = PREVIEW_URL,
    stats_bytes: bytes = STATS_JSON,
    deployment: dict | None = None,
    client=None,
    **kwargs,
) -> VerificationResult:
    return verify_deployment(
        client if client is not None else origin.client(),
        base_url,
        inventory=inventory,
        build_id=BUILD_ID,
        code_sha=CODE_SHA,
        stats_bytes=stats_bytes,
        deployment=recorded_deployment() if deployment is None else deployment,
        **kwargs,
    )


# --- baseline ----------------------------------------------------------------


def test_clean_deployment_verifies(tmp_path):
    site = _site()
    result = _run(_Origin(site), _inventory(tmp_path, site))

    assert result.ok is True
    assert result.outcome == attestation.VERIFIED
    assert result.findings == ()
    assert result.diverged_paths == ()
    assert result.files_verified == result.files_total == len(site)
    assert result.verification_scope == "expected_paths"
    # The honest limit travels with the claim, not only in a document.
    assert "TD-10" in result.detail or "closure" in result.detail


def test_the_same_routine_verifies_the_custom_domain(tmp_path):
    """R11: preview and production differ by base_url and nothing else."""
    site = _site()
    origin = _Origin(site)
    result = _run(origin, _inventory(tmp_path, site), base_url=DOMAIN_URL)

    assert result.ok is True
    assert origin.seen, "no path was fetched"
    assert all(url.startswith(DOMAIN_URL + "/") for url in origin.seen)
    # No host is baked into the module.
    source = (REPO_ROOT / "src" / "populus" / "deploy" / "verify.py").read_text()
    assert "publicfilings" not in source and "pages.dev" not in source


def test_a_plain_client_is_an_acceptable_getter(tmp_path):
    """The injected object is an ordinary client, not a bespoke wrapper."""
    site = _site()
    origin = _Origin(site)
    client = httpx.Client(transport=httpx.MockTransport(origin.handler))
    assert _run(origin, _inventory(tmp_path, site), client=client).ok is True


def test_body_is_hashed_after_content_decoding(tmp_path):
    """The inventory records decoded bytes; a gzipped asset must still match.

    It also proves the *wire* length is not what gets compared: the response's
    ``content-length`` here is the compressed size, which disagrees with the
    inventory on every compressible file.
    """
    site = _site()
    inventory = _inventory(tmp_path, site)
    compressed = gzip.compress(site["assets/app.js"])
    assert len(compressed) != len(site["assets/app.js"])
    origin = _Origin(
        site,
        overrides={
            "assets/app.js": httpx.Response(
                200,
                content=compressed,
                headers={
                    "content-encoding": "gzip",
                    # An `overrides` response is returned verbatim, so this
                    # legitimately-served asset must carry the policy a real
                    # `/*` rule would have put on it.
                    "content-security-policy": LOCKED_CONTENT_SECURITY_POLICY,
                },
            )
        },
    )
    assert _run(origin, inventory).ok is True


# --- R19: markers are read by name and compared exactly ----------------------


def test_markers_are_read_from_the_named_meta_only():
    document = (
        '<meta content="wrong" name="other:build_id">'
        f"<meta   name='{MARKER_BUILD_ID}'   content='{BUILD_ID}'  />"
        f'<meta name="{MARKER_CODE_SHA}" content="{CODE_SHA}" data-x="1">'
        f"<p>{BUILD_ID}</p>"
    )
    markers = read_markers(document)
    assert markers[MARKER_BUILD_ID] == [BUILD_ID]
    assert markers[MARKER_CODE_SHA] == [CODE_SHA]
    assert check_markers(document, build_id=BUILD_ID, code_sha=CODE_SHA) == []


def test_tampered_footer_with_a_correct_blob_fails(tmp_path):
    """R19: the whole footer (and both markers) replaced, blob left correct."""
    site = _site()
    payload = json.dumps({"build_id": BUILD_ID, "generated": "2026-08-05T04:00:00Z"})
    tampered = (
        '<!doctype html><html><head><meta charset="utf-8"></head><body>'
        f'<script type="application/json" id="page-data">{payload}</script>'
        "<footer>build unknown &middot; code unknown</footer>"
        "</body></html>"
    ).encode()
    # The trap: a containment check passes on these exact bytes.
    assert BUILD_ID.encode() in tampered
    assert CODE_SHA.encode() not in tampered

    site["index.html"] = tampered
    result = _run(_Origin(site), _inventory(tmp_path, site))

    assert result.ok is False
    assert result.outcome == attestation.REJECTED
    joined = " ".join(result.findings)
    assert MARKER_BUILD_ID in joined and "absent" in joined
    assert MARKER_CODE_SHA in joined


@pytest.mark.parametrize(
    ("served_sha", "expected_sha", "label"),
    [
        (CODE_SHA, SHORT_SHA, "served-full-expected-short"),
        (SHORT_SHA, CODE_SHA, "served-short-expected-full"),
    ],
)
def test_code_sha_is_compared_exactly_never_by_containment(
    served_sha, expected_sha, label
):
    """Both directions: containment would pass one of them, equality neither."""
    document = (
        f'<meta name="{MARKER_BUILD_ID}" content="{BUILD_ID}">'
        f'<meta name="{MARKER_CODE_SHA}" content="{served_sha}">'
    )
    assert served_sha in document and expected_sha in f"{served_sha}{expected_sha}"
    findings = check_markers(document, build_id=BUILD_ID, code_sha=expected_sha)
    assert len(findings) == 1, label
    assert MARKER_CODE_SHA in findings[0] and "mismatch" in findings[0]


def test_a_duplicated_marker_is_refused():
    document = (
        f'<meta name="{MARKER_BUILD_ID}" content="{BUILD_ID}">'
        f'<meta name="{MARKER_BUILD_ID}" content="20260101.9">'
        f'<meta name="{MARKER_CODE_SHA}" content="{CODE_SHA}">'
    )
    findings = check_markers(document, build_id=BUILD_ID, code_sha=CODE_SHA)
    assert len(findings) == 1
    assert "appears 2 times" in findings[0]


# --- R15: the inventory-wide sweep -------------------------------------------


@pytest.mark.parametrize(
    ("path", "tampered"),
    [
        ("congress/index.html", _page(extra="<script>fetch('//evil.invalid')</script>")),
        ("assets/app.js", b"export const buildId = '20260805.1';\nsteal();\n"),
        # Same length as the original: a length-only comparison passes this one.
        ("assets/site.css", b":root{--populus-ink:#ff0000}\n"),
        ("congress/data/feed.v1.json", b'{"rows":[1],"page":1}'),
    ],
    ids=["html", "js", "css-same-length", "json"],
)
def test_marker_preserving_tamper_is_caught_one_file_at_a_time(tmp_path, path, tampered):
    """R15: markers and stats.json still correct; exactly one other file altered."""
    site = _site()
    inventory = _inventory(tmp_path, site)
    original = site[path]
    site[path] = tampered
    assert tampered != original

    result = _run(_Origin(site), inventory)

    assert result.ok is False
    assert result.outcome == attestation.REJECTED
    # The exact path, and only that path.
    assert result.diverged_paths == (path,)
    assert len(result.findings) == 1
    assert path in result.findings[0]
    assert result.files_verified == result.files_total - 1
    # Markers and stats.json were untouched and are individually fine — this is
    # the whole point of the fixture (R9/TD-4).
    assert check_markers(site["index.html"], build_id=BUILD_ID, code_sha=CODE_SHA) == []
    assert check_stats(site["stats.json"], STATS_JSON) == []


def test_same_length_tamper_is_named_by_hash(tmp_path):
    """The css case above, stated as the property it pins: hash is compared."""
    site = _site()
    inventory = _inventory(tmp_path, site)
    site["assets/site.css"] = b":root{--populus-ink:#ff0000}\n"
    assert len(site["assets/site.css"]) == len(_site()["assets/site.css"])

    result = _run(_Origin(site), inventory)
    assert result.diverged_paths == ("assets/site.css",)
    assert "sha256" in result.findings[0]


def test_recorded_length_is_compared_as_well_as_the_hash(tmp_path):
    """A served body whose hash matches but whose length contradicts the entry."""
    site = _site()
    inventory = _inventory(tmp_path, site)
    for entry in inventory["files"]:
        if entry["path"] == "assets/app.js":
            entry["bytes"] = entry["bytes"] + 1

    result = _run(_Origin(site), inventory)

    assert result.ok is False
    assert result.diverged_paths == ("assets/app.js",)
    assert "length" in result.findings[0]
    assert "sha256" not in result.findings[0]


def test_every_diverged_path_is_named(tmp_path):
    """Two altered files: both reported, not a count and not the first one."""
    site = _site()
    inventory = _inventory(tmp_path, site)
    site["assets/app.js"] = b"pwned();\n"
    site["congress/data/feed.v1.json"] = b'{"rows":["pwned"]}'

    result = _run(_Origin(site), inventory)

    assert result.diverged_paths == ("assets/app.js", "congress/data/feed.v1.json")
    assert result.files_verified == result.files_total - 2


def test_a_missing_inventoried_path_is_rejected_not_unavailable(tmp_path):
    site = _site()
    inventory = _inventory(tmp_path, site)
    del site["assets/site.css"]

    result = _run(_Origin(site), inventory)

    assert result.outcome == attestation.REJECTED
    assert result.unavailable is False
    assert result.diverged_paths == ("assets/site.css",)
    assert "HTTP 404" in result.findings[0]


def test_preview_sweep_catches_what_markers_and_stats_alone_would_miss(tmp_path):
    """R9: the fixture that makes TD-4's bound non-vacuous.

    Markers pass. ``stats.json`` passes byte-for-byte. A marker-only preview
    check would green-light this deployment and production would then be
    'the identical bytes that already passed the preview sweep'.
    """
    site = _site()
    inventory = _inventory(tmp_path, site)
    site["congress/index.html"] = _page(extra="<p>injected</p>")

    marker_only_verdict = check_markers(
        site["index.html"], build_id=BUILD_ID, code_sha=CODE_SHA
    )
    assert marker_only_verdict == []
    assert check_stats(site["stats.json"], STATS_JSON) == []

    result = _run(_Origin(site), inventory)
    assert result.ok is False
    assert result.diverged_paths == ("congress/index.html",)


# --- R3: stats.json byte-for-byte --------------------------------------------


def test_served_stats_must_be_byte_equal_not_json_equal(tmp_path):
    """Same JSON, different bytes — and the inventory agrees with the served copy.

    Built this way on purpose: if the inventory disagreed too, the sweep would
    catch it and this test would prove nothing about the R3 check.
    """
    reserialized = json.dumps(json.loads(STATS_JSON)).encode()
    assert json.loads(reserialized) == json.loads(STATS_JSON)
    assert reserialized != STATS_JSON

    site = _site()
    site["stats.json"] = reserialized
    inventory = _inventory(tmp_path, site)  # built over the re-serialized copy

    result = _run(_Origin(site), inventory, stats_bytes=STATS_JSON)

    assert result.ok is False
    assert result.diverged_paths == ()  # the sweep is satisfied; R3 is not
    assert len(result.findings) == 1
    assert "byte-equal" in result.findings[0]


# --- inventory path → served URL (the Pages directory format) ----------------
#
# The dashboard builds with Astro's `format: "directory"`, so 8,170 of its
# 12,543 files are HTML that Cloudflare Pages refuses to serve at its literal
# path — it 307s to the directory/extension-less form. Fetching verbatim
# produced 8,170 divergences on a *healthy* deployment and, because only a 200
# populates `bodies`, meant `check_markers` never ran at all. These pin the
# mapping and, just as importantly, pin that the mapping did not buy the pass
# by weakening anything.


@pytest.mark.parametrize(
    ("inventory_path", "expected"),
    [
        ("congress/index.html", "congress/"),
        ("congress/members/P000197/index.html", "congress/members/P000197/"),
        ("index.html", ""),
        ("404.html", "404"),
        ("assets/app.js", "assets/app.js"),
        ("assets/styles.css", "assets/styles.css"),
        ("stats.json", "stats.json"),
        ("favicon.svg", "favicon.svg"),
        ("congress/data/feed.v1.json", "congress/data/feed.v1.json"),
    ],
    ids=[
        "directory-index",
        "nested-directory-index",
        "root-index",
        "bare-html",
        "js",
        "css",
        "json",
        "svg",
        "data-shard",
    ],
)
def test_an_inventory_path_maps_to_the_url_the_provider_serves(inventory_path, expected):
    """The documented rewrite, one case per row.

    `/about/index.html` → `/about/` keeps its trailing slash and `/contact.html`
    → `/contact` loses its extension, both per Cloudflare's own wording; every
    non-HTML asset is left alone, because Pages serves those verbatim.
    """
    assert served_path(inventory_path) == expected


def test_every_inventoried_path_is_fetched_at_its_served_url(tmp_path):
    """End to end: the exact URL set, not just the mapping function.

    A `.html` anywhere in a requested URL would mean the sweep is asking for a
    path this provider answers with a 307.
    """
    site = _site()
    origin = _Origin(site)
    client = origin.client()
    result = _run(origin, _inventory(tmp_path, site), client=client, cache_bust="deadbeef")

    assert result.ok is True
    requested = {url.split("?")[0] for url, _follow in client.calls}
    assert requested == {
        f"{PREVIEW_URL}/",  # index.html, served at the site root
        f"{PREVIEW_URL}/congress/",  # congress/index.html
        f"{PREVIEW_URL}/assets/app.js",
        f"{PREVIEW_URL}/assets/site.css",
        f"{PREVIEW_URL}/congress/data/feed.v1.json",
        f"{PREVIEW_URL}/stats.json",
        f"{PREVIEW_URL}/_redirects",
        f"{PREVIEW_URL}/_headers",
        f"{PREVIEW_URL}/_worker.js",
        f"{PREVIEW_URL}/populus-never-published-deadbeef",
    }
    assert not any("index.html" in url for url, _follow in client.calls)
    # The site root still gets the cache-buster, and gets it as a query.
    assert f"{PREVIEW_URL}/?populus-verify=deadbeef" in {url for url, _f in client.calls}


def test_the_fixture_origin_reproduces_the_provider_307(tmp_path):
    """Guards the guard: the fixture must not drift into serving HTML literally.

    If this origin ever answers 200 at `/index.html`, every test above stops
    being evidence about Cloudflare Pages — the mapping could be deleted and
    nothing would notice.
    """
    site = _site()
    origin = _Origin(site)
    client = httpx.Client(transport=httpx.MockTransport(origin.handler))

    for literal, location in (
        ("/index.html", "/"),
        ("/congress/index.html", "/congress/"),
    ):
        response = client.get(
            f"{PREVIEW_URL}{literal}?populus-verify=deadbeef", follow_redirects=False
        )
        assert response.status_code == 307, literal
        # The query string does not suppress the hop; it rides along.
        assert response.headers["location"] == f"{location}?populus-verify=deadbeef"


def test_a_site_of_only_directory_style_pages_verifies_clean(tmp_path):
    """The shape the dashboard actually ships: every page is `<route>/index.html`."""
    site = {
        "index.html": _page(),
        "congress/index.html": _page(extra="<h1>Congress</h1>"),
        "congress/members/P000197/index.html": _page(extra="<h1>Member</h1>"),
        "institutional/index.html": _page(extra="<h1>13F</h1>"),
        "404.html": _page(extra="<h1>Not found</h1>"),
        "stats.json": STATS_JSON,
    }
    origin = _Origin(site)
    client = origin.client()
    result = _run(origin, _inventory(tmp_path, site), client=client)

    assert result.findings == ()
    assert result.ok is True
    assert result.diverged_paths == ()
    assert result.files_verified == result.files_total == len(site)
    # Five of six inventory entries are HTML — the case that used to emit a
    # divergence per page.
    assert sum(1 for path in site if path.endswith(".html")) == 5


def test_a_tamper_on_a_directory_style_page_is_still_caught(tmp_path):
    """The rewrite must not have bought the pass by loosening the comparison."""
    site = {
        "index.html": _page(),
        "congress/index.html": _page(extra="<h1>Congress</h1>"),
        "congress/members/P000197/index.html": _page(extra="<h1>Member</h1>"),
        "stats.json": STATS_JSON,
    }
    inventory = _inventory(tmp_path, site)
    site["congress/members/P000197/index.html"] = _page(
        extra="<h1>Member</h1><script>fetch('//evil.invalid')</script>"
    )

    result = _run(_Origin(site), inventory)

    assert result.ok is False
    assert result.outcome == attestation.REJECTED
    # Named in inventory coordinates, not in the URL the fetch used.
    assert result.diverged_paths == ("congress/members/P000197/index.html",)
    assert "sha256" in result.findings[0]


def test_a_redirect_on_the_mapped_url_is_still_a_divergence(tmp_path):
    """The no-follow property survives the rewrite — this is the whole bargain.

    The alternative fix (accept one 3xx whose ``location`` looks canonical and
    re-fetch) was rejected because it cannot tell the provider's own rewrite
    from an injected `_redirects` line aiming a page at its own directory. Here
    the hop is served on the *already-mapped* URL and its target holds the
    correct bytes: a follow-then-compare verifier passes this deployment.
    """
    site = _site()
    inventory = _inventory(tmp_path, site)
    origin = _Origin(
        site,
        overrides={
            "congress/index.html": httpx.Response(
                302, headers={"location": "/congress/hijacked/"}
            )
        },
    )
    origin.served["congress/hijacked/index.html"] = site["congress/index.html"]

    result = _run(origin, inventory)

    assert result.ok is False
    assert result.outcome == attestation.REJECTED
    assert result.diverged_paths == ("congress/index.html",)
    assert "302" in result.findings[0] and "hijacked" in result.findings[0]


def test_a_redirect_on_the_mapped_root_url_is_still_a_divergence(tmp_path):
    """Same property at the root, where the mapping is most aggressive."""
    site = _site()
    inventory = _inventory(tmp_path, site)
    origin = _Origin(
        site, overrides={"index.html": httpx.Response(301, headers={"location": "/home/"})}
    )

    result = _run(origin, inventory)

    assert result.ok is False
    assert "index.html" in result.diverged_paths
    assert any("301" in finding and "/home/" in finding for finding in result.findings)


def test_the_marker_page_body_is_captured_so_check_markers_actually_runs(tmp_path):
    """Before the mapping, `bodies` was empty and the marker check never ran.

    Only a 200 populates `bodies`, and the marker page's literal URL is a 307 —
    so `marker_body` was `None` and R19 was reported as "markers unreadable"
    rather than being evaluated. The fixture proves the check *ran*: the sweep
    is satisfied (the inventory is built over the served page), so the single
    finding can only have come from `check_markers` reading a real body.
    """
    site = _site()
    site["index.html"] = _page().replace(CODE_SHA.encode(), b"0" * 40)
    inventory = _inventory(tmp_path, site)

    result = _run(_Origin(site), inventory)

    assert result.ok is False
    assert result.diverged_paths == ()  # the sweep is content; R19 is not
    assert len(result.findings) == 1
    assert MARKER_CODE_SHA in result.findings[0]
    assert "mismatch" in result.findings[0]
    assert not any("unreadable" in finding for finding in result.findings)


def test_the_marker_and_stats_defaults_stay_inventory_paths(tmp_path):
    """`served_path` is applied at fetch time and nowhere else.

    `DEFAULT_MARKER_PATH` indexes the envelope, names the file inside the
    downloaded artifact (`populus.deploy.record` opens `site/index.html` by it)
    and keys `bodies`. Rewriting it to `""` would break all three while fixing
    nothing — the URL is already mapped where the URL is built.
    """
    assert verify_module.DEFAULT_MARKER_PATH == "index.html"
    assert verify_module.DEFAULT_STATS_PATH == "stats.json"

    site = _site()
    sweep = verify_module.sweep_inventory(
        _Origin(site).client(),
        PREVIEW_URL,
        _inventory(tmp_path, site),
        cache_bust="deadbeef",
        keep=(verify_module.DEFAULT_MARKER_PATH,),
    )
    assert sweep.divergences == ()
    assert set(sweep.bodies) == {"index.html"}  # keyed by inventory path
    body = sweep.bodies["index.html"]
    assert check_markers(body, build_id=BUILD_ID, code_sha=CODE_SHA) == []


def test_two_inventory_entries_served_from_one_url_are_refused(tmp_path):
    """The mapping is not injective, and a collision is an input problem.

    `about.html` and a bare `about` are two distinct files that Pages serves
    from one URL. Verifying one of them twice and the other never is not a
    verdict, so it raises rather than resolving into `ok` or `rejected`.
    """
    site = _site()
    inventory = _inventory(tmp_path, site)
    entry = dict(inventory["files"][0])
    entry["path"] = "about.html"
    inventory["files"].append(entry)
    inventory["files"].append({**entry, "path": "about"})

    with pytest.raises(VerifyInputError) as raised:
        _run(_Origin(site), inventory)
    assert "about.html" in str(raised.value) and "/about" in str(raised.value)


# --- redirects disabled ------------------------------------------------------


def test_a_redirect_on_an_inventoried_path_fails_even_when_the_target_is_correct(
    tmp_path,
):
    """An injected `_redirects` hijacking an inventoried path (R15/R16).

    The redirect target serves the *correct* bytes, which is the case a
    follow-then-compare verifier passes: the hop can be conditional (by agent,
    by geography), handing the verifier the good copy and everyone else the bad
    one. The 3xx itself is therefore the finding.
    """
    site = _site()
    inventory = _inventory(tmp_path, site)
    origin = _Origin(
        site,
        overrides={
            "assets/app.js": httpx.Response(
                302, headers={"location": "/assets/app.hijacked.js"}
            )
        },
    )
    origin.served["assets/app.hijacked.js"] = site["assets/app.js"]  # correct bytes

    result = _run(origin, inventory)

    assert result.ok is False
    assert result.diverged_paths == ("assets/app.js",)
    assert "302" in result.findings[0] and "app.hijacked.js" in result.findings[0]


def test_every_fetch_disables_redirects_and_busts_the_cache(tmp_path):
    site = _site()
    origin = _Origin(site)
    client = origin.client()
    result = _run(origin, _inventory(tmp_path, site), client=client)

    assert result.ok is True
    assert client.calls, "nothing was fetched"
    assert all(follow is False for _url, follow in client.calls)
    assert all("populus-verify=" in url for url, _follow in client.calls)
    # Every inventoried path, plus the control probes.
    assert len(client.calls) == len(site) + len(CONTROL_PATHS) + 1


# --- R16: the three closure-narrowing provider checks ------------------------


def test_the_recorded_fixture_carries_the_shape_the_check_reads():
    deployment = recorded_deployment()
    assert deployment["uses_functions"] is False
    assert deployment["environment"] == "production"
    assert deployment["url"].startswith("https://")


def test_a_functions_reporting_deployment_fails(tmp_path):
    site = _site()
    deployment = dict(recorded_deployment())
    deployment["uses_functions"] = True

    result = _run(_Origin(site), _inventory(tmp_path, site), deployment=deployment)

    assert result.ok is False
    assert result.outcome == attestation.REJECTED
    assert any("uses_functions" in finding for finding in result.findings)


def test_a_deployment_without_the_signal_fails_closed(tmp_path):
    site = _site()
    deployment = {k: v for k, v in recorded_deployment().items() if k != "uses_functions"}

    result = _run(_Origin(site), _inventory(tmp_path, site), deployment=deployment)

    assert result.ok is False
    assert any("fails closed" in finding for finding in result.findings)


@pytest.mark.parametrize("poisoned", list(CONTROL_PATHS))
def test_each_control_path_is_probed_separately(tmp_path, poisoned):
    """One at a time: a probe that stopped early would let the others hide."""
    site = _site()
    origin = _Origin(
        site,
        overrides={poisoned.lstrip("/"): httpx.Response(200, content=b"/* config */")},
    )

    result = _run(origin, _inventory(tmp_path, site))

    assert result.ok is False
    assert result.outcome == attestation.REJECTED
    named = [finding for finding in result.findings if poisoned in finding]
    assert len(named) == 1, result.findings
    assert "200" in named[0]
    # The other two answered correctly and must not be reported.
    for other in CONTROL_PATHS:
        if other != poisoned:
            assert not any(other in finding for finding in result.findings)


def test_a_catch_all_rewrite_is_caught_by_the_never_published_probe(tmp_path):
    """`/* /index.html 200` answers for a path that has never existed."""
    site = _site()
    origin = _Origin(site, catch_all=site["index.html"])

    result = _run(origin, _inventory(tmp_path, site))

    assert result.ok is False
    assert any("never-published" in finding for finding in result.findings)


def test_an_unexpected_response_header_fails(tmp_path):
    site = _site()
    origin = _Origin(site, extra_headers={"index.html": {"set-cookie": "session=1"}})

    result = _run(origin, _inventory(tmp_path, site))

    assert result.ok is False
    assert any("set-cookie" in finding for finding in result.findings)
    assert "set-cookie" not in ALLOWED_RESPONSE_HEADERS


def test_the_allowlist_excludes_the_headers_an_injection_would_add():
    # AMENDED against the first real deployment (run 9), reason recorded:
    # `access-control-allow-origin` was listed here as an injection signal, but
    # Cloudflare Pages sets it NATIVELY on every served asset — so its presence
    # says nothing about tampering, and its absence from the allowlist rejected
    # an entirely honest deployment (10 findings; production untouched). The
    # headers below remain real signals: a static site has no reason to set a
    # cookie or a redirect, and neither is provider boilerplate.
    for header in ("set-cookie", "location", "x-powered-by"):
        assert header not in ALLOWED_RESPONSE_HEADERS


def test_scope_is_expected_paths_and_full_is_not_a_scope_anywhere(tmp_path):
    site = _site()
    result = _run(_Origin(site), _inventory(tmp_path, site))

    assert VERIFICATION_SCOPE == "expected_paths"
    assert result.verification_scope == "expected_paths"
    assert result.as_record()["verification_scope"] == "expected_paths"
    assert "full" not in json.dumps(result.as_record())

    source = (REPO_ROOT / "src" / "populus" / "deploy" / "verify.py").read_text()
    literals = [
        node.value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    assert "full" not in literals


# --- R17: an outage is not an accusation -------------------------------------


def test_a_transport_error_is_unavailable(tmp_path):
    site = _site()
    origin = _Origin(site, raiser=httpx.ConnectError("no route to host"))

    result = _run(origin, _inventory(tmp_path, site))

    assert result.ok is False
    assert result.outcome == attestation.UNAVAILABLE
    assert result.unavailable is True
    assert result.diverged_paths == ()
    assert "unavailable" in result.detail
    assert "tamper" not in result.detail


@pytest.mark.parametrize("status", [403, 429, 500, 502, 503])
def test_a_rate_limit_or_origin_error_is_unavailable(tmp_path, status):
    site = _site()
    origin = _Origin(
        site, overrides={"assets/app.js": httpx.Response(status, content=b"nope")}
    )

    result = _run(origin, _inventory(tmp_path, site))

    assert result.outcome == attestation.UNAVAILABLE
    assert result.unavailable is True
    assert result.divergences == ()
    assert result.findings == ()


def test_an_outage_on_a_control_probe_is_also_unavailable(tmp_path):
    site = _site()
    origin = _Origin(
        site, overrides={"_headers": httpx.Response(503, content=b"unavailable")}
    )

    result = _run(origin, _inventory(tmp_path, site))

    assert result.outcome == attestation.UNAVAILABLE
    assert result.findings == ()


def test_the_outcome_vocabulary_is_attestations_own():
    """R17 mirrors the publish-side split rather than re-inventing it."""
    assert verify_module.REJECTED == attestation.REJECTED
    assert verify_module.UNAVAILABLE == attestation.UNAVAILABLE
    assert verify_module.VERIFIED == attestation.VERIFIED
    assert attestation.REJECTED != attestation.UNAVAILABLE


# --- TD-10: the documented non-detection -------------------------------------


def test_an_added_file_is_a_documented_non_detection(tmp_path):
    """TD-10, asserted as *not detected* so the limit cannot quietly become a claim.

    The sweep asks "is every expected path correct?", so a file nobody
    inventoried is invisible to it. This is the residual the three provider
    checks narrow and do not close; if this test ever starts failing because
    the sweep grew closure, TD-10 is what needs updating.
    """
    site = _site()
    inventory = _inventory(tmp_path, site)
    origin = _Origin(site)
    origin.served["assets/backdoor.js"] = b"exfiltrate();\n"

    result = _run(origin, inventory)

    assert result.ok is True  # NOT detected — the declared limit
    assert result.verification_scope == "expected_paths"
    assert "closure" in result.detail


# --- inputs, and the shape of the module -------------------------------------


@pytest.mark.parametrize(
    "mutate",
    [
        lambda inv: inv.update(files=[]),
        lambda inv: inv.update(dist_digest_version="99"),
        lambda inv: inv.update(files=[{"path": "a", "bytes": 1}]),
        lambda inv: inv.update(files=[{"path": "/a", "bytes": 1, "sha256": "0" * 64}]),
        lambda inv: inv.update(files=[{"path": "a", "bytes": -1, "sha256": "0" * 64}]),
        lambda inv: inv.update(files=[{"path": "a", "bytes": 1, "sha256": "short"}]),
    ],
    ids=["empty", "version", "no-sha", "absolute-path", "negative-bytes", "short-sha"],
)
def test_a_malformed_inventory_raises_rather_than_verifying(tmp_path, mutate):
    site = _site()
    inventory = _inventory(tmp_path, site)
    mutate(inventory)
    with pytest.raises(VerifyInputError):
        _run(_Origin(site), inventory)


def test_a_marker_page_outside_the_inventory_raises(tmp_path):
    site = _site()
    with pytest.raises(VerifyInputError):
        _run(_Origin(site), _inventory(tmp_path, site), marker_path="not-inventoried.html")


def test_the_module_opens_nothing_and_names_no_transport_library():
    """The client is injected; verify.py is verification logic over bytes.

    ``tests/test_dep_guard.py`` *permits* this module a transport import. The
    assertion here is that it does not take the permission — a constructed
    client is one whose redirect policy lives outside the code that depends on
    it, and redirects-disabled is the property a hijacked path is caught by. A
    later change that adds a default client should have to delete this test on
    purpose. Re-executing the module body under the autouse no-network guard
    proves import time performs no I/O.

    **Why this is not ``importlib.reload`` any more.** It was, and the reload
    was a live test-order bug. ``reload`` re-executes the body into the *same*
    module object, rebinding ``verify.VerifyUnavailable`` to a brand-new class
    while ``populus.deploy.record`` — imported earlier and never reloaded —
    still holds the original. ``record.py``'s ``except VerifyUnavailable`` then
    stopped catching what the reloaded ``_fetch`` raised, so
    ``pytest tests/test_deploy_verify.py tests/test_deploy_record.py`` failed
    while the reverse order passed; alphabetical default collection is the only
    reason CI ever read green. A teardown fixture cannot undo it — reloading
    again mints a *third* class rather than restoring the first — so the fix is
    to stop mutating the shared module at all: execute the body into a fresh
    throwaway namespace that ``sys.modules`` never sees. The property under test
    is unchanged. ``tests/test_deploy_record.py`` pins the class identity, so a
    reintroduced reload fails loudly instead of hiding in the collection order.
    """
    spec = importlib.util.find_spec("populus.deploy.verify")
    throwaway = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(throwaway)  # import-time I/O would trip the guard
    assert throwaway is not verify_module, "the shared module was mutated in place"

    primitives = re.compile(
        r"\b(httpx|requests|urllib|socket|http\.client|ftplib|smtplib"
        r"|subprocess|os\.system|aiohttp|asyncio\.open_connection)\b"
    )
    source = (REPO_ROOT / "src" / "populus" / "deploy" / "verify.py").read_text()
    offending = [
        f"{number}: {line.strip()}"
        for number, line in enumerate(source.splitlines(), start=1)
        if primitives.search(line)
    ]
    assert offending == []


def test_result_records_the_counts_it_actually_checked(tmp_path):
    site = _site()
    result = _run(_Origin(site), _inventory(tmp_path, site))
    record = result.as_record()

    assert record["files_verified"] == record["files_total"] == len(site)
    assert record["outcome"] == attestation.VERIFIED
    assert record["diverged_paths"] == []
    assert "TD-10" in record["non_detection"]
    assert hashlib.sha256(STATS_JSON).hexdigest()  # stats bytes are what we compared


def test_a_rejection_names_the_findings_not_just_the_count(tmp_path):
    """Run 9 rejected with "10 finding(s)" and nothing else.

    Diagnosing it meant re-running the sweep by hand against a preview that
    happened to still exist. A verifier that refuses without saying what it saw
    turns every failure into an investigation — and on the deploy path the
    evidence is gone as soon as the next deployment replaces it.
    """
    site = _site()
    inventory = _inventory(tmp_path, site)
    tampered = dict(site)
    tampered["assets/app.js"] = site["assets/app.js"] + b"// injected\n"
    result = _run(_Origin(tampered), inventory)

    assert result.ok is False
    assert "assets/app.js" in result.detail, (
        f"the diverged path is not named in the detail: {result.detail!r}"
    )


# --- R11c: the REAL serving probe, against the real provider fixture ---------
#
# Review round F4: every orchestration test injects a synthetic probe, so the
# production factory's URL mapping, cache behaviour, status handling and marker
# validation were untested — and F1, F2 and F3 all lived in exactly that gap.
# F1 was the severe one: requesting the literal `index.html` gets Pages' 307,
# which with redirects refused made the probe answer None for every deployment
# and turned R11c into a blanket pre-upload refusal. These tests use the same
# `_Origin` fixture as the rest of this file, which reproduces that 307.

MARKED_PAGE = (
    b'<!doctype html><meta name="populus:build_id" content="20260814.2">'
    b'<meta name="populus:code_sha" content="4fd2987857b24045dc9c82ae368343df35ea9a22">'
)


def _probe_against(origin: _Origin):
    from populus.deploy.orchestrator import serving_probe

    client = origin.client()
    return serving_probe(client), client


def test_the_probe_reads_the_marker_through_the_provider_rewrite() -> None:
    """F1: `index.html` is requested at the path Pages answers 200 on."""
    origin = _Origin({"index.html": MARKED_PAGE})
    probe, client = _probe_against(origin)

    assert probe("https://publicfilings.org") == (
        "4fd2987857b24045dc9c82ae368343df35ea9a22"
    )
    # The literal path would have been a 307; the request must not have used it.
    assert not any(url.endswith("index.html") for url, _ in client.calls), client.calls
    assert all(follow is False for _, follow in client.calls), "redirects stay refused"


def test_every_probe_request_carries_a_fresh_cache_bust() -> None:
    """F2: a fixed key is not a cache bust — two calls must differ."""
    origin = _Origin({"index.html": MARKED_PAGE})
    probe, client = _probe_against(origin)

    probe("https://publicfilings.org")
    probe("https://publicfilings.org")

    busts = [url.split(f"{CACHE_BUST_PARAM}=")[1] for url, _ in client.calls]
    assert len(busts) == 2 and busts[0] != busts[1], busts


@pytest.mark.parametrize(
    "page, why",
    [
        (
            b'<!doctype html><meta name="populus:code_sha" content="">',
            "F3: an empty marker is not a value",
        ),
        (
            b'<!doctype html><meta name="populus:code_sha" content="   ">',
            "F3: whitespace is not a value either",
        ),
        (
            b'<!doctype html><meta name="populus:code_sha" content="a">'
            b'<meta name="populus:code_sha" content="b">',
            "a duplicated marker is not one answer",
        ),
        (b"<!doctype html><title>no markers here</title>", "a missing marker"),
    ],
)
def test_the_probe_refuses_anything_but_one_real_marker(page: bytes, why: str) -> None:
    origin = _Origin({"index.html": page})
    probe, _ = _probe_against(origin)
    assert probe("https://publicfilings.org") is None, why


def test_the_probe_reports_none_on_a_non_200() -> None:
    """A 404 for the marker page is 'could not ask', not an answer."""
    origin = _Origin({})
    probe, _ = _probe_against(origin)
    assert probe("https://publicfilings.org") is None


def test_the_probe_reports_none_on_a_transport_failure() -> None:
    origin = _Origin({"index.html": MARKED_PAGE}, raiser=httpx.ConnectError("down"))
    probe, _ = _probe_against(origin)
    assert probe("https://publicfilings.org") is None


def test_the_probe_reraises_the_suite_no_network_guard() -> None:
    """An accidental real fetch must fail loudly, not launder into None.

    Same carve-out `_fetch` makes, for the same reason: `except Exception`
    swallowing the guard would hide a test that reached the network.
    """
    origin = _Origin({"index.html": MARKED_PAGE}, raiser=AssertionError("no network"))
    probe, _ = _probe_against(origin)
    with pytest.raises(AssertionError):
        probe("https://publicfilings.org")


# --- R36: the locked Content-Security-Policy ---------------------------------


def test_the_locked_constant_equals_the_shipped_headers_file() -> None:
    """The verifier's constant and `dashboard/public/_headers` are ONE value.

    The verifier cannot read the repo at deploy time, so the policy is spelled
    twice — here and in the shipped file. That is a drift surface, and this is
    the only thing standing on it: edit one without the other and the deploy
    would demand a policy the site does not serve.
    """
    shipped = (REPO_ROOT / "dashboard" / "public" / "_headers").read_text()
    match = re.search(r"^\s+Content-Security-Policy:\s*(.+)$", shipped, re.M)
    assert match is not None, "no Content-Security-Policy line in _headers"
    assert match.group(1) == LOCKED_CONTENT_SECURITY_POLICY
    # A single `/*` block, per the plan's lock.
    assert shipped.splitlines()[0] == "/*"


def test_the_policy_lists_script_hashes_and_no_style_hash() -> None:
    """CSP2+ IGNORES `'unsafe-inline'` in a directive that also lists hashes.

    So a style hash added here would not tighten anything — it would silently
    re-block every data-driven bar width on the site. Asserted structurally
    rather than by eyeballing a 364-character string.
    """
    directives = {
        part.split(" ", 1)[0]: part
        for part in (p.strip() for p in LOCKED_CONTENT_SECURITY_POLICY.split(";"))
    }
    assert len(re.findall(r"'sha256-", directives["script-src"])) == 2
    assert "'sha256-" not in directives["style-src"]
    assert "'unsafe-inline'" in directives["style-src"]
    assert "https://static.cloudflareinsights.com" in directives["script-src"]
    assert "https://cloudflareinsights.com" in directives["connect-src"]


def test_a_deployment_serving_no_policy_is_rejected(tmp_path) -> None:
    """NEGATIVE: the policy is REQUIRED, not merely allowed."""
    site = _site()
    origin = _Origin(site, content_security_policy=None)
    result = _run(origin, _inventory(tmp_path, site))
    assert result.ok is False
    assert result.outcome == "rejected"
    assert "missing required response header" in result.detail
    assert "content-security-policy" in result.detail


def test_a_deployment_serving_an_altered_policy_is_rejected(tmp_path) -> None:
    """NEGATIVE: present-but-weakened is the case an allowlist cannot see.

    `object-src 'none'` -> `object-src *` is a real weakening that leaves the
    header present, correctly named, and structurally valid — exactly what a
    "does it have a CSP?" check waves through.
    """
    site = _site()
    weakened = LOCKED_CONTENT_SECURITY_POLICY.replace("object-src 'none'", "object-src *")
    assert weakened != LOCKED_CONTENT_SECURITY_POLICY, "the mutation did not apply"
    origin = _Origin(site, content_security_policy=weakened)
    result = _run(origin, _inventory(tmp_path, site))
    assert result.ok is False
    assert result.outcome == "rejected"
    assert "does not equal the locked policy" in result.detail


def test_the_control_file_is_never_swept_as_a_served_url(tmp_path) -> None:
    """`_headers` in the tree must not become a path the sweep demands a 200 on.

    This is the contradiction the split exists to prevent: `probe_control_paths`
    asserts `/_headers` 404s, so an inventory that listed it under `files` would
    require a 200 and a 404 on one URL and could never pass.
    """
    site = dict(_site())
    site["_headers"] = b"/*\n  Content-Security-Policy: default-src 'self'\n"
    inventory = _inventory(tmp_path, site)
    assert "_headers" not in {entry["path"] for entry in inventory["files"]}
    assert "_headers" in {entry["path"] for entry in inventory["control_files"]}

    origin = _Origin(_site())  # the ORIGIN does not serve `_headers` — it 404s
    result = _run(origin, inventory)
    assert result.ok is True, result.detail
