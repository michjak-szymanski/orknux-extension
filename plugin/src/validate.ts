import {
  CAPABILITIES,
  CONNECTION,
  CONNECTION_TYPES,
  IDENTIFIER,
  LIBRARY_PATH,
  MAX_FUNCTIONS,
  MAX_LIBRARIES,
  MAX_LIBRARY_PATH_LENGTH,
  MAX_OBJECTS,
  MAX_PARAMETERS,
  MAX_PERMISSIONS,
  MAX_PROPERTIES,
  MAX_SKILLS,
  MAX_SKILL_CHARS,
  MAX_SKILL_NAME_LENGTH,
  MAX_TOOLS,
  OBJECT_NAME,
  PARAMETER_TYPES,
  PERMISSIONS,
  PLUGIN_ID,
  PROPERTY_KINDS,
  SUPPORTED_API_VERSIONS,
  VALUE_TYPES,
} from './limits.js';

/**
 * The server's own rules, applied here.
 *
 * A copy of what the upload does — `PluginDeclarations.validated` and
 * `validatedParameters`, the permission and capability vocabularies, and the
 * bounds `PluginRunner` reads under — wording included, so a plugin that is
 * going to be refused is refused on the machine it was written on. Two
 * deliberate differences: this collects every problem rather than stopping at
 * the first, because a list is what somebody fixing them wants, and it knows
 * nothing about a database — it is given what a plugin answered and says what is
 * wrong with it.
 */

/** One parameter, as the plugin wrote it. Whether the type is real is decided here. */
export interface DeclaredParam {
  name: string;
  type: string;
}

/** One function, as the plugin wrote it. */
export interface DeclaredFunction {
  name: string;
  description?: string | null;
  params: DeclaredParam[];
  returnType: string;
}

/**
 * One tool the plugin offers to agents, as the inspection resolved it.
 *
 * The same shape as a function's declaration plus `proxyOf`: set, it names the
 * plugin's own function this tool stands in front of, and the params and
 * return type here were copied from it when the plugin was questioned. Absent
 * or null for a tool with a `run` of its own.
 */
export interface DeclaredTool {
  name: string;
  description?: string | null;
  params: DeclaredParam[];
  returnType: string;
  proxyOf?: string | null;
}

/**
 * One thing the plugin says it has to be told, as it wrote it.
 *
 * `required` and `secret` are optional here because a declaration is what a
 * plugin answered, and the sandbox's own constructor already filled the
 * defaults in — true and false respectively — before anything was asked.
 */
export interface DeclaredParameter {
  name: string;
  description?: string | null;
  type: string;
  required?: boolean;
  secret?: boolean;
  connectionType?: string | null;
}

/** What a plugin answered when it was loaded and asked. */
export interface Declaration {
  id: string;
  apiVersion: number;
  functions: DeclaredFunction[];
  /** Optional because a declaration written before these existed has none. */
  tools?: DeclaredTool[];
  parameters?: DeclaredParameter[];
  permissions?: string[];
  capabilities?: string[];
  /** The relative paths of the library files it ships with; optional for the same reason. */
  libraries?: string[];
  /** The instruction sets it brings; optional for the same reason. */
  skills?: DeclaredSkill[];
  /** The shapes it exports; optional for the same reason. */
  objects?: DeclaredObject[];
}

/** One instruction set a plugin brings, as it reaches the loader. */
export interface DeclaredSkill {
  name: string;
  description?: string | null;
  content: string;
}

/** One field of an exported object, as it reaches the loader. */
export interface DeclaredProperty {
  name: string;
  kind: string;
  /** The object it points at, or what the array holds. */
  of?: string | null;
  description?: string | null;
}

/** One shape a plugin exports, as it reaches the loader. */
export interface DeclaredObject {
  name: string;
  description?: string | null;
  properties: DeclaredProperty[];
}

