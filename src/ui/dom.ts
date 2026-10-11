import { formatNumber } from '../i18n/index.ts';

type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

/** Small element builder, so screens are built without innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) {
    node.className = props.class;
  }
  if (props.text !== undefined) {
    node.textContent = props.text;
  }
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    node.setAttribute(name, value);
  }
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    node.addEventListener(type, handler as EventListener);
  }
  node.append(...children.filter((child): child is Node | string => Boolean(child)));
  return node;
}

/**
 * A translated sentence with nodes (links) in it: the template's text with each `{name}` place that
 * has a node swapped for it, in the order the language puts them. Places with no node stay as text.
 */
export function withNodes(template: string, nodes: Record<string, Node>): Child[] {
  return template.split(/\{(\w+)\}/).map((part, index) => (index % 2 === 0 ? part : (nodes[part] ?? `{${part}}`)));
}

export { countryName } from '../game/locations.ts';

export const formatScore = (score: number) => formatNumber(score);
