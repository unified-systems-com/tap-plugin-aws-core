/**
 * layout-hints — placement a layout reads from a node's own tags, never from its name or id
 * (req-aws-core-layout-hints).
 *
 * Three neutral tag keys, set on the node in the data that seeds or collects it:
 *
 *   layout:order   integer; siblings are placed in ascending order (a row left to right, a
 *                  column top to bottom). Unordered siblings come after the ordered ones, by label.
 *   layout:column  integer; which column of its parent a node sits in (0 = main, default).
 *                  Used by parents laid out as columns (stampColumns).
 *   layout:fill    "true"; the box widens to its lane: the width of the column it shares with
 *                  other siblings, or else the rest of the row it sits in.
 *
 * The helpers stamp `_stage` / `_order` for tap_viz's `ranked` inner layout (nested-projection.js)
 * and stretch filled boxes after projection. Any layout module may import them; they know no
 * entity type and no deployment.
 */

export const LAYOUT_TAG = {order: "layout:order", column: "layout:column", fill: "layout:fill"};

//: Offset for siblings with no layout:order, so they always follow the ordered ones.
const UNORDERED = 100000;

//: The integer value of a tag, or null when absent or not an integer.
export function intTag(n, key) {
    const raw = (n.data("tags") || {})[key];
    if (raw === undefined || raw === null || raw === "") return null;
    const v = Number(raw);
    return Number.isInteger(v) ? v : null;
}

export function isFill(n) {
    return String((n.data("tags") || {})[LAYOUT_TAG.fill] || "") === "true";
}

export function childrenOf(cy, parentId) {
    return cy.nodes().filter((n) => n.data("_viewport_parent") === parentId);
}

//: Move a node and everything nested in it.
export function moveTree(cy, node, dx, dy) {
    if (!dx && !dy) return;
    const p = node.position();
    node.position({x: p.x + dx, y: p.y + dy});
    childrenOf(cy, node.id()).forEach((c) => moveTree(cy, c, dx, dy));
}

function _byLabel(a, b) {
    return String(a.data("label") || "").localeCompare(String(b.data("label") || ""));
}

//: One row: each sibling its own `ranked` column, in layout:order; unordered ones after, by label.
export function stampRow(siblings) {
    const unordered = siblings.filter((n) => intTag(n, LAYOUT_TAG.order) === null).sort(_byLabel);
    siblings.forEach((n) => {
        const order = intTag(n, LAYOUT_TAG.order);
        if (order !== null) {
            n.data("_stage", order);
            n.data("_order", order);
        }
    });
    unordered.forEach((n, i) => {
        n.data("_stage", UNORDERED + i);
        n.data("_order", UNORDERED + i);
    });
}

//: Columns: layout:column picks the column (default 0), layout:order the place in it.
export function stampColumns(siblings) {
    siblings.forEach((n) => {
        const column = intTag(n, LAYOUT_TAG.column);
        const order = intTag(n, LAYOUT_TAG.order);
        n.data("_stage", column === null ? 0 : column);
        n.data("_order", order === null ? UNORDERED : order);
    });
}

function _depth(cy, n) {
    let d = 0;
    let p = n.data("_viewport_parent");
    while (p) {
        d += 1;
        p = cy.getElementById(p).data("_viewport_parent");
    }
    return d;
}

/**
 * Stretch every box tagged layout:fill, parents before children.
 *
 * In a column (siblings sharing its `_stage`) it widens to the column's widest box, keeping the
 * column's centre. Otherwise it takes the rest of its row (siblings whose vertical extent overlaps
 * it) inside the parent's inner width, and the row is re-packed left to right with its gap.
 *
 * @param {cytoscape.Core} cy
 * @param {{inset?: number}} [opts] - the parent's side padding (default 24).
 */
export function fill(cy, opts) {
    const inset = (opts && opts.inset != null) ? opts.inset : 24;
    const fills = cy.nodes().filter(isFill).sort((a, b) => _depth(cy, a) - _depth(cy, b));
    fills.forEach((n) => {
        const parentId = n.data("_viewport_parent");
        if (!parentId) return;
        const parent = cy.getElementById(parentId);
        const siblings = childrenOf(cy, parentId);
        const stage = n.data("_stage");
        const column = Number.isInteger(stage) ? siblings.filter((s) => s.id() !== n.id() && s.data("_stage") === stage) : [];
        if (column.length) {
            const width = Math.max(...column.map((s) => s.width()));
            if (width > n.width()) n.style({width});
            return;
        }
        const innerLeft = parent.position().x - parent.width() / 2 + inset;
        const innerW = parent.width() - inset * 2;
        const y0 = n.position().y - n.height() / 2;
        const y1 = n.position().y + n.height() / 2;
        const row = siblings.filter((s) => {
            const t = s.position().y - s.height() / 2;
            const b = s.position().y + s.height() / 2;
            return t < y1 && b > y0;
        }).sort((a, b) => a.position().x - b.position().x);
        const gap = row.length > 1 ? (row[1].position().x - row[1].width() / 2) - (row[0].position().x + row[0].width() / 2) : 0;
        const others = row.filter((s) => s.id() !== n.id()).reduce((w, s) => w + s.width(), 0);
        const width = innerW - others - gap * (row.length - 1);
        if (width <= n.width()) return;
        n.style({width});
        let x = innerLeft;
        row.forEach((s) => {
            moveTree(cy, s, x + s.width() / 2 - s.position().x, 0);
            x += s.width() + gap;
        });
    });
}