/** Something that would stop this plugin being accepted. */
export interface Problem {
  /** Which of the plugin's answers it came from, for grouping in a report. */
  part:
    | 'id'
    | 'apiVersion'
    | 'functions'
    | 'tools'
    | 'parameters'
    | 'permissions'
    | 'capabilities'
    | 'libraries'
    | 'skills'
    | 'objects';
  message: string;
}

/** Everything wrong with what a plugin declared. Empty means the server would take it. */
export function validate(declared: Declaration): Problem[] {
  return [
    ...validateId(declared.id),
    ...validateApiVersion(declared.apiVersion),
    ...validateFunctions(declared.functions),
    ...validateTools(declared.tools ?? [], declared.functions),
    ...validateParameters(declared.parameters ?? []),
    ...validatePermissions(declared.permissions ?? []),
    ...validateCapabilities(declared.capabilities ?? []),
    ...validateLibraries(declared.libraries ?? []),
    ...validateSkills(declared.skills ?? []),
    ...validateObjects(declared.objects ?? []),
  ];
}

/**
 * The skills, held to what the server holds them to.
 *
 * The frontmatter is deliberately not required here, because it is not
 * required there: a plugin that wrote plain markdown and named the skill in
 * its declaration has stated both facts once, and the server writes the block
 * from them. What is checked is a block that *opens* and never closes, which
 * is a mistake rather than an omission.
 */
export function validateSkills(declared: DeclaredSkill[]): Problem[] {
  const problems: Problem[] = [];
  const refuse = (message: string): void => {
    problems.push({ part: 'skills', message });
  };

  if (declared.length > MAX_SKILLS) {
    refuse(`skills() declared more than ${MAX_SKILLS} skills`);
    return problems;
  }

  const seen = new Set<string>();
  for (const skill of declared) {
    const name = typeof skill?.name === 'string' ? skill.name.trim() : '';
    if (name.length === 0) {
      refuse('a skill has to have a name');
      continue;
    }
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      refuse(`"${name.slice(0, 40)}…" is longer than a skill name can be (${MAX_SKILL_NAME_LENGTH})`);
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      refuse(`skills() declares ${name} more than once`);
    }
    seen.add(name.toLowerCase());

    const content = typeof skill.content === 'string' ? skill.content : '';
    if (content.trim().length === 0) {
      refuse(`the skill ${name} has no content: a skill is the markdown an agent reads`);
      continue;
    }
    if (content.length > MAX_SKILL_CHARS) {
      refuse(`the skill ${name} is ${content.length} characters, and a skill is at most ${MAX_SKILL_CHARS}`);
      continue;
    }

    const lines = content.split('\n');
    const first = lines.findIndex((line) => line.trim().length > 0);
    if (first !== -1 && lines[first]?.trim() === '---') {
      const closes = lines.slice(first + 1).some((line) => line.trim() === '---');
      if (!closes) refuse(`the skill ${name} opens a frontmatter fence and never closes it`);
    }
  }
  return problems;
}

/**
 * The exported shapes, held to what the server holds them to.
 *
 * The part worth having locally is the last of them: an `of` naming an object
 * the plugin does not declare. Every other check fires at the line that wrote
 * it, but that one needs the whole set, so it is the one a plugin author
 * otherwise learns about from a refused upload.
 */
