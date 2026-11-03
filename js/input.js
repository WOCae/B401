// キーボード/タッチ入力。keys = {l, r, j, jp}
export function bindInput(keys, $) {
  addEventListener("keydown", e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const k = e.code;
    if (k === "ArrowLeft" || k === "KeyA") keys.l = 1;
    if (k === "ArrowRight" || k === "KeyD") keys.r = 1;
    if (k === "Space" || k === "ArrowUp" || k === "KeyW") { if (!keys.j) keys.jp = true; keys.j = 1; }
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) e.preventDefault();
  });
  addEventListener("keyup", e => {
    const k = e.code;
    if (k === "ArrowLeft" || k === "KeyA") keys.l = 0;
    if (k === "ArrowRight" || k === "KeyD") keys.r = 0;
    if (k === "Space" || k === "ArrowUp" || k === "KeyW") keys.j = 0;
  });
  document.addEventListener("click", e => { if (e.target.matches("button")) e.target.blur(); });
  const hold = (id, on, off) => {
    const b = $(id);
    b.addEventListener("pointerdown", e => { e.preventDefault(); on(); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(t => b.addEventListener(t, off));
  };
  hold("bl", () => keys.l = 1, () => keys.l = 0);
  hold("br", () => keys.r = 1, () => keys.r = 0);
  hold("bj", () => { keys.jp = true; keys.j = 1; }, () => keys.j = 0);
}
