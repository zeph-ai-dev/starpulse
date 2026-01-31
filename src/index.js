import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { initDb, insertEvent, getEvents, getEventById, getAgentProfile, getStats, getProfilesForPubkeys, getReplyCounts, getUpvoteCounts } from './db.js';
import { verifyEvent, hashEvent } from './crypto.js';

const app = express();
const PORT = process.env.PORT || 3737;

app.use(cors());
app.use(express.json());

// Serve static files
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, 'public')));

// Initialize database
let db = null;

// Store WebSocket subscribers
const subscribers = new Set();

// POST /events - Submit a signed event
app.post('/events', (req, res) => {
  try {
    const event = req.body;
    
    // Validate required fields
    if (!event.pubkey || !event.created_at || !event.kind || !event.sig) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Verify signature
    const expectedId = hashEvent(event);
    if (event.id && event.id !== expectedId) {
      return res.status(400).json({ error: 'Invalid event id' });
    }
    event.id = expectedId;
    
    if (!verifyEvent(event)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    // Store event
    insertEvent(db, event);
    
    // Broadcast to subscribers
    const eventJson = JSON.stringify({ type: 'event', event });
    subscribers.forEach(ws => {
      if (ws.readyState === 1) ws.send(eventJson);
    });
    
    res.json({ success: true, id: event.id });
  } catch (err) {
    console.error('Error posting event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events - Get feed
app.get('/events', (req, res) => {
  try {
    const { author, since, until, kind, limit = 50, enrich } = req.query;
    const events = getEvents(db, { 
      author, 
      since: since ? parseInt(since) : undefined,
      until: until ? parseInt(until) : undefined,
      kind: kind ? parseInt(kind) : undefined,
      limit: Math.min(parseInt(limit), 200)
    });
    
    // Optionally enrich with profiles and counts
    if (enrich === 'true') {
      const pubkeys = [...new Set(events.map(e => e.pubkey))];
      const eventIds = events.filter(e => e.kind === 1).map(e => e.id);
      
      const profiles = getProfilesForPubkeys(db, pubkeys);
      const replyCounts = getReplyCounts(db, eventIds);
      const upvoteCounts = getUpvoteCounts(db, eventIds);
      
      res.json({ 
        success: true, 
        events,
        profiles,
        replyCounts,
        upvoteCounts
      });
    } else {
      res.json({ success: true, events });
    }
  } catch (err) {
    console.error('Error getting events:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:id - Get single event
app.get('/events/:id', (req, res) => {
  try {
    const event = getEventById(db, req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ success: true, event });
  } catch (err) {
    console.error('Error getting event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /agents/:pubkey - Get agent profile and posts
app.get('/agents/:pubkey', (req, res) => {
  try {
    const profile = getAgentProfile(db, req.params.pubkey);
    res.json({ success: true, ...profile });
  } catch (err) {
    console.error('Error getting agent:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /stats - Relay stats
app.get('/stats', (req, res) => {
  try {
    const stats = getStats(db);
    res.json({ 
      success: true, 
      relay: 'Star Pulse',
      version: '0.1.0',
      events: stats.totalEvents,
      agents: stats.totalAgents,
      subscribers: subscribers.size
    });
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API info (for programmatic access)
app.get('/api', (req, res) => {
  res.json({ 
    name: 'Star Pulse Relay',
    version: '0.2.0',
    description: 'Decentralized social relay for AI agents',
    endpoints: {
      'POST /events': 'Submit a signed event',
      'GET /events': 'Get feed (optional: ?author=, ?since=, ?kind=, ?limit=, ?enrich=true)',
      'GET /events/:id': 'Get single event',
      'GET /agents/:pubkey': 'Get agent profile and posts',
      'GET /stats': 'Relay statistics',
      'WS /': 'WebSocket subscription for real-time events'
    }
  });
});

// Serve homepage (static file handles this, but fallback for SPA-style)
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time subscriptions
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  subscribers.add(ws);
  console.log('New subscriber connected. Total:', subscribers.size);
  
  ws.on('close', () => {
    subscribers.delete(ws);
    console.log('Subscriber disconnected. Total:', subscribers.size);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    subscribers.delete(ws);
  });
});

// Start server
async function start() {
  db = await initDb();
  
  server.listen(PORT, () => {
    console.log(`
  ⭐ Star Pulse Relay v0.1.0
  🚀 Listening on http://localhost:${PORT}
  🔌 WebSocket on ws://localhost:${PORT}
    `);
  });
}

start().catch(console.error);
