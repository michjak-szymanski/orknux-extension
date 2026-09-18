#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import process from 'node:process';

import { bundle } from './build.js';
import { inspect, NotAPluginError } from './inspect.js';
import type { Inspection } from './inspect.js';
import { API_VERSION, MAX_SOURCE_BYTES } from './limits.js';
import { qualifiedName, validate } from './validate.js';
import type { Problem } from './validate.js';

/**
 * `orknux-plugin` — build a plugin, and find out beforehand whether the server
 * would take it.
 *
 * Three commands, and the middle one is the point: `check` asks a built bundle
 * the questions the upload asks, and applies the rules the upload applies, so
 * the answer arrives while the file is still open rather than after a round
 * trip through an administrator.
 *
 * Arguments are parsed by hand. A plugin toolchain that pulled in a parser would
 * be a dependency in every plugin project for the sake of three flags.
 */

const USAGE = `orknux-plugin — plugins for orknux-server

  orknux-plugin build <entry> [-o <file>] [--minify] [--no-check]
  orknux-plugin check <file>
  orknux-plugin init [<directory>]

build   bundles <entry> into the single ES module the server takes, and checks
        the result. Writes dist/<entry>.js unless told otherwise.
check   loads a built plugin and reports what the server would make of it.
init    writes a plugin project that already builds.

  -o, --out <file>   where the bundle goes
      --minify       smaller, and unreadable when downloaded again
      --no-check     bundle without asking whether it would be accepted
  -h, --help         this
  -v, --version      the version of this package
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    process.stdout.write(`${await version()}\n`);
    return 0;
  }

  switch (command) {
    case 'build':
      return build(rest);
    case 'check':
      return check(rest);
    case 'init':
      return init(rest);
    default:
      process.stderr.write(`There is no "${command}" command.\n\n${USAGE}`);
      return 2;
  }
}

async function build(argv: string[]): Promise<number> {
  const flags = parse(argv);
  const entry = flags.positional[0];
  if (entry === undefined) {
    process.stderr.write('build needs the file holding the default export.\n');
    return 2;
  }

  const outfile = flags.out ?? join('dist', `${basename(entry, extname(entry))}.js`);

  try {
    const built = await bundle({ entry, outfile, minify: flags.minify });
    process.stdout.write(`${built.outfile}  ${size(built.bytes)}\n`);
  } catch (failure) {
    process.stderr.write(`${describe(failure)}\n`);
    return 1;
  }

  return flags.check ? report(outfile) : 0;
}

async function check(argv: string[]): Promise<number> {
  const file = parse(argv).positional[0];
  if (file === undefined) {
    process.stderr.write('check needs a built plugin to look at.\n');
    return 2;
  }
  return report(file);
}

/** Loads a built plugin, says what it is, and says whether it would be taken. */
async function report(file: string): Promise<number> {
  let inspected: Inspection;
  try {
    inspected = await inspect(resolve(file));
  } catch (failure) {
    process.stderr.write(`${describe(failure)}\n`);
    return 1;
  }

  const problems: Problem[] = validate(inspected);
  if (!inspected.withinSizeLimit) {
    problems.push({
      part: 'functions',
      message: `it is ${size(inspected.bytes)}, and a plugin may be at most ${size(MAX_SOURCE_BYTES)}`,
    });
  }

  process.stdout.write(
    `\n${inspected.id}  ·  plugin API ${inspected.apiVersion}  ·  ${size(inspected.bytes)}  ·  ` +
      `sha256 ${inspected.sha256.slice(0, 12)}…\n\n`,
  );

  if (inspected.functions.length === 0) {
    process.stdout.write('  It declares no functions.\n');
  }
  for (const declared of inspected.functions) {
    const params = declared.params
      .map((param) => `${param.name}: ${param.type.toLowerCase()}`)
      .join(', ');
    process.stdout.write(
      `  ${qualifiedName(inspected.id, declared.name)}(${params}): ${declared.returnType.toLowerCase()}\n`,
    );
    if (declared.description !== null && declared.description !== undefined) {
      process.stdout.write(`      ${declared.description}\n`);
    }
  }

  /*
   * The rest of what an administrator is shown: what each workspace will be
   * asked to answer, and what loading means agreeing to. Printed even when it
   * is only going to be read once, because "this asks for nothing" is exactly
   * as much worth knowing before an upload as after one.
   */
  if (inspected.parameters.length > 0) {
    process.stdout.write('\n  It has to be told:\n');
    for (const parameter of inspected.parameters) {
      const kind =
        parameter.connectionType === null || parameter.connectionType === undefined
          ? parameter.type.toLowerCase()
          : `${parameter.type.toLowerCase()} to ${parameter.connectionType}`;
      const marks = [
        parameter.required === false ? 'optional' : undefined,
        parameter.secret === true ? 'secret' : undefined,
      ].filter((mark) => mark !== undefined);
      process.stdout.write(
        `    ${parameter.name}: ${kind}${marks.length > 0 ? ` — ${marks.join(', ')}` : ''}\n`,
      );
    }
  }

  const agreed = [...inspected.permissions, ...inspected.capabilities];
  if (agreed.length > 0) {
    process.stdout.write(`\n  Loading it means accepting: ${agreed.join(', ')}\n`);
  }

  if (problems.length > 0) {
    process.stdout.write('\nThe server would refuse this:\n\n');
    for (const problem of problems) process.stdout.write(`  - ${problem.message}\n`);
    process.stdout.write('\n');
    return 1;
  }

  /*
   * The filename is what the plugin is called on screen — the id is what it *is* —
   * so a bundle named after its entry point turns up in the list as "plugin".
   * Worth a word, and not worth refusing over.
   */
  const named = basename(inspected.file, extname(inspected.file));
  if (named !== inspected.id) {
    process.stdout.write(
      `\nIt would be listed as "${named}", from the filename. Build to ` +
        `${join(dirname(inspected.file), `${inspected.id}.js`)} to have it listed as itself.\n`,
    );
  }

  process.stdout.write(`\nAccepted. Load it with: orkx plugin load --file ${inspected.file}\n\n`);
  return 0;
}

async function init(argv: string[]): Promise<number> {
  const directory = resolve(parse(argv).positional[0] ?? '.');
  const name = basename(directory);
  const id = name.replace(/[^A-Za-z0-9_$]/g, '_').slice(0, 32) || 'plugin';

  await mkdir(join(directory, 'src'), { recursive: true });

  const files: Array<[string, string]> = [
    [join(directory, 'package.json'), scaffoldPackage(name, id)],
    [join(directory, 'tsconfig.json'), SCAFFOLD_TSCONFIG],
    [join(directory, '.gitignore'), 'node_modules/\ndist/\n'],
    [join(directory, 'src', 'plugin.ts'), scaffoldPlugin(id)],
  ];

  for (const [path, content] of files) {
    /*
     * Never over a file that is already there: running `init` in a directory
     * somebody has worked in is a mistake, and it should cost nothing.
     */
    try {
      await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
      process.stdout.write(`  ${path}\n`);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure;
      process.stdout.write(`  ${path} — already there, left alone\n`);
    }
  }

  process.stdout.write('\nnpm install && npm run build\n');
  return 0;
}

interface Flags {
  positional: string[];
  out?: string;
  minify: boolean;
  check: boolean;
}

function parse(argv: string[]): Flags {
  const flags: Flags = { positional: [], minify: false, check: true };

  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at] as string;
    switch (argument) {
      case '-o':
      case '--out':
        at += 1;
        flags.out = argv[at];
        break;
      case '--minify':
        flags.minify = true;
        break;
      case '--no-check':
        flags.check = false;
        break;
      default:
        flags.positional.push(argument);
    }
  }

  return flags;
}

/** esbuild reports a list of places; anything else reports a sentence. */
function describe(failure: unknown): string {
  if (failure instanceof NotAPluginError) return failure.message;

  const errors = (failure as {
    errors?: Array<{ text?: string; location?: { file?: string; line?: number } }>;
  }).errors;

  if (Array.isArray(errors) && errors.length > 0) {
    return errors
      .map((error) => {
        const at = error.location;
        const where = at?.file === undefined ? '' : ` (${at.file}:${at.line ?? 0})`;
        return `${error.text ?? 'the build failed'}${where}`;
      })
      .join('\n');
  }

  return failure instanceof Error ? failure.message : String(failure);
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function version(): Promise<string> {
  const manifest = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(manifest) as { version: string }).version;
}

function scaffoldPackage(name: string, id: string): string {
  return `${JSON.stringify(
    {
      name,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: {
        build: `orknux-plugin build src/plugin.ts -o dist/${id}.js`,
        typecheck: 'tsc --noEmit',
      },
      devDependencies: {
        '@orknux/plugin': '^0.1.0',
        typescript: '^5.9.0',
      },
    },
    null,
    2,
  )}\n`;
}

const SCAFFOLD_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['src'],
  },
  null,
  2,
)}\n`;

function scaffoldPlugin(id: string): string {
  return `import { definePlugin, fn } from '@orknux/plugin';

/*
 * A plugin is one default export. The server loads this file, asks what it is
 * called, which plugin API it uses and what it offers, and turns the answers
 * into functions every workspace can call — this one as \`${id}_isTeammate\`.
 */
export default definePlugin({
  id: '${id}',
  apiVersion: ${API_VERSION},
  functions: [
    fn({
      name: 'isTeammate',
      description: 'Whether an email address belongs to a member of this workspace.',
      params: [{ name: 'email', type: 'string' }],
      returnType: 'boolean',

      /*
       * Nothing in here can reach out. The sandbox has no network and no files,
       * so a function works with what it was passed and nothing else.
       */
      run: (email) => email.endsWith('@example.com'),
    }),
  ],
});
`;
}

process.exitCode = await main(process.argv.slice(2));
