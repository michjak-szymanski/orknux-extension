import {
  CAPABILITIES,
  CONNECTION,
  CONNECTION_TYPES,
  IDENTIFIER,
  MAX_FUNCTIONS,
  MAX_PARAMETERS,
  MAX_PERMISSIONS,
  PARAMETER_TYPES,
  PERMISSIONS,
  PLUGIN_ID,
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
  parameters?: DeclaredParameter[];
  permissions?: string[];
  capabilities?: string[];
}

/** Something that would stop this plugin being accepted. */
export interface Problem {
  /** Which of the plugin's answers it came from, for grouping in a report. */
  part: 'id' | 'apiVersion' | 'functions' | 'parameters' | 'permissions' | 'capabilities';
  message: string;
}

/** Everything wrong with what a plugin declared. Empty means the server would take it. */
export function validate(declared: Declaration): Problem[] {
  return [
    ...validateId(declared.id),
    ...validateApiVersion(declared.apiVersion),
    ...validateFunctions(declared.functions),
    ...validateParameters(declared.parameters ?? []),
    ...validatePermissions(declared.permissions ?? []),
    ...validateCapabilities(declared.capabilities ?? []),
  ];
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
