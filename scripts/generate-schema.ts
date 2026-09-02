import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateConfigJsonSchema } from '../src/config.js';

const schemaPath = path.resolve('schema.json');
const schema = `${JSON.stringify(generateConfigJsonSchema(), null, 2)}\n`;

await writeFile(schemaPath, schema, 'utf8');
