import { useSyncExternalStore } from "react";
import type { Holding } from "./model";

// 保有データは「値動きの通訳」と「ポートフォリオ」の両方から使う。
// 親に持ち上げて渡し回すと配線が増えるので、小さな共有ストアにしている。
// 保存先はブラウザのlocalStorageだけで、外には出さない。

const KEY = "yokogushi-holdings-v1";

function load(): Holding[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Holding[]) : [];
  } catch {
    return [];
  }
}

let holdings: Holding[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function setHoldings(next: Holding[]) {
  holdings = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 保存できなくても画面は動く */
  }
  emit();
}

/** 初回だけ localStorage から読み込む。SSRは無いのでマウント後に一度呼べばよい */
export function hydrateHoldings() {
  if (hydrated) return;
  hydrated = true;
  holdings = load();
  emit();
}

export function useHoldings(): Holding[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => holdings,
    () => holdings
  );
}
