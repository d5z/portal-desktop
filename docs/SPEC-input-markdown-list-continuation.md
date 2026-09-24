# SPEC: 输入框 Markdown 列表续行（v2.2）

- 日期：2026-09-24（v2.2 18:30）
- 状态：DRAFT（待 Marvic 拍板）
- 类型：体验小需求（fork → PR 路线，weiguo 侧合不合他定）

## 0. v2 变更（对照 v1）

参照系从「飞书消息框子集」改为「AI prompt 输入的结构化子集」。飞书是给人看的（富文本、颜色），prompt 是给 AI 看的——只需要列表层级和缩进这种**部分结构化**，不需要富文本编辑。行为规格对齐 CodeMirror 官方 `insertNewlineContinueMarkup`（下述行业标准），新增：多级列表缩进继承、Tab/Shift+Tab 缩进、空行降级退出。

### v2.1 变更（答「自动的 123 和手打的 123 要有区别吗」）

新增**视觉规格**（§2 视觉规格）：输入态零渲染、无任何视觉区别。新增 IME 守卫落地细节、undo 已知限制与光标复位（§3 交互细节核验）。视觉参照 beautifului.dev 的 Chat / Prompt Bar 源码（Marvic 17:33 提供，已通读）。

### v2.2 变更（有序列表自动重排 renumber）

- **进范围**：同级有序列表（同缩进、同 `N.`/`N)` marker）在受管操作后按文档顺序重编为 1. 2. 3. …；无序列表 `-`/`*`/`+` 不受影响。
- **触发边界（仅受管事件后）**：Shift+Enter 续行/行首前插新项、空项 Shift+Enter 退出、行首 Tab / Shift+Tab 改缩进。用户纯打字改序号、粘贴、普通 Enter 发送 → **不重排**。
- **范围隔离**：代码围栏内（`isInCodeFence`）不参与；父级与子级（不同缩进）各自独立块；空项退出删除中间行时不留多余空行，避免块被断开。
- **光标**：重排后 selection 仍落在新项/当前项 marker 之后，不跳行。
- **实现**：纯函数 `renumberOrderedLists`（`list-continuation.ts`），`page.tsx` 无新增分支（仍只调现有 apply*）。

## 1. 参照真源（git 查证）

- **行业标准实现**：CodeMirror `@codemirror/lang-markdown` 的 `insertNewlineContinueMarkup`（276 行，已通读源码）。Zettlr、Joplin（fork）、MarkEdit、GROWI、OtterWiki 等 markdown 编辑器 Enter 键全用它，CommonMark 兼容。
- **AI prompt 输入场景直接用它**：coze-dev/coze-loop 的 `prompt-components`、johannesjo/parallel-code 的 `live-markdown`（AI 编码工具输入区）。
- **Codex CLI 没有此功能**（已翻源码：`textarea.rs` 4659 行 + `chat_composer.rs` 12995 行，Enter=submit、Shift+Enter=纯换行，无任何列表续行逻辑）。Cursor 闭源无法查证实现。
- 本项目渲染端已支持 markdown（marked），本需求只做输入侧辅助。

## 2. 需求（prompt 结构化子集）

### 行为规格（对齐 CodeMirror 实现）

