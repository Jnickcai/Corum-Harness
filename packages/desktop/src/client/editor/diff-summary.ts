export interface LineChange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

export function summarizeLineChanges(changes: readonly LineChange[] | null): { added: number; removed: number; count: number } {
  let added = 0
  let removed = 0
  for (const change of changes ?? []) {
    if (change.modifiedEndLineNumber !== 0) added += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
    if (change.originalEndLineNumber !== 0) removed += change.originalEndLineNumber - change.originalStartLineNumber + 1
  }
  return { added, removed, count: changes?.length ?? 0 }
}
