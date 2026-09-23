"""GRIFT batch assembly for the boto3 collector (one batch per run).

Spec: plugins/aws_core/specs/spec-aws-core-collector-v0.md
(req-aws-collector-grift-batch).

A pure document-shaper: it turns the run's node + edge envelopes plus
provenance into the GRIFT document root, mirroring the KSI reference
collector's shape in ``aws_core``'s own format. It performs no I/O and never
submits — submission via ``self.submit_grift`` is the runtime integration's
job (``req-aws-collector-grift-batch-3``). The batch carries no deletion or
tombstone content (``req-aws-collector-grift-batch-4``); v0 has no
implied-absence semantics.

Node/edge identities are the deterministic ``uuid5`` values from
:mod:`.identity`; only the per-run ``batch_entity`` id is fresh (``uuid7``).
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any
from uuid import uuid7

from .projection import ProjectedNode

# The description_json format tag for this collector's provenance payload —
# aws_core's own format, parallel to the KSI collector's.
COLLECTION_FORMAT = "tap.aws_core.collection-v0"

# Whether a node's raw AWS response (``ProjectedNode.configuration``) is
# persisted into the GRIFT node payload. Read at emit time by
# :func:`node_envelope`; see :func:`persisted_configuration`.
PERSIST_RAW_CONFIGURATION: bool = False
"""Persist the raw boto3 response into each node's ``configuration``. Off.

Ruling (George, owner, 2026-09-23): the ``configuration`` field exists to
capture the raw boto3 responses that will later be submitted as audit
evidence, so masking or redacting it would destroy that evidence. Instead,
response collection is disabled entirely for now — it is not needed yet and
holding it (Lambda environment variables, origin shared-secret headers,
policy documents) is a liability. The collection manifest's per-entry
``sensitivity`` declaration records where a raw response may carry sensitive
values, so the work needed before this is switched back on is tracked.

This is the single switch. With it off the collector still builds the full
configuration envelope in memory — typed fields, tags, hydrate-gap warnings
and edges are all derived exactly as before — and only the GRIFT emit writes
``{}`` in its place. Turning it on restores lossless persistence unchanged.
Spec: req-aws-core-fields-1 (spec-aws-core-v0.md) and
req-aws-collector-field-projection-3 (spec-aws-core-collector-v0.md).
"""

# GRIFT document format version. A literal at the producer, exactly as the
# KSI reference collector does (it is the document's format version, not the
# collector's to derive).
_GRIFT_VERSION = "0"


def persisted_configuration(node: ProjectedNode) -> dict[str, Any]:
    """The ``configuration`` value to persist for ``node``.

    The in-memory envelope when :data:`PERSIST_RAW_CONFIGURATION` is on,
    otherwise ``{}``. ``{}`` is sent explicitly rather than omitted so the
    replace on import sets the column deterministically: a resource collected
    before the switch was turned off has its stored raw response replaced
    with ``{}`` the next time it is collected.
    """
    if PERSIST_RAW_CONFIGURATION:
        return node.configuration
    return {}


def node_envelope(
    node: ProjectedNode,
    dimensions: dict[str, str],
    tags: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a GRIFT node envelope from a projected node.

    The ``node`` payload is the projected typed fields, the canonical
    ``tags`` map (``req-aws-collector-tags``; ``{}`` when untagged — the
    correct answer, never omitted), and ``configuration`` as decided by
    :func:`persisted_configuration` (``{}`` while raw-response persistence
    is switched off); the service layer validates it on import.
    """
    return {
        "entity": {
            "entity_id": str(node.entity_id),
            "entity_type": node.entity_type,
            "name": node.name,
            "dimensions": dimensions,
        },
        "node": {
            **node.fields,
            "tags": tags or {},
            "configuration": persisted_configuration(node),
        },
    }


def assemble_batch(
    *,
    source: str,
    manifest_version: str,
    account_id: str | None,
    regions: list[str],
    node_envelopes: list[dict[str, Any]],
    edge_envelopes: list[dict[str, Any]],
    now: datetime | None = None,
    batch_entity_id: str | None = None,
) -> dict[str, Any]:
    """Assemble the single GRIFT document for one collection run.

    Args:
        source: The collector's dotted source identity.
        manifest_version: The resource manifest's ``manifest_version``.
        account_id: The collected AWS account id (``None`` if undetermined).
        regions: The regions swept this run.
        node_envelopes: Phase-one node envelopes (see :func:`node_envelope`).
        edge_envelopes: Phase-two edge envelopes (see :func:`.edges.emit_edges`).
        now: Collection timestamp; defaults to ``datetime.now(UTC)``.
        batch_entity_id: Override the per-run batch id (tests); defaults to a
            fresh ``uuid7``.
    """
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    now_iso = moment.isoformat().replace("+00:00", "Z")
    label = f"AWS collection {now_iso}"

    by_entity_type = Counter(env["entity"]["entity_type"] for env in node_envelopes)
    description_data = {
        "schema_version": "v0",
        "manifest_version": manifest_version,
        "account_id": account_id,
        "regions": regions,
        "counts": {
            "nodes": len(node_envelopes),
            "edges": len(edge_envelopes),
            "by_entity_type": dict(sorted(by_entity_type.items())),
        },
    }

    batch = {
        "batch_entity": {
            "entity_id": batch_entity_id or str(uuid7()),
            "entity_type": "batch",
            "name": label,
            "dimensions": {},
        },
        "batch_node": {
            "source": source,
            "name": label,
            "description": "AWS account collection via tap_cares.",
            "description_json": {
                "format": COLLECTION_FORMAT,
                "data": description_data,
            },
        },
        "nodes": node_envelopes,
        "edges": edge_envelopes,
    }
    return {
        "metadata": {"grift_version": _GRIFT_VERSION},
        "_reserved": {},
        "batches": [batch],
    }
