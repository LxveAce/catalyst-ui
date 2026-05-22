import React, { useCallback, useMemo } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { TerminalPanel } from './TerminalPanel';
import type { SplitNode, SplitContainerNode, SplitPaneNode } from '../../../shared/types';

export interface SplitLayoutProps {
  root: SplitNode;
  activePaneId: string;
  /** Called whenever the user drags a divider — payload is the new tree. */
  onLayoutChange: (next: SplitNode) => void;
  onFocusPane: (paneId: string) => void;
  onPidChange: (paneId: string, pid: number) => void;
  registerSender: (paneId: string, send: ((data: string) => void) | null) => void;
}

/**
 * Recursive renderer for a {@link SplitNode} tree using react-resizable-panels.
 * Each pane is a leaf {@link TerminalPanel} hosting its own xterm + PTY.
 *
 * Resize handles emit `onLayout` with new percentage sizes; we walk the
 * original tree and produce a new tree with updated `sizes` at the matching
 * subtree node so the parent can persist it. Children themselves are not
 * remounted (paneId identity is preserved across resizes).
 */
export function SplitLayout({
  root,
  activePaneId,
  onLayoutChange,
  onFocusPane,
  onPidChange,
  registerSender,
}: SplitLayoutProps) {
  return (
    <NodeRenderer
      node={root}
      path={[]}
      activePaneId={activePaneId}
      onLayoutChange={onLayoutChange}
      rootTree={root}
      onFocusPane={onFocusPane}
      onPidChange={onPidChange}
      registerSender={registerSender}
    />
  );
}

interface NodeRendererProps {
  node: SplitNode;
  /** Path of '0' | '1' indices from root to this node. */
  path: Array<0 | 1>;
  activePaneId: string;
  onLayoutChange: (next: SplitNode) => void;
  rootTree: SplitNode;
  onFocusPane: (paneId: string) => void;
  onPidChange: (paneId: string, pid: number) => void;
  registerSender: (paneId: string, send: ((data: string) => void) | null) => void;
}

function NodeRenderer(props: NodeRendererProps) {
  const { node } = props;
  if (node.type === 'pane') {
    return <PaneRenderer {...props} node={node} />;
  }
  return <ContainerRenderer {...props} node={node} />;
}

function PaneRenderer({
  node,
  activePaneId,
  onPidChange,
  registerSender,
  onFocusPane,
}: NodeRendererProps & { node: SplitPaneNode }) {
  return (
    <TerminalPanel
      paneId={node.id}
      cwd={node.cwd}
      active={node.id === activePaneId}
      onPidChange={onPidChange}
      registerSender={registerSender}
      onFocus={onFocusPane}
    />
  );
}

function ContainerRenderer({
  node,
  path,
  activePaneId,
  onLayoutChange,
  rootTree,
  onFocusPane,
  onPidChange,
  registerSender,
}: NodeRendererProps & { node: SplitContainerNode }) {
  /** react-resizable-panels uses 'horizontal' = side-by-side; in our tree the
   *  same word means "split goes horizontally → children stacked side-by-side"
   *  which happens to match. 'vertical' = stacked top/bottom. Same semantics. */
  const direction = node.direction === 'vertical' ? 'vertical' : 'horizontal';

  const handleResize = useCallback(
    (sizes: number[]) => {
      if (sizes.length !== 2) return;
      const [a, b] = sizes;
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        a <= 0 ||
        b <= 0
      ) {
        return;
      }
      // No-op if sizes match the current tree (avoids a state update storm
      // from the lib's initial onLayout fire).
      if (Math.abs(node.sizes[0] - a) < 0.01 && Math.abs(node.sizes[1] - b) < 0.01) {
        return;
      }
      const updated = updateNodeAtPath(rootTree, path, (n) => {
        if (n.type !== 'split') return n;
        return { ...n, sizes: [a, b] as [number, number] };
      });
      onLayoutChange(updated);
    },
    [node, onLayoutChange, path, rootTree]
  );

  // Stable id; react-resizable-panels uses it as a localStorage key when
  // `autoSaveId` is set. We don't enable autosave (we have SessionService for
  // that), but a stable id still helps the lib internally.
  const groupId = useMemo(() => `g_${path.join('') || 'root'}`, [path]);

  return (
    <PanelGroup direction={direction} onLayout={handleResize} id={groupId}>
      <Panel defaultSize={node.sizes[0]} minSize={10}>
        <NodeRenderer
          node={node.children[0]}
          path={[...path, 0]}
          activePaneId={activePaneId}
          onLayoutChange={onLayoutChange}
          rootTree={rootTree}
          onFocusPane={onFocusPane}
          onPidChange={onPidChange}
          registerSender={registerSender}
        />
      </Panel>
      <PanelResizeHandle
        style={{
          background: 'var(--border)',
          width: direction === 'horizontal' ? 3 : 'auto',
          height: direction === 'vertical' ? 3 : 'auto',
          transition: 'background var(--transition-fast)',
          cursor: direction === 'horizontal' ? 'col-resize' : 'row-resize',
        }}
      />
      <Panel defaultSize={node.sizes[1]} minSize={10}>
        <NodeRenderer
          node={node.children[1]}
          path={[...path, 1]}
          activePaneId={activePaneId}
          onLayoutChange={onLayoutChange}
          rootTree={rootTree}
          onFocusPane={onFocusPane}
          onPidChange={onPidChange}
          registerSender={registerSender}
        />
      </Panel>
    </PanelGroup>
  );
}

