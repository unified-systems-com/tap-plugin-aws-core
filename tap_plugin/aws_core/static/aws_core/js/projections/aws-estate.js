/**
 * aws-estate — the nested layout behind the /aws pages (req-aws-core-page-dashboard,
 * req-aws-core-page-organization, req-aws-core-page-network).
 *
 * Whatever the page's searches put in the scene, containment comes only from aws_core's own edges:
 *
 *   - organization ⊃ OU ⊃ OU / account      NESTED_UNDER_PARENT (child → parent)
 *   - transit gateway ⊃ its attachments      ATTACHED_TO_TRANSIT_GATEWAY (attachment → gateway)
 *   - account ⊃ what was collected in it     the collector's `aws_account` dimension (dimension_match)
 *
 * Every other edge in the scene is drawn as a line: an SCP ATTACHED_TO_TARGET its OU, an attachment
 * ATTACHES_VPC, an OU SCOPED_TO a compliance boundary, Identity Center TRUSTS_IDENTITY_SOURCE.
 * Nothing is placed by name or id. A design node has no account id and so no `aws_account`
 * dimension, and aws_core has no edge yet for "this VPC is in this account" or "this gateway is in
 * this VPC", so designed VPCs and gateways stand outside the account boxes, grouped by type.
 *
 * Roots are laid out in bands, top to bottom: the organisation tree, transit gateways, VPCs and
 * their gateways, policies, boundaries, then anything from outside aws_core (an identity provider).
 *
 * Standard tap layout module: `export async function execute(context)` (spec-viz-layouts.md).
 */

import {projectNested} from "/static/tap_viz/js/runtime/nested-projection.js";
import {applyStandardChrome, placeParentLabels, parentLabelInset} from "/static/tap_viz/js/runtime/chrome.js";

const T = {
    organization: "aws_core__aws_organization",
    ou: "aws_core__aws_organizational_unit",
    account: "aws_core__aws_account",
    scp: "aws_core__aws_service_control_policy",
    identityCenter: "aws_core__aws_identity_center_instance",
    tgw: "aws_core__aws_transit_gateway",
    attachment: "aws_core__aws_transit_gateway_attachment",
    vpc: "aws_core__aws_vpc",
    boundary: "compliance_core__compliance_boundary",
};
const E = {
    nested: "NESTED_UNDER_PARENT__aws_core",
    attachedToTgw: "ATTACHED_TO_TRANSIT_GATEWAY__aws_core",
    scoped: "SCOPED_TO_COMPLIANCE_BOUNDARY__compliance_core",
};
const CONTAINERS = [T.organization, T.ou, T.account, T.tgw, T.vpc];

//: Root bands, top to bottom. A root whose type is in no band goes in the aws_core band if it is
//: an aws_core type, else in the last band (outside systems).
const BANDS = [
    {name: "organization", types: [T.organization, T.ou, T.account]},
    {name: "transit", types: [T.tgw, T.attachment]},
    {name: "aws", types: []},
    {name: "policy", types: [T.scp, T.identityCenter]},
    {name: "boundary", types: [T.boundary]},
    {name: "outside", types: []},
];

const GEOM = {leaf: {width: 220, height: 54}, labelInset: 16, bandGap: 90, itemGap: 48};