export function validateObjects(declared: DeclaredObject[]): Problem[] {
  const problems: Problem[] = [];
  const refuse = (message: string): void => {
    problems.push({ part: 'objects', message });
  };

  if (declared.length > MAX_OBJECTS) {
    refuse(`objects() declared more than ${MAX_OBJECTS} objects`);
    return problems;
  }

  const names = new Set<string>();
  for (const object of declared) {
    const name = typeof object?.name === 'string' ? object.name.trim() : '';
    if (!OBJECT_NAME.test(name)) {
      refuse(`"${name}" is not a usable object name`);
      continue;
    }
    if (names.has(name)) refuse(`objects() declares ${name} more than once`);
    names.add(name);
  }

  for (const object of declared) {
    const name = typeof object?.name === 'string' ? object.name.trim() : '';
    const properties = Array.isArray(object?.properties) ? object.properties : [];
    if (properties.length > MAX_PROPERTIES) {
      refuse(`${name} declares more than ${MAX_PROPERTIES} properties`);
      continue;
    }

    const fields = new Set<string>();
    for (const held of properties) {
      const field = typeof held?.name === 'string' ? held.name.trim() : '';
      if (!IDENTIFIER.test(field)) {
        refuse(`${name} has a property called "${field}", which is not a usable name`);
        continue;
      }
      if (fields.has(field)) refuse(`${name} declares ${field} twice`);
      fields.add(field);

      const kind = typeof held.kind === 'string' ? held.kind.trim().toLowerCase() : '';
      if (!PROPERTY_KINDS.includes(kind)) {
        refuse(`${name}'s ${field} is a "${held.kind}", which is not one of ${PROPERTY_KINDS.join(', ')}`);
        continue;
      }

      const points = kind === 'object' || kind === 'array';
      const of = typeof held.of === 'string' ? held.of.trim() : null;
      if (points && (of === null || of.length === 0)) {
        refuse(
          `${name}'s ${field} is ${kind === 'object' ? 'an object' : 'an array'}, so it needs an "of": ` +
            (kind === 'object' ? 'the object it points at' : 'what it holds'),
        );
        continue;
      }
      if (!points && of !== null) {
        refuse(`${name}'s ${field} names an "of" but is a ${kind}`);
        continue;
      }
      if (of === null) continue;

      // An array of scalars says so with a kind; anything else names an object.
      if (kind === 'array' && PROPERTY_KINDS.includes(of.toLowerCase()) && of.toLowerCase() !== 'object') {
        if (of.toLowerCase() === 'array') {
          refuse(`${name}'s ${field} is an array of arrays, which this server has no shape for`);
        }
        continue;
      }
      if (!names.has(of)) {
        refuse(`${name}'s ${field} points at "${of}", which objects() does not declare`);
      }
    }
  }
  return problems;
}

/**
 * The library paths, held to the shape the server holds them to: relative,
 * `/`-joined, ending in `.js`, nothing that could name a file outside what
 * travels with the plugin. What this cannot check — that every relative import
 * resolves within the declared set — the server checks against the files it
 * actually receives.
 */
export function validateLibraries(declared: string[]): Problem[] {
  const problems: Problem[] = [];
  const refuse = (message: string): void => {
    problems.push({ part: 'libraries', message });
  };

  if (declared.length > MAX_LIBRARIES) {
    refuse(`libraries() declared more than ${MAX_LIBRARIES} files`);
    return problems;
  }

  const seen = new Set<string>();
  for (const path of declared) {
    if (typeof path !== 'string' || path.trim().length === 0) {
      refuse('a library path has to be a non-empty string');
      continue;
    }
    const held = path.trim();
    if (held.length > MAX_LIBRARY_PATH_LENGTH) {
      refuse(`"${held.slice(0, 40)}…" is longer than a library path can be (${MAX_LIBRARY_PATH_LENGTH})`);
      continue;
    }
    if (!LIBRARY_PATH.test(held)) {
      refuse(
        `"${held}" is not a usable library path: relative, /-joined and ending in .js — ` +
          'no absolute paths, no URLs, no .., no bare specifiers',
      );
      continue;
    }
    // The same file spelled with and without './' is one file; the server
    // stores it without, so it is compared without.
    const bare = held.replace(/^\.\//, '');
    if (seen.has(bare)) {
      refuse(`libraries() declares ${bare} more than once`);
    }
    seen.add(bare);
  }
  return problems;
}

export function validateId(id: string): Problem[] {
  if (typeof id !== 'string' || id.trim().length === 0) {
    return [{ part: 'id', message: 'id() did not answer with a name' }];
  }
  if (!PLUGIN_ID.test(id.trim())) {
    return [
      {
        part: 'id',
        message:
          `"${id}" cannot be a plugin id: it has to start with a letter and hold only ` +
          'letters, digits or underscores, up to 32 of them — it becomes the prefix on ' +
          'every function the plugin declares.',
      },
    ];
  }
  return [];
}

export function validateApiVersion(version: number): Problem[] {
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return [{ part: 'apiVersion', message: 'apiVersion() did not answer with a whole number' }];
  }
  if (!SUPPORTED_API_VERSIONS.includes(version)) {
    return [
      {
        part: 'apiVersion',
        message:
          `The plugin uses plugin API version ${version}, which this server does not know. ` +
          `It supports ${[...SUPPORTED_API_VERSIONS].sort((a, b) => a - b).join(', ')}.`,
      },
    ];
  }
  return [];
}

