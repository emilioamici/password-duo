// Genera la chiave che cifra i token di rinnovo conservati sul server (una volta sola).
// Uso: node worker/scripts/generate-session-key.mjs
import { randomBytes } from 'node:crypto'
console.log('SESSION_KEY=' + randomBytes(32).toString('base64url'))
console.log('\nVa solo nei segreti di Cloudflare: npx wrangler secret put SESSION_KEY. Se la perdi, gli accessi persistenti vanno rifatti.')
