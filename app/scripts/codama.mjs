// Generate a @solana/kit client from the Anchor IDL.
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { readFileSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(readFileSync(path.join(here, '../../target/idl/heirloom.json'), 'utf8'));
const codama = createFromRoot(rootNodeFromAnchor(idl));
const out = path.join(here, '../.codama-out');
await codama.accept(renderVisitor(out, { deleteFolderBeforeRendering: true, formatCode: false }));
const dest = path.join(here, '../src/generated');
rmSync(dest, { recursive: true, force: true });
cpSync(path.join(out, 'src/generated'), dest, { recursive: true });
rmSync(out, { recursive: true, force: true });
console.log('generated src/generated');
