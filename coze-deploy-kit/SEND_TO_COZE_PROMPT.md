# 发给扣子自动部署助手的提示词

我会发送一个 zip 压缩包。请你基于这个压缩包自动完成部署上线。请注意：

1. 你不能访问我的本地目录，只能使用 zip 解压后的文件。
2. 应用根目录是 zip 解压后的顶层目录，不是 `coze-deploy-kit/`。
3. `coze-deploy-kit/` 只是部署资料包，里面有部署说明、环境变量模板和排查清单。
4. 请优先读取解压根目录的 `.coze` 配置。
5. 如果 zip 上传后没有 `.coze`，请把 `coze-deploy-kit/coze-config.toml` 的内容恢复为解压根目录 `.coze`。
6. 只允许使用 pnpm，不要使用 npm 或 yarn。
7. Node 运行时使用 `nodejs-24`，Next.js 16 至少需要 Node >= 20.9。
8. 构建命令使用：`bash ./scripts/build.sh`。
9. 启动命令使用：`bash ./scripts/start.sh`。
10. 启动脚本会读取扣子平台的 `DEPLOY_RUN_PORT`，不要手动硬编码端口。
11. 环境变量请参考 `coze-deploy-kit/ENV.production.example`，通过扣子平台的环境变量/密钥配置填写，不要写入源码。必须设置 `NEXT_PUBLIC_COZE_CLOUD=1`、`LOCAL_BACKEND=0`、`HZ_BACKEND_MODE=supabase`。
12. 生产环境必须设置 `COZE_PROJECT_ENV=PROD` 和强随机 `JWT_SECRET`。
13. 数据库使用 Supabase/PostgreSQL，必须配置 `COZE_SUPABASE_URL`、`COZE_SUPABASE_ANON_KEY`、`COZE_SUPABASE_SERVICE_ROLE_KEY`。
14. 图片上传和分享依赖对象存储/S3Storage，必须确保扣子项目绑定对象存储，或配置 `COZE_BUCKET_ENDPOINT_URL`、`COZE_BUCKET_NAME`。
15. 图像生成和对话依赖外部 OpenAI 兼容接口，至少需要配置可用的 `GRS_API_KEY`/`GRS_BASE_URL` 或在页面内配置模型供应商。
16. 云端版本已关闭本地/局域网同步，只保留账号注册登录。LibreOffice/Poppler 可通过 `INSTALL_DOC_TOOLS=1` 尝试安装；若构建环境不支持，则 PPTX/PDF 转图片降级为上传图片 ZIP。

部署完成后请验证：

1. 访问首页 `/` 返回 200。
2. 注册/登录流程可用。
3. 项目列表可创建、重命名、删除。
4. 图片上传可成功返回 URL。
5. 生图接口可调用并写入历史记录。
6. 对话接口支持 SSE 流式输出。
7. 生成图片可在画布、图库和 Lightbox 中正常展示。
