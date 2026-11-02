---
name: zotmeta-release
description: 为 study-233/ZotMeta 准备定制 XPI、执行发布前验收、按版本标签发布或核对现有 GitHub Release 的附件与 SHA-256。
---

# ZotMeta 定制包发布

从仓库根目录执行。仅准备或本地验证时，完成候选包检查即止。核对已有发布时直接查对应 tag 的 Release。只有用户要求正式发布时才推送版本 tag。

## 准备候选包

1. 用 `git remote -v`、`git status --short --branch` 确认目标为 `study-233/ZotMeta`，核对待发布的改动。以 [构建脚本](../../../scripts/build.py) 和 [Release 工作流](../../../.github/workflows/release.yml) 为准。
2. 取 `src/manifest.json` 的数字版本，与 `src/install.rdf` 对齐。准备非空的 `docs/releases/v<version>.md`，写明实际变化、安装及升级影响。保持插件 ID、两份清单的上游 HTTPS 更新地址及定制包按插件关闭后台更新的策略。
3. 运行 `python -B scripts/build.py`。它先跑 Node 和 Python 回归，再生成、检查 XPI 并写出 SHA-256 文件。按 [独立 Zotero 验收步骤](../../../AGENTS.md#在独立-zotero-中验收) 安装这份候选包，分别记录自动化结果与真实验收覆盖。仅要求本地构建时，报告包路径、摘要和未执行项。

## 正式发布

- 发布提交应已进入 fork 的 `master`。[Build](../../../.github/workflows/build.yml) 在面向 `master` 的 PR 和该分支的推送上运行，fork 用 Python，其他仓库用 `make`。核对发布提交的 Build 结果；CI 上传的 `ZotMeta` artifact 只含 XPI。
- 在 PowerShell 中读取目标版本与提交。确认远端 tag 和 Release 状态。已有 tag 时先核对其提交并查看原 run；同名 tag 指向其他提交时停止，不移动 tag 或覆盖附件。

```powershell
$repo = 'study-233/ZotMeta'
$version = (Get-Content -Raw src/manifest.json | ConvertFrom-Json).version
$tag = "v$version"
$sha = git rev-parse HEAD
git ls-remote --tags origin "refs/tags/$tag" "refs/tags/$tag^{}"
```

- 正式发布且 tag 尚不存在时，运行 `git tag $tag $sha` 和 `git push origin "refs/tags/$tag"`。Release 的 tag 过滤为 `v[0-9]*.[0-9]*`；`fork-release` 还要求 tag 精确等于清单版本前加 `v`、说明文件非空。它从该 tag 重新构建，在 `build/` 运行 `sha256sum -c`，再发布两个附件及版本说明。
- 上游分支逻辑在其他仓库运行 `make clean && make`，发布 XPI 后为生成的 `updates.json` 向 `master` 开 PR。上游合并该 PR 才向用户提供更新，其哈希取自 Actions 发布的 XPI。fork 发布无需改动或提交 `updates.json`。

## 核对公开附件

1. 按待验版本设置 `$tag`（如 `'v2.1.2'`）、`$version = $tag.Substring(1)` 和 `$repo = 'study-233/ZotMeta'`。用上面的 `git ls-remote` 查得该 tag 的提交并赋给 `$sha`（附注标签取 `^{}` 行）。用 `gh run list -R $repo -w release.yml -e push --commit $sha` 找到该 tag 对应的 run，在 `gh run view <run-id> -R $repo` 确认 `fork-release` 成功。
2. 用 `gh release view $tag -R $repo --json tagName,isDraft,body,assets,url` 核对公开状态、版本说明和两个非空附件的准确文件名。GitHub 自动提供的源码 ZIP/tarball 不计入附件。
3. 从该 Release 用准确名称下载到新目录，在 PowerShell 中校验下载字节及校验文件记录的文件名。

```powershell
$xpi = "zotmeta-$version.xpi"
$dest = Join-Path $PWD ("build/verify-" + [guid]::NewGuid())
gh release download $tag -R $repo -p $xpi -p "$xpi.sha256" -D $dest
if ($LASTEXITCODE -ne 0) { throw "Release 附件下载失败" }
$hash = (Get-FileHash -LiteralPath "$dest/$xpi" -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
$record = (Get-Content -Raw -LiteralPath "$dest/$xpi.sha256" -ErrorAction Stop).TrimEnd()
if ($record -cne "$hash  $xpi") { throw "SHA-256 或文件名不匹配" }
```

交付时给出 tag、Release 和对应 Actions run 的链接、附件校验结果。附件缺失或摘要不符时记录具体文件和 run，先查原发布步骤，保留现有 tag 和附件。
