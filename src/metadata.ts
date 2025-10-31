// New file: src/metadata.ts
import fs from 'fs-extra';
import { parse } from '@typescript-eslint/parser';
import type { TSESTree } from '@typescript-eslint/types';

export interface EnhancedSummaryNode {
  summary: string;
  metadata: {
    // Signatures extraites (via AST parsing)
    exports?: Array<{
      name: string;
      type: 'function' | 'class' | 'interface' | 'type' | 'const';
      signature: string; // "function authenticate(req, res): Promise<User>"
      location: { line: number; column: number };
    }>;
    imports?: Array<{ from: string; names: string[] }>;
    dependencies?: string[]; // Packages externes
    complexity?: number; // Cyclomatic complexity
    linesOfCode?: number;
  };
  children: EnhancedSummaryNode[];
  path: string;
  type: 'file' | 'folder';
}

type Metadata = EnhancedSummaryNode['metadata'];

function generateFunctionSignature(node: TSESTree.FunctionDeclaration): string {
  const name = node.id?.name || 'anonymous';
  const params = node.params.map(param => {
    if (param.type === 'Identifier') {
      const typeAnnotation = param.typeAnnotation?.typeAnnotation;
      const type = typeAnnotation ? `: ${formatType(typeAnnotation)}` : '';
      return `${param.name}${type}`;
    }
    if (param.type === 'RestElement' && param.argument.type === 'Identifier') {
      return `...${param.argument.name}`;
    }
    return '[complex-param]'; // Destructuring, etc.
  }).join(', ');
  
  const returnType = node.returnType?.typeAnnotation 
    ? `: ${formatType(node.returnType.typeAnnotation)}` 
    : '';
  
  const isAsync = node.async ? 'async ' : '';
  
  return `${isAsync}function ${name}(${params})${returnType}`;
}

function generateClassSignature(node: TSESTree.ClassDeclaration): string {
  const name = node.id?.name || 'AnonymousClass';
  const extendsClause = node.superClass 
    ? ` extends ${node.superClass.type === 'Identifier' ? node.superClass.name : '[complex]'}` 
    : '';
  
  const implementsClause = node.implements && node.implements.length > 0
    ? ` implements ${node.implements.map(i => i.expression.type === 'Identifier' ? i.expression.name : '[complex]').join(', ')}`
    : '';
  
  // Lister les méthodes publiques
  const methods = node.body.body
    .filter(member => member.type === 'MethodDefinition' && !member.static)
    .map(member => {
      if (member.type === 'MethodDefinition' && member.key.type === 'Identifier') {
        return member.key.name;
      }
      return '[computed]';
    })
    .slice(0, 5); // Limiter à 5 pour lisibilité
  
  const methodsList = methods.length > 0 ? ` { ${methods.join(', ')}${methods.length === 5 ? ', ...' : ''} }` : '';
  
  return `class ${name}${extendsClause}${implementsClause}${methodsList}`;
}

function generateInterfaceSignature(node: TSESTree.TSInterfaceDeclaration): string {
  const name = node.id.name;
  const extendsClause = node.extends && node.extends.length > 0
    ? ` extends ${node.extends.map(e => e.expression.type === 'Identifier' ? e.expression.name : '[complex]').join(', ')}`
    : '';
  
  // Lister les propriétés
  const properties = node.body.body
    .filter(member => member.type === 'TSPropertySignature')
    .map(member => {
      if (member.key.type === 'Identifier') {
        const typeAnnotation = member.typeAnnotation?.typeAnnotation;
        const type = typeAnnotation ? `: ${formatType(typeAnnotation)}` : '';
        return `${member.key.name}${type}`;
      }
      return '[computed]';
    })
    .slice(0, 5);
  
  const propsList = properties.length > 0 ? ` { ${properties.join('; ')}${properties.length === 5 ? '; ...' : ''} }` : '';
  
  return `interface ${name}${extendsClause}${propsList}`;
}

function generateTypeAliasSignature(node: TSESTree.TSTypeAliasDeclaration): string {
  const name = node.id.name;
  const typeAnnotation = formatType(node.typeAnnotation);
  
  // Tronquer si trop long
  const maxLength = 100;
  const truncated = typeAnnotation.length > maxLength 
    ? typeAnnotation.slice(0, maxLength) + '...' 
    : typeAnnotation;
  
  return `type ${name} = ${truncated}`;
}

