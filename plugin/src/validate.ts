import {
  IDENTIFIER,
  MAX_FUNCTIONS,
  PLUGIN_ID,
  SUPPORTED_API_VERSIONS,
  VALUE_TYPES,
} from './limits.js';

/**
 * The server's own rules, applied here.
 *
 * A copy of what `PluginDeclarations.validated` does at upload, wording included,
 * so a plugin that is going to be refused is refused on the machine it was
 * written on. Two deliberate differences: this collects every problem rather than
 * stopping at the first, because a list is what somebody fixing them wants, and
 * it knows nothing about a database — it is given what a plugin answered and says
 * what is wrong with it.
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

/** What a plugin answered when it was loaded and asked. */
export interface Declaration {
  id: string;
  apiVersion: number;
  functions: DeclaredFunction[];
}

/** Something that would stop this plugin being accepted. */
export interface Problem {
  /** Which of the three questions it came from, for grouping in a report. */
  part: 'id' | 'apiVersion' | 'functions';
  message: string;
}

/** Everything wrong with what a plugin declared. Empty means the server would take it. */
export function validate(declared: Declaration): Problem[] {
  return [
    ...validateId(declared.id),
    ...validateApiVersion(declared.apiVersion),
    ...validateFunctions(declared.functions),
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
