  // src/test-prrs.ts
   import { prrs } from './prrs.js';
   
   async function test() {
     const folder = '/home/pierre/Code/perso/ts-node-jwt';  // e.g., __dirname ou un petit dossier
     const modelKey = 'g4f-no-reasoning';  // Ou 'g4f-reasoning' pour deep
     const summaries = await prrs(folder, ['architecture'], modelKey);
     console.log('Full summaries:', JSON.stringify(summaries, null, 2)); // Preview tree
   }
   test();