function generateVariableSignature(decl: TSESTree.VariableDeclarator): string {
  if (decl.id.type !== 'Identifier') return 'const [complex]';
  
  const name = decl.id.name;
  const typeAnnotation = decl.id.typeAnnotation?.typeAnnotation
    ? `: ${formatType(decl.id.typeAnnotation.typeAnnotation)}`
    : '';
  
  // Détection de type à partir de l'init
  let inferredType = '';
  if (!typeAnnotation && decl.init) {
    if (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression') {
      inferredType = ' (function)';
    } else if (decl.init.type === 'Literal') {
      inferredType = ` (${typeof decl.init.value})`;
    } else if (decl.init.type === 'ArrayExpression') {
      inferredType = ' (array)';
    } else if (decl.init.type === 'ObjectExpression') {
      inferredType = ' (object)';
    }
  }
  
  return `const ${name}${typeAnnotation}${inferredType}`;
}

// Helper pour formatter les types TS
function formatType(typeNode: TSESTree.TypeNode): string {
  switch (typeNode.type) {
    case 'TSStringKeyword':
      return 'string';
    case 'TSNumberKeyword':
      return 'number';
    case 'TSBooleanKeyword':
      return 'boolean';
    case 'TSAnyKeyword':
      return 'any';
    case 'TSVoidKeyword':
      return 'void';
    case 'TSArrayType':
      return `${formatType(typeNode.elementType)}[]`;
    case 'TSTypeReference':
      if (typeNode.typeName.type === 'Identifier') {
        const typeArgs = typeNode.typeArguments?.params
          ? `<${typeNode.typeArguments.params.map(formatType).join(', ')}>`
          : '';
        return `${typeNode.typeName.name}${typeArgs}`;
      }
      return '[complex-type]';
    case 'TSUnionType':
      return typeNode.types.map(formatType).join(' | ');
    case 'TSIntersectionType':
      return typeNode.types.map(formatType).join(' & ');
    case 'TSTypeLiteral':
      return '{ ... }'; // Simplifier les types littéraux
    case 'TSFunctionType':
      return '(...) => ...'; // Simplifier les signatures de fonction
    default:
      return '[unknown-type]';
  }
}

function extractImports(ast: TSESTree.Program): Array<{ from: string; names: string[] }> {
  const imports: Array<{ from: string; names: string[] }> = [];
  
  ast.body.forEach(node => {
    if (node.type === 'ImportDeclaration') {
      const from = node.source.value as string;
      const names: string[] = [];
      
      node.specifiers.forEach(spec => {
        if (spec.type === 'ImportSpecifier') {
          // import { foo, bar as baz } from 'module'
          if (spec.imported.type === 'Identifier') {
            names.push(spec.imported.name);
          }
        } else if (spec.type === 'ImportDefaultSpecifier') {
          // import DefaultExport from 'module'
          names.push(`default as ${spec.local.name}`);
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          // import * as ns from 'module'
          names.push(`* as ${spec.local.name}`);
        }
      });
      
      imports.push({ from, names });
    }
  });
  
  return imports;
}

function extractDependencies(ast: TSESTree.Program): string[] {
  const dependencies = new Set<string>();
  
  ast.body.forEach(node => {
    if (node.type === 'ImportDeclaration') {
      const source = node.source.value as string;
      
      // Filtrer les imports relatifs (commencent par . ou ..)
      if (!source.startsWith('.')) {
        // Extraire le nom du package (gérer les scoped packages)
        const packageName = source.startsWith('@')
          ? source.split('/').slice(0, 2).join('/') // @scope/package
          : source.split('/')[0]; // package
        
        dependencies.add(packageName);
      }
    }
    
    // Optionnel : Détecter require() dynamiques
    // (Nécessite un visitor récursif pour parcourir tout l'AST)
  });
  
  return Array.from(dependencies).sort();
}

function calculateComplexity(ast: TSESTree.Program): number {
  let complexity = 1; // Base complexity
  
  // Visitor récursif pour compter les branches
  function visit(node: any) {
    if (!node || typeof node !== 'object') return;
    
    // Incrémente pour chaque point de décision
    if (
      node.type === 'IfStatement' ||
      node.type === 'ConditionalExpression' || // Ternary
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'WhileStatement' ||
      node.type === 'DoWhileStatement' ||
      node.type === 'SwitchCase' && node.test !== null || // case (pas default)
      node.type === 'CatchClause' ||
      node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')
    ) {
      complexity++;
    }
    
    // Parcourir récursivement
    Object.keys(node).forEach(key => {
      const value = node[key];
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    });
  }
  
  visit(ast);
  return complexity;
}

