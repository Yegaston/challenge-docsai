type Timer = {
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
};

/** Single-flight maintenance; diagnostics carry counts only, never row data or driver errors. */
export function startTicketRetention(
  service: { sweep(shouldStop: () => boolean): Promise<{ deleted: number; conflicts: number; backlog: number }> },
  timer: Timer = { setInterval, clearInterval },
  report: (message: string) => void = (message) => console.warn(message),
) {
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = service.sweep(() => stopped).then(({ backlog }) => {
      if (backlog > 0) report(`Ticket retention backlog: ${backlog}`);
    }).catch(() => { report("Ticket retention sweep failed; will retry."); }).finally(() => { inFlight = undefined; });
  };
  run();
  const interval = timer.setInterval(run, 15 * 60 * 1000);
  return async () => {
    stopped = true;
    timer.clearInterval(interval);
    await inFlight;
  };
}
