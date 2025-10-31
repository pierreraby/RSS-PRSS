import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';
import type { LanguageModelV2 } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { modelMap, getContext } from './models.js';


export interface SummaryNode {
  summary: string;
  children: SummaryNode[];
  path?: string;
  type?: 'file' | 'folder';
}

export interface RankedChunk {
  chunk: string;
  score: number;
  reason: string;
}

export interface PRRSSummaries {
  [lens: string]: SummaryNode;
}

// callLLM (inchangée)
async function callLLM(prompt: string, model: LanguageModelV2): Promise<string> {
  try {
    const { text } = await generateText({
      model,
      messages: [{ role: 'user', content: prompt }],
    });
    return text.trim();
  } catch (error) {
    console.error('LLM Error:', error);
    return 'Error in summarization';
  }
}

// splitFileIntoChunks (inchangée)
/**
 * Split a large piece of text into smaller chunks trying to respect statement boundaries.
 * Falls back to blunt splitting if necessary.
 */
function splitTextBySize(text: string, maxChars = 4000): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text.trim()];

  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur = '';

  const pushCur = (force = false) => {
    if (cur && (force || cur.length >= 1)) {
      chunks.push(cur.trim());
      cur = '';
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    if ((cur + '\n' + line).length > maxChars) {
      // try to find a safe split point inside `cur`
      const splitCandidates = ['\n\n', ';\n', '};\n', '\n//', '\n'];
      let splitPos = -1;
      for (const cand of splitCandidates) {
        const idx = cur.lastIndexOf(cand);
        if (idx > splitPos) splitPos = idx + (cand.startsWith('\n') ? 1 : 0);
      }
      if (splitPos > 10) {
        const head = cur.slice(0, splitPos).trim();
        const tail = cur.slice(splitPos).trim();
        if (head) chunks.push(head);
        cur = tail + '\n' + line;
        if (cur.length > maxChars) {
          // still too big -> brute force chop
          while (cur.length > maxChars) {
            chunks.push(cur.slice(0, maxChars).trim());
            cur = cur.slice(maxChars);
          }
        }
      } else {
        // no good split candidate -> push current and start fresh
        pushCur();
        if (line.length > maxChars) {
          // single line too long -> hard split
          let start = 0;
          while (start < line.length) {
            chunks.push(line.slice(start, start + maxChars));
            start += maxChars;
          }
        } else {
          cur = line;
        }
      }
    } else {
      cur += (cur ? '\n' : '') + line;
    }
  }
  pushCur(true);
  return chunks.map(s => s.trim()).filter(Boolean);
}

