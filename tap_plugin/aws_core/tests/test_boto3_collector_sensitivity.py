"""The collection manifest's per-entry ``sensitivity`` declaration.

Spec: spec-aws-core-collector-v0.md (req-aws-collector-manifest-6) and
spec-aws-core-v0.md (req-aws-core-fields-1). Every manifest entry must
declare whether its raw AWS response may carry sensitive values. Three states
are valid, ``unreviewed`` included; a missing declaration is not a state and
must fail, so "nobody looked" can never read as "safe".
"""

from __future__ import annotations

import copy
import json

import botocore.session
import jsonschema
import pytest
from tap_plugin.aws_core.collectors.boto3_collector.manifest import MANIFEST_PATH, SCHEMA_PATH

_STATES = {"unreviewed", "reviewed_none_known", "reviewed_may_contain"}


def _raw_manifest() -> dict:
    # Read the file directly rather than via load_manifest(), so this test does
    # not depend on the schema it is also checking.
    return json.loads(MANIFEST_PATH.read_text())


def _validator() -> jsonschema.Draft202012Validator:
    return jsonschema.Draft202012Validator(json.loads(SCHEMA_PATH.read_text()))


def _entries() -> list[dict]:
    return _raw_manifest()["entries"]


@pytest.mark.parametrize("entry", _entries(), ids=lambda e: e["entity_type"])
def test_every_manifest_entry_declares_sensitivity(entry):
    assert "sensitivity" in entry, (
        f"{entry['entity_type']} has no sensitivity declaration; declare "
        '{"status": "unreviewed"} if nobody has reviewed its response shape yet'
    )
    declared = entry["sensitivity"]
    assert declared["status"] in _STATES
    if declared["status"] == "reviewed_may_contain":
        assert declared["locations"], "reviewed_may_contain must name its locations"
    else:
        assert "locations" not in declared
    if declared["status"] != "unreviewed":
        assert declared.get("basis"), "a reviewed status must name its basis"


class TestSchema:
    def _entry(self) -> dict:
        return copy.deepcopy(_entries()[0])

    def _errors(self, entry: dict) -> list[str]:
        doc = {"manifest_version": "0", "entries": [entry]}
        return [e.message for e in _validator().iter_errors(doc)]

    def test_missing_declaration_is_rejected(self):
        entry = self._entry()
        del entry["sensitivity"]
        assert any("sensitivity" in m for m in self._errors(entry))

    def test_unreviewed_is_a_valid_declaration(self):
        entry = self._entry()
        entry["sensitivity"] = {"status": "unreviewed"}
        assert self._errors(entry) == []

    def test_may_contain_without_locations_is_rejected(self):
        entry = self._entry()
        entry["sensitivity"] = {"status": "reviewed_may_contain", "basis": "read x"}
        assert self._errors(entry)

    def test_none_known_with_locations_is_rejected(self):
        entry = self._entry()
        entry["sensitivity"] = {
            "status": "reviewed_none_known",
            "basis": "read x",
            "locations": [{"path": "A", "category": "credential", "reason": "r", "evidence": "reviewer_judgement"}],
        }
        assert self._errors(entry)

    def test_reviewed_without_basis_is_rejected(self):
        entry = self._entry()
        entry["sensitivity"] = {"status": "reviewed_none_known"}
        assert self._errors(entry)

    def test_shipped_manifest_validates(self):
        assert list(_validator().iter_errors(_raw_manifest())) == []


# --- declared paths resolve against the real botocore response shapes -------
#
# For entries sourced by a plain aws_op, every declared location must name a
# member that exists in botocore's output shape for that op, reached through
# the entry's items_path. custom_fn entries build their own item and are
# checked by reading the custom_fn; they are skipped here, as are paths under
# an engine-added ``_`` key (for example ``_hydrate.tags``), which is not part
# of the AWS payload.


def _step(shape, segment: str):
    name, is_list = (segment[:-2], True) if segment.endswith("[]") else (segment, False)
    if name:
        assert shape.type_name == "structure", f"{name!r}: parent is {shape.type_name}"
        assert name in shape.members, f"{name!r} not in {shape.name} members"
        shape = shape.members[name]
    if is_list:
        assert shape.type_name == "list", f"{segment!r}: not a list"
        shape = shape.member
    return shape


