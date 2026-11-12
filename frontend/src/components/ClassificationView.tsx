import { memo } from "react";
import type { ClassificationNode } from "../api/types";
import { plural } from "../lib/format";
import { classificationParent, classificationPath } from "../state/search";

interface Props {
  nodes: ClassificationNode[]; // facets.classification of the current response
  selected: string | null; // the classification filter that response answers
  onSelect: (code: string | null) => void;
}

function findNode(nodes: ClassificationNode[], path: string[]): ClassificationNode | null {
  let level = nodes;
  let found: ClassificationNode | null = null;
  for (const code of path) {
    found = level.find((n) => n.code === code) ?? null;
    if (!found) return null;
    level = found.children;
  }
  return found;
}

/**
 * Drill-down: lists the children of the selected node with count bars. Levels with a single
 * child (every sample patent is under B › B60) are skipped in the list but kept in the
 * breadcrumb, so the first list is already useful.
 */
export const ClassificationView = memo(function ClassificationView({ nodes, selected, onSelect }: Props) {
  const path = selected ? classificationPath(selected) : [];
  const selectedNode = selected ? findNode(nodes, path) : null;

  let parent: ClassificationNode | null = selectedNode;
  let rows = selectedNode ? selectedNode.children : nodes;
  const implied: string[] = [];
  while (rows.length === 1 && rows[0].children.length > 0) {
    implied.push(rows[0].code);
    parent = rows[0];
    rows = rows[0].children;
  }
  if (selectedNode && rows.length === 0) rows = [selectedNode]; // a leaf: show it, selected
  const base = Math.max(1, parent?.count ?? rows.reduce((sum, n) => sum + n.count, 0));
  const crumbs = [...path, ...implied];

  return (
    <section className="panel classification" aria-labelledby="classification-heading">
      <h2 id="classification-heading" className="panel-title">
        Classification
      </h2>
      <nav aria-label="Classification path">
        <ol className="breadcrumb">
          <li>
            {selected ? (
              <button type="button" className="crumb" onClick={() => onSelect(null)}>
                All classes
              </button>
            ) : (
              <span className="crumb crumb--current" aria-current="true">
                All classes
              </span>
            )}
          </li>
          {crumbs.map((code) => (
            <li key={code}>
              <span className="crumb-sep" aria-hidden="true">
                ›
              </span>
              {code === selected ? (
                <span className="crumb crumb--current mono" aria-current="true">
                  {code}
                </span>
              ) : (
                <button type="button" className="crumb mono" onClick={() => onSelect(code)}>
                  {code}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {rows.length === 0 ? (
        <p className="panel-empty">No classes in this selection.</p>
      ) : (
        <ul className="class-list">
          {rows.map((node) => {
            const isSelected = node.code === selected;
            return (
              <li key={node.code}>
                <button
                  type="button"
                  className="class-row"
                  aria-pressed={isSelected}
                  aria-label={`${node.code}: ${plural(node.count, "patent", "patents")}`}
                  onClick={() => onSelect(isSelected ? (classificationParent(node.code) ?? null) : node.code)}
                >
                  <span className="class-code mono">{node.code}</span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar" style={{ width: `${(node.count / base) * 100}%` }} />
                  </span>
                  <span className="class-count mono">{node.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