// splitFileIntoChunks: prefer semantic splitting using TypeScript AST, but limit chunk size
function splitFileIntoChunks(fileContent: string, maxChunks = 10, maxChunkChars = 4000): string[] {
  try {
    const sourceFile = ts.createSourceFile('file.ts', fileContent, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
    const declTexts: string[] = [];

    // Collect top-level children texts
    sourceFile.forEachChild((node) => {
      const start = node.getFullStart ? node.getFullStart() : node.pos;
      const end = node.getEnd();
      if (end > start) {
        const txt = fileContent.slice(start, end).trim();
        if (txt) {
          if (txt.length > maxChunkChars) {
            // split large declaration into smaller semantic-ish pieces
            const sub = splitTextBySize(txt, maxChunkChars);
            declTexts.push(...sub);
          } else {
            declTexts.push(txt);
          }
        }
      }
    });

    if (!declTexts.length) throw new Error('No top-level declarations found');

    // If too many chunks, group contiguous chunks into buckets to respect maxChunks
    if (declTexts.length <= maxChunks) {
      return declTexts.map(c => c.trim()).filter(Boolean);
    }

    const perBucket = Math.ceil(declTexts.length / maxChunks);
    const grouped: string[] = [];
    for (let i = 0; i < declTexts.length; i += perBucket) {
      const group = declTexts.slice(i, i + perBucket).join('\n\n');
      grouped.push(group.trim());
    }
    return grouped.map(c => c.trim()).filter(Boolean);
  } catch (err) {
    // Fallback: original heuristic with size limit
    const chunks: string[] = [];
    const lines = fileContent.split('\n');
    let currentChunk: string[] = [];
    let chunkCount = 0;

    const flushCurrent = () => {
      if (currentChunk.length) {
        const txt = currentChunk.join('\n');
        if (txt.length > maxChunkChars) {
          chunks.push(...splitTextBySize(txt, maxChunkChars));
        } else {
          chunks.push(txt);
        }
        currentChunk = [];
        chunkCount++;
      }
    };

    for (const line of lines) {
      if (chunkCount >= maxChunks) {
        currentChunk.push(line);
        continue;
      }
      if (line.match(/^(def|class|function|const|let|var|import|export)\s+\w+|^\s*\/\/\s*(TODO|NOTE|FIXME)/i)) {
        if (currentChunk.length) {
          flushCurrent();
          currentChunk = [line];
        } else {
          currentChunk = [line];
        }
      } else {
        currentChunk.push(line);
      }
      // if current grows too big, flush it
      const curText = currentChunk.join('\n');
      if (curText.length > maxChunkChars) {
        const parts = splitTextBySize(curText, maxChunkChars);
        chunks.push(...parts.slice(0, -1));
        currentChunk = [parts[parts.length - 1]];
        chunkCount = chunks.length;
      }
    }
    if (currentChunk.length && chunkCount < maxChunks) {
      flushCurrent();
    }
    // Finally clamp to maxChunks by grouping if necessary
    if (chunks.length <= maxChunks) return chunks.map(c => c.trim()).filter(Boolean);
    const perBucket = Math.ceil(chunks.length / maxChunks);
    const grouped: string[] = [];
    for (let i = 0; i < chunks.length; i += perBucket) {
      grouped.push(chunks.slice(i, i + perBucket).join('\n\n'));
    }
    return grouped.map(c => c.trim()).filter(Boolean);
  }
}

// rankChunksByImportance : utilise des indices (plus robuste que demander le texte exact)
async function rankChunksByImportance(chunks: string[], lens: string, model: LanguageModelV2): Promise<RankedChunk[]> {
  if (!chunks || chunks.length === 0) return [];

  // Build numbered previews to give context without forcing exact repetition.
  const previewLen = 400; // configurable preview length
  const previews = chunks.map((c, i) => `${i}) ${c.slice(0, previewLen).replace(/\n+/g, ' ')}${c.length > previewLen ? '…' : ''}`).join('\n');
  const prompt = `Rank these chunks by index (0-${chunks.length - 1}) from "${lens}" perspective. Respond with ONLY a valid JSON array, NO other text or explanations: [{"index": 0, "score": number (1-10), "reason": "brief reason"}]. Use ONLY the indices to identify chunks.\n\nChunks (index : preview):\n${previews}`;
  const response = await callLLM(prompt, model);

  // Try direct JSON.parse first (trimmed)
  let parsed: any;
  try {
    parsed = JSON.parse(response.trim());
    if (Array.isArray(parsed) && parsed.every((p: any) => typeof p.index === 'number' && typeof p.score === 'number')) {
      return parsed.map((p: any) => {
        const idx = Math.max(0, Math.min(chunks.length - 1, Number(p.index)));
        return { chunk: chunks[idx], score: Number(p.score), reason: p.reason || 'No reason provided' } as RankedChunk;
      });
    }
  } catch (e) {
    // fall through to regex fallback
  }

  // Regex fallback : extract first JSON-like array found
  const arrayMatch = response.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((p: any) => p.index !== undefined && !isNaN(Number(p.index)))
          .map((p: any) => {
            const idx = Math.max(0, Math.min(chunks.length - 1, Number(p.index)));
            return { chunk: chunks[idx], score: Number(p.score) || 5, reason: p.reason || 'Extracted ranking' } as RankedChunk;
          });
      }
    } catch (err) {
      // ignore and fallback
    }
  }

  // Ultimate fallback : neutral defaults
  console.warn('Fallback to defaults (parsing fully failed)');
  return chunks.slice(0, Math.min(chunks.length, 10)).map(chunk => ({ chunk, score: 5, reason: 'Default ranking (parse failed)' }));
}

// summarizeChunks (inchangée)
async function summarizeChunks(rankedChunks: RankedChunk[], lens: string, model: LanguageModelV2): Promise<string> {
  const topChunks = rankedChunks.slice(0, 5).map(c => `${c.score}: ${c.reason}\n${c.chunk}`).join('\n');
  const prompt = `Summarize these top-ranked TypeScript/JavaScript code chunks from "${lens}" perspective: key patterns, dependencies, potential issues/impacts. Concise (100-200 words).\n\nTop chunks with scores/reasons:\n${topChunks}`;
  return await callLLM(prompt, model);
}

