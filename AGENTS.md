# ZotMeta 开发约定

本仓库维护 `study-233/ZotMeta`。从仓库根目录运行命令，先用 `git status --short --branch` 核对工作区。按改动复现问题、做最小修复，用现有测试验证。功能与界面入口见 [README](README.md)。

## 日常验证

| 要检查的内容 | 命令 |
| --- | --- |
| 条目处理、批次、设置与本地化 | `node tests/run-tests.js`（或 `make test`） |
| 安装清单、兼容范围与版本格式 | `python -B -m unittest discover -s tests -p test_build.py` |
| 完整验证并构建定制包 | `python -B scripts/build.py`（已包含以上两组测试） |
| 提交前检查差异 | `git diff --check` |

**定制包。** Python 脚本从 `src/manifest.json` 取版本，在 `build/` 生成 `zotmeta-<version>.xpi` 和同名 `.xpi.sha256`，校验包结构、语言资源和更新配置。仅打包时向根 `prefs.js` 加入 `extensions.zotmeta.privateBuild`。启动时插件通过 AddonManager 将自身的 `applyBackgroundUpdates` 设为 `AUTOUPDATE_DISABLE`。

**上游包。** 在独立干净的检出目录运行 `make`，它从 `src/install.rdf` 取版本，运行 Node 测试，打包 `src/` 并生成根目录的 `updates.json`。两条路径使用相同的 XPI 文件名，上游包没有定制标记。定制构建保留仓库中的上游更新元数据。

两种包共用插件 ID `zotmeta@roadtodream.tech`，安装其一会替换另一种。Zotero 10.0.7 要求 `applications.zotero` 包含 `id`、`update_url`、`strict_max_version`。两份清单保留相同地址 `https://raw.githubusercontent.com/RoadToDream/ZotMeta/master/updates.json`。手动更新仍可能覆盖定制包，装回上游版后可在插件详情恢复自动更新。

## 在独立 Zotero 中验收

Windows 验收目标为 Zotero 10.0.7。先正常退出日常 Zotero，再用 PowerShell 创建一次性的配置和数据目录。路径按本机安装位置调整。

```powershell
$zotero = "C:\Program Files\Zotero\zotero.exe"
$runDir = Join-Path $PWD ("build\qa-" + [guid]::NewGuid())
$testProfile = Join-Path $runDir "profile"
$testData = Join-Path $runDir "data"
New-Item -ItemType Directory -Path $testProfile,$testData | Out-Null
& $zotero -no-remote -profile $testProfile -datadir $testData
```

1. 在 Zotero 设置中核对实际数据目录与 `$testData` 一致。保持同步账号未登录，仅导入测试条目和 PDF 副本。在“工具 → 插件 → 从文件安装插件”选择本次 XPI，核对版本及本插件自动更新为“关闭”。需要重启时复用上面的启动行与同一组目录。
2. 按 [Windows 验收清单](docs/WINDOWS-TESTING.zh-CN.md) 检查中英文各自的浅色和深色界面，包括右键菜单、控制面板、统计与设置保存。在测试库操作单条及批量更新、从 PDF 创建父条目，核对进度、条目实际变化和调试日志中的批次编号。
3. 记录包版本、Zotero 版本、语言、主题及各项结果，问题附日志片段或截图。退出测试实例。仅做过自动化验证时，原生界面和真实服务均记为待验收。

准备版本、核对发布附件或正式发布时，按 [zotmeta-release](.agents/skills/zotmeta-release/SKILL.md) 操作。日常开发到本地验证为止。
