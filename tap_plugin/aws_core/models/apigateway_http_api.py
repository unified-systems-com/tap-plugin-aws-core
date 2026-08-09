"""API Gateway HTTP API — an Amazon API Gateway v2 HTTP API."""

from typing import Any, ClassVar

from django.db import models

from tap_grid.models import BaseModel


class ApiGatewayHttpApi(BaseModel):
    """An Amazon API Gateway v2 HTTP API."""

    ENTITY_TYPE: ClassVar[str] = "aws_core__aws_apigateway_http_api"
    ENTITY_NAME: ClassVar[str] = "API Gateway HTTP API"
    ENTITY_DESCRIPTION: ClassVar[str] = (
        "An Amazon API Gateway v2 HTTP API — a managed HTTP front door whose routes "
        "integrate with backend targets (typically Lambda) and whose authorizers "
        "gate access (typically Cognito JWT)."
    )
    ENTITY_ICON: ClassVar[str] = "aws-apigateway"
    DEFAULT_DIMENSIONS: ClassVar[dict[str, str]] = {"tap.cloud": "aws"}

    DEFAULT_DISPLAY: ClassVar[dict[str, Any]] = {
        "tap_viz": {
            "shape": "rectangle",
            "colors": {"fill": "#DECDFF", "border": "#8C4FFF", "label": "#271647"},
        }
    }

    FIELD_CRUD_SCHEMA: ClassVar[dict[str, Any]] = {
        "name": {"type": "string", "minLength": 1},
        "api_id": {"type": "string"},
        "api_arn": {"type": "string"},
        "api_endpoint": {"type": "string"},
        "protocol_type": {"type": "string"},
        "tags": {"type": "object"},
        "configuration": {"type": "object"},
    }

    FIELD_VALIDATION_SCHEMA: ClassVar[dict[str, Any]] = {
        "name": {"validation": "jsonschema", "schema": {"type": "string", "minLength": 1}},
        "api_id": {"validation": "jsonschema", "schema": {"type": "string"}},
        "api_arn": {"validation": "jsonschema", "schema": {"type": "string"}},
        "api_endpoint": {"validation": "jsonschema", "schema": {"type": "string"}},
        "protocol_type": {"validation": "jsonschema", "schema": {"type": "string"}},
        "tags": {"validation": "jsonschema", "schema": {"type": "object"}},
        "configuration": {"validation": "jsonschema", "schema": {"type": "object"}},
    }
    CREATE_REQUIRED: ClassVar[list[str]] = ["name"]

    name = models.CharField(max_length=255, blank=True, default="")
    api_id = models.CharField(max_length=128, blank=True, default="")
    api_arn = models.CharField(max_length=512, blank=True, default="")
    api_endpoint = models.CharField(max_length=512, blank=True, default="")
    protocol_type = models.CharField(max_length=32, blank=True, default="")
    tags = models.JSONField(default=dict, blank=True)
    configuration = models.JSONField(default=dict, blank=True)

    class Meta(BaseModel.Meta):
        db_table = "aws_core__aws_apigateway_http_api"

    def get_name(self) -> str:
        return self.name

    def __str__(self) -> str:
        return self.name
