/* Formatação de registros; não modifica os dados originais. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.monitorFormat = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function decode(value) {
    if (typeof value !== 'string') return value;
    let result = value;
    for (let i = 0; i < 2; i++) {
      try { const decoded = JSON.parse(result); if (typeof decoded !== 'string') break; result = decoded; }
      catch { break; }
    }
    return result;
  }
  function readable(value) {
    value = decode(value);
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  const protectedNotice = '[Conteúdo protegido ou codificado indisponível para leitura.]';
  // Reconhece apenas o padrão observado de tokens Fernet, sem classificar todo texto em base64 como protegido.
  function isProtectedToken(value) {
    if (typeof value !== 'string') return false;
    const token = value.trim();
    return token.length >= 100 && /^gAAAAA[A-Za-z0-9_-]+={0,2}$/.test(token);
  }
  function displayText(value) {
    const text = readable(value);
    return isProtectedToken(text) ? protectedNotice : text;
  }
  function formatCall(name, args, resolveRecipient) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { text: readable(args) || '', raw: args };
    const find = (...keys) => { for (const key of keys) if (args[key] !== undefined && args[key] !== null) return decode(args[key]); };
    const message = find('Message', 'message', 'Prompt', 'prompt', 'task', 'instructions');
    const recipient = find('Recipient', 'recipient', 'target');
    const role = find('Role', 'role', 'task_name', 'name');
    const type = find('TypeName', 'type_name');
    const lines = [];
    if (message !== undefined) lines.push(displayText(message));
    if (recipient !== undefined) lines.push(`Para: ${resolveRecipient(String(recipient))}`);
    if (role !== undefined) lines.push(`Agente: ${readable(role)}`);
    if (type !== undefined) lines.push(`Tipo: ${readable(type)}`);
    return { text: lines.join('\n\n') || 'Dados disponíveis nos detalhes técnicos.', raw: args };
  }
  function formatSystemMessage(content, resolveRecipient) {
    const text = String(content || '');
    const match = text.match(/\[Message\]\s+timestamp=\S+\s+sender=(\S+)\s+priority=\S+\s+content=([\s\S]*?)(?:\s*<\/SYSTEM_MESSAGE>\s*)?$/);
    if (!match) return null;
    return { text: `De: ${resolveRecipient(match[1])}\n\n${displayText(match[2].trim())}`, raw: text };
  }
  function formatAgentMessage(content, hasProtectedContent, resolveRecipient, raw) {
    const text = String(content || '');
    const match = text.match(/^Message Type:\s*([^\r\n]+)\r?\nTask name:\s*([^\r\n]+)\r?\nSender:\s*([^\r\n]+)\r?\nPayload:\s*([\s\S]*)$/);
    if (!match) {
      const visible = displayText(text);
      return { text: [visible, hasProtectedContent && protectedNotice].filter(Boolean).join('\n\n'), raw };
    }
    const labels = { NEW_TASK: 'Nova tarefa', MESSAGE: 'Mensagem', FINAL_ANSWER: 'Resposta final', FOLLOWUP_TASK: 'Tarefa de acompanhamento', TASK_COMPLETE: 'Tarefa concluída' };
    const type = match[1].trim();
    const payload = match[4].trim();
    const lines = [labels[type] || `Tipo: ${type}`, `Tarefa: ${match[2].trim()}`, `De: ${resolveRecipient(match[3].trim())}`];
    if (payload) lines.push(displayText(payload));
    if (hasProtectedContent && (!payload || !isProtectedToken(payload))) lines.push(protectedNotice);
    return { text: lines.join('\n\n'), raw };
  }
  function compactTokens(total) {
    return Number.isFinite(total) && total >= 0 ? `${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(total).replace(/\u00a0/g, ' ')} tokens` : 'tokens indisponíveis';
  }
  function modelLabels(models) {
    if (!Array.isArray(models) || !models.length) return ['Modelo e esforço indisponíveis'];
    return models.map(entry => `${entry.model || 'Modelo indisponível'} · esforço: ${entry.effort || 'indisponível'}`);
  }
  return { decode, formatCall, formatSystemMessage, formatAgentMessage, isProtectedToken, compactTokens, modelLabels };
});
