/* ============================================================
 * engine.js — Web Worker：加载 Pikafish WASM，封装 UCI 为 Promise API
 * 引擎源码已改造为单线程 + js_getline 桥接（见 js_bridge.cpp），
 * 主线程通过 Module.uci(cmd) 注入命令，引擎用 ASYNCIFY 阻塞等待。
 * 协议（主线程 ↔ 本 Worker）：
 *   主线程 → { id, cmd: 'search' | 'stop', fen?, movetime?, depth? }
 *   本 → 主线程 { id, result } 或 { id, error }，以及 { event:'ready' }
 * ============================================================ */
(function () {
  'use strict';

  let ready = false;
  let pendingSearch = null;
  let lastInfo = null;

  function post(obj) { self.postMessage(obj); }

  /* ---------------- 解析 info 行 ---------------- */
  function parseInfo(line) {
    if (!/^info\b/.test(line)) return null;
    const info = { depth: 0, scoreCp: 0, mate: 0, pv: '' };
    const dm = line.match(/depth (\d+)/);
    if (dm) info.depth = parseInt(dm[1], 10);
    const cm = line.match(/score cp (-?\d+)/);
    if (cm) info.scoreCp = parseInt(cm[1], 10);
    const mm = line.match(/score mate (-?\d+)/);
    if (mm) info.mate = parseInt(mm[1], 10);
    const pm = line.match(/ pv (.+)$/);
    if (pm) info.pv = pm[1].trim();
    return info;
  }

  /* ---------------- stdout 处理 ---------------- */
  function onStdout(text) {
    const lines = String(text).split('\n');
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '').trim();
      if (!line) continue;
      const info = parseInfo(line);
      if (info) { lastInfo = info; continue; }
      const bm = line.match(/^bestmove\s+(\S+)/);
      if (bm && pendingSearch) {
        const p = pendingSearch;
        pendingSearch = null;
        p.resolve({
          bestmove: bm[1],
          depth: lastInfo ? lastInfo.depth : 0,
          scoreCp: lastInfo ? lastInfo.scoreCp : 0,
          mate: lastInfo ? lastInfo.mate : 0,
          pv: lastInfo ? lastInfo.pv : ''
        });
        continue;
      }
      if (line === 'readyok' && !ready) {
        ready = true;
        post({ event: 'ready' });
      }
    }
  }

  /* ---------------- 定义 Module 并加载 ---------------- */
  self.Module = {
    print: onStdout,
    printErr: onStdout,
    locateFile: (path) => 'lib/' + path
  };

  importScripts('lib/pikafish.js');

  // 引擎 main() 在 ASYNCIFY 下异步运行，js_init_queue 稍后才暴露 Module.uci。
  let initStarted = false;
  function trySendInit() {
    if (typeof self.Module.uci === 'function') {
      if (!initStarted) {
        initStarted = true;
        self.Module.uci('uci');
        self.Module.uci('isready');
        self.Module.uci('setoption name Threads value 1');
      }
    } else {
      setTimeout(trySendInit, 30);
    }
  }
  trySendInit();

  /* ---------------- 消息处理 ---------------- */
  self.onmessage = function (e) {
    const d = e.data || {};
    const id = d.id;
    if (d.cmd === 'search') {
      pendingSearch = {
        resolve: (result) => post({ id, result }),
        reject: (msg) => post({ id, error: msg })
      };
      lastInfo = null;
      self.Module.uci('position fen ' + d.fen);
      if (d.movetime) self.Module.uci('go movetime ' + d.movetime);
      else self.Module.uci('go depth ' + (d.depth || 14));
    } else if (d.cmd === 'stop') {
      self.Module.uci('stop');
    }
  };
})();
