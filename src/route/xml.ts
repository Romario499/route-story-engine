// Ограниченный XML-сканер без DOM и внешних сущностей. Имена с namespace сохраняются для проверки вложенности.
import { ROUTE_ERRORS, RouteParseError } from './errors';

export interface XmlNode { name: string; attrs: Record<string, string>; text: string; children: XmlNode[] }
const fail = (): never => { throw new RouteParseError(ROUTE_ERRORS.unreadable('повреждённый или небезопасный XML KML')); };

function unescapeXml(s: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(s)) fail();
  return s.replace(/&([^;\s]+);/g, (_m, value: string) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (value in predefined) return predefined[value];
    if (!/^#(?:\d+|x[\da-f]+)$/i.test(value)) return fail();
    const n = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
    if (n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return fail();
    return String.fromCodePoint(n);
  });
}

export const localName = (node: XmlNode): string => node.name.split(':').pop()!;
export const child = (node: XmlNode, name: string): XmlNode | undefined => node.children.find((n) => localName(n) === name);
export const value = (node: XmlNode, name: string): string => child(node, name)?.text.trim() ?? '';
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const visit = (n: XmlNode) => { if (localName(n) === name) out.push(n); for (const c of n.children) visit(c); };
  visit(node);
  return out;
}

export function parseXml(input: string): XmlNode {
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(input) || input.length > 32 * 1024 * 1024) fail();
  const root: XmlNode = { name: '', attrs: {}, text: '', children: [] }, stack = [root];
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g;
  let end = 0;
  for (const m of input.matchAll(tokens)) {
    if (m.index !== end) fail();
    end = m.index + m[0].length;
    const token = m[0], current = stack[stack.length - 1];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { if (stack.length < 2) fail(); current.text += token.slice(9, -3); continue; }
    if (!token.startsWith('<')) { if (stack.length === 1 && token.trim()) fail(); current.text += unescapeXml(token); continue; }
    const close = /^<\/([\w:.-]+)\s*>$/.exec(token);
    if (close) { if (stack.length < 2 || current.name !== close[1]) fail(); stack.pop(); continue; }
    const open = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!open || stack.length > 128) fail();
    const attrs: Record<string, string> = {};
    let rest = open![2];
    while (rest.trim()) {
      const a = /^\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if (!a || a[1] in attrs) fail();
      const attrValue = a![2] ?? a![3];
      if (attrValue.includes('<')) fail();
      attrs[a![1]] = unescapeXml(attrValue);
      rest = rest.slice(a![0].length);
    }
    const node: XmlNode = { name: open![1], attrs, text: '', children: [] };
    current.children.push(node);
    if (!open![3]) stack.push(node);
  }
  if (end !== input.length || stack.length !== 1 || root.children.length !== 1 || localName(root.children[0]) !== 'kml') fail();
  return root.children[0];
}
