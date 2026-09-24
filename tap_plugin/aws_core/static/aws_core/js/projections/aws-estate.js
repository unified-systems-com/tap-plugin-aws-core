/**
 * aws-estate — the nested layout behind the /aws dashboard and network graphs
 * (req-aws-core-page-dashboard, req-aws-core-page-network). The organization graph has its own
 * module, aws-organization.js.
 *
 * Whatever the page's searches put in the scene, containment comes only from aws_core's own edges:
 *
 *   - organization ⊃ OU ⊃ OU / account      NESTED_UNDER_PARENT (child → parent)
 *   - transit gateway ⊃ its attachments      ATTACHED_TO_TRANSIT_GATEWAY (attachment → gateway)
 *   - VPC ⊃ its subnets                      PARTITIONED_INTO_SUBNET (VPC → subnet)
 *   - VPC ⊃ its internet gateway             ATTACHED_TO_VPC (gateway → VPC)
 *   - subnet ⊃ what is placed in it          RESIDES_IN_SUBNET (resource → subnet), when the resource
 *                                            is in exactly one subnet in the scene
 *   - VPC ⊃ a resource in several subnets    RESIDES_IN_SUBNET to two or more subnets of one VPC
 *                                            (a network firewall's per-zone endpoints): it sits in
 *                                            the VPC and keeps a line to each subnet
 *   - account ⊃ what was collected in it     the collector's `aws_account` dimension (dimension_match)
 *
 * Inside a VPC, subnets stand in one column per availability zone (the subnet's own
 * `availability_zone`, zones in name order), public subnets first, then by label; what the VPC holds
 * directly (its internet gateway, a multi-subnet resource) stands in a column to their left.
 * While the scene carries no zone (the graph panel lifts only `tags`, not model fields), a VPC's
 * subnets stand as a compact block in label order instead.
 *
 * Every other edge in the scene is drawn as a line: an SCP ATTACHED_TO_TARGET its OU, an attachment
 * ATTACHES_VPC, an OU SCOPED_TO a compliance boundary, Identity Center TRUSTS_IDENTITY_SOURCE.
 * Nothing is placed by name or id.
 *
 * Roots are laid out in bands, top to bottom: the organisation tree, transit gateways, VPCs and
 * their gateways, policies, boundaries, then anything from outside aws_core (an identity provider).
 *
 * Standard tap layout module: `export async function execute(context)` (spec-viz-layouts.md).
 */

import {projectNested, HIDDEN_CONTAINMENT_CLASS} from "/static/tap_viz/js/runtime/nested-projection.js";
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
    subnet: "aws_core__aws_subnet",
    boundary: "compliance_core__compliance_boundary",
};
const E = {
    nested: "NESTED_UNDER_PARENT__aws_core",
    attachedToTgw: "ATTACHED_TO_TRANSIT_GATEWAY__aws_core",
    scoped: "SCOPED_TO_COMPLIANCE_BOUNDARY__compliance_core",
    partitioned: "PARTITIONED_INTO_SUBNET__aws_core",
    attachedToVpc: "ATTACHED_TO_VPC__aws_core",
    residesInSubnet: "RESIDES_IN_SUBNET__aws_core",
};
//: The layout's own placement edge, derived from RESIDES_IN_SUBNET before nesting (see _placeResidents).
//: Never stored: added to the scene for nesting resolution only, and removed on every run.
const PLACED_IN = "_PLACED_IN";
const PLACED_PREFIX = "placed-in:";
const CONTAINERS = [T.organization, T.ou, T.account, T.tgw, T.vpc, T.subnet];

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

const GEOM = {
    leaf: {width: 220, height: 54}, labelInset: 16, bandGap: 90, itemGap: 48,
    //: Every subnet is one size, so the rows of a VPC's zone columns line up whether or not a subnet
    //: holds a gateway; what a subnet holds is drawn small enough to fit inside it.
    subnet: {width: 196, height: 70}, resident: {width: 164, height: 30},
};
//: Column for what a VPC holds directly, left of its zone columns.
const VPC_LEVEL_STAGE = -1;
//: Column for a subnet with no availability zone, right of the zone columns.
const NO_ZONE_STAGE = 1000;

