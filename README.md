# 中国象棋 · Xiangqi

纯前端中国象棋网页：本地双人、人机对战（皮卡鱼 Pikafish 引擎 + 每步战略讲解）、复盘，支持悔棋、localStorage 自动续局。

## 运行

需要本地 HTTP 服务器（WASM 无法通过 `file://` 加载，且需要 COOP/COEP 响应头）：

```bash
node serve.js
```

然后浏览器打开 http://localhost:8000

## 功能

- **本地双人对战**：两人共用一屏，棋子文字各自朝向己方（红正立、黑旋转 180°），支持「翻转」按钮切换视角。
- **人机对战**：皮卡鱼（Pikafish）WASM 引擎，困难强度。电脑每走一步都在气泡里显示**战略讲解**——客观属性分类（吃子/将军/应将/防守/保子/兑子/抢占要点/入局杀）+ 引擎评估分变化。可开启**朗读**自动语音讲解。
- **复盘**：逐步回放当前对局，显示每步记谱与讲解；支持复制/导入对局坐标串。
- **悔棋**：人机回退两步、双人回退一步，讲解随历史同步退回。
- **持久化**：每一步（含悔棋/重开/切模式）写入 `localStorage`，刷新后自动恢复，防意外关闭丢失对局。
- 落子/吃子/将军/胜负音效（Web Audio 合成）、胜利彩带、移动端适配。

## 目录结构

| 文件 | 说明 |
|---|---|
| `index.html` / `style.css` | 页面与样式 |
| `rules.js` | 象棋规则引擎（走法生成、将军/将死/困毙、记谱法、FEN） |
| `ai.js` | 走棋解释生成器（分类模板 + 评估分叠加） |
| `game.js` | 游戏流程、渲染、交互、音效、彩带、朗读、持久化、复盘 |
| `engine.js` | Web Worker，加载皮卡鱼 WASM 并封装 UCI 为 Promise API |
| `lib/pikafish.js` + `.wasm` | 皮卡鱼引擎（NNUE 已内嵌进 .wasm） |
| `serve.js` | 本地静态服务器（带 COOP/COEP 头） |

## 引擎构建（可复现）

皮卡鱼源码做了三处改造，让它在浏览器里**单线程**运行（避免 Emscripten 多线程搜索死锁）：

1. `js_bridge.cpp/h`（新增）：`Module.uci(cmd)` 桥接命令 + ASYNCIFY 阻塞式 `js_getline`。
2. `uci.cpp`：把 `std::getline(std::cin, cmd)` 换成 `js_getline(cmd)`。
3. `thread_native.h` / `thread.cpp`：`__EMSCRIPTEN__` 下不创建 pthread，`run_custom_job` 直接在当前线程执行搜索。
4. `Makefile`：wasm32 改为 `-sASYNCIFY`（单线程，去掉 `-pthread`），并跳过 LTO（避免 EM_JS 符号被优化掉）。

关键构建步骤：

```bash
# 1. 安装 Emscripten SDK 并激活
git clone https://github.com/emscripten-core/emsdk.git && cd emsdk
./emsdk install latest && ./emsdk activate latest

# 2. 克隆皮卡鱼并下载 NNUE 网络到 src/pikafish.nnue
git clone https://github.com/official-pikafish/Pikafish.git
# 下载 https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue

# 3. 编译（Windows 下需传 OS= 清掉环境变量，避免被误判为 Windows 目标）
cd Pikafish/src
make ARCH=wasm32 CXX=em++ OS= EXTRALDFLAGS="--embed-file=pikafish.nnue" build
```

产物 `pikafish.js` + `pikafish.wasm` 复制到本项目的 `lib/` 目录。
