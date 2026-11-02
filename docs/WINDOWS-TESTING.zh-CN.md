# Windows 安装与验收说明

本文适用于 `study-233/ZotMeta` 的 Windows 构建，目标环境为 Zotero 10.0.7。

## 交付包与安装

- 从本 fork 的 Releases 页面下载 `zotmeta-2.1.2.xpi`。本地构建会将安装包写入仓库的 `build` 目录。arXiv 预印本的期刊引用保存在 Extra 的 `arXiv journal ref` 行。
- 在更新前启用“帮助 → 调试日志”。完成后打开“查看输出日志”，搜索 `ZotMeta: Batch completed:` 获取批次编号。该批次中的 `Failed to update item metadata:` 记录含条目编号、原始标题和失败原因。`Preprint saved:` 记录成功保存的预印本编号。
- 安装包保留原插件 ID `zotmeta@roadtodream.tech`，安装时会替换已有 ZotMeta。原有设置键和状态标签不变。
- 自动化测试使用模拟条目。原生界面和真实服务响应的手动验收步骤见下文。

在你选择的测试 Zotero 配置中：

1. 打开 Zotero，进入“工具 → 插件”（Tools → Plugins）。
2. 点击齿轮菜单，选择“从文件安装插件…”（Install Plugin From File…），选择上述 XPI。
3. 按提示完成安装，必要时重启 Zotero。
4. 从“工具 → ZotMeta 控制面板”打开面板，也可从 Zotero 设置侧栏进入 ZotMeta。

主题跟随 Zotero 设置中的外观；语言跟随 Zotero 的界面语言。切换界面语言后，按 Zotero 提示重启。

## 自动更新与复现构建

仓库源码的 `src/manifest.json` 和 `src/install.rdf` 保留原来的上游更新地址，方便后续上游合并。普通 `make` 构建仍沿用该配置。

Zotero 10.0.7 的安装器要求 `applications.zotero.id`、`update_url` 和 `strict_max_version` 均存在。第一版 `2.1.1-local.1` 删除了必填的 `update_url`，因此无法安装；该包已被新版替代，请选择上面列出的新文件。

修正版保留上游 HTTPS 更新地址，两个清单中的地址保持一致。`python scripts/build.py` 仅为个人包加入默认标记 `extensions.zotmeta.privateBuild`；插件启动时通过 Zotero 的 AddonManager 将**本插件**的 `applyBackgroundUpdates` 设为 `AUTOUPDATE_DISABLE`，避免上游后台更新覆盖定制版，不修改其他插件或全局更新设置。普通上游构建没有这个默认标记，不主动更改更新策略。

安装并启用新版后，可以在插件详情中检查“自动更新”为“关闭”。手动安装上游 XPI 仍会替换定制版；手动确认更新也可能覆盖定制代码。以后继续使用个人构建脚本。若将来装回官方版本，需要在插件详情中自行恢复希望使用的自动更新设置。根目录的 `updates.json` 和上游发布流程未改写。

在 Windows 上将 Python 3 和 Node.js 加入 PATH，然后在仓库根目录运行以下命令。

```powershell
python scripts/build.py
```

脚本先运行全部测试，再创建 XPI，验证 ZIP 完整性、包内语言资源和更新配置，生成同名 `.xpi.sha256`。归档包含插件根目录的 `manifest.json`、`bootstrap.js`、`prefs.js` 和 `LICENSE`，没有多余外层目录。构建结果采用固定文件时间与顺序，便于复现。

## 主要改动

- `src/preferences.xhtml`：保留原布局，替换固定文字与配色；输入框关联标签，年份按钮补充本地化无障碍标签。
- `src/theme.css`：优先继承 Zotero 的 `--color-background`、`--fill-primary`、`--fill-secondary`、`--color-border`、`--color-button` 等变量；链接和热力图色阶由实际背景与前景混色产生，无操作系统主题判断。补充悬停、禁用、键盘焦点和窄窗口布局。
- `src/preferences.js`：静态界面使用显式语言列表的原生 Fluent Localization，避免繁体中文等未支持语言被协商到简体中文；动态统计文字、数字、日期、条目类型与提示本地化；添加与格子共用 CSS 类的五级图例。保留 SQL / 条目对象统计路径、年份导航和设置存储。
- `src/chrome/content/l10n.js`：动态界面使用 Zotero/Mozilla 原生字符串包，按 Zotero 界面语言选择 zh-CN 或英文；条目类型优先用 Zotero 官方翻译，附完整中英文回退标签；使用 Intl 格式化数字和日期。
- `src/chrome/content/utilities.js`、`zotmeta.js`：菜单、进度、成功、失败、跳过提示本地化，进度面板复用主题变量。论文标题、作者、期刊名、DOI 和状态标签原值不翻译。
- `src/locale/{en-US,zh-CN}/zotmeta.ftl` 与 `src/chrome/locale/{en-US,zh-CN}/zotmeta.properties`：完整中英文资源。
- `src/bootstrap.js`、`src/chrome.manifest`：加载共享语言帮助代码、主题样式并注册中文资源；个人构建只关闭本插件的后台自动更新。
- `tests/run-tests.js`、`tests/test_build.py`、`scripts/build.py`：扩展回归检查、安装清单检查与 Windows 个人构建流程。