export function validateFunctions(declared: DeclaredFunction[]): Problem[] {
  const problems: Problem[] = [];
  const refuse = (message: string): void => {
    problems.push({ part: 'functions', message });
  };

  if (declared.length > MAX_FUNCTIONS) {
    refuse(`functions() declared more than ${MAX_FUNCTIONS} functions`);
  }

  const names = new Set<string>();
  for (const declaration of declared) {
    const name = declaration.name;

    if (!IDENTIFIER.test(name)) {
      refuse(`"${name}" is not a usable function name`);
    }
    if (names.has(name)) {
      refuse(`it declares ${name} more than once`);
    }
    names.add(name);

    /*
     * `none` and `object` are types the server has and a plugin may not use, so
     * they are named in the refusal rather than lumped in with a typo. A plugin's
     * functions belong to every workspace at once, and an object names one
     * workspace's definition — there is no workspace here for it to mean.
     */
    if (isReserved(declaration.returnType)) {
      refuse(
        declaration.returnType.trim().toLowerCase() === 'none'
          ? `${name} must return something, not none`
          : `${name} returns an object, which names one of a workspace's definitions. A ` +
              "plugin's functions belong to every workspace at once, so use map instead.",
      );
    } else if (!isValueType(declaration.returnType)) {
      refuse(`${name} returns "${declaration.returnType}", which is not a type this server has`);
    }

    const params = new Set<string>();
    for (const param of declaration.params) {
      if (!IDENTIFIER.test(param.name)) {
        refuse(`${name} has a parameter called "${param.name}", which is not a usable name`);
      }
      if (params.has(param.name)) {
        refuse(`${name} declares ${param.name} twice`);
      }
      params.add(param.name);

      const written = param.type.trim().toLowerCase();
      if (written === 'object') {
        refuse(
          `${name}'s ${param.name} is an object, which names one of a workspace's ` +
            "definitions. A plugin's functions belong to every workspace at once, so there is " +
            'no workspace whose objects they could name. Use map instead.',
        );
      } else if (written === 'none') {
        /*
         * Stricter than the upload, which lets this through: nothing can be passed
         * for a parameter that is declared to carry no value, so a workflow calling
         * it would have nothing to fill in. Refused here because it is a mistake
         * either way, and the types in this package cannot express it anyway.
         */
        refuse(`${name}'s ${param.name} is a "none", and a parameter has to carry something`);
      } else if (!isValueType(param.type)) {
        refuse(`${name}'s ${param.name} is a "${param.type}", which is not a type this server has`);
      }
    }
  }

  return problems;
}

/**
 * The rules the agents' surface is held to — `PluginDeclarations.validatedTools`,
 * in the upload's own sentences.
 *
 * Tool names are identifiers and unique among the tools; sharing a name with a
 * function is fine, and is exactly what a proxy defaults to — the two lists
 * have different readers and never answer the same call. A tool answers a
 * model, so `none` and `object` are refused as return types by name. And a
 * proxy has to front a function the plugin declares, which is the loader's
 * refusal rather than the upload's: the inspection resolves proxies before the
 * upload ever judges them, so it is applied here from [functions].
 */