// Estimate max chunk characters based on model context window (tokens).
async function estimateMaxChunkChars(modelKey?: string): Promise<number> {
  // Map known model keys to token windows (best-effort). Adjust if you know exact values.
  const tokenWindowByModel: Record<string, number> = {
    'g4f-reasoning': 8192,
    'g4f-no-reasoning': 8192,
  };
  const defaultTokens = 4096;

  let tokens = defaultTokens;

  if (modelKey) {
    if (tokenWindowByModel[modelKey]) {
      tokens = tokenWindowByModel[modelKey];
    } else {
      // Try to fetch runtime provider context from models.getContext
      try {
        const ctx = await getContext(modelKey);
        if (typeof ctx === 'number' && ctx > 0) {
          tokens = ctx;
        }
      } catch (err) {
        // If anything fails, fall back to the best-effort static mapping above
        console.warn(`estimateMaxChunkChars: failed to fetch context for "${modelKey}", falling back to defaults:`, err);
      }
    }
  }

  const fraction = 0.20; // aim for ~20% of context per chunk
  const approxChars = Math.max(1000, Math.floor(tokens * 4 * fraction));
  return approxChars;
}

// rrs : Ajout optional skip filter (après boucle for, avant aggregate)
async function rrs(folderPath: string, lens: string, depth = 0, maxDepth = 3, model: LanguageModelV2, maxChunkChars = 4000): Promise<SummaryNode> {
  if (depth > maxDepth) return { summary: 'Depth limit reached', children: [] };

  const stats = await fs.stat(folderPath);
  const isFile = stats.isFile();
  const children: SummaryNode[] = [];

  if (isFile) {
    const ext = path.extname(folderPath);
    if (!ext.match(/\.ts$|\.js$|\.py$|\.json$/i)) {
      console.log(`Skipping non-code file: ${path.basename(folderPath)}`);
      return { summary: 'Skipped (non-source file)', children: [], path: folderPath, type: 'file' };
    }
    console.log(`Processing file: ${path.basename(folderPath)}`);
    const content = await fs.readFile(folderPath, 'utf8');
    if (!content.trim()) return { summary: 'Empty file', children: [] };

  const chunks = splitFileIntoChunks(content, 10, maxChunkChars);
    if (chunks.length === 0) return { summary: 'No chunks extracted', children: [] };

    const ranked = await rankChunksByImportance(chunks, lens, model);
    const summary = await summarizeChunks(ranked, lens, model);
    return { summary, children: [], path: folderPath, type: 'file' };
  } else {
    console.log(`Processing folder: ${path.basename(folderPath)}`);
    const items = await fs.readdir(folderPath);
    for (const item of items) {
      const itemPath = path.join(folderPath, item);
      const itemStats = await fs.stat(itemPath);
      if (itemStats.isDirectory() && (item === 'node_modules' || item === '.git' || item === 'dist')) continue;
  const childSummary = await rrs(itemPath, lens, depth + 1, maxDepth, model, maxChunkChars);
      children.push(childSummary);
    }

    // NOUVEAU : Filtre skips à la source (clean children pour aggregate/JSON/tree)
    const filteredChildren = children.filter(c => !c.summary.startsWith('Skipped (non-source file)'));
    if (filteredChildren.length === 0) return { summary: 'Empty folder (ignored items only)', children: [], path: folderPath, type: 'folder' };

    // Aggregate sur filtered (plus efficient)
    const childSummaries = filteredChildren.map(c => `${path.basename(c.path || '')}: ${c.summary.slice(0, 100)}...`).join('\n');
    const prompt = `Summarize these child code summaries from "${lens}" perspective: overall structure, key interactions/dependencies, high-level insights. Concise.\n\nChild summaries:\n${childSummaries}`;
    const summary = await callLLM(prompt, model);
    return { summary, children: filteredChildren, path: folderPath, type: 'folder' };  // Retourne filtered
  }
}

// prrs (inchangée, déjà bonne)
async function prrs(folderPath: string, lenses = ['architecture'], modelKey = 'g4f-reasoning', maxDepth = 3): Promise<PRRSSummaries> {
  const summaries: PRRSSummaries = {};
  const modelToUse = modelKey in modelMap ? (modelMap[modelKey as keyof typeof modelMap]) : modelMap['g4f-reasoning'];
  const maxChunkChars = await estimateMaxChunkChars(modelKey);
  for (const lens of lenses) {
    console.log(`\n--- Processing lens: ${lens} with model ${modelKey} (maxChunkChars=${maxChunkChars}) ---`);
    summaries[lens] = await rrs(folderPath, lens, 0, maxDepth, modelToUse, maxChunkChars);
  }
  return summaries;
}

export { prrs, rrs };