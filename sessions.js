const fs = require('fs').promises;
const path = require('path');

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
function parseTranscript(text) {
  return text.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
async function collectSessions(brain) {
  let dirs;
  try { dirs = await fs.readdir(brain, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return { sessions: [], warning: 'Pasta de registros não encontrada. Inicie uma sessão no Antigravity CLI.' }; throw e; }
  const sessions = await Promise.all(dirs.filter(d => d.isDirectory() && idPattern.test(d.name)).map(async d => {
    const root = path.join(brain, d.name, '.system_generated');
    const file = path.join(root, 'logs', 'transcript.jsonl');
    let text, stat;
    try { [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]); } catch { return null; }
    let entries = [];
    try { entries = await fs.readdir(path.join(root, 'subagents')); } catch { /* sem subagentes */ }
    const children = (await Promise.all(entries.map(name => readJson(path.join(root, 'subagents', name))))).filter(child => child && idPattern.test(child.conversationId || '')).map(child => ({ id: child.conversationId, role: child.subagentDescriptor?.role || 'Subagente', state: child.state || '' }));
    return { id: d.name, modified: stat.mtimeMs, events: parseTranscript(text), children };
  }));
  return { sessions: sessions.filter(Boolean).sort((a, b) => b.modified - a.modified), warning: '' };
}
module.exports = { collectSessions, parseTranscript };
