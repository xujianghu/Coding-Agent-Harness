interface Reference { ref: number }
interface SpecialNumber { number: 'nan' | 'infinity' | '-infinity' | '-zero' }
type Encoded = null | string | boolean | number | Reference | SpecialNumber | { undefined: true };
interface GraphNode { type: 'array' | 'object'; nullPrototype?: boolean; items: Encoded[] | Array<[string, Encoded]> }
export interface ValueGraph { root: Encoded; nodes: GraphNode[] }

/** 只传递数据，支持 NaN、共享引用与无原型对象，不在父进程执行候选代码。 */
export function encodeValue(value: unknown): ValueGraph {
  const nodes: GraphNode[] = [];
  const seen = new Map<object, number>();
  function encode(current: unknown, depth: number): Encoded {
    if (depth > 64) throw new Error('RPC 数据嵌套过深');
    if (current === undefined) return { undefined: true };
    if (typeof current === 'number') {
      if (Number.isNaN(current)) return { number: 'nan' };
      if (current === Infinity) return { number: 'infinity' };
      if (current === -Infinity) return { number: '-infinity' };
      if (Object.is(current, -0)) return { number: '-zero' };
      return current;
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current !== 'object') throw new Error('RPC 不接受函数或其他可执行值');
    if (seen.has(current)) return { ref: seen.get(current)! };
    if (nodes.length >= 10000) throw new Error('RPC 数据节点过多');
    const ref = nodes.length; seen.set(current, ref);
    const node: GraphNode = { type: Array.isArray(current) ? 'array' : 'object', nullPrototype: Object.getPrototypeOf(current) === null, items: [] };
    nodes.push(node);
    node.items = Array.isArray(current) ? current.map(item => encode(item, depth + 1))
      : Object.keys(current).map(key => [key, encode((current as Record<string, unknown>)[key], depth + 1)]);
    return { ref };
  }
  return { root: encode(value, 0), nodes };
}

export function decodeValue(graph: ValueGraph): unknown {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length > 10000) throw new Error('无效的 RPC 数据图');
  const objects: unknown[] = graph.nodes.map(node => {
    if (node.type === 'array') return [];
    if (node.type === 'object') return node.nullPrototype ? Object.create(null) as object : {};
    throw new Error('无效的 RPC 节点类型');
  });
  function decode(value: Encoded): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
    if (!value || typeof value !== 'object') throw new Error('无效的 RPC 值');
    if ('ref' in value && Number.isInteger(value.ref) && value.ref >= 0 && value.ref < objects.length) return objects[value.ref];
    if ('undefined' in value && value.undefined === true) return undefined;
    if ('number' in value) {
      if (value.number === 'nan') return NaN;
      if (value.number === 'infinity') return Infinity;
      if (value.number === '-infinity') return -Infinity;
      if (value.number === '-zero') return -0;
    }
    throw new Error('无效的 RPC 数据值');
  }
  graph.nodes.forEach((node, index) => {
    if (!Array.isArray(node.items) || node.items.length > 10000) throw new Error('无效的 RPC 节点内容');
    if (node.type === 'array') for (const item of node.items as Encoded[]) (objects[index] as unknown[]).push(decode(item));
    else for (const entry of node.items as Array<[string, Encoded]>) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') throw new Error('无效的 RPC 对象属性');
      Object.defineProperty(objects[index], entry[0], { value: decode(entry[1]), enumerable: true, configurable: true, writable: true });
    }
  });
  return decode(graph.root);
}
