"""The /aws/network page bundle (req-aws-core-page-network, specs/spec-aws-core-v0.md).

Reads the shipped pages bundle and checks the network graph's scene searches and the subnets table:
the searches are what put subnets, internet gateways and residents into the scene for aws-estate.js to
nest, so a missing one silently flattens the picture. Pure JSON: no database.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

BUNDLE = Path(__file__).resolve().parent.parent / "grift" / "pages.grift.json"


@pytest.fixture(scope="module")
def batch() -> dict[str, Any]:
    return json.loads(BUNDLE.read_text())["batches"][0]


def _by_name(batch: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {n["entity"]["name"]: n for n in batch["nodes"]}


def _queries_used_by(batch: dict[str, Any], panel_name: str) -> list[str]:
    nodes = _by_name(batch)
    panel_id = nodes[panel_name]["entity"]["entity_id"]
    by_id = {n["entity"]["entity_id"]: n for n in batch["nodes"]}
    return [
        "\n".join(by_id[e["edge"]["to_entity_id"]]["node"]["definition"]["query"])
        for e in batch["edges"]
        if e["edge"]["edge_type"] == "USES_SEARCH" and e["edge"]["from_entity_id"] == panel_id
    ]


def test_network_scene_carries_the_placement_edges(batch: dict[str, Any]) -> None:
    """req-aws-core-page-network-3."""
    queries = _queries_used_by(batch, "AWS network")
    joined = "\n".join(queries)
    assert "aws_core__aws_subnet" in next(q for q in queries if q.startswith("MATCH (n)"))
    for edge in ("PARTITIONED_INTO_SUBNET__aws_core", "ATTACHED_TO_VPC__aws_core", "RESIDES_IN_SUBNET__aws_core"):
        assert f"[:{edge}]" in joined, edge


def test_residents_search_names_only_network_plane_types(batch: dict[str, Any]) -> None:
    """req-aws-core-page-network-3."""
    # A RESIDES_IN_SUBNET search without a type filter would pull every service, task and
    # function on the grid into the network picture.
    q = next(q for q in _queries_used_by(batch, "AWS network") if "RESIDES_IN_SUBNET" in q)
    assert "WHERE a.entity_type IN" in q
    assert "aws_core__aws_nat_gateway" in q and "aws_core__aws_network_firewall" in q


def test_network_page_mounts_the_subnets_table(batch: dict[str, Any]) -> None:
    """req-aws-core-page-network-4."""
    nodes = _by_name(batch)
    rows = nodes["Network"]["node"]["layout"]["columns"]["col-1"]["rows"]
    assert [r["panel-id"] for r in rows.values()] == ["plane", "attachments", "subnets", "igw", "dx"]
    panel_id = nodes["Subnets"]["entity"]["entity_id"]
    mounts = [
        e["edge"]["properties"]["hotlink"]["value"]
        for e in batch["edges"]
        if e["edge"]["edge_type"] == "USES_PANEL" and e["edge"]["to_entity_id"] == panel_id
    ]
    assert mounts == ["subnets"]
    (query,) = _queries_used_by(batch, "Subnets")
    fields = [c["field"] for c in nodes["Subnets"]["node"]["config"]["columns"]]
    for field in fields:
        assert f" AS {field}" in query, field
