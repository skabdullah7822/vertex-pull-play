import type { Snapshot } from "./history";

/**
 * Local project persistence. The whole scene is stored as a history
 * Snapshot (JSON serialisable) inside localStorage.
 */

export const PROJECT_KEY = "rendercraft.project.v1";

export interface SavedProject {
  version: 1;
  savedAt: number;
  bg: string;
  snapshot: Snapshot;
}

export function saveProject(snapshot: Snapshot, bg: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const payload: SavedProject = { version: 1, savedAt: Date.now(), bg, snapshot };
    window.localStorage.setItem(PROJECT_KEY, JSON.stringify(payload));
    return payload.savedAt;
  } catch {
    return null;
  }
}

export function loadProject(): SavedProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedProject;
    if (!data || data.version !== 1 || !data.snapshot || !Array.isArray(data.snapshot.items))
      return null;
    return data;
  } catch {
    return null;
  }
}

export function clearProject() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PROJECT_KEY);
  } catch {
    /* ignore */
  }
}
