/**
 * aws-organization — the AWS Organizations tree as nested boxes (req-aws-core-page-organization).
 *
 * Containment is aws_core's NESTED_UNDER_PARENT edge only (child → parent): the organization
 * around its top-level OUs and accounts, each OU around its children. Anything else a search
 * brings into the scene (a policy, a boundary, an identity source) is dropped before layout, so
 * the tree has no lines across it.
 *
 * Placement comes from the nodes' own layout tags (layout-hints.js), never from a name or id:
 *
 *   - the organization lays its children out in columns: `layout:column` picks the column
 *     (0, the default, is the main one), `layout:order` the place in it, top to bottom;
 *   - an OU lays its children out in one row, in `layout:order`, unordered ones after by label;
 *     an OU tagged `layout:columns` wraps at that many per row (1 stacks them in a column);
 *   - a box tagged `layout:fill` widens to its lane (its parent's single column, its column, or
 *     the rest of its row).
 *
 * With no tags at all the tree still draws: one column under the organization, rows by label.
 *
 * Standard tap layout module: `export async function execute(context)` (spec-viz-layouts.md).
 */

import {projectNested} from "/static/tap_viz/js/runtime/nested-projection.js";
import {applyStandardChrome, placeParentLabels, parentLabelInset} from "/static/tap_viz/js/runtime/chrome.js";
import {
    stampColumns, arrangeRows, fill, childrenOf, rowLayouts, styleRows, ROW_RELATIONSHIP,
} from "/static/aws_core/js/runtime/layout-hints.js";

const T = {
    organization: "aws_core__aws_organization",
    ou: "aws_core__aws_organizational_unit",
    account: "aws_core__aws_account",
};
const NESTED = "NESTED_UNDER_PARENT__aws_core";
const CONTAINERS = [T.organization, T.ou];
const TREE = [T.organization, T.ou, T.account];
const GEOM = {leaf: {width: 180, height: 56}, box: {width: 220, height: 72}, labelInset: 16, side: 24};

function _edgeType(e) {
    return e.data("edge_type") || e.data("label") || "";
}

//: Stamp `_stage` / `_order` for `ranked` from the NESTED_UNDER_PARENT edges, before projection.
function _stamp(cy) {
    const byParent = new Map();
    const nested = cy.edges().filter((e) => _edgeType(e) === NESTED);
    nested.forEach((e) => {
        const parent = e.target();
        if (!byParent.has(parent.id())) byParent.set(parent.id(), {parent, children: []});
        byParent.get(parent.id()).children.push(e.source());
    });
    byParent.forEach(({parent, children}) => {
        if (parent.data("entity_type") === T.organization) stampColumns(children);
        else arrangeRows(cy, parent, children, {containEdges: nested});
    });
}

export async function execute(context) {
    const {cy} = context;
    cy.remove(cy.nodes().filter((n) => !TREE.includes(n.data("entity_type"))));
    const chrome = applyStandardChrome(cy);
    const labelInset = parentLabelInset({...chrome, inset: GEOM.labelInset});
    const pad = {top: 14 + labelInset, right: GEOM.side, bottom: GEOM.side, left: GEOM.side};

    _stamp(cy);
    const types = [...new Set(cy.nodes().map((n) => n.data("entity_type")).filter(Boolean))];
    const baseSizes = Object.fromEntries(types.map((t) => [t, CONTAINERS.includes(t) ? GEOM.box : GEOM.leaf]));
    const rows = rowLayouts(24);

    const result = await projectNested(cy, {
        relationships: [
            {name: "org-holds", gryphon: `(parent:${T.organization})<-[:${NESTED}]-(child)`},
            {name: "ou-holds", gryphon: `(parent:${T.ou})<-[:${NESTED}]-(child)`},
            ROW_RELATIONSHIP,
        ],
        baseSizes: {...baseSizes, ...rows.baseSize},
        padding: GEOM.side,
        paddings: {...Object.fromEntries(CONTAINERS.map((t) => [t, pad])), ...rows.padding},
        innerLayout: {name: "ranked", sort: "order", columnGap: 24, rowGap: 24},
        innerLayouts: {
            [T.organization]: {name: "ranked", sort: "order", columnGap: 56, rowGap: 36},
            ...rows.innerLayout,
        },
    });

    fill(cy, {inset: GEOM.side});
    cy.nodes(CONTAINERS.map((t) => `[entity_type = "${t}"]`).join(", ")).forEach((n) => {
        if (childrenOf(cy, n.id()).empty()) n.addClass("tap-viewport-parent");
    });
    placeParentLabels(cy, {
        anchor: "upper-left", inset: GEOM.labelInset,
        parentFontSize: chrome.parentFontSize, parentFontWeight: chrome.parentFontWeight,
    });
    _style(cy);
    styleRows(cy);
    return {warnings: result.warnings || []};
}

function _style(cy) {
    cy.style()
        .selector(`node[entity_type = "${T.organization}"]`)
        .style({"shape": "round-rectangle", "background-color": "#eef2f7", "background-opacity": 1,
                "border-width": 1.5, "border-color": "#7b93b8", "color": "#1e3a5f"})
        .selector(`node[entity_type = "${T.ou}"]`)
        .style({"shape": "round-rectangle", "background-color": "#f8fafc", "background-opacity": 1,
                "border-width": 1, "border-style": "dashed", "border-color": "#94a3b8", "color": "#334155"})
        .update();
}
