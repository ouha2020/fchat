export type SendTextResult = boolean | void;

export function shouldClearTextAfterSend(result: SendTextResult): boolean {
  return result !== false;
}
