// Argon-owned stand-in for opencode packages/util/src/bom.ts: only the pure helpers patch.ts uses
// (upstream's file also has Effect-based file IO). Not in vendor.json, so `vendor sync` leaves it alone.
const value = String.fromCharCode(0xfeff)

export function split(text: string) {
  const stripped = text.replace(/^﻿+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  return bom ? value + stripped : stripped
}

export * as Bom from "./bom.ts"
