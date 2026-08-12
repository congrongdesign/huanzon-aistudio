# 扣子云端版功能说明

## 已改为账号云端模式

扣子部署包会启用：

```text
NEXT_PUBLIC_COZE_CLOUD=1
COZE_PROJECT_ENV=PROD
LOCAL_BACKEND=0
HZ_BACKEND_MODE=supabase
```

效果：

1. 登录页只显示邮箱登录/注册。
2. 不再显示本地模式、局域网主机、局域网客户端。
3. 服务端强制关闭本地 JSON 后端，数据走 Supabase。
4. 项目、图片记录、提示词、技能、社交等依赖用户账号和云数据库。
5. 隐藏项目侧边栏里的 NAS/本地同步备份入口。

## 保留的云端能力

```text
注册 / 登录
项目管理
AI 画布
AI 对话
AI 生图
图片上传
图库 / 历史记录
提示词库
自定义技能
对象存储图片保存
图片处理
PPT 工作台的图片包流程
可编辑 PPT 的图片/PDF/PPTX 导入（取决于文档工具是否安装成功）
```

## 不再作为扣子云端功能的能力

```text
本地访客模式
局域网主机模式
局域网客户端模式
NAS / 本机目录同步中心
直接读写用户电脑本地路径
本机 Ollama / 127.0.0.1 模型接口
Electron 桌面端安装包更新能力
```

## LibreOffice / Poppler

扣子云端是否能安装 LibreOffice/Poppler 取决于部署环境是否允许构建期联网、下载 micromamba、执行二进制以及构建时长。

默认：

```text
INSTALL_DOC_TOOLS=0
```

默认不安装，部署更稳。PPTX/PDF 转页面图可能提示缺少工具，用户可以上传图片 ZIP 作为兜底。

如果你希望扣子尝试安装：

```text
INSTALL_DOC_TOOLS=1
```

构建脚本会执行：

```bash
bash ./scripts/install-cloud-doc-tools.sh
```

安装位置：

```text
tools/cloud-doc-tools/bin/soffice
tools/cloud-doc-tools/bin/pdftoppm
```

应用运行时会自动从这个目录查找工具。
