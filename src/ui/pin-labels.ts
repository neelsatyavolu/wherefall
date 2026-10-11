/**
 * Which players' pins can carry their names on a match's reveal. A name is a box on the map, and
 * with twenty players the boxes land on one another: a name that would lie on a pin already drawn
 * is left off, and its pin is a bare mark that gives its name to the pointer or a tap (`map.css`).
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** the air two names keep between them, in pixels */
const AIR = 4;

/** The box of a pin of a size, centred on its point, as the map draws it. */
export function boxAround(point: { x: number; y: number }, size: { width: number; height: number }): Box {
  return { left: point.x - size.width / 2, top: point.y - size.height / 2, right: point.x + size.width / 2, bottom: point.y + size.height / 2 };
}

const tooClose = (one: Box, other: Box): boolean =>
  one.left < other.right + AIR && other.left < one.right + AIR && one.top < other.bottom + AIR && other.top < one.bottom + AIR;

/**
 * For each of `named`, in order: whether its name fits, clear of what is `fixed` on the map (the
 * place, the viewer's own pin) and of every name kept before it. A pin whose name is left off takes
 * no room in the count: it is drawn small, and the next name may stand where its name would have.
 */
export function namesThatFit(fixed: readonly Box[], named: readonly Box[]): boolean[] {
  const taken = [...fixed];
  return named.map((box) => {
    const fits = !taken.some((other) => tooClose(box, other));
    if (fits) {
      taken.push(box);
    }
    return fits;
  });
}
