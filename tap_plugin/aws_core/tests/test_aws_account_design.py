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


@pytest.mark.django_db
@pytest.mark.parametrize("type_slug", ["aws_core__aws_account", "aws_core__aws_vpc", "aws_core__aws_subnet"])
def test_two_id_less_creates_stay_distinct(type_slug: str) -> None:
    """Blank ids never converge: none of these types declares a NATURAL_KEY, so no lookup keys on the id."""
    results = write_batch(
        [
            WriteOperation(verb="create_node", type_slug=type_slug, payload={"name": "a"}),
            WriteOperation(verb="create_node", type_slug=type_slug, payload={"name": "b"}),
        ],
        caller_context=CallerContext(),
    ).results
    assert all(r.success for r in results)
    assert results[0].entity_id != results[1].entity_id


@pytest.mark.django_db
@pytest.mark.parametrize("type_slug", ["aws_core__aws_ec2_instance", "aws_core__aws_ebs_volume"])
def test_designed_compute_and_storage_need_no_aws_id(type_slug: str) -> None:
    """A designed EC2 instance or EBS volume exists before AWS mints its id. Nothing is required, because a
    collected one can be untagged and so nameless too."""
    ok = write_batch(
        [WriteOperation(verb="create_node", type_slug=type_slug, payload={"name": "teleport-auth-a"})],
        caller_context=CallerContext(),
    ).results[0]
    assert ok.success


@pytest.mark.django_db
def test_elb_records_its_load_balancer_type() -> None:
    """An NLB is an aws_elb with lb_type=network; an unknown type is refused."""
    good = write_batch(
        [WriteOperation(verb="create_node", type_slug="aws_core__aws_elb", payload={"name": "gitlab-ssh", "lb_type": "network"})],
        caller_context=CallerContext(),
    ).results[0]
    assert good.success
    bad = write_batch(
        [WriteOperation(verb="create_node", type_slug="aws_core__aws_elb", payload={"name": "x", "lb_type": "application"})],
        caller_context=CallerContext(),
    ).results[0]
    assert not bad.success
