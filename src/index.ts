#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { prrs } from './prrs.js';

// Vérif env key early
if (!process.env.OPENROUTER_API_KEY) {
  console.error('Error: Set OPENROUTER_API_KEY (run source secrets.sh or export).');
  process.exit(1);
}

// CLI setup (identique à ton code)
const program = new Command()
  .name('prrs')
  .description('PRRS: Prompt-based Recursive Repo Summarizer (multi-lens code analysis via Grok/OpenRouter)')
  .version('1.0.0')
  .option('-p, --path <dir>', 'Target folder to analyze', '.')
  .option('-l, --lenses <list>', 'Comma-separated lenses (e.g., architecture,data_flow,security)', 'architecture')
  .option('-m, --model <key>', 'LLM model from modelMap (e.g., g4f-no-reasoning)', 'g4f-reasoning')
  .option('-d, --depth <num>', 'Max recursion depth', '3')
  .option('-o, --output <format>', 'Output format: json (full), tree (ascii), console (simple)', 'console')
  .option('-v, --verbose', 'Enable verbose logging');

program
  .command('prrs')
  .description('Run PRRS analysis')
  .action(async (cmdOptions) => {
    const options = { ...program.opts(), ...cmdOptions };
    const { path: folderPath, lenses, model, depth, output, verbose } = options;

    if (!fs.existsSync(folderPath)) {
      console.error(`Error: Path "${folderPath}" not found.`);
      process.exit(1);
    }
    const maxDepth = parseInt(depth, 10);
    if (isNaN(maxDepth) || maxDepth < 1) {
      console.error('Error: --depth must be a positive number.');
      process.exit(1);
    }
    if (verbose) console.log(`Starting PRRS on "${folderPath}" with lenses: ${lenses}, model: ${model}, depth: ${maxDepth}`);

    try {
      const summaries = await prrs(folderPath, lenses.split(','), model, maxDepth);

      switch (output) {
        case 'json':
          console.log(JSON.stringify(summaries, null, 2));
          break;
        case 'tree':
          printTree(summaries);  // Upgradé : gère multi-lenses, filtre skips, prefixes fix
          break;
        case 'console':
        default:
          Object.entries(summaries).forEach(([lens, node]) => {
            console.log(`\n=== ${lens.toUpperCase()} Summary ===`);
            console.log(node.summary);
            if (verbose) console.log(`Tree depth: ${getTreeDepth(node)} nodes`);
          });
          break;
      }
    } catch (error: any) {
      console.error('PRRS Error:', error.message || error);
      process.exit(1);
    }
  });

// Helper upgradé : Print tree avec proper ASCII (filtre skips auto, prefixes standards)
function printTree(summaries: any) {
  const lensEntries = Object.entries(summaries);
  lensEntries.forEach(([lensKey, lensNode], lensIndex) => {
    if (
      lensNode == null ||
      typeof lensNode !== 'object' ||
      !('summary' in lensNode) ||
      typeof (lensNode as any).summary !== 'string'
    ) return;

    // Spacer entre lenses
    if (lensIndex > 0) console.log('');

    console.log(`${lensKey.toUpperCase()} Analysis:`);
    
    // Recursive pour chaque lens root
    _printNode(lensNode, '', true);  // Start avec empty prefix, isLast=true pour root (└──)
  });
}

// _printNode simplifié : Drop childIndex/indent (unused), rely on prefix pour spacing ; type-safe
function _printNode(node: any, prefix: string, isLast: boolean) {
  if (
    node == null ||
    typeof node !== 'object' ||
    !('summary' in node) ||
    typeof (node as any).summary !== 'string'
  ) return;

  // Filtre skips : Skip print si "Skipped (non-source file)"
  if ((node as any).summary.startsWith('Skipped (non-source file)')) return;

  const connector = isLast ? '└── ' : '├── ';
  const branch = isLast ? '    ' : '│   ';
  
  // Print node
  const nodeName = path.basename((node as any).path || 'root');
  const nodeType = (node as any).type || 'unknown';
  console.log(`${prefix}${connector}${nodeName} (${nodeType})`);
  
  // Summary alignée sous le nom (4 spaces pour matcher connector length)
  console.log(`${prefix}    Summary: ${(node as any).summary.slice(0, 150)}...`);

  // Children (filtre skips avant recurse)
  const children = ((node as any).children || []).filter((child: any) => {
    return child != null && typeof child === 'object' && ('summary' in child) && !((child as any).summary.startsWith('Skipped (non-source file)'));
  });
  
  if (children.length > 0) {
    children.forEach((child: any, i: number) => {
      const childIsLast = i === children.length - 1;
      const childPrefix = prefix + branch;
      _printNode(child, childPrefix, childIsLast);
    });
  }
}

function getTreeDepth(node: any): number {
  if (!node || typeof node !== 'object' || !node.children || node.children.length === 0) return 1;
  return 1 + Math.max(...(node.children as any[]).map((child: any) => getTreeDepth(child)));
}

program.parse(process.argv);