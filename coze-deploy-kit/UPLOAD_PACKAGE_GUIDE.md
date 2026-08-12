# 上传给扣子的 zip 包说明

最终给扣子的文件是：

```text
coze-deploy-kit/dist/ai-platform-coze-upload.zip
```

扣子收到 zip 后，应解压并以解压后的顶层目录作为部署根目录。

## 压缩包必须包含

```text
.coze
.babelrc
.npmrc
package.json
pnpm-lock.yaml
next.config.ts
tsconfig.json
postcss.config.mjs
components.json
eslint.config.mjs
src/
public/
scripts/
assets/
AGENTS.md
README.md
coze-deploy-kit/
```

## 压缩包不包含

```text
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
node_modules/
.next/
.git/
release/
output/
.desktop-runtime/
.playwright-cli/
```

## 重新生成 zip

在项目根目录执行：

```bash
bash coze-deploy-kit/make-coze-upload-zip.sh
```

脚本采用白名单打包，只收集部署需要的源码和配置。
