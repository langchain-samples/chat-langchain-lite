/** Who last signed in with LangSmith here, shown on the sign-in screen. Never a token. */
export interface Account {
  readonly email: string;
}

const KEY = "chat-langchain-lite:last-account";

// localStorage, unlike the tokens: it only names the account, and it should outlive the tab.
export function loadLastAccount(storage: Storage): Account | null {
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? "null") as Partial<Account> | null;
    if (typeof saved?.email !== "string" || !saved.email) return null;
    return { email: saved.email };
  } catch {
    return null;
  }
}

export function saveLastAccount(storage: Storage, account: Account): void {
  storage.setItem(KEY, JSON.stringify(account));
}

export function forgetLastAccount(storage: Storage): void {
  storage.removeItem(KEY);
}
