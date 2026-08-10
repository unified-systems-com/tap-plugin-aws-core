---
name: add-aws-type
description: Add (or update) a collected AWS resource type in the aws_core plugin — manifest entry, model with the mandatory tags field, schemas + migration, unit tests, the live trial run, and release. Use whenever aws_core should start collecting a new AWS service type, or when changing what an existing type collects. Never ship a type blind.
allowed-tools: Read Write Edit Glob Grep Bash(git *) Bash(uv *) Bash(scripts/*) Bash(docker *) Bash(python *)
argument-hint: <aws-service-type e.g. sns_topic> [--update]
---

# Add an AWS Type to aws_core

> **Skill source-of-truth.** Canonical location: `tap_plugin/aws_core/skills/add-aws-type/SKILL.md`
> (ships in the wheel — the install carries it, per the tests-in-wheel AI-surface posture).

You are wiring one new collected AWS resource type through every layer of the
`aws_core` plugin. The 16 correctly-wired types are the reference corpus; the
**motivating scar is v0.4.0's `secrets_manager_secret`**, which shipped blind —
no live instance was ever collected before release — and carried a bug that
rejected entire GRIFT batches on any account with one secret (step 2 names it).
The whole point of this checklist is that step 5 makes that impossible to repeat.

Work happens from the command line in a dev checkout of
`tap-plugin-aws-core` (e.g. `_dev-plugins/aws_core/` inside a TAP session
worktree), on a branch. Building a new AWS type is developer/build-time
activity: live AWS access uses local developer credentials (AWS_PROFILE /
env), NOT the plugin's runtime secret envelopes.

## Step 1 — Manifest entry (`collectors/boto3_collector/aws_resource_manifest.json`)

Add the entry: `entity_type` (`aws_core__aws_<type>`), `service` (boto3 service
name), `scope` (`regional` | `global`), `source`, `why` (one honest sentence —
what relationship or risk does collecting this illuminate?), `items_path`,
`natural_key` (an ARN or the service's canonical id — deterministic identity
depends on it), `fields` (model field → jsonpath), `edges`.

- `source`: prefer a declared `aws_op` (one list call, engine-paginated). Use a
  `custom_fn` in `customfns.py` ONLY when one logical resource needs multiple
  calls (describe fan-out, tag side-fetch, cross-join) — see
  `sqs_queues_described` / `apigateway_http_apis_detailed` for the shape and
  the per-item graceful-degradation discipline (`AccessDenied` on a sub-call
  degrades that slot, never kills the run).
- Validate against `aws_resource_manifest.schema.json` (the manifest unit tests
  do this; `manifest_version` only bumps on format changes, not entries).

**The tag-strategy decision (do not skip; this is settled, clever machinery —
pick the right lane per AWS's tagging surface for the service):**

| Strategy | When | Manifest shape |
|---|---|---|
| `rgta` | The resource type is covered by Resource Groups Tagging API and the item carries a joinable ARN | `"tags": {"source": "rgta", "join": {...}}` — tags land via the per-run RGTA sweep, joined by ARN (e.g. `lambda`) |
| service side-quest | RGTA excludes the type (e.g. IAM roles) but the service has a tag-list op | `"tags": {"source": "service", "op": ..., "params": ..., "path": ..., "shape": "list_kv"\|"map"}` — runs through the hydrate seam, so denials surface as `HYDRATE_GAP`, and normalizes via `normalize_tags` |
| projected field | A `custom_fn` already fetched tags while assembling the item | `"tags": "<path>"` inside `fields` (e.g. `"_tags"` for sqs, `"UserPoolTags"` for cognito) |

All three converge on ONE canonical `tags` field: a flat `{str: str}` map,
`{}` when untagged (a normal fact, never an omission). New wire shapes (ECS
lowercase kv, WAFv2 wrapped) extend the `normalize_tags` enum — never a
per-service loop.

## Step 2 — Model (`models/<type>.py`)

Copy the shape of a recent collected model (`sqs_queue.py` is clean): `BaseModel`
subclass, `ENTITY_TYPE = "aws_core__aws_<type>"` (== `db_table`), `ENTITY_NAME`,
`ENTITY_DESCRIPTION`, `ENTITY_ICON` (then run the `get-aws-icons` skill),
`DEFAULT_DIMENSIONS = {"tap.cloud": "aws"}`, `DEFAULT_DISPLAY`, fields,
`get_name`, `__str__`.

**THE TRAP (v0.4.0, named):** the collector emits `tags` on EVERY node
unconditionally — `batch.node_envelope` writes `"tags": tags or {}`, contract
"never omitted". A model without a `tags` field is therefore rejected wholesale
at GRIFT import: core validates the payload against the model's create schema
with `additionalProperties: false`, so the undeclared `tags` key fails the whole
batch. `SecretsManagerSecret` shipped exactly this way in v0.4.0 and broke
collection for any account with ≥1 secret. **Every collected model MUST declare:**

- field: `tags = models.JSONField(default=dict, blank=True)`
- `FIELD_CRUD_SCHEMA`: `"tags": {"type": "object"}`
- `FIELD_VALIDATION_SCHEMA`: `"tags": {"validation": "jsonschema", "schema": {"type": "object"}}`
- membership in `tests/test_aws_core_tags_field.py::_COLLECTED_MODELS` (the
  always-on guard for exactly this).

Same discipline for `configuration` (the lossless raw blob): JSONField + both
schema entries.

## Step 3 — Schemas + migration

Every field the manifest projects MUST appear in `FIELD_CRUD_SCHEMA` **and**
`FIELD_VALIDATION_SCHEMA` (schemas are the import gate; the collector performs
no coercion — a projected field missing from the schema is the same
reject-the-batch failure as the tags trap). `CREATE_REQUIRED = ["name"]`.
Register the model in `models/__init__.py` and `tap-plugin.toml` `[models]`,
then generate the migration (from a TAP session worktree:
`scripts/dc exec web uv run python manage.py makemigrations aws_core`) and eyeball
it — one additive `CreateModel`, nothing touching existing tables.

## Step 4 — Unit tests (cheap, always-on)

In `tap_plugin/aws_core/tests/` (in-package; the wheel carries them):

- `custom_fn` / transform tests with faked boto3 clients — follow
  `test_boto3_collector_new_service_types.py` (enumeration shaping, edge-key
  derivation, per-item degradation on denial).
- Payload-vs-schema: build a realistic raw item, run `project_item` +
  `node_envelope`, validate the payload against the model create schema with
  `additionalProperties: false` (reuse `_create_verb_schema` /
  `_prepare_null_payload` from `test_trial_run_live.py`). This is the offline
  half of the trial-run assertion and runs in every lane.

## Step 5 — THE TRIAL RUN (never ship a type blind)

The executable half of this skill:
`tap_plugin/aws_core/tests/test_trial_run_live.py` (its module docstring is the
operator runbook — env vars, exact commands, credential seam, sweep).

1. Add a `TrialTypeSpec` for the new type: a provisioner that creates the
   CHEAPEST possible live instance via boto3, tagged through the service's
   native tag surface with `tap:trial=sacrificial` + `tap:trial-session=<run>`,
   name-prefixed `tap-trial-`, with an instant teardown. If the type cannot be
   torn down cleanly (KMS's 7-day deletion floor, CloudTrail's S3 prerequisites),
   register it with a `deferred_reason` naming the caveat honestly instead.
2. **Get human approval for what will be provisioned** — the harness enforces
   this: nothing runs unless a human lists the type in `TAP_AWS_TRIAL_TYPES`.
   State the expected cost/residue when asking.
3. Run it (write credentials = local developer AWS credentials, or the
   `trial_provisioner` envelope once that has passed /manage-secret review;
   NEVER the read-only `boto_collector` envelope). Attach the
   `handoff/trial-provisioner-policy.json` policy to the identity used.
4. Green means: the live resource appeared through the real collection path,
   its emitted payload validates against the model schema exactly as GRIFT
   import will, and the trial tags round-tripped through the tag strategy
   chosen in step 1.
5. Confirm teardown (the run deletes in `finally`; a crashed run is cleaned by
   `TAP_AWS_TRIAL_SWEEP=all` — RGTA find-by-tag, delete).

## Step 6 — Release

`release-plugin.sh` from the plugin repo (runs the gates, tags, builds); then
bump the pin in every consuming boot record (e.g. the samsite profile's
boot-record BOM) so the new version actually boots somewhere. A type is DONE
when: trial run green, unit tests green in the plugin's CI lane against
core-main, released, pins bumped — in that order.
