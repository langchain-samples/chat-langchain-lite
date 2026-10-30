import { describe, expect, it } from "vite-plus/test";

import { forgetLastAccount, loadLastAccount, saveLastAccount } from "./lastAccount";

const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  } as Storage;
};

describe("lastAccount", () => {
  it("remembers the email until it's forgotten", () => {
    const storage = memoryStorage();
    expect(loadLastAccount(storage)).toBeNull();
    saveLastAccount(storage, { email: "dev@example.com" });
    expect(loadLastAccount(storage)).toEqual({ email: "dev@example.com" });
    forgetLastAccount(storage);
    expect(loadLastAccount(storage)).toBeNull();
  });

  it("ignores anything it didn't write", () => {
    const storage = memoryStorage();
    storage.setItem("chat-langchain-lite:last-account", "not json");
    expect(loadLastAccount(storage)).toBeNull();
    storage.setItem("chat-langchain-lite:last-account", JSON.stringify({ email: 3 }));
    expect(loadLastAccount(storage)).toBeNull();
  });
});