function extractExports(ast: TSESTree.Program): NonNullable<Metadata['exports']> {
  
  const extractedExports: NonNullable<Metadata['exports']> = [];
  
  ast.body.forEach(node => {
    // ✅ FunctionDeclaration - OK mais vérifier null
    if (node.type === 'FunctionDeclaration' && node.id) {
      extractedExports.push({
        name: node.id.name,
        type: 'function',
        signature: generateFunctionSignature(node),
        location: { line: node.loc!.start.line, column: node.loc!.start.column }
      });
    }
    
    // ✅ ClassDeclaration - OK mais vérifier null
    if (node.type === 'ClassDeclaration' && node.id) {
      extractedExports.push({
        name: node.id.name,
        type: 'class',
        signature: generateClassSignature(node),
        location: { line: node.loc!.start.line, column: node.loc!.start.column }
      });
    }
    
    // ✅ TSInterfaceDeclaration - OK
    if (node.type === 'TSInterfaceDeclaration') {
      extractedExports.push({
        name: node.id.name,
        type: 'interface',
        signature: generateInterfaceSignature(node),
        location: { line: node.loc!.start.line, column: node.loc!.start.column }
      });
    }
    
    // ✅ TSTypeAliasDeclaration - OK
    if (node.type === 'TSTypeAliasDeclaration') {
      extractedExports.push({
        name: node.id.name,
        type: 'type',
        signature: generateTypeAliasSignature(node),
        location: { line: node.loc!.start.line, column: node.loc!.start.column }
      });
    }
    
    // ⚠️ VariableDeclaration - Attention : plusieurs patterns possibles
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach(decl => {
        // Gérer différents patterns : const x = ..., const { a, b } = ..., const [a, b] = ...
        if (decl.id.type === 'Identifier') {
          extractedExports.push({
            name: decl.id.name,
            type: 'const',
            signature: generateVariableSignature(decl),
            location: { line: decl.loc!.start.line, column: decl.loc!.start.column }
          });
        } else if (decl.id.type === 'ObjectPattern') {
          // const { a, b } = obj
          decl.id.properties.forEach(prop => {
            if (prop.type === 'Property' && prop.key.type === 'Identifier') {
              extractedExports.push({
                name: prop.key.name,
                type: 'const',
                signature: `const ${prop.key.name} (destructured)`,
                location: { line: prop.loc!.start.line, column: prop.loc!.start.column }
              });
            }
          });
        }
        // Ignorer ArrayPattern pour simplifier (const [a, b] = array)
      });
    }
    
    // 🆕 Ajouter ExportNamedDeclaration pour capturer export { x, y }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        // export function foo() {} → Déjà capturé par les cas ci-dessus
        // Mais on doit traiter récursivement
        // (Astuce : parser les exports récursivement ou marquer comme exported)
      }
      node.specifiers?.forEach(spec => {
        if (spec.type === 'ExportSpecifier' && spec.exported.type === 'Identifier' && spec.local.type === 'Identifier') {
          extractedExports.push({
            name: spec.exported.name,
            type: 'const', // Type générique
            signature: `export { ${spec.local.name} as ${spec.exported.name} }`,
            location: { line: spec.loc!.start.line, column: spec.loc!.start.column }
          });
        }
      });
    }
  });
  
  return extractedExports;
}

export async function extractMetadata(filePath: string): Promise<Metadata> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    
    // Vérifier extension
    const ext = filePath.split('.').pop();
    if (!['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) {
      return { linesOfCode: content.split('\n').length };
    }
    
    const ast = parse(content, { 
      sourceType: 'module',
      ecmaVersion: 2022,
      loc: true,
      range: true,
      // Gérer JSX si nécessaire
      ecmaFeatures: { jsx: ext === 'tsx' || ext === 'jsx' }
    });
    
    return {
      exports: extractExports(ast),
      imports: extractImports(ast),
      dependencies: extractDependencies(ast),
      complexity: calculateComplexity(ast),
      linesOfCode: content.split('\n').length
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to parse ${filePath}:`, errorMessage);
    // Fallback gracieux
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    return { 
      linesOfCode: content.split('\n').length,
      exports: [],
      imports: [],
      dependencies: []
    };
  }
}