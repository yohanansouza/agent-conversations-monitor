class Notifications {
  constructor() { this.known = new Map(); this.unread = new Set(); }
  update(source, sessions) {
    const previous = this.known.get(source);
    const current = new Set(sessions.map(session => session.id));
    if (previous) for (const id of current) if (!previous.has(id)) this.unread.add(id);
    this.known.set(source, current);
    for (const id of this.unread) if (previous?.has(id) && !current.has(id)) this.unread.delete(id);
  }
  read(id) { this.unread.delete(id); }
  list() { return [...this.unread]; }
}
module.exports = { Notifications };
