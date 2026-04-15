/**
 * MCP 安装工具函数
 *
 * extraConfig merge → 模板替换 → 最终 serverConfig
 */

/**
 * Extract ${var} template variables from a server config object.
 * Scans all string values recursively.
 */
export function extractConfigVariables(config: Record<string, unknown>): string[] {
  const vars: string[] = [];
  const str = JSON.stringify(config);
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g;
  let match: RegExpExecArray | null = re.exec(str);
  while (match !== null) {
    if (!vars.includes(match[1])) vars.push(match[1]);
    match = re.exec(str);
  }
  return vars;
}

/**
 * Substitute ${var} template variables in a string with actual values.
 * Returns the string with all matched variables replaced.
 */
function substituteConfigVariables(
  str: string,
  values: Record<string, string>
): { result: string; consumedKeys: Set<string> } {
  const consumedKeys = new Set<string>();
  const result = str.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)}/g, (match, varName: string) => {
    if (varName in values) {
      consumedKeys.add(varName);
      return values[varName];
    }
    return match; // leave unresolved
  });
  return { result, consumedKeys };
}

/**
 * Merge extraConfig values into a server config.
 *
 * 1. Replace ${var} templates in the config with provided values
 * 2. Append unconsumed values to env (stdio) or headers (sse/http)
 * 3. Does NOT mutate the original config — returns a new object
 *
 * @param transportType - 'stdio' | 'sse' | 'http'
 * @param serverConfig - Original server config object
 * @param extraConfigValues - User-provided key-value pairs
 * @returns Merged server config with templates resolved
 */
export function mergeExtraConfigIntoServerConfig(
  transportType: string,
  serverConfig: Record<string, unknown>,
  extraConfigValues: Record<string, string>
): Record<string, unknown> {
  const keys = Object.keys(extraConfigValues);
  if (keys.length === 0) return serverConfig;

  // Serialize → substitute → deserialize
  const configStr = JSON.stringify(serverConfig);
  const { result: resolvedStr, consumedKeys } = substituteConfigVariables(
    configStr,
    extraConfigValues
  );
  const resolved = JSON.parse(resolvedStr) as Record<string, unknown>;

  // Append unconsumed keys
  const unconsumed: Record<string, string> = {};
  for (const key of keys) {
    if (!consumedKeys.has(key)) {
      unconsumed[key] = extraConfigValues[key];
    }
  }

  if (Object.keys(unconsumed).length === 0) return resolved;

  if (transportType === 'stdio') {
    // Append to env
    const env = (resolved.env as Record<string, string>) ?? {};
    resolved.env = { ...env, ...unconsumed };
  } else {
    // Append to headers
    const headers = (resolved.headers as Record<string, string>) ?? {};
    resolved.headers = { ...headers, ...unconsumed };
  }

  return resolved;
}
