/* ============================================================
 * xqengine.js — xqwlight 引擎适配层
 * 搜索放到 Web Worker（xqworker.js）避免阻塞主线程；评估很快，
 * 仍在主线程直接调用 lib/position.js。
 * 依赖：rules.js（XQ.toFEN）、lib/position.js、lib/search.js
 * ============================================================ */
(function () {
  'use strict';

  const XQ = window.XQ;

  // xqwlight 内部 16×16 坐标 → 项目内部坐标
  // RANK_Y: 3(黑方底线)~12(红方底线) → row 0~9；FILE_X: 3(左)~11(右) → col 0~8
  function sqToCoord(sq) {
    return { r: RANK_Y(sq) - 3, c: FILE_X(sq) - 3 };
  }

  /* ---------------- Worker（搜索） ---------------- */
  let worker = null;
  let reqId = 0;
  const pending = {};

  function getWorker() {
    if (!worker) {
      worker = new Worker('xqworker.js');
      worker.onmessage = function (e) {
        const d = e.data || {};
        if (d.id && pending[d.id]) {
          pending[d.id](d);
          delete pending[d.id];
        }
      };
    }
    return worker;
  }

  // 搜索最佳走法（side 走棋）。返回 Promise<{fr,fc,tr,tc}|null>
  function search(board, side, depth, millis) {
    return new Promise((resolve) => {
      const id = ++reqId;
      pending[id] = (d) => {
        if (!d.mv) { resolve(null); return; }
        const src = sqToCoord(SRC(d.mv));
        const dst = sqToCoord(DST(d.mv));
        resolve({ fr: src.r, fc: src.c, tr: dst.r, tc: dst.c });
      };
      getWorker().postMessage({ id, cmd: 'search', fen: XQ.toFEN(board, side), depth, millis });
    });
  }

  // 评估局面（side 视角），返回分值（xqwlight 分值点：车≈256，兵≈20~30，MATE=10000）
  function evaluate(board, side) {
    const pos = new Position();
    pos.fromFen(XQ.toFEN(board, side));
    return pos.evaluate();
  }

  window.XQEngine = { search, evaluate };
})();
