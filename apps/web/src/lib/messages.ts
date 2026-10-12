import type { ApiResult } from "./api";
export const unreachableMessage = "Unable to reach the server. Try again.";
export const ticketNotFoundMessage = "Ticket not found.";
const failures: Record<string, string> = {
  timeout: "The analysis took too long. Try again.",
  provider: "The AI provider failed. Try again.",
  invalid_output: "The AI returned an unusable result. Try again.",
  unconfigured: "The AI provider is not configured on the server. Contact the operator.",
};
export function analysisFailureMessage(code: string | null | undefined) {
  return (code && failures[code]) || "The analysis failed. Try again.";
}
function serverText(result: ApiResult, fallback: string) {
  return result.status === 0 ? unreachableMessage : typeof result.body?.error === "string" ? result.body.error : fallback;
}
export function analysisErrorText(result: ApiResult) {
  if (result.status === 0) return unreachableMessage;
  if (result.status === 429) return serverText(result, "Analysis limit reached. Try later.");
  if (result.status === 404) return ticketNotFoundMessage;
  if (result.status === 400) return serverText(result, "Invalid analysis request.");
  if (result.status === 503) return serverText(result, "Analysis storage unavailable. Reload before retrying.");
  const code = typeof result.body?.code === "string" ? result.body.code : undefined;
  return analysisFailureMessage(code);
}
export function ticketCreationErrorText(result: ApiResult) {
  if (result.status === 413) return "The ticket text is too long.";
  return serverText(result, "Unable to create the ticket. Try again.");
}
export function ticketLoadErrorText(result: ApiResult) {
  if (result.status === 404) return ticketNotFoundMessage;
  return serverText(result, "Unable to load the ticket. Try again.");
}
export function historyLoadErrorText(result: ApiResult) {
  return serverText(result, "Unable to load the tickets. Try again.");
}
