/* Renderiza tokens Markdown com APIs DOM; nunca interpreta HTML das mensagens. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.monitorMarkdown = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }
  function render(text, document, parser) {
    const root = document.createElement('div');
    root.className = 'message-content';
    function node(tag, content) { const item = document.createElement(tag); if (content !== undefined) item.textContent = content; return item; }
    function appendTokens(container, tokens) {
      for (const token of tokens || []) {
        let item;
        switch (token.type) {
          case 'space': case 'def': break;
          case 'text': case 'escape':
            if (token.tokens) appendTokens(container, token.tokens);
            else container.append(document.createTextNode(token.text || ''));
            break;
          case 'paragraph': case 'strong': case 'em': case 'del': case 'blockquote': {
            const tag = { paragraph: 'p', strong: 'strong', em: 'em', del: 'del', blockquote: 'blockquote' }[token.type];
            item = node(tag); appendTokens(item, token.tokens); container.append(item); break;
          }
          case 'heading': item = node(`h${Math.max(1, Math.min(6, token.depth || 1))}`); appendTokens(item, token.tokens); container.append(item); break;
          case 'codespan': container.append(node('code', token.text || '')); break;
          case 'code': item = node('pre'); item.append(node('code', token.text || '')); container.append(item); break;
          case 'br': container.append(node('br')); break;
          case 'hr': container.append(node('hr')); break;
          case 'checkbox': container.append(node('span', token.checked ? '☑ ' : '☐ ')); break;
          case 'list':
            item = node(token.ordered ? 'ol' : 'ul');
            if (token.ordered && Number.isInteger(token.start) && token.start > 0) item.start = token.start;
            for (const entry of token.items || []) { const li = node('li'); appendTokens(li, entry.tokens); item.append(li); }
            container.append(item); break;
          case 'link': {
            const url = safeUrl(token.href);
            item = node(url ? 'a' : 'span');
            if (url) { item.href = url; item.rel = 'noopener noreferrer'; }
            appendTokens(item, token.tokens); container.append(item); break;
          }
          case 'image': container.append(document.createTextNode(token.text ? `[Imagem: ${token.text}]` : '[Imagem]')); break;
          case 'table': {
            const wrap = node('div'); wrap.className = 'table-wrap';
            const table = node('table'); const head = node('thead'); const row = node('tr');
            for (const cell of token.header || []) { const th = node('th'); appendTokens(th, cell.tokens); row.append(th); }
            head.append(row); table.append(head);
            const body = node('tbody');
            for (const cells of token.rows || []) { const tr = node('tr'); for (const cell of cells) { const td = node('td'); appendTokens(td, cell.tokens); tr.append(td); } body.append(tr); }
            table.append(body); wrap.append(table); container.append(wrap); break;
          }
          // HTML e qualquer token desconhecido são inseridos como texto literal.
          default: container.append(document.createTextNode(token.raw || token.text || ''));
        }
      }
    }
    try { appendTokens(root, parser.lexer(String(text), { gfm: true, breaks: true })); }
    catch { root.textContent = String(text); }
    return root;
  }
  return { render, safeUrl };
});
