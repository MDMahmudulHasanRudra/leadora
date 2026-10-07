// Spec §70 log shape: {"timestamp","level":"info","service",...}. Typed structurally so this package needs no pino dependency.
export function baseLoggerOptions(service: string, level: string) {
  return {
    level,
    base: { service },
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };
}