## 已通过的自动化检查

1. 修改前原有 `node tests/run-tests.js` 全部通过；修改后全部原有测试继续通过。覆盖 PubMed / DOI / arXiv / 图书检索、标识符提取、重试、并发批次、状态标签、创建父条目及原有设置。
2. 新增语言回归覆盖 en-US、en-GB、zh-CN、zh-Hans，以及 fr-FR、zh-TW、zh-HK 的英文回退。检查菜单字符串、成功/失败/跳过提示、数字日期、官方条目类型名称与书目字符串原样保留。
3. SQL 与条目对象统计路径一致；附件、失败、跳过计数、2024 闰日、年度合计、年份前后切换及图例等级检查通过。
4. Fluent 两种语言键集合一致，XHTML 引用的键均存在；动态字符串包的键集合一致。
5. 全部插件 JavaScript 通过 `node --check`；XHTML / XUL / RDF 可解析，JSON 清单有效；`git diff --check` 通过。
6. XPI CRC、包内 en-US / zh-CN 两类资源、根清单位置、必填 HTTPS 更新地址、目标版本范围及个人包更新策略检查通过。新增 6 个 Python 构建回归测试，包括第一版缺失字段的反例；Node 测试检查只关闭本插件后台更新、普通构建不更改策略。
7. 从本机 Zotero 10.0.7 的 `omni.ja` 提取安装器实际必填字段检查代码，在 Node 中分别检查两个包的清单副本：旧包产生 `applications.zotero.update_url not provided`，新包没有该段清单检查错误。结果保存于 `build/install-manifest-check.json`。这是清单代码验证，未启动 Zotero、未执行实际安装，不代表完整安装或界面验收通过。

这些是代码、模拟环境与归档检查，不代表 Zotero 原生界面验收通过。曾尝试只在 `build/` 下的独立配置/数据目录启动 Zotero 10.0.7，远程测试接口没有完成会话；没有取得可用于验收的截图。用户要求自行验证后已停止隔离测试，不交付模拟截图。

## 待手动验收

以下四种组合均待你确认，尚未标为通过：

| Zotero 界面语言 | Zotero 外观 | 状态 |
| --- | --- | --- |
| 简体中文 | 浅色 | 待验证 |
| 简体中文 | 深色 | 待验证 |
| English | Light | 待验证 |
| English | Dark | 待验证 |

每组建议检查：

1. 右键菜单包含“更新元数据 / 创建父条目”，工具菜单可打开控制面板；英文环境显示对应英文。
2. 面板文字、统计卡片、输入框、下拉框、按钮和链接清晰，中文标签完整。用 Tab 移动焦点，检查轮廓；检查悬停与年份按钮禁用状态。
3. **Windows 保持浅色，仅在 Zotero 中选择深色**，面板、控件、进度面板和热力图应跟随 Zotero。
4. 热力图的零值与最低非零值可分辨，图例色阶与格子一致；悬停显示正确语言的日期与数量。切换上一年再返回，检查年度合计和下一年按钮状态。
5. 用测试文献检查统计数与条目类型分布；切换语言后应保持相同计数、设置和值，日期/数字格式随界面语言变化。
6. 只在测试库中运行单条及批量元数据更新、创建父条目，检查进度/成功/失败/跳过提示和并发设置；确认标题、作者、期刊名、DOI 没有因语言切换被翻译。

原生菜单外观、操作系统组合、下拉选项弹出层、实际焦点与悬停效果、中文是否截断、真实网络请求，以及切换语言重启后的运行表现，均需你在 Zotero 中完成验证。

## API 参考

- [Zotero 插件开发：本地化和设置面板](https://www.zotero.org/support/dev/zotero_7_for_developers#localization)
- 本地兼容性检查参考已安装 Zotero 10.0.7 的 `app/omni.ja` 中设置面板管理器、主题 CSS、官方条目类型翻译。
