import { setFlagsFromString } from 'node:v8';
// Nervox's default startup command is node index.js.
setFlagsFromString('--max-old-space-size=320');
await import('./src/chat-index.js');