| # | 规则 | 行为 |
|---|------|------|
| R1 | 续行 | Shift+Enter 时，当前行是列表项 → 新行插入同缩进+同类型标记：有序 `N.`/`N)` → `N+1`；无序 `-`/`*`/`+` → 同符号 |
| R2 | 多级继承 | 嵌套列表（缩进）续行时，新行继承**当前层级**的完整前缀（缩进空格数 + 标记），不塌缩到父级 |
| R3 | 空行降级退出 | 光标在**只有标记没有内容**的项上 Shift+Enter → 删一层标记：多级时降一级（保留父级缩进+续父级列表），单级时清空退出列表 |
| R4 | Tab 缩进 | 光标在行首或列表标记前按 Tab → 插入 2 空格（升一级，与渲染端嵌套对齐，已拍板）；Shift+Tab → 删 2 空格（降一级） |
| R5 | 无干扰 | 纯 Enter=发送、IME 组词中、代码块内（行以 ``` 围栏内）→ 全部零行为变化 |
| R6 | 有序重排 | 受管操作（R1/R3/R4）完成后，对光标所在同级有序块重编 1…n；见 v2.2 触发边界 |

### 明确不做（观察后再说）

- todo checkbox 续行（`- [ ]` → `- [ ]`，CodeMirror 支持但低频）
- 引用块 `>` 续行
- 非受管场景重编号（手改序号、粘贴、删除键删行）——保持轻量，不接管全文
- 实时富文本预览、粘贴转换、输入条形态改造

### 视觉规格（v2.1 新增）

**自动插入的 `2.` 和手打的 `1.` 不做任何视觉区别——同字体、同颜色、同为普通字符。**

依据：
1. 参考组件输入框均为**纯文本零渲染**（beautifului Chat 是 `<input>`、Prompt Bar 是 `<textarea>`，全文无任何 markdown 实时渲染——输入态就是纯字符串）；
2. textarea 技术上**无法子串着色**：要区别就得换 contenteditable（飞书路线）或做 ghost overlay（编辑器路线），与「形态先不管」冲突；
3. 产品定位：prompt 是给 AI 看的部分结构化，输入态不需要人眼审阅的富样式；
4. 行业同路线（VS Code 等纯文本 markdown 编辑器）同样零区别——续行的价值全在行为（R3 空项退出），不在颜色。

唯一的「视觉事件」是行为反馈：空项 Shift+Enter 标记消失（R3），不需要颜色参与。发送后：渲染端（marked）正常渲染列表，与手打消息完全一致——输入方式不进消息元数据，两边天然同源。

### 交互细节核验（v2.1，逐条对照现有代码验证过）

- **IME 五重守卫已存在**（page.tsx onKeyDown：`composing.current` / `isComposing` / `keyCode === 229` / `compositionEnd + 50ms` 抖动窗）。续行逻辑挂进 Shift+Enter 分支时**必须复用同一组守卫**——组词中按 Shift+Enter（多数 IME 会确认候选词）绝不插入标记。
- **自动增高已存在**（page.tsx useLayoutEffect：桌面 6 行 / 移动 4 行封顶后内部滚动）。多级缩进不会撑破输入框。参照组件 Prompt Bar 是 28px→100px 后滚动，我们等价且更宽。
- **光标复位**：插入前缀后光标落在标记后，须在受控组件更新同一帧内 `setSelectionRange`（useLayoutEffect），避免闪烁。
- **已知限制（v1 接受）**：受控 textarea 直接改 value 会破坏浏览器原生 undo——续行插入无法一步 Cmd+Z 还原。如反馈强烈，v2 改用 `document.execCommand('insertText')`（deprecated 但保 undo 栈）。

## 3. 实现路线

- 裸 `<textarea>` + 正则前缀解析（不引入 CodeMirror——那是编辑器级改造，与「形态先不管」冲突）。
- 纯函数 `parseListPrefix(line): {indent, type, number, marker} | null` + `buildContinuation(prefix): string`，抄 CodeMirror 的 `getContext`/`marker()` 行为但降级为行级正则。
- 改动文件：仅 `desktop/renderer/chat/page.tsx`（keydown 分支）+ 一个新纯函数文件。
- 渲染端、bridge、main 进程：零改动。

## 4. 验收用例

1. `1. 甲` Shift+Enter → `2. `，连打到 `5.` 每次都续（报障场景）
2. `- 甲` Shift+Enter → `- `；`* 甲` → `* `；`1) 甲` → `2) `
3. 多级：`1. 甲` 下一行 Tab 两下成子级 `- 乙`，Shift+Enter → 新行继承子级缩进 + `- `
4. 只剩 `3. `（无内容）Shift+Enter → 单级退出；多级时只降一级，父级 `2. ` 续上
5. 行首 Tab → `  `（2 空格）；Shift+Tab → 删 2 空格；行中 Tab 不劫持（保持原默认行为）
6. IME 组词中 / ``` 代码块内 → 零行为变化
7. 纯 Enter 发送、发送后渲染与今日完全一致
8. **renumber（v2.2）**：首行前插 / 项内回车 / 空项退出 / Tab 往返后，同级有序序号连续无重复；多级、无序、围栏内见 `tests/list-continuation.test.mjs`

## 5. 开放问题（待拍板）

- Q1: R3 降级退出的「两级连续空行自动发送」不做（保持可预期），确认？
