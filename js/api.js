// PHP API のクライアント。ツール名は api/lib/tools.php の registry() と同じ
// (将来MCPツールに包むときも同じ名前・引数)。
const BASE = "api/index.php";

export class ApiError extends Error {
  constructor(message, code, status, details) { super(message); this.code = code; this.status = status; this.details = details; }
}

async function call(tool, args = {}, post = false) {
  let res;
  try {
    res = post
      ? await fetch(`${BASE}?tool=${tool}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) })
      : await fetch(`${BASE}?tool=${tool}&` + new URLSearchParams(args));
  } catch { throw new ApiError("サーバーに接続できません", "network", 0); }
  let j;
  try { j = await res.json(); } catch { throw new ApiError("サーバーの応答を読み取れません(PHPが動いていますか?)", "bad_response", res.status); }
  if (!j.ok) throw new ApiError(j.error?.message || "エラー", j.error?.code, res.status, j.error?.details);
  return j.result;
}

export const api = {
  getSchema: () => call("get_schema"),
  listGames: () => call("list_games"),
  getGame: game_id => call("get_game", { game_id }),
  listHistory: (game_id, limit = 50) => call("list_history", { game_id, limit }),
  validateGame: args => call("validate_game", args, true),
  createGame: (game_id, game) => call("create_game", { game_id, game }, true),
  saveGame: (game_id, game, base_version, label) => call("save_game", { game_id, game, base_version, label }, true),
  proposePatch: (game_id, ops, title, source = "rule") => call("propose_patch", { game_id, ops, title, source }, true),
  applyPatch: (game_id, proposal_id) => call("apply_patch", { game_id, proposal_id }, true),
  discardPatch: (game_id, proposal_id) => call("discard_patch", { game_id, proposal_id }, true),
  undoGame: (game_id, base_version) => call("undo_game", { game_id, base_version }, true),
};
