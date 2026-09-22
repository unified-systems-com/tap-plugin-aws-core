"""A designed AWS account exists before AWS mints its id (design-phase accounts)."""

from __future__ import annotations

import pytest
from tap_plugin.aws_core.models import AwsAccount

from tap_grid.caller_context import CallerContext
from tap_grid.services import WriteOperation, write_batch

TYPE = "aws_core__aws_account"


def _create(payload: dict):
    return write_batch(
        [WriteOperation(verb="create_node", type_slug=TYPE, payload=payload)], caller_context=CallerContext()
    ).results[0]


@pytest.mark.django_db
class TestDesignedAccount:
    def test_account_without_id_is_accepted(self) -> None:
        result = _create({"name": "staging · cicd"})
        assert result.success
        assert AwsAccount.all_objects.get(entity_id=result.entity_id).account_id == ""

    def test_name_still_required(self) -> None:
        assert not _create({"account_id": "123456789012"}).success


@pytest.mark.django_db
@pytest.mark.parametrize("type_slug", ["aws_core__aws_vpc", "aws_core__aws_subnet"])
def test_designed_network_without_id_is_accepted(type_slug: str) -> None:
    """A designed VPC or subnet exists before AWS mints its id."""
    result = write_batch(
        [WriteOperation(verb="create_node", type_slug=type_slug, payload={"name": "staging · cicd"})],
        caller_context=CallerContext(),
    ).results[0]
    assert result.success
