/* Organização baseada apenas nos vínculos registrados. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.monitorTree = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function build(sessions) {
    const byId = new Map(sessions.map(s => [s.id, s]));
    const parent = new Map(), children = new Map();
    for (const s of sessions) for (const child of s.children || []) {
      if (child.id !== s.id && !parent.has(child.id)) parent.set(child.id, {id:s.id, role:child.role, relation:child.relation});
    }
    for (const s of sessions) if (s.parent && s.parent !== s.id && !parent.has(s.id)) parent.set(s.id, {id:s.parent, role:s.role});
    for (const [id, link] of parent) if (byId.has(id) && byId.has(link.id)) {
      if (!children.has(link.id)) children.set(link.id, []);
      children.get(link.id).push(byId.get(id));
    }
    return {byId, parent, children};
  }
  function rows(sessions, options = {}) {
    const graph = build(sessions), {byId, parent, children} = graph;
    const kind = options.kind || 'all', source = options.source || '', query = (options.query || '').toLowerCase().trim();
    const expanded = options.expanded || new Set();
    const title = options.title || (s => s.id);
    const allowed = s => (!source || s.source === source) && (kind === 'all' || (kind === 'agents' ? parent.has(s.id) : !parent.has(s.id)));
    const textMatch = s => !query || `${title(s)} ${s.id} ${parent.get(s.id)?.role || ''} ${(s.events || []).map(e => e.content || '').join(' ')}`.toLowerCase().includes(query);
    function subtreeMatches(s, seen) {
      if (seen.has(s.id)) return false;
      const next = new Set(seen); next.add(s.id);
      return (allowed(s) && textMatch(s)) || (children.get(s.id) || []).some(c => subtreeMatches(c, next));
    }
    const out = [], visited = new Set();
    function walk(s, depth) {
      if (visited.has(s.id) || !subtreeMatches(s, new Set())) return;
      visited.add(s.id);
      const visible = allowed(s) && (textMatch(s) || kind === 'all');
      const descendants = (children.get(s.id) || []).filter(c => subtreeMatches(c, new Set([s.id])));
      if (visible) out.push({session:s, depth, role:parent.get(s.id)?.role, relation:parent.get(s.id)?.relation, agent:parent.has(s.id), parentId:parent.get(s.id)?.id, hasChildren:descendants.length > 0, expanded:!!query || expanded.has(s.id)});
      if (!visible || query || expanded.has(s.id)) for (const c of descendants) walk(c, depth + (visible ? 1 : 0));
    }
    const reachable = new Set();
    function mark(s) { if (reachable.has(s.id)) return; reachable.add(s.id); for (const c of children.get(s.id) || []) mark(c); }
    for (const s of sessions) if (!parent.has(s.id) || !byId.has(parent.get(s.id).id)) { mark(s); walk(s, 0); }
    // Vínculos cíclicos não devem ocultar todos os registros desse grupo.
    for (const s of sessions) if (!reachable.has(s.id)) { mark(s); walk(s, 0); }
    return { ...graph, rows:out };
  }
  return {build, rows};
});
