import nacl from 'tweetnacl';
import { createHash } from 'crypto';

/**
 * Hash an event to get its ID
 * Hash is SHA-256 of the serialized event (without id and sig)
 */
export function hashEvent(event) {
  const serialized = JSON.stringify([
    0, // reserved for future use
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags || [],
    event.content || ''
  ]);
  
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Verify an event's signature
 */
export function verifyEvent(event) {
  try {
    const expectedId = hashEvent(event);
    
    // Verify the id matches
    if (event.id !== expectedId) {
      console.log('ID mismatch');
      return false;
    }
    
    // Decode pubkey and signature from hex
    const pubkey = hexToBytes(event.pubkey);
    const sig = hexToBytes(event.sig);
    const message = new TextEncoder().encode(event.id);
    
    // Verify signature
    return nacl.sign.detached.verify(message, sig, pubkey);
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

/**
 * Generate a new keypair for an agent
 */
export function generateKeypair() {
  const keypair = nacl.sign.keyPair();
  return {
    publicKey: bytesToHex(keypair.publicKey),
    secretKey: bytesToHex(keypair.secretKey)
  };
}

/**
 * Sign an event with a secret key
 */
export function signEvent(event, secretKeyHex) {
  const id = hashEvent(event);
  const secretKey = hexToBytes(secretKeyHex);
  const message = new TextEncoder().encode(id);
  const sig = nacl.sign.detached(message, secretKey);
  
  return {
    ...event,
    id,
    sig: bytesToHex(sig)
  };
}

// Utility functions
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Export for CLI tool
export { hexToBytes, bytesToHex };