export async function execute(context) {
    const {cy} = context;
    const chrome = applyStandardChrome(cy);
    const labelInset = parentLabelInset({...chrome, inset: GEOM.labelInset});
    const pad = {top: 14 + labelInset, right: 24, bottom: 24, left: 24};

    const types = [...new Set(cy.nodes().map((n) => n.data("entity_type")).filter(Boolean))];
    const baseSizes = Object.fromEntries(types.map((t) => [t, CONTAINERS.includes(t) ? {width: 190, height: 90} : GEOM.leaf]));

    const result = await projectNested(cy, {
        relationships: [
            {name: "org-holds", gryphon: `(parent:${T.organization})<-[:${E.nested}]-(child)`},
            {name: "ou-holds", gryphon: `(parent:${T.ou})<-[:${E.nested}]-(child)`},
            {name: "tgw-holds", gryphon: `(parent:${T.tgw})<-[:${E.attachedToTgw}]-(child)`},
            {name: "account-holds", dimension_match: {parent_type: T.account, dimension: "aws_account"}},
        ],
        baseSizes,
        padding: 24,
        paddings: Object.fromEntries(CONTAINERS.map((t) => [t, pad])),
        innerLayout: {name: "flow", gap: 28, sort: "label"},
        innerLayouts: {
            [T.organization]: {name: "flow", gap: 36, sort: "label", aspect: 2.2},
            [T.ou]: {name: "flow", gap: 28, sort: "label", aspect: 2.4},
            [T.tgw]: {name: "flow", gap: 20, sort: "label", aspect: 3},
        },
    });

    _placeRootBands(cy);
    cy.nodes(CONTAINERS.map((t) => `[entity_type = "${t}"]`).join(", ")).forEach((n) => {
        if (_childrenOf(cy, n.id()).empty()) n.addClass("tap-viewport-parent");
    });
    placeParentLabels(cy, {
        anchor: "upper-left", inset: GEOM.labelInset,
        parentFontSize: chrome.parentFontSize, parentFontWeight: chrome.parentFontWeight,
    });
    _style(cy);
    return {warnings: result.warnings || []};
}

function _childrenOf(cy, parentId) {
    return cy.nodes().filter((n) => n.data("_viewport_parent") === parentId);
}

function _moveTree(cy, node, dx, dy) {
    if (!dx && !dy) return;
    const p = node.position();
    node.position({x: p.x + dx, y: p.y + dy});
    _childrenOf(cy, node.id()).forEach((c) => _moveTree(cy, c, dx, dy));
}

function _band(type) {
    const i = BANDS.findIndex((b) => b.types.includes(type));
    if (i >= 0) return i;
    return type.startsWith("aws_core__") ? BANDS.findIndex((b) => b.name === "aws") : BANDS.length - 1;
}

//: Each band is one centred row (wrapping at the widest band's width); bands stack top to bottom.
function _placeRootBands(cy) {
    const roots = cy.nodes().filter((n) => !n.data("_viewport_parent") && !n.data("_is_badge") && !n.data("_is_shadow"));
    const bands = BANDS.map(() => []);
    roots.forEach((n) => bands[_band(n.data("entity_type") || "")].push(n));
    const maxRow = Math.max(1600, ...roots.map((n) => n.width()));
    let y = 0;
    bands.forEach((items) => {
        if (!items.length) return;
        items.sort((a, b) => (b.width() * b.height() - a.width() * a.height())
            || String(a.data("entity_type")).localeCompare(String(b.data("entity_type")))
            || String(a.data("label")).localeCompare(String(b.data("label"))));
        const rows = [];
        let row = [];
        let w = 0;
        items.forEach((n) => {
            if (row.length && w + n.width() > maxRow) { rows.push(row); row = []; w = 0; }
            row.push(n);
            w += n.width() + GEOM.itemGap;
        });
        if (row.length) rows.push(row);
        rows.forEach((r) => {
            const width = r.reduce((s, n) => s + n.width(), 0) + GEOM.itemGap * (r.length - 1);
            const height = Math.max(...r.map((n) => n.height()));
            let x = -width / 2;
            r.forEach((n) => {
                _moveTree(cy, n, x + n.width() / 2 - n.position().x, y + n.height() / 2 - n.position().y);
                x += n.width() + GEOM.itemGap;
            });
            y += height + GEOM.itemGap;
        });
        y += GEOM.bandGap - GEOM.itemGap;
    });
}

function _style(cy) {
    cy.style()
        .selector(`node[entity_type = "${T.organization}"]`)
        .style({"shape": "round-rectangle", "background-color": "#eef2f7", "background-opacity": 1,
                "border-width": 1.5, "border-color": "#7b93b8", "color": "#1e3a5f"})
        .selector(`node[entity_type = "${T.ou}"]`)
        .style({"shape": "round-rectangle", "background-color": "#f8fafc", "background-opacity": 1,
                "border-width": 1, "border-style": "dashed", "border-color": "#94a3b8", "color": "#334155"})
        .selector(`node[entity_type = "${T.boundary}"]`)
        .style({"border-width": 3, "border-color": "#b91c1c", "color": "#991b1b"})
        .selector(`edge[label = "${E.scoped}"]`)
        .style({"line-color": "#dc2626", "target-arrow-color": "#dc2626", "line-style": "dashed", "width": 2})
        .update();
}
