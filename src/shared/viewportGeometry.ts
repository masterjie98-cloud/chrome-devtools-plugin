export interface ViewportRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

/**
 * Returns deterministic probe points inside the visible intersection of an
 * element and the viewport. The first point is the visible center; the
 * remaining points let callers recover when that center is covered by a
 * floating child or overlay while another part of the element is clickable.
 */
export function viewportProbePoints(
  rect: ViewportRectLike,
  viewport: ViewportSize,
): ViewportPoint[] {
  if (
    !isFiniteRect(rect) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return [];
  }

  const left = Math.max(0, Math.min(viewport.width, rect.left));
  const top = Math.max(0, Math.min(viewport.height, rect.top));
  const right = Math.max(0, Math.min(viewport.width, rect.right));
  const bottom = Math.max(0, Math.min(viewport.height, rect.bottom));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    return [];
  }

  const insetX = Math.min(2, width / 4);
  const insetY = Math.min(2, height / 4);
  const x1 = left + insetX;
  const x2 = right - insetX;
  const y1 = top + insetY;
  const y2 = bottom - insetY;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const candidates = [
    { x: centerX, y: centerY },
    { x: x1, y: centerY },
    { x: x2, y: centerY },
    { x: centerX, y: y1 },
    { x: centerX, y: y2 },
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x1, y: y2 },
    { x: x2, y: y2 },
  ];

  const seen = new Set<string>();
  return candidates.flatMap((point) => {
    const rounded = {
      x: Math.round(point.x * 100) / 100,
      y: Math.round(point.y * 100) / 100,
    };
    const key = `${rounded.x}:${rounded.y}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [rounded];
  });
}

function isFiniteRect(rect: ViewportRectLike): boolean {
  return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite);
}
