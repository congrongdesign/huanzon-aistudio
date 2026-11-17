# 安装版入库（Windows / macOS）

适用于环中AIStudio v0.2.4+ 本机模式。不需要源代码、pnpm 或修改程序文件。Python 3 仅用于生成共享包；优先使用 Codex 可用的 Python 运行时。路径含中文或空格时正确引用，JSON 始终使用 UTF-8。

1. 每批独立保存 collection.json 和已核对的静态图片（建议最长边≤1400）。字段见 collection.md。保留完整原图、出处和原始提示词证据。
2. 读取当前库、回收站及过去采集报告，按稳定 key、原文和图片去重；已删条目跳过。首次执行且没有历史时先检查可访问记录，不能宣称检查了无法读取的历史。
3. 执行 `python <技能绝对路径>/scripts/build_hzlib.py <collection绝对路径> --output <新文件绝对路径>.hzlib`。只生成文件，不写软件。图片格式/大小检查不代替视觉检查。
4. 在实际软件“提示词”或“字体”页面点“导入”，选择该 .hzlib；先看预览、数量、重复/冲突，再选现有分类或新分类并追加。不要点“导入图片”或“智能整理”，这些可能触发付费模型。导入 .hzlib 本身不调用模型。
5. 导入后搜索标题，打开代表卡片，检查原提示词/完整备注/图片；与导入前 ID 对照确认已有卡片保留。记录实际新增、跳过、冲突及失败项。再次导入相同包应跳过重复，不能换 key 强行恢复用户删除。

可用浏览器工具时也可自动操作实际窗口。没有窗口访问能力时保留共享包和成果，明确桌面尚未验收，不能以文件生成成功代替入库完成。

## 自动化 API（可选）

从实际 desktop.log 或当前窗口 URL 确定 `http://127.0.0.1:<端口>`。只连接本机，拒绝重定向，不发送凭据到外部地址；远程/多用户模式需要当前用户的正常认证，不能改账号或绕过认证。

`POST /api/library-transfer` 使用 multipart 表单：`kind=prompts` 或 `fonts`、`action=preview`、`file=<共享包>`。JSON 返回 total/images/duplicates/conflicts/items/groups。先读取并核对该结果；冲突时停止核对，保留现有卡片。

追加使用同一包、`action=import`，附带 `destination` JSON：`{"mode":"preserve"}` 按包中分类导入，或 `{"mode":"new","name":"本批精选"}`，或 `{"mode":"existing","id":"已确认的分组ID"}`。返回 added/skipped/conflicts。导入失败先回读库，不能盲重试。不要调用其他图片上传/AI整理接口。

`GET /api/library-transfer?kind=prompts|fonts` 可只读查看现有分类、ID和标题。完整卡片通过 `/api/prompts` 或 `/api/font-library` 回读；遵循接口分页，不只查看第一页就声称无重复。回收站查当前 UI；未知协议先检查，不直接写索引。

本技能不会携带发布者的项目、图库、API Key 或浏览器登录信息。实际库共享请在软件内选择所需条目“导出”成 .hzlib，另行授权分享。
