import type { WealthDocument } from '@nonsheet-finance/core'
import { createEmptyWealthDocument } from '@nonsheet-finance/core'

type Listener = () => void

let doc: WealthDocument = createEmptyWealthDocument()
let dirty = false
const listeners = new Set<Listener>()

function emit() {
  for (const fn of listeners) fn()
}

export function subscribeWealthDocStore(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getWealthDocument(): WealthDocument {
  return doc
}

/** Replace entire document (e.g. load file). */
export function replaceWealthDocument(next: WealthDocument, opts?: { markDirty?: boolean }): void {
  doc = next
  if (opts?.markDirty === true) dirty = true
  else dirty = false
  emit()
}

export function updateWealthDocument(fn: (d: WealthDocument) => WealthDocument, opts?: { markDirty?: boolean }): void {
  doc = fn(doc)
  if (opts?.markDirty !== false) dirty = true
  emit()
}

export function isWealthDocStoreDirty(): boolean {
  return dirty
}

export function markWealthDocStoreSaved(): void {
  dirty = false
  emit()
}

export function setWealthDocStoreDirty(value: boolean): void {
  dirty = value
  emit()
}

let fileHandle: FileSystemFileHandle | null = null

export function getWealthFileHandle(): FileSystemFileHandle | null {
  return fileHandle
}

export function setWealthFileHandle(h: FileSystemFileHandle | null): void {
  fileHandle = h
}
