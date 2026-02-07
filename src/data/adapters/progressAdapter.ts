import { authAdapter } from "./authAdapter";

export const progressAdapter = {
  getWordProgress(): Record<number, number> {
    const session = authAdapter.getSession();
    if (!session) return {};
    const users = authAdapter.getUsers();
    return users[session.username]?.wordProgress || {};
  },
  updateWordProgress(wordId: number, value: number) {
    const session = authAdapter.getSession();
    if (!session) return;
    const users = authAdapter.getUsers();
    const user = users[session.username];
    if (!user) return;
    user.wordProgress = user.wordProgress || {};
    user.wordProgress[wordId] = value;
    authAdapter.saveUsers(users);
  },
};
