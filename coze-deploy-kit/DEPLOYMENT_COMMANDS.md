# 部署命令

## 包管理器

只使用 pnpm。

```bash
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
```

## 构建

项目根目录执行：

```bash
bash ./scripts/build.sh
```

该脚本会：

1. 安装依赖。
2. 执行 `pnpm next build`。
3. 用 `tsup` 打包 `src/server.ts` 到 `dist/server.js`。

## 启动

项目根目录执行：

```bash
bash ./scripts/start.sh
```

启动脚本会读取：

```bash
DEPLOY_RUN_PORT
```

并通过：

```bash
PORT=${DEPLOY_RUN_PORT} node dist/server.js
```

启动服务。

## 运行时

- Node: `nodejs-24`
- Next.js: `16.1.1`
- React: `19.2.3`
- TypeScript: `5.x`
- Next config: `output: 'standalone'`