// --- tree helpers (exported for App.tsx + palette) ---------------------------

export function updateNodeAtPath(
  root: SplitNode,
  path: Array<0 | 1>,
  mutate: (n: SplitNode) => SplitNode
): SplitNode {
  if (path.length === 0) return mutate(root);
  if (root.type !== 'split') return root;
  const [head, ...rest] = path;
  const newChild = updateNodeAtPath(root.children[head], rest, mutate);
  const children: [SplitNode, SplitNode] = head === 0
    ? [newChild, root.children[1]]
    : [root.children[0], newChild];
  return { ...root, children };
}

/** In-order list of leaf pane ids, used for next/prev focus cycling. */
export function listPaneIds(root: SplitNode): string[] {
  if (root.type === 'pane') return [root.id];
  return [...listPaneIds(root.children[0]), ...listPaneIds(root.children[1])];
}

export function findPanePath(
  root: SplitNode,
  paneId: string
): Array<0 | 1> | null {
  if (root.type === 'pane') return root.id === paneId ? [] : null;
  const left = findPanePath(root.children[0], paneId);
  if (left !== null) return [0, ...left];
  const right = findPanePath(root.children[1], paneId);
  if (right !== null) return [1, ...right];
  return null;
}

export function getPaneAtPath(
  root: SplitNode,
  path: Array<0 | 1>
): SplitPaneNode | null {
  if (path.length === 0) {
    return root.type === 'pane' ? root : null;
  }
  if (root.type !== 'split') return null;
  return getPaneAtPath(root.children[path[0]], path.slice(1) as Array<0 | 1>);
}

/** Generate a paneId not currently present in the tree. */
export function newPaneId(root: SplitNode): string {
  const existing = new Set(listPaneIds(root));
  // Try compact ids first ("p_2", "p_3" …) and fall back to crypto if the
  // user has gone wild with closes/opens.
  for (let i = 2; i < 256; i++) {
    const candidate = `p_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `p_${cryptoRandomId()}`;
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Replace the leaf at `paneId` with a 2-child split containing the original
 * pane and a brand-new pane. Returns `{ tree, newPaneId }` so the caller can
 * focus the new pane.
 */
export function splitPane(
  root: SplitNode,
  paneId: string,
  direction: 'horizontal' | 'vertical'
): { tree: SplitNode; newPaneId: string } | null {
  const path = findPanePath(root, paneId);
  if (path === null) return null;
  const existingPane = getPaneAtPath(root, path);
  if (!existingPane) return null;
  const newId = newPaneId(root);
  const newPane: SplitPaneNode = { type: 'pane', id: newId, cwd: existingPane.cwd };
  const tree = updateNodeAtPath(root, path, () => ({
    type: 'split',
    direction,
    sizes: [50, 50],
    children: [existingPane, newPane],
  }));
  return { tree, newPaneId: newId };
}

/**
 * Remove the leaf at `paneId`. If the result would be an empty tree, returns
 * `null` (caller decides whether to forbid the close or reset to defaults).
 */
export function closePane(
  root: SplitNode,
  paneId: string
): { tree: SplitNode; nextFocus: string } | null {
  if (root.type === 'pane') {
    if (root.id !== paneId) return { tree: root, nextFocus: root.id };
    return null;
  }
  const path = findPanePath(root, paneId);
  if (path === null) return { tree: root, nextFocus: listPaneIds(root)[0] };
  if (path.length === 0) return null;

  // The parent of the closing leaf is everything except the last index.
  const parentPath = path.slice(0, -1) as Array<0 | 1>;
  const childIdx = path[path.length - 1];
  const siblingIdx = childIdx === 0 ? 1 : 0;

  const collapsed = updateNodeAtPath(root, parentPath, (n) => {
    if (n.type !== 'split') return n;
    return n.children[siblingIdx];
  });

  // Compute the next focus deterministically — first pane in the sibling
  // subtree we just promoted.
  const ids = listPaneIds(collapsed);
  const fallback = ids[0] ?? paneId;
  return { tree: collapsed, nextFocus: fallback };
}
