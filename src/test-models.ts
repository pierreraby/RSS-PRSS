 // src/test-models.ts
   import { modelMap } from './models.js';
   import { generateText } from 'ai';

  // Use a model key that exists in `modelMap` (typo corrected: 'grok-reasoning')
  const llm = modelMap['g4f-reasoning' as keyof typeof modelMap];
   async function test() {
     try {
       const { text } = await generateText({ model: llm, prompt: 'Hello Grok!' });
       console.log('Test OK:', text.slice(0, 100));  // Preview
     } catch (e: any) {
       console.error('Error:', e?.message ?? e);
     }
   }
   test();