def _aws_op_locations():
    for entry in _entries():
        op = entry["source"].get("aws_op")
        for loc in entry.get("sensitivity", {}).get("locations", []):
            if op and not loc["path"].startswith("_"):
                yield pytest.param(entry, loc, id=f"{entry['entity_type']}:{loc['path']}")


@pytest.mark.parametrize(("entry", "location"), list(_aws_op_locations()))
def test_declared_path_exists_in_botocore_shape(entry, location):
    model = botocore.session.get_session().get_service_model(entry["service"])
    shape = model.operation_model(entry["source"]["aws_op"]).output_shape
    for segment in entry["items_path"].split("."):
        shape = _step(shape, segment)
    for segment in location["path"].split("."):
        shape = _step(shape, segment)
    if location["evidence"] == "botocore_sensitive":
        flagged = shape.metadata.get("sensitive") or (
            shape.type_name == "map" and shape.value.metadata.get("sensitive")
        )
        assert flagged, f"{location['path']} is not marked sensitive in botocore"


def _tag_carrier(entry: dict) -> str | None:
    """Where an entry's tag values sit inside the configuration envelope.

    field lane: the item path the tags are read from. service lane: the
    collector stores the tag call's response at ``_hydrate.tags``. rgta lane:
    tags come from the per-run sweep, not the item, so nothing is in the
    envelope.
    """
    block = entry.get("tags") or {}
    if block.get("source") == "field":
        return block["from"]
    if block.get("source") == "service":
        return "_hydrate.tags"
    return None


@pytest.mark.parametrize(
    "entry",
    [e for e in _entries() if _tag_carrier(e)],
    ids=lambda e: e["entity_type"],
)
def test_tag_values_in_the_envelope_are_declared(entry):
    # Tag values are operator-set arbitrary strings; where they ride inside
    # the raw envelope they must be on the declared work list.
    paths = {loc["path"] for loc in entry.get("sensitivity", {}).get("locations", [])}
    assert _tag_carrier(entry) in paths


def _sensitive_member_paths(shape, prefix: str = "", seen: frozenset = frozenset()) -> list[str]:
    """Every botocore-``sensitive`` member path under ``shape``, in the manifest dialect.

    A map is a leaf (the dialect cannot address map keys), so a sensitive map or
    map value reports the map's own path.
    """
    if shape.name in seen:
        return []
    seen = seen | {shape.name}
    found: list[str] = []
    if shape.type_name == "structure":
        for name, member in shape.members.items():
            path = f"{prefix}.{name}" if prefix else name
            if member.metadata.get("sensitive"):
                found.append(path)
            else:
                found.extend(_sensitive_member_paths(member, path, seen))
    elif shape.type_name == "list":
        found.extend(_sensitive_member_paths(shape.member, f"{prefix}[]", seen))
    elif shape.type_name == "map" and shape.value.metadata.get("sensitive"):
        found.append(prefix)
    return found


def _covered(path: str, declared: set[str]) -> bool:
    return any(path == d or path.startswith((d + ".", d + "[]")) for d in declared)


@pytest.mark.parametrize(
    "entry",
    [e for e in _entries() if e["source"].get("aws_op")],
    ids=lambda e: e["entity_type"],
)
def test_every_botocore_sensitive_member_is_declared(entry):
    # The completeness ratchet for aws_op entries: whatever botocore marks
    # sensitive in the item shape must be on the declared list (a declared
    # ancestor covers its subtree). custom_fn entries compose their items and
    # are reviewed by reading the custom_fn.
    if entry.get("sensitivity", {}).get("status") == "unreviewed":
        pytest.skip("unreviewed declares nothing to be complete against")
    model = botocore.session.get_session().get_service_model(entry["service"])
    shape = model.operation_model(entry["source"]["aws_op"]).output_shape
    for segment in entry["items_path"].split("."):
        shape = _step(shape, segment)
    declared = {loc["path"] for loc in entry["sensitivity"].get("locations", [])}
    missing = [p for p in _sensitive_member_paths(shape) if not _covered(p, declared)]
    assert missing == [], f"{entry['entity_type']}: botocore-sensitive members not declared: {missing}"
