import fs from 'fs-extra';
import path from 'path';
import type { LanguageModelV2 } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { modelMap } from './models.js';

interface SummaryNode {
  summary: string;
  children: SummaryNode[];
  path?: string;
  type?: 'file' | 'folder';
}

interface RankedChunk {
  chunk: string;
  score: number;
  reason: string;
}

interface PRRSSummaries {
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
function splitFileIntoChunks(fileContent: string, maxChunks = 10): string[] {
  const chunks: string[] = [];
  const lines = fileContent.split('\n');
  let currentChunk: string[] = [];
  let chunkCount = 0;

  lines.forEach(line => {
    if (chunkCount >= maxChunks) {
      currentChunk.push(line);
      return;
    }
    if (line.match(/^(def|class|function|const|let|var|import|export)\s+\w+|^\s*\/\/\s*(TODO|NOTE|FIXME)/i)) {
      if (currentChunk.length) {
        chunks.push(currentChunk.join('\n'));
        chunkCount++;
        currentChunk = [line];
      } else {
        currentChunk = [line];
      }
    } else {
      currentChunk.push(line);
    }
  });
  if (currentChunk.length && chunkCount < maxChunks) {
    chunks.push(currentChunk.join('\n'));
  }
  return chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 0);
}

// rankChunksByImportance : Upgradé pour robust parsing (trim extra text + regex extract JSON array)
async function rankChunksByImportance(chunks: string[], lens: string, model: LanguageModelV2): Promise<RankedChunk[]> {
  const prompt = `As a code analyst, rank these TypeScript/JavaScript code chunks by importance from "${lens}" perspective. Respond with ONLY a valid JSON array, NO other text or explanations: [{"chunk": "exact chunk text", "score": number (1-10), "reason": "brief reason on system impact"}]. Limit to chunks provided. Do not add markdown or prefixes.\n\nChunks:\n${chunks.join('\n---\n')}`;
  const response = await callLLM(prompt, model);

  // Robust parsing : Trim, try JSON.parse ; fallback regex extract
  let parsed: any;
  try {
    // Trim lines avant/after potential JSON
    const trimmed = response.replace(/^[^{]*\{|\}[^}]*$|\n\s*(?=\{)/g, '').trim();  // Strip non-JSON
    parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((p: any) => p.chunk && typeof p.score === 'number' && p.reason)) {
      return parsed as RankedChunk[];
    }
  } catch (parseError) {
    console.warn('JSON parse failed, trying regex fallback');
  }

  // Regex fallback : Extract JSON-like array (e.g., grab between [ ... ])
  const arrayMatch = response.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((p: any) => p.chunk && typeof p.score === 'number').map((p: any) => ({ ...p, reason: p.reason || 'Extracted ranking' })) as RankedChunk[];
      }
    } catch {}
  }

  // Ultimate fallback : Defaults
  console.warn('Fallback to defaults (parsing fully failed)');
  return chunks.slice(0, Math.min(chunks.length, 10)).map(chunk => ({ chunk, score: 5, reason: 'Default ranking (parse failed)' }));
}

// summarizeChunks (inchangée)
async function summarizeChunks(rankedChunks: RankedChunk[], lens: string, model: LanguageModelV2): Promise<string> {
  const topChunks = rankedChunks.slice(0, 5).map(c => `${c.score}: ${c.reason}\n${c.chunk}`).join('\n');
  const prompt = `Summarize these top-ranked TypeScript/JavaScript code chunks from "${lens}" perspective: key patterns, dependencies, potential issues/impacts. Concise (100-200 words).\n\nTop chunks with scores/reasons:\n${topChunks}`;
  return await callLLM(prompt, model);
}

// rrs : Ajout optional skip filter (après boucle for, avant aggregate)
async function rrs(folderPath: string, lens: string, depth = 0, maxDepth = 3, model: LanguageModelV2): Promise<SummaryNode> {
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

    const chunks = splitFileIntoChunks(content);
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
      const childSummary = await rrs(itemPath, lens, depth + 1, maxDepth, model);
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
  for (const lens of lenses) {
    console.log(`\n--- Processing lens: ${lens} with model ${modelKey} ---`);
    summaries[lens] = await rrs(folderPath, lens, 0, maxDepth, modelToUse);
  }
  return summaries;
}

export { prrs, rrs };