export function validateTools(
  declared: DeclaredTool[],
  functions: DeclaredFunction[] = [],
): Problem[] {
  const problems: Problem[] = [];
  const refuse = (message: string): void => {
    problems.push({ part: 'tools', message });
  };

  if (declared.length > MAX_TOOLS) {
    refuse(`tools() declared more than ${MAX_TOOLS} tools`);
  }

  const offered = new Set(functions.map((one) => one.name));
  const names = new Set<string>();
  for (const tool of declared) {
    const name = tool.name;

    if (!IDENTIFIER.test(name)) {
      refuse(`"${name}" is not a usable tool name`);
    }
    if (names.has(name)) {
      refuse(`it declares the tool ${name} more than once`);
    }
    names.add(name);

    const proxyOf = tool.proxyOf ?? null;
    if (proxyOf !== null && !offered.has(proxyOf)) {
      refuse(`tools() proxies "${proxyOf}", which functions() does not declare`);
    }

    if (isReserved(tool.returnType)) {
      refuse(
        `the tool ${name} returns ${tool.returnType.trim().toLowerCase()}; a tool answers a model, ` +
          `so it has to return one of ${VALUE_TYPES.join(', ')}`,
      );
    } else if (!isValueType(tool.returnType)) {
      refuse(`the tool ${name} returns "${tool.returnType}", which is not a type this server has`);
    }

    const params = new Set<string>();
    for (const param of tool.params) {
      if (!IDENTIFIER.test(param.name)) {
        refuse(`the tool ${name} has a parameter called "${param.name}", which is not a usable name`);
      }
      if (params.has(param.name)) {
        refuse(`the tool ${name} declares ${param.name} twice`);
      }
      params.add(param.name);

      /*
       * Stricter than the upload, which reads a tool's params against the
       * whole type list: `none` and `object` cannot be filled in by a model
       * any more than by a workflow, the types in this package cannot express
       * them, and refusing them here can only stop something no plugin should
       * be doing.
       */
      const written = param.type.trim().toLowerCase();
      if (written === 'none') {
        refuse(`the tool ${name}'s ${param.name} is a "none", and a parameter has to carry something`);
      } else if (written === 'object') {
        refuse(
          `the tool ${name}'s ${param.name} is an object, which names one of a workspace's ` +
            "definitions. A plugin's tools belong to every workspace at once, so there is " +
            'no workspace whose objects they could name. Use map instead.',
        );
      } else if (!isValueType(param.type)) {
        refuse(
          `the tool ${name}'s ${param.name} is a "${param.type}", which is not a type this server has`,
        );
      }
    }
  }

  return problems;
}

/**
 * The rules a plugin's own parameters are held to — the ones a workspace
 * answers, not the ones a caller fills in.
 *
 * The wording is the upload's, from `PluginDeclarations.validatedParameters`,
 * plus the bound `PluginRunner` reads under. A connection is the one parameter
 * that is neither typed in nor read from a variable: it points at a row the
 * workspace already has, so it is checked on its own terms and never against
 * the scalar types.
 */
