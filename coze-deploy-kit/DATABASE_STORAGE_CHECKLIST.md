# 数据库与对象存储清单

## 数据库

生产环境必须提供可访问的 Supabase/PostgreSQL，并配置：

```text
COZE_SUPABASE_URL
COZE_SUPABASE_ANON_KEY
COZE_SUPABASE_SERVICE_ROLE_KEY
```

## 必需表

请确保数据库结构与项目中的 `src/storage/database/shared/schema.ts` 保持一致。核心表包括：

```text
users
projects
image_records
chat_messages
reference_images
prompt_library
custom_skills
image_tags
inspiration_folders
inspiration_items
sys_category
prompt_atom
prompt_package
prompt_template
template_var
prompt_use_log
prompt_test_records
prompt_libraries
prompt_versions
```

项目中还有设计资产、版本、操作追踪、社交、归档、知识库等扩展能力，部署助手应以 `src/storage/database/shared/schema.ts` 和 API route 实际查询字段为准补齐。

## 对象存储

这些功能依赖对象存储：

```text
/api/upload
/api/generate
/api/image-process
/api/inpaint
/api/share
/api/references
/api/history
/api/trash
/api/archived-images
/api/refresh-image-urls
```

需要确保：

1. 运行环境可以实例化 `coze-coding-dev-sdk` 的 `S3Storage`。
2. 上传后的图片 URL 可被浏览器通过 HTTPS 访问。
3. 删除/回收站接口有权限删除对象。
4. 如果扣子没有自动注入存储配置，请配置 `COZE_BUCKET_ENDPOINT_URL` 和 `COZE_BUCKET_NAME`。
