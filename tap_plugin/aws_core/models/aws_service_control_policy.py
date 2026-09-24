"""AWS Service Control Policy — an AWS Organizations SCP."""

from typing import Any, ClassVar

from django.db import models

from tap_grid.models import BaseModel


class AwsServiceControlPolicy(BaseModel):
    """A service control policy (SCP) in AWS Organizations.

    Where it applies is the ``ATTACHED_TO_TARGET`` edge to an OU, an account or the organization (the
    root). The policy document is not stored: no source fills a typed summary of it yet, and a raw
    document blob is exactly the unsourced JSON the model contract forbids. ``description`` carries
    the author's statement of intent, which is AWS's own field. Design vocabulary: no collector emits
    it yet. Fields are those ``organizations:DescribePolicy`` (``PolicySummary``) and
    ``ListTagsForResource`` report.

    Spec: specs/spec-aws-core-v0.md (req-aws-core-organizations)
    """

    ENTITY_TYPE: ClassVar[str] = "aws_core__aws_service_control_policy"
    ENTITY_NAME: ClassVar[str] = "AWS Service Control Policy"
    ENTITY_DESCRIPTION: ClassVar[str] = (
        "An AWS Organizations service control policy: the maximum permissions available to the "
        "accounts under the OU, account or root it is attached to."
    )
    ENTITY_ICON: ClassVar[str] = "aws-organizations"
    DEFAULT_DIMENSIONS: ClassVar[dict[str, str]] = {"tap.cloud": "aws"}
    DEFAULT_DISPLAY: ClassVar[dict[str, Any]] = {
        "tap_viz": {
            "shape": "rectangle",
            "colors": {"fill": "#F8BDDA", "border": "#E7157B", "label": "#400522"},
        }
    }

    # AWS's policy id (p-…; the AWS-managed FullAWSAccess policy is p-FullAWSAccess).
    NATURAL_KEY: ClassVar[tuple[str, ...]] = ("policy_id",)

    FIELD_CRUD_SCHEMA: ClassVar[dict[str, Any]] = {
        "name": {"type": "string", "minLength": 1},
        "policy_id": {"type": "string", "pattern": "^(p-[0-9a-zA-Z_]{8,128})?$"},
        "description": {"type": "string"},
        "aws_managed": {"type": "boolean"},
        "tags": {"type": "object", "additionalProperties": {"type": "string"}},
    }

    FIELD_VALIDATION_SCHEMA: ClassVar[dict[str, Any]] = {
        name: {"validation": "jsonschema", "schema": schema} for name, schema in FIELD_CRUD_SCHEMA.items()
    }

    CREATE_REQUIRED: ClassVar[list[str]] = ["name"]

    name = models.CharField(max_length=128, blank=True, default="")
    policy_id = models.CharField(max_length=130, blank=True, default="", db_index=True)
    description = models.CharField(max_length=512, blank=True, default="")
    aws_managed = models.BooleanField(default=False)
    # AWS tags, canonical flat {str: str} (req-aws-core-fields-4). Source: organizations:ListTagsForResource.
    tags = models.JSONField(default=dict, blank=True)

    class Meta(BaseModel.Meta):
        db_table = "aws_core__aws_service_control_policy"

    def get_name(self) -> str:
        return self.name or self.policy_id

    def __str__(self) -> str:
        return self.get_name()