export function validateParameters(declared: DeclaredParameter[]): Problem[] {
  const problems: Problem[] = [];
  const refuse = (message: string): void => {
    problems.push({ part: 'parameters', message });
  };

  if (declared.length > MAX_PARAMETERS) {
    refuse(`parameters() declared more than ${MAX_PARAMETERS} parameters`);
  }

  const names = new Set<string>();
  for (const parameter of declared) {
    const name = parameter.name;

    if (!IDENTIFIER.test(name)) {
      refuse(`"${name}" is not a usable parameter name`);
    }
    if (names.has(name)) {
      refuse(`it declares the parameter ${name} more than once`);
    }
    names.add(name);

    const connectionType = parameter.connectionType ?? null;

    if (parameter.type.trim().toLowerCase() === CONNECTION) {
      if (!isConnectionType(connectionType)) {
        refuse(
          `the parameter ${name} is a connection but does not say which kind. ` +
            `It has to name one of ${CONNECTION_TYPES.join(', ')}.`,
        );
      }
      if (parameter.secret === true) {
        /*
         * Refused rather than ignored, as the upload refuses it: a connection
         * parameter holds no secret — it names a row, and the credential on
         * that row is decrypted on the far side of the sandbox and never
         * crosses it — so a plugin marking one secret has misunderstood what
         * it is being given.
         */
        refuse(
          `the parameter ${name} is a connection and cannot be a secret: it names a ` +
            "connection rather than holding one's credential.",
        );
      }
      continue;
    }

    if (connectionType !== null) {
      refuse(`the parameter ${name} names a connection kind but is a "${parameter.type}".`);
      continue;
    }

    if (!isParameterType(parameter.type)) {
      refuse(
        `the parameter ${name} is a "${parameter.type}". A parameter is either typed in, ` +
          "points at one of the workspace's variables, or names one of the workspace's " +
          'connections, so it has to be one of ' +
          `${[...PARAMETER_TYPES, CONNECTION].join(', ')}.`,
      );
    }
  }

  return problems;
}

/**
 * The permission vocabulary, applied as the server applies it: a closed list,
 * matched exactly. Not case-folded — a plugin asking for something is making a
 * precise request, and being generous about how it is spelled is how a typo
 * becomes a grant of something adjacent.
 */
export function validatePermissions(declared: string[]): Problem[] {
  const problems: Problem[] = [];

  /*
   * The loader trims what `permissions()` answered, drops empties and reads
   * each name once before any of this is judged, so the same is done here —
   * a name asked for twice is one request, not two refusals.
   */
  const asked = [...new Set(declared.map((name) => name.trim()).filter((name) => name.length > 0))];

  if (asked.length > MAX_PERMISSIONS) {
    problems.push({
      part: 'permissions',
      message: `permissions() asked for more than ${MAX_PERMISSIONS} things`,
    });
  }

  for (const name of asked) {
    if (!(PERMISSIONS as readonly string[]).includes(name)) {
      problems.push({
        part: 'permissions',
        message:
          `This plugin asks for "${name}", which is not something this server can grant. ` +
          `It grants ${PERMISSIONS.join(', ')}.`,
      });
    }
  }

  return problems;
}

/**
 * The capability vocabulary, applied as the server applies it.
 *
 * There is no count bound here because the loader reads these under none: the
 * closed list is the bound, and a name that is not on it is refused whatever
 * the length. Matched forgivingly — trimmed, any case — because that is how
 * `PluginCapability.named` matches.
 */
export function validateCapabilities(declared: string[]): Problem[] {
  const problems: Problem[] = [];

  for (const name of declared) {
    const matched = (CAPABILITIES as readonly string[]).some(
      (capability) => capability.toLowerCase() === name.trim().toLowerCase(),
    );
    if (!matched) {
      problems.push({
        part: 'capabilities',
        message:
          `This server has no capability called "${name}". ` +
          'A plugin may only ask for the ones it has.',
      });
    }
  }

  return problems;
}

/** `teammates_isTeammate` — what a workflow will call this by once it is loaded. */
export function qualifiedName(id: string, name: string): string {
  return `${id}_${name}`;
}

/** A type the server has but a plugin may not use. Worth its own sentence. */
function isReserved(type: string): boolean {
  const written = type.trim().toLowerCase();
  return written === 'none' || written === 'object';
}

function isValueType(type: string): boolean {
  const written = type.trim().toLowerCase();
  return (VALUE_TYPES as readonly string[]).includes(written);
}

function isParameterType(type: string): boolean {
  const written = type.trim().toLowerCase();
  return (PARAMETER_TYPES as readonly string[]).includes(written);
}

/** Matched the way the server matches a connection kind: trimmed, any case. */
function isConnectionType(named: string | null): boolean {
  if (named === null) return false;
  const written = named.trim().toLowerCase();
  return (CONNECTION_TYPES as readonly string[]).some((kind) => kind.toLowerCase() === written);
}
