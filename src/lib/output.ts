export interface OutputOptions {
  json: boolean;
  isTTY?: boolean;
  humanReadable?: string;
}

export function formatOutput(data: unknown, options: OutputOptions): string {
  const useJson = options.json || (options.isTTY === false);

  if (useJson) {
    return JSON.stringify(data, null, 2);
  }

  return options.humanReadable ?? JSON.stringify(data, null, 2);
}
