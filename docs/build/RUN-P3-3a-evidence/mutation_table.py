#!/usr/bin/env python3
"""RUN P3-3a mutation table — proves each pin is load-bearing.

Run from anywhere:  python3 docs/build/RUN-P3-3a-evidence/mutation_table.py

A mutant is KILLED if its named test selection FAILS with the mutation applied.
A SURVIVOR means the tests asserted an end state rather than the property — the
failure mode `mutation-tests-pin-properties` records.

The list deliberately includes the *structural guard itself* (M-GUARD): a guard
that cannot detect a reintroduced omission is decoration, and this whole run
exists because three review rounds trusted a search that could not see one.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
ATT = ROOT / "src/populus/publish/attestation.py"
BUILD = ROOT / "src/populus/publish/build.py"
WF = ROOT / ".github/workflows/publish.yml"
SERVER = ROOT / "src/populus/mcp_server/server.py"

TESTS = ["tests/test_attestation.py", "tests/test_attestation_structure.py",
         "tests/test_publish.py"]

# (id, file, old, new, -k selection, property pinned)
MUTANTS = [
    # The five pins, re-anchored after the verify path was rewritten to use
    # sigstore's real contract (signature + certificate policy are ONE call).
    ("M1", ATT,
     "                bundle, identity=identity, issuer=self._issuer",
     "                bundle, identity=P2_PUBLISH_IDENTITY, issuer=self._issuer",
     "deployment_subject_requires_the_record_signer",
     "the certificate-identity pin — the policy we hand sigstore must be the "
     "one the SUBJECT requires, not a hardcoded default"),
    ("M2", ATT,
     "                bundle, identity=identity, issuer=self._issuer",
     '                bundle, identity=identity, issuer="https://accounts.example.com"',
     "a_valid_bundle_verifies or wrong_oidc_issuer",
     "the OIDC issuer pin"),
    ("M3", ATT,
     '            and (s.get("digest") or {}).get("sha256") == digest',
     "            and True",
     "subject_digest_mismatch", "the subject-digest match"),
    ("M3b", ATT,
     '            and _subject_name_matches(str(s.get("name") or ""), subject_name)',
     "            and True",
     "subject_name_is_bound",
     "the subject-NAME binding — digest-only matching lets pointer bytes verify "
     "under the manifest's name"),
    ("M4", ATT,
     "        if predicate_type != SLSA_PREDICATE_TYPE:",
     "        if False:",
     "wrong_predicate_type", "the SLSA predicate filter"),
    ("M5", ATT,
     "        except VerificationFailed as exc:",
     "        except ZeroDivisionError as exc:",
     "a_bad_signature_is_rejected",
     "the signature/policy check — §14 calls this the root of trust"),
    ("M6", ATT,
     '            outcome=UNAVAILABLE,\n            )',
     '            outcome=REJECTED,\n            )',
     "lookup_failure_is_unavailable",
     "R9: a quota failure must not read as tampering"),
    ("M7", ATT,
     "    if subject_name in SUBJECT_IDENTITIES:\n        return SUBJECT_IDENTITIES[subject_name]\n",
     "    if True:\n        return P2_PUBLISH_IDENTITY\n",
     "unknown_subject_is_refused", "unknown subject refused, no default identity"),
    ("M8", ATT,
     'ATTESTATION_REPO = "johnbaekk-spec/populus"',
     'ATTESTATION_REPO = "johnbaekk-spec/populus-data"',
     "identities_and_lookup_derive", "R19: the lookup repository"),
    ("M9", ATT,
     '        key = (digest, identity, self._issuer)',
     '        key = (digest,)',
     "cache_key_includes_the_identity", "cache keyed by pin, not digest alone"),
    ("M10", BUILD,
     '    if not result.ok:\n        raise PublishError(f"attestation failed: {result.detail}")',
     '    if False:\n        raise PublishError(f"attestation failed: {result.detail}")',
     "a_failing_attest_stops_the_publish", "R15: the _require_attested HELPER raises on a failing verdict (no production path can reach it — both providers return ok=True for a mapped subject; the real gate is the workflow step order)"),
    ("M-GUARD", SERVER,
     '        attestation=_attestation_provider(args),\n    )\n    congress_outcome',
     '    )\n    congress_outcome',
     "no_production_call_site_omits",
     "THE GUARD ITSELF: a reintroduced omission must fail it"),
    ("M-WF-ORDER", WF,
     "      - name: Attest published artifacts\n        uses: actions/attest-build-provenance@96b4a1ef7235a096b17240c259729fdd70c83d45 # v2",
     "      - name: Placeholder\n        run: 'true'",
     "attest_step_precedes_verify", "R1: the attest step must exist and precede Verify"),
    ("M-WF-FLAG", WF,
     'run: uv run populus verify --data-repo populus-data --attestation=sigstore',
     'run: uv run populus verify --data-repo populus-data',
     "verify_step_demands_real_attestation or every_populus_invocation",
     "R1: Verify must demand the real provider"),
    ("M-WF-TOKEN", WF,
     '        env:\n          GH_TOKEN: ${{ github.token }}\n        run: uv run populus verify',
     '        run: uv run populus verify',
     "verify_step_is_authenticated", "R9: authenticated lookups in CI"),
]


def run(selection: str) -> int:
    return subprocess.run(
        ["uv", "run", "pytest", "-q", "-x", "--no-header", "-k", selection, *TESTS],
        cwd=ROOT, capture_output=True, text=True,
    ).returncode


results = []
for mid, path, old, new, selection, prop in MUTANTS:
    original = path.read_text()
    if original.count(old) != 1:
        results.append((mid, "ANCHOR-MISS", prop))
        print(f"{mid}: ANCHOR-MISS (count={original.count(old)}) — {prop}", flush=True)
        continue
    path.write_text(original.replace(old, new, 1))
    try:
        rc = run(selection)
    finally:
        path.write_text(original)
    verdict = "KILLED" if rc != 0 else "SURVIVED"
    results.append((mid, verdict, prop))
    print(f"{mid}: {verdict} — {prop}", flush=True)

killed = sum(1 for r in results if r[1] == "KILLED")
print(f"\n=== {killed}/{len(results)} killed ===")
for mid, verdict, prop in results:
    if verdict != "KILLED":
        print(f"  !! {mid}: {verdict} — {prop}")
sys.exit(0 if killed == len(results) else 1)
