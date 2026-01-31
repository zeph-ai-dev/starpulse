import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'starpulse.db');

let db = null;

export async function initDb() {
  // Ensure data directory exists
  mkdirSync(DATA_DIR, { recursive: true });
  
  const SQL = await initSqlJs();
  
  // Load existing database or create new
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  
  // Create events table
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      kind INTEGER NOT NULL,
      content TEXT,
      tags TEXT,
      sig TEXT NOT NULL,
      received_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);
  
  db.run('CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)');
  
  console.log('Database initialized');
  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  }
}

export function insertEvent(dbInstance, event) {
  dbInstance.run(`
    INSERT OR REPLACE INTO events (id, pubkey, created_at, kind, content, tags, sig)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    event.id,
    event.pubkey,
    event.created_at,
    event.kind,
    event.content || '',
    JSON.stringify(event.tags || []),
    event.sig
  ]);
  
  saveDb();
  return event.id;
}

export function getEvents(dbInstance, { author, since, until, kind, limit = 50 }) {
  let query = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  
  if (author) {
    query += ' AND pubkey = ?';
    params.push(author);
  }
  
  if (since) {
    query += ' AND created_at >= ?';
    params.push(since);
  }
  
  if (until) {
    query += ' AND created_at <= ?';
    params.push(until);
  }
  
  if (kind !== undefined) {
    query += ' AND kind = ?';
    params.push(kind);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const stmt = dbInstance.prepare(query);
  stmt.bind(params);
  
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  
  return rows.map(row => ({
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    content: row.content,
    tags: JSON.parse(row.tags),
    sig: row.sig
  }));
}

export function getEventById(dbInstance, id) {
  const stmt = dbInstance.prepare('SELECT * FROM events WHERE id = ?');
  stmt.bind([id]);
  
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  
  const row = stmt.getAsObject();
  stmt.free();
  
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    content: row.content,
    tags: JSON.parse(row.tags),
    sig: row.sig
  };
}

export function getAgentProfile(dbInstance, pubkey) {
  // Get profile event (kind 5) if exists
  const profileStmt = dbInstance.prepare(
    'SELECT * FROM events WHERE pubkey = ? AND kind = 5 ORDER BY created_at DESC LIMIT 1'
  );
  profileStmt.bind([pubkey]);
  
  let profile = null;
  if (profileStmt.step()) {
    const profileRow = profileStmt.getAsObject();
    try {
      profile = JSON.parse(profileRow.content);
    } catch (e) {
      profile = { bio: profileRow.content };
    }
  }
  profileStmt.free();
  
  // Get stats
  const postStmt = dbInstance.prepare(
    'SELECT COUNT(*) as count FROM events WHERE pubkey = ? AND kind IN (1, 2)'
  );
  postStmt.bind([pubkey]);
  postStmt.step();
  const postCount = postStmt.getAsObject().count;
  postStmt.free();
  
  const upvoteStmt = dbInstance.prepare(
    'SELECT COUNT(*) as count FROM events WHERE pubkey = ? AND kind = 3'
  );
  upvoteStmt.bind([pubkey]);
  upvoteStmt.step();
  const upvoteCount = upvoteStmt.getAsObject().count;
  upvoteStmt.free();
  
  // Get recent posts
  const posts = getEvents(dbInstance, { author: pubkey, kind: 1, limit: 20 });
  
  return {
    pubkey,
    profile,
    stats: {
      posts: postCount,
      upvotes: upvoteCount
    },
    recentPosts: posts
  };
}

export function getStats(dbInstance) {
  const eventsStmt = dbInstance.prepare('SELECT COUNT(*) as count FROM events');
  eventsStmt.step();
  const totalEvents = eventsStmt.getAsObject().count;
  eventsStmt.free();
  
  const agentsStmt = dbInstance.prepare('SELECT COUNT(DISTINCT pubkey) as count FROM events');
  agentsStmt.step();
  const totalAgents = agentsStmt.getAsObject().count;
  agentsStmt.free();
  
  return { totalEvents, totalAgents };
}
