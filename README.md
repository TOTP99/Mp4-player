# 电影院

纯前端远程/YouTube 播放器，无构建工具。普通 `<script>` 顺序加载，可用 `file://` 或任意静态托管。

## 加载顺序（不可打乱）

```
state.js → db.js → utils.js → audio-enhance.js → thumbnail.js → player.js → cards.js → events.js → main.js
```

靠顶层变量共享全局作用域（非 ES module）。`style.css` 单独引入。

| 文件 | 作用 |
|---|---|
| `state.js` | 常量、DOM 引用、全局状态、时钟、`updatePosInfo()` |
| `db.js` | IndexedDB：`thumbs` / `state` |
| `utils.js` | 时间格式化、YouTube 解析、全屏 |
| `thumbnail.js` | 缩略图存取与截图 |
| `player.js` | 播放控制、按文件进度存档 |
| `cards.js` | 列表卡片（点击前先存进度） |
| `events.js` | 按钮、进度条、键盘、滑动换片、定时/切页存档 |
| `main.js` | 启动、扫描合并列表、恢复进度；刷新不打断播放 |
| `index.html` / `style.css` | 结构与黑金 UI |

## 核心行为

**双模式** `mode`：`'local' | 'youtube' | null`  
local 实际播的是 `BASE_URL` 下的远程 mp4；YouTube 用 iframe。互斥切换。

**列表**  
只增不减扫描 `1.mp4 ~ MAX.mp4`（默认 56）。启动先读缓存秒开，再后台 6 路并发 HEAD 探测。手动刷新（🔄 / `R`）合并新片，**不打断当前播放**。

**进度自动保存**（IndexedDB `state.playback`）  
- `file` / `time`：上次播到哪一集（启动恢复）  
- `byFile`：每个文件各自的进度  
- 触发：暂停、播完、换集、拖进度结束、每 4 秒、页面隐藏/关闭  
- 点卡片切片前也会先存；接近结尾记 0，下次从头播  

**UI**  
- 标题栏：左侧文件名，右侧金色胶囊 `当前序号 / 总数`  
- 控制条：`⏮▶⏭` · 横屏进度 · `⛶🔄📁`；**YouTube 链接单独一行**  
- 画面左右滑动可换集（仅 local）  
- 竖屏/横屏两套进度条，拖拽 pointer + touch  

**缩略图**  
播过约 0.8 秒自动截；双击画面可覆盖。需 `player.crossOrigin = 'anonymous'` 且远端带 CORS。

## 快捷键

| 键 | 功能 |
|---|---|
| 空格 / K | 播放暂停 |
| ← / → | 上一集 / 下一集 |
| F | 全屏 |
| R | 刷新列表 |

输入框聚焦时不响应。

## 常见修改

| 需求 | 改哪里 |
|---|---|
| 视频目录 / 数量上限 | `state.js` 的 `BASE_URL`、`MAX`（文件名须为 `数字.mp4`） |
| 配色 | `style.css` 顶部 `:root` 变量 |
| 缩略图清晰度 | `THUMB_MAX_W`、`THUMB_QUALITY` |
| 探测并发/超时 | `main.js` 的 `CONCURRENCY`、`exists()` 超时 |
| 新快捷键 | `events.js` 的 `keydown` |
| 升 IDB 结构 | `DB_VER` 递增 + `db.js` `onupgradeneeded` |

## 注意

- 扫描失败不删已有项（防网络抖动误删）。  
- `events.js` 可引用 `main.js` 的 `scanVideos`/`scanning`，因回调在用户点击时才执行，届时 main 已加载完。  
- 调试：控制台可看 `videoList` / `currentIndex` / `mode` / `scanVideos()`；DevTools → Application → IndexedDB → `cinema_db`。

## 本轮（2026-09-27）商业化检查与增强

**修的真 bug**
- 切回本地视频时清空 YouTube iframe 的 `src`：之前 YouTube 会在后台继续播声音。
- 视频加载失败（404/断网）：普通模式之前黑屏无提示，现在显示错误遮罩 + 重试按钮；顺序/随机模式仍自动跳集。
- 切到 YouTube 时横竖屏进度条停在旧值：现在清零。

**去 emoji**：品牌栏 `TP制作🐈📽️` 换 SVG 放映机图标 + 文字；`alert` 换输入框内提示；`✓` 换纯文字。

**功能增强**
- 新增「设为代表图」相机按钮（控制条右侧）：iOS 上双击手势不可靠，双击画面仍保留。
- 列表标题跟 `MAX` 走（之前硬编码 56）。
- 键盘快捷键忽略范围扩大到输入框/文本区/下拉/可编辑区。
- iOS 上 `<video>` 自带全屏也能同步全屏按钮文案。
- 画面加 `touch-action: pan-y`：横滑换片与竖滑页面不再打手势架。

**验证**：9 个 JS 语法通过；36 个 DOM id 交叉无缺失；CSS 括号平衡；14 项行为冒烟测试通过。未做真实 iPhone 实机 QA。
