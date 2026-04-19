#!/usr/bin/env node
/**
 * scripts/i18n-gate.cjs — Grep gate for inline JSX string literals.
 * Fails if string literals of > 3 words are found in component files outside the catalog.
 * 
 * Usage: node scripts/i18n-gate.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DASHBOARD_SRC = path.join(__dirname, '..', 'dashboard', 'src');
const COMPONENT_DIRS = ['pages', 'components'];
const ALLOWLIST_FILES = [
  'dashboard/src/i18n/en.ts',
  'dashboard/src/i18n/context.tsx',
];

// Patterns that are allowed (icon labels, single words, etc.)
const ALLOWLIST_PATTERNS = [
  /^[A-Z]{1,3}$/, // Single uppercase letters or acronyms (AAA, OK, etc.)
  /^\d+[a-z]{0,2}$/, // Numbers with optional unit (1s, 10m, 100ms)
  /^[\w\s]{1,10}$/, // Very short strings (up to 10 chars)
  /^var\(--/, // CSS variables
  /^https?:/, // URLs
  /^\/[\/\w-]+$/, // Paths
  /^[\w-]+:[\w-]+/, // Key:value pairs
  /^\{.*\}$/, // Template expressions
  /^aria-/, // ARIA attributes (these are acceptable as-is)
  /^[A-Z]\w*$/, // Single PascalCase words (component names, etc.)
];

function shouldSkipString(str) {
  // Skip very short strings
  if (str.length < 15) return true;
  
  // Skip if fewer than 4 words
  const words = str.trim().split(/\s+/);
  if (words.length < 4) return true;
  
  // Check allowlist patterns
  return ALLOWLIST_PATTERNS.some(pattern => pattern.test(str.trim()));
}

function findInlineStrings() {
  const violations = [];
  
  for (const dir of COMPONENT_DIRS) {
    const dirPath = path.join(DASHBOARD_SRC, dir);
    if (!fs.existsSync(dirPath)) continue;
    
    // Find all .tsx files recursively
    const findCmd = process.platform === 'win32'
      ? `powershell -Command "Get-ChildItem -Path '${dirPath}' -Recurse -Filter *.tsx | Select-Object -ExpandProperty FullName"`
      : `find "${dirPath}" -name "*.tsx" -type f`;
    
    let files;
    try {
      files = execSync(findCmd, { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .map(f => f.trim());
    } catch (err) {
      console.error(`Error finding files in ${dirPath}:`, err.message);
      continue;
    }
    
    for (const file of files) {
      // Skip allowlisted files
      const relPath = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
      if (ALLOWLIST_FILES.some(pattern => relPath.includes(pattern))) {
        continue;
      }
      
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        
        // Simple regex to find JSX string literals
        // Matches: <tag>String here</tag> or <tag attribute="String here" />
        // This is a heuristic and may have false positives/negatives
        const jsxTextPattern = />([^<>{]+)</g;
        const attributePattern = /=["']([^"']+)["']/g;
        
        lines.forEach((line, lineNum) => {
          // Check JSX text content
          let match;
          while ((match = jsxTextPattern.exec(line)) !== null) {
            const str = match[1].trim();
            if (str && !shouldSkipString(str)) {
              violations.push({
                file: relPath,
                line: lineNum + 1,
                string: str,
              });
            }
          }
          
          // Check attribute values (but skip aria-label, title, etc.)
          while ((match = attributePattern.exec(line)) !== null) {
            const str = match[1].trim();
            // Only flag non-aria, non-className attributes with long strings
            const isAria = line.includes('aria-');
            const isClass = line.includes('className=');
            const isDataTest = line.includes('data-test');
            const isId = line.includes('id=');
            const isKey = line.includes('key=');
            
            if (!isAria && !isClass && !isDataTest && !isId && !isKey && str && !shouldSkipString(str)) {
              violations.push({
                file: relPath,
                line: lineNum + 1,
                string: str,
              });
            }
          }
        });
      } catch (err) {
        console.error(`Error reading ${file}:`, err.message);
      }
    }
  }
  
  return violations;
}

function main() {
  console.log('🔍 Scanning for inline JSX string literals...\n');
  
  const violations = findInlineStrings();
  
  if (violations.length === 0) {
    console.log('✅ No inline string violations found!\n');
    process.exit(0);
  }
  
  console.error(`❌ Found ${violations.length} inline string violation(s):\n`);
  
  violations.forEach(({ file, line, string }) => {
    console.error(`  ${file}:${line}`);
    console.error(`    "${string}"\n`);
  });
  
  console.error('\n💡 Move these strings to dashboard/src/i18n/en.ts and use the useT() hook.\n');
  
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { findInlineStrings };
