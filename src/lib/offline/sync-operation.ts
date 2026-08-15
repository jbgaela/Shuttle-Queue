export function operationIdForRevision(currentOperationId: string | undefined, currentOperationRevision: number | undefined, localRevision: number, createId: () => string) {
  return currentOperationId && currentOperationRevision === localRevision ? currentOperationId : createId();
}
