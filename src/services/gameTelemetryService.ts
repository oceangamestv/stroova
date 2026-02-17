type GateEventName =
  | "gate_start"
  | "task_answered"
  | "boss_damaged"
  | "gate_clear"
  | "run_failed"
  | "run_completed";

type GateEventPayload = Record<string, unknown>;

type AnalyticsWindow = Window & {
  dataLayer?: Array<Record<string, unknown>>;
};

export const gameTelemetryService = {
  track(event: GateEventName, payload: GateEventPayload = {}): void {
    const data = { event, ...payload, timestamp: Date.now() };
    const w = window as AnalyticsWindow;
    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push(data);
    }
    if (import.meta.env.DEV) {
      // Локальный telemetry-fallback, чтобы удобно балансировать без внешней аналитики.
      console.info("[gate-telemetry]", data);
    }
  },
};
