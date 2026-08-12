# 云端限制与上线验收

## 扣子云端版已关闭的本机能力

以下能力依赖本机文件系统或系统二进制，在扣子云端部署后可能降级或不可用：

```text
本地 NAS 路径扫描
局域网同步
桌面端 Electron 能力
本机 .codex 技能运行
PPT 导入时的 LibreOffice
PDF 转图片时的 pdftoppm / Poppler
直接访问用户电脑本地路径
```

部署助手不要把这些能力作为基础服务健康检查。云端版登录页只保留邮箱登录/注册。

## 上线验收顺序

1. 首页 `/` 可打开。
2. 用户注册/登录可用，Cookie 在 HTTPS 下正常写入。
3. 项目 CRUD 可用。
4. 参考图上传可用。
5. 图像生成接口 `/api/generate` 可返回图片并写入 `image_records`。
6. 对话接口 `/api/chat` 可 SSE 流式返回。
7. 图库、Lightbox、历史记录可读图。
8. 删除、回收站、恢复、永久删除可用。
9. 如果配置了对象存储短期签名 URL，请验证刷新图片 URL 功能。

## 常见失败点

- 没有上传 `.coze`：扣子不知道构建/启动命令。
- 把 `coze-deploy-kit/` 当成应用根目录：会找不到 `package.json`。
- 没有配置 Supabase 环境变量：登录、项目、历史记录接口会失败。
- 没有配置对象存储：上传、生图结果保存、分享失败。
- 使用 npm 安装：项目 `preinstall` 会要求 pnpm。
- 没有设置 `COZE_PROJECT_ENV=PROD`：服务可能按 dev 模式启动。
- 没有设置强随机 `JWT_SECRET`：生产登录安全性不足。
- grsai/OpenAI 兼容接口 key 不可用：对话和生图失败。
