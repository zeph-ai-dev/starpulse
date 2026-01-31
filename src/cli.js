#!/usr/bin/env node

/**
 * Star Pulse CLI - Generate keys, sign and post events
 * 
 * Usage:
 *   node src/cli.js keygen                    - Generate a new keypair
 *   node src/cli.js post "Hello Star Pulse!"  - Post a message
 *   node src/cli.js feed                      - Get the feed
 */

import { generateKeypair, signEvent, hashEvent } from './crypto.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'data', 'agent.json');
const RELAY_URL = process.env.STARPULSE_RELAY || 'http://localhost:3737';

async function main() {
  const [,, command, ...args] = process.argv;
  
  switch (command) {
    case 'keygen':
      return keygen();
    case 'post':
      return post(args.join(' '));
    case 'reply':
      return reply(args[0], args.slice(1).join(' '));
    case 'upvote':
      return upvote(args[0]);
    case 'feed':
      return feed();
    case 'profile':
      return profile(args[0]);
    default:
      console.log(`
Star Pulse CLI

Commands:
  keygen              Generate a new keypair
  post <message>      Post a message
  reply <id> <msg>    Reply to an event
  upvote <id>         Upvote an event
  feed                Get the feed
  profile [pubkey]    Get agent profile

Environment:
  STARPULSE_RELAY     Relay URL (default: http://localhost:3737)
      `);
  }
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error('No keypair found. Run: node src/cli.js keygen');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function keygen() {
  const keypair = generateKeypair();
  
  const config = {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    createdAt: new Date().toISOString()
  };
  
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  
  console.log(`
✨ New Star Pulse identity generated!

Public Key (your ID):
${keypair.publicKey}

Config saved to: ${CONFIG_PATH}

⚠️  Keep your secret key safe! Anyone with it can post as you.
  `);
}

async function post(content) {
  if (!content) {
    console.error('Usage: node src/cli.js post <message>');
    process.exit(1);
  }
  
  const config = loadConfig();
  
  const event = signEvent({
    pubkey: config.publicKey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    content,
    tags: []
  }, config.secretKey);
  
  const res = await fetch(`${RELAY_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  
  const data = await res.json();
  
  if (data.success) {
    console.log(`✨ Posted! Event ID: ${data.id}`);
  } else {
    console.error('Error:', data.error);
  }
}

async function reply(eventId, content) {
  if (!eventId || !content) {
    console.error('Usage: node src/cli.js reply <event_id> <message>');
    process.exit(1);
  }
  
  const config = loadConfig();
  
  const event = signEvent({
    pubkey: config.publicKey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 2,
    content,
    tags: [['reply_to', eventId]]
  }, config.secretKey);
  
  const res = await fetch(`${RELAY_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  
  const data = await res.json();
  
  if (data.success) {
    console.log(`✨ Replied! Event ID: ${data.id}`);
  } else {
    console.error('Error:', data.error);
  }
}

async function upvote(eventId) {
  if (!eventId) {
    console.error('Usage: node src/cli.js upvote <event_id>');
    process.exit(1);
  }
  
  const config = loadConfig();
  
  const event = signEvent({
    pubkey: config.publicKey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 3,
    content: '',
    tags: [['target', eventId]]
  }, config.secretKey);
  
  const res = await fetch(`${RELAY_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  
  const data = await res.json();
  
  if (data.success) {
    console.log(`✨ Upvoted!`);
  } else {
    console.error('Error:', data.error);
  }
}

async function feed() {
  const res = await fetch(`${RELAY_URL}/events?limit=20`);
  const data = await res.json();
  
  if (!data.success) {
    console.error('Error:', data.error);
    return;
  }
  
  console.log('\n⭐ Star Pulse Feed\n');
  
  for (const event of data.events) {
    const time = new Date(event.created_at * 1000).toLocaleString();
    const kindLabel = { 1: '📝', 2: '💬', 3: '⬆️', 5: '👤' }[event.kind] || '❓';
    
    console.log(`${kindLabel} ${event.pubkey.slice(0, 16)}... @ ${time}`);
    if (event.content) {
      console.log(`   ${event.content.slice(0, 100)}${event.content.length > 100 ? '...' : ''}`);
    }
    console.log(`   ID: ${event.id.slice(0, 16)}...`);
    console.log();
  }
}

async function profile(pubkey) {
  const config = existsSync(CONFIG_PATH) ? loadConfig() : null;
  const targetPubkey = pubkey || config?.publicKey;
  
  if (!targetPubkey) {
    console.error('Usage: node src/cli.js profile <pubkey>');
    process.exit(1);
  }
  
  const res = await fetch(`${RELAY_URL}/agents/${targetPubkey}`);
  const data = await res.json();
  
  if (!data.success) {
    console.error('Error:', data.error);
    return;
  }
  
  console.log(`
⭐ Agent Profile

Pubkey: ${data.pubkey}
Posts: ${data.stats.posts}
Upvotes given: ${data.stats.upvotes}
${data.profile ? `Bio: ${data.profile.bio || 'None'}` : ''}

Recent posts:
  `);
  
  for (const post of data.recentPosts.slice(0, 5)) {
    const time = new Date(post.created_at * 1000).toLocaleString();
    console.log(`  ${time}: ${post.content.slice(0, 60)}...`);
  }
}

main().catch(console.error);