export async function execute(context) {
    const {cy} = context;
    const chrome = applyStandardChrome(cy);
    const labelInset = parentLabelInset({...chrome, inset: GEOM.labelInset});
    const pad = {top: 14 + labelInset, right: 24, bottom: 24, left: 24};

    const types = [...new Set(cy.nodes().map((n) => n.data("entity_type")).filter(Boolean))];
    const residents = _placeResidents(cy);
    const sizeOf = (t) => {
        if (t === T.subnet) return GEOM.subnet;
        if (residents.inSubnet.has(t)) return GEOM.resident;
        return CONTAINERS.includes(t) ? {width: 190, height: 90} : GEOM.leaf;
    };
    const baseSizes = Object.fromEntries(types.map((t) => [t, sizeOf(t)]));
    _stampVpcColumns(cy);

    const result = await projectNested(cy, {
        relationships: [
            {name: "org-holds", gryphon: `(parent:${T.organization})<-[:${E.nested}]-(child)`},
            {name: "ou-holds", gryphon: `(parent:${T.ou})<-[:${E.nested}]-(child)`},
            {name: "tgw-holds", gryphon: `(parent:${T.tgw})<-[:${E.attachedToTgw}]-(child)`},
            {name: "vpc-holds-subnets", gryphon: `(parent:${T.vpc})-[:${E.partitioned}]->(child)`},
            {name: "vpc-holds-gateway", gryphon: `(parent:${T.vpc})<-[:${E.attachedToVpc}]-(child)`},
            {name: "placed-in", gryphon: `(parent)<-[:${PLACED_IN}]-(child)`},
            {name: "account-holds", dimension_match: {parent_type: T.account, dimension: "aws_account"}},
        ],
        baseSizes,
        padding: 24,
        paddings: {
            ...Object.fromEntries(CONTAINERS.map((t) => [t, pad])),
            [T.subnet]: {top: 10 + labelInset, right: 10, bottom: 8, left: 10},
        },
        innerLayout: {name: "flow", gap: 28, sort: "label"},
        innerLayouts: {
            [T.organization]: {name: "flow", gap: 36, sort: "label", aspect: 2.2},
            [T.ou]: {name: "flow", gap: 28, sort: "label", aspect: 2.4},
            [T.tgw]: {name: "flow", gap: 20, sort: "label", aspect: 3},
            [T.vpc]: {name: "ranked", sort: "order", columnGap: 16, rowGap: 12},
            [T.subnet]: {name: "flow", gap: 8, sort: "label"},
        },
    });
    // A resident that nests in its one subnet needs no line to it: the box says it.
    residents.redundant.forEach((id) => cy.getElementById(id).addClass(HIDDEN_CONTAINMENT_CLASS));

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

function _edgeType(e) {
    return e.data("edge_type") || e.data("label") || "";
}

/**
 * Derive where each RESIDES_IN_SUBNET source nests, from the scene's own edges.
 *
 * A resource in exactly one subnet of the scene nests in that subnet. A resource in two or more
 * subnets that all partition one VPC (a firewall's per-zone endpoints, a load balancer across zones)
 * nests in that VPC and keeps its lines to the subnets. Anything else is left to the edges alone.
 * The derivation is expressed as `_PLACED_IN` scene edges (the pattern shadow-nodes.js uses for its
 * placement edges), removed and rebuilt on every run.
 *
 * @returns {{inSubnet: Set<string>, redundant: string[]}} the entity types nested in a subnet, and
 *   the RESIDES_IN_SUBNET edge ids that duplicate a nesting and so are hidden.
 */
function _placeResidents(cy) {
    cy.edges().filter((e) => e.id().startsWith(PLACED_PREFIX)).remove();
    const vpcOfSubnet = new Map();
    cy.edges().forEach((e) => {
        if (_edgeType(e) === E.partitioned) vpcOfSubnet.set(e.target().id(), e.source().id());
    });
    const bySource = new Map();
    cy.edges().forEach((e) => {
        if (_edgeType(e) !== E.residesInSubnet) return;
        if (!bySource.has(e.source().id())) bySource.set(e.source().id(), []);
        bySource.get(e.source().id()).push(e);
    });
    const inSubnet = new Set();
    const redundant = [];
    bySource.forEach((edges, sourceId) => {
        const subnets = [...new Set(edges.map((e) => e.target().id()))];
        let parentId = null;
        if (subnets.length === 1) {
            parentId = subnets[0];
            inSubnet.add(cy.getElementById(sourceId).data("entity_type") || "");
            redundant.push(...edges.map((e) => e.id()));
        } else {
            const vpcs = new Set(subnets.map((s) => vpcOfSubnet.get(s)));
            if (vpcs.size === 1 && !vpcs.has(undefined)) parentId = [...vpcs][0];
        }
        if (!parentId) return;
        cy.add({
            group: "edges",
            data: {id: PLACED_PREFIX + sourceId, source: sourceId, target: parentId, label: "", edge_type: PLACED_IN},
            classes: HIDDEN_CONTAINMENT_CLASS,
        });
    });
    return {inSubnet, redundant};
}

/**
 * Stamp the `ranked` columns inside each VPC: one column per availability zone of its subnets (by
 * the subnet's `availability_zone`, zones in name order), public subnets at the top of each; what the
 * VPC holds directly in a column to their left.
 */
function _stampVpcColumns(cy) {
    const subnetsOf = new Map();
    cy.edges().forEach((e) => {
        if (_edgeType(e) !== E.partitioned) return;
        if (!subnetsOf.has(e.source().id())) subnetsOf.set(e.source().id(), []);
        subnetsOf.get(e.source().id()).push(e.target());
    });
    subnetsOf.forEach((subnets) => {
        const zones = [...new Set(subnets.map((s) => s.data("availability_zone")).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
        if (!zones.length) {
            // The scene carries no zone for any of this VPC's subnets (the graph panel lifts only a
            // node's tags onto the scene, not its model fields): a compact block instead of a tower,
            // square-ish, in label order.
            const width = Math.ceil(Math.sqrt(subnets.length));
            [...subnets].sort((a, b) => String(a.data("label")).localeCompare(String(b.data("label"))))
                .forEach((s, i) => s.data({_stage: i % width, _order: Math.floor(i / width)}));
            return;
        }
        subnets.forEach((s) => {
            const zone = s.data("availability_zone");
            s.data("_stage", zone ? zones.indexOf(zone) : NO_ZONE_STAGE);
            s.data("_order", s.data("public") === true ? 0 : 1);
        });
    });
    cy.edges().forEach((e) => {
        const t = _edgeType(e);
        if (t === E.attachedToVpc) e.source().data({_stage: VPC_LEVEL_STAGE, _order: 0});
        if (t === PLACED_IN && e.target().data("entity_type") === T.vpc) e.source().data({_stage: VPC_LEVEL_STAGE, _order: 1});
    });
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
