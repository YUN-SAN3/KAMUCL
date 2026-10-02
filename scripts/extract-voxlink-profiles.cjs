// Read-only upstream extraction. Usage: node scripts/extract-voxlink-profiles.cjs <reference root>
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
if (!root) throw new Error('Reference root required')
const source = fs.readFileSync(path.join(root, 'fabric/1.20_1.20.1/src/main/java/icu/wuhui/voxlink/network/PunchProfile.java'), 'utf8')
const fields = name => [...source.match(new RegExp(`(?:private|public) ${name}\\(\\s*([\\s\\S]*?)\\) \\{`))[1].matchAll(/(?:[\w.]+(?:\[\])?)\s+(\w+)(?:,|\s*$)/g)].map(m => m[1])
const send = fields('SendParams'), sym = fields('SymParams'), profile = fields('PunchProfile')
const values = s => s.replace(/new int\[\]\{([^}]*)\}/g, (_, x) => '[' + x.replace(/,/g, ';') + ']').split(',').map(v => v.trim().replace(/;/g, ','))
const object = (name, type, keys, vals, extra = '') => `export const ${name}: ${type} = Object.freeze({\n${keys.map((k, i) => `  ${k}: ${vals[i]}, // PunchProfile.java: ${name}.${k}`).join('\n')}\n${extra}})\n`
let out = '// SPDX-License-Identifier: LGPL-3.0-only\n// VoxLink 924845e897d8fb36dca2474ade30e675278559d0; generated from unmodified PunchProfile.java.\n'
out += `export interface SendParams {\n${send.map(k => `  readonly ${k}: number`).join('\n')}\n}\n`
out += `export interface SymParams {\n${sym.map(k => `  readonly ${k}: number`).join('\n')}\n}\n`
out += `export interface PunchProfile {\n${profile.map(k => `  readonly ${k}: ${k === 'name' ? 'string' : k === 'send' ? 'SendParams' : k === 'progressiveRanges' ? 'readonly number[]' : 'number'}`).join('\n')}\n  readonly sym: SymParams\n}\n`
for (const m of source.matchAll(/(?:PunchProfile\.)?SendParams (SEND_\w+) = new (?:PunchProfile\.)?SendParams\(([^)]*)\)/g)) out += object(m[1], 'SendParams', send, values(m[2]))
out += object('RECIPE', 'SymParams', sym, values(source.match(/RECIPE = new SymParams\(([^)]*)\)/)[1]))
const names = []
for (const m of source.matchAll(/public static final PunchProfile (\w+) = new PunchProfile\(\s*([\s\S]*?)\s*\);/g)) {
  const vals = values(m[2]); if (vals.length !== profile.length) throw new Error('Profile arity: ' + m[1])
  names.push(m[1]); out += object(m[1], 'PunchProfile', profile, vals, '  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE\n')
}
out += `export const PROFILES = { ${names.join(', ')} } as const\n`
fs.writeFileSync('src/main/core/voxlink/punchProfiles.ts', out)
