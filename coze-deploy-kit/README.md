# 扣子自动部署压缩包说明

这个文件夹是给扣子自动部署助手看的部署资料包，已经随源码一起放进上传压缩包。

## 重要说明

扣子不能访问我的本地目录。请以收到的 zip 解压后的根目录作为部署根目录。

不要以 `coze-deploy-kit/` 作为应用根目录。`coze-deploy-kit/` 只是说明资料包，真正的应用根目录是 zip 解压后的顶层目录，那里应该包含：

```text
.coze
package.json
pnpm-lock.yaml
next.config.ts
src/
public/
scripts/
coze-deploy-kit/
```

## 部署入口

压缩包根目录包含 `.coze` 配置：

```toml
[project]
requires = [ "nodejs-24" ]
template = "nextjs"
version = "0.0.21"
appliedPatches = [ ]

[deploy]
build = [ "bash", "./scripts/build.sh" ]
run = [ "bash", "./scripts/start.sh" ]
deps = [ "git" ]
```

如果上传平台丢失隐藏文件 `.coze`，请把 `coze-deploy-kit/coze-config.toml` 的内容复制为解压根目录的 `.coze`。

## 推荐部署步骤

1. 解压上传包。
2. 进入解压后的顶层目录，不要进入 `coze-deploy-kit/`。
3. 读取 `coze-deploy-kit/SEND_TO_COZE_PROMPT.md`。
4. 使用 pnpm 安装依赖。
5. 执行 `bash ./scripts/build.sh` 构建。
6. 执行 `bash ./scripts/start.sh` 启动。
7. 在扣子平台配置 `ENV.production.example` 中列出的环境变量。

## 压缩包内不包含

为了安全和体积控制，上传包不包含：

```text
.env.local
.env
.env.production.local
node_modules/
.next/
.git/
release/
output/
.desktop-runtime/
.playwright-cli/
```

生产密钥必须通过扣子平台环境变量/密钥配置注入，不要写入源码。云端版功能差异见 `CLOUD_VERSION_NOTES.md`。
