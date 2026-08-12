import { pgTable, serial, varchar, text, timestamp, boolean, integer, index, jsonb, real } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull().unique(),
    username: varchar("username", { length: 100 }).notNull(),
    password_hash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 100 }),
    avatar_url: text("avatar_url"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("users_email_idx").on(table.email),
  ]
);

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const customSkills = pgTable(
  "custom_skills",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    steps: text("steps").notNull().default("[]"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("custom_skills_project_id_idx").on(table.project_id),
  ]
);

export const referenceImages = pgTable(
  "reference_images",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    image_url: text("image_url"),
    image_key: varchar("image_key", { length: 512 }),
    file_name: varchar("file_name", { length: 200 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reference_images_project_id_idx").on(table.project_id),
  ]
);

export const projectFolders = pgTable(
  "project_folders",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull().default("新建文件夹"),
    parent_id: varchar("parent_id", { length: 36 }),
    sort_order: integer("sort_order").default(0),
    color: varchar("color", { length: 20 }).default("#6366f1"),
    is_collapsed: boolean("is_collapsed").default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("project_folders_user_id_idx").on(table.user_id),
    index("project_folders_parent_id_idx").on(table.parent_id),
  ]
);

export const projects = pgTable(
  "projects",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull().default("未命名项目"),
    folder_id: varchar("folder_id", { length: 36 }).references(() => projectFolders.id, { onDelete: "set null" }),
    is_pinned: boolean("is_pinned").default(false),
    sort_order: integer("sort_order").default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("projects_is_pinned_idx").on(table.is_pinned),
    index("projects_sort_order_idx").on(table.sort_order),
    index("projects_user_id_idx").on(table.user_id),
    index("projects_folder_id_idx").on(table.folder_id),
  ]
);

export const imageRecords = pgTable(
  "image_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull(),
    image_url: text("image_url"),
    image_key: varchar("image_key", { length: 512 }),
    reference_images: text("reference_images"),
    canvas_block_id: varchar("canvas_block_id", { length: 36 }),
    block_order: integer("block_order").default(0),
    canvas_x: integer("canvas_x").default(0),
    canvas_y: integer("canvas_y").default(0),
    canvas_width: integer("canvas_width").default(512),
    canvas_height: integer("canvas_height").default(512),
    size: varchar("size", { length: 20 }).default("1:1"),
    model: varchar("model", { length: 100 }).default("gpt-image-2"),
    status: varchar("status", { length: 20 }).default("pending"),
    is_favorite: boolean("is_favorite").default(false),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    edited_image_key: varchar("edited_image_key", { length: 512 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("image_records_project_id_idx").on(table.project_id),
    index("image_records_project_block_idx").on(table.project_id, table.canvas_block_id),
    index("image_records_created_at_idx").on(table.created_at),
    index("image_records_status_idx").on(table.status),
    index("image_records_user_id_idx").on(table.user_id),
  ]
);

export const canvasBlocks = pgTable(
  "canvas_blocks",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull().default("画板"),
    color: varchar("color", { length: 20 }).notNull().default("#3b82f6"),
    canvas_x: integer("canvas_x").default(0),
    canvas_y: integer("canvas_y").default(0),
    canvas_width: integer("canvas_width").default(960),
    canvas_height: integer("canvas_height").default(600),
    image_scale: real("image_scale").default(1),
    sort_mode: varchar("sort_mode", { length: 20 }).notNull().default("compact"),
    padding: integer("padding").default(20),
    locked: boolean("locked").default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("canvas_blocks_project_id_idx").on(table.project_id),
    index("canvas_blocks_project_updated_idx").on(table.project_id, table.updated_at),
    index("canvas_blocks_user_id_idx").on(table.user_id),
  ]
);

export const designAssets = pgTable(
  "design_assets",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id, { onDelete: "set null" }),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 40 }).notNull().default("image"),
    url: text("url").notNull(),
    key: varchar("key", { length: 512 }),
    width: integer("width").default(0),
    height: integer("height").default(0),
    mime_type: varchar("mime_type", { length: 100 }).default("image/png"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("design_assets_project_id_idx").on(table.project_id),
    index("design_assets_user_id_idx").on(table.user_id),
    index("design_assets_kind_idx").on(table.kind),
    index("design_assets_created_at_idx").on(table.created_at),
  ]
);

export const designLayers = pgTable(
  "design_layers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    document_id: varchar("document_id", { length: 36 }),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    asset_id: varchar("asset_id", { length: 36 }).references(() => designAssets.id, { onDelete: "set null" }),
    type: varchar("type", { length: 40 }).notNull().default("image"),
    name: varchar("name", { length: 200 }).notNull().default("图层"),
    x: integer("x").default(0),
    y: integer("y").default(0),
    width: integer("width").default(0),
    height: integer("height").default(0),
    opacity: real("opacity").default(1),
    visible: boolean("visible").default(true),
    locked: boolean("locked").default(false),
    z_index: integer("z_index").default(0),
    props: jsonb("props").default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("design_layers_document_id_idx").on(table.document_id),
    index("design_layers_project_id_idx").on(table.project_id),
    index("design_layers_user_id_idx").on(table.user_id),
    index("design_layers_asset_id_idx").on(table.asset_id),
  ]
);

export const designOperations = pgTable(
  "design_operations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    document_id: varchar("document_id", { length: 36 }),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id, { onDelete: "set null" }),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    input_asset_ids: jsonb("input_asset_ids").default(sql`'[]'::jsonb`),
    output_asset_ids: jsonb("output_asset_ids").default(sql`'[]'::jsonb`),
    kind: varchar("kind", { length: 60 }).notNull(),
    prompt: text("prompt").default(""),
    mask_asset_id: varchar("mask_asset_id", { length: 36 }).references(() => designAssets.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 80 }).default(""),
    model: varchar("model", { length: 120 }).default(""),
    params: jsonb("params").default(sql`'{}'::jsonb`),
    status: varchar("status", { length: 30 }).notNull().default("queued"),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("design_operations_document_id_idx").on(table.document_id),
    index("design_operations_project_id_idx").on(table.project_id),
    index("design_operations_user_id_idx").on(table.user_id),
    index("design_operations_status_idx").on(table.status),
    index("design_operations_kind_idx").on(table.kind),
    index("design_operations_created_at_idx").on(table.created_at),
  ]
);

export const assetVersions = pgTable(
  "asset_versions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    asset_id: varchar("asset_id", { length: 36 }).references(() => designAssets.id, { onDelete: "cascade" }).notNull(),
    parent_asset_id: varchar("parent_asset_id", { length: 36 }).references(() => designAssets.id, { onDelete: "set null" }),
    operation_id: varchar("operation_id", { length: 36 }).references(() => designOperations.id, { onDelete: "set null" }),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    version_index: integer("version_index").default(1),
    label: varchar("label", { length: 120 }).default("版本"),
    url: text("url").notNull(),
    key: varchar("key", { length: 512 }),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("asset_versions_asset_id_idx").on(table.asset_id),
    index("asset_versions_parent_asset_id_idx").on(table.parent_asset_id),
    index("asset_versions_operation_id_idx").on(table.operation_id),
    index("asset_versions_user_id_idx").on(table.user_id),
  ]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    reference_image_urls: text("reference_image_urls"),
    image_url: text("image_url"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chat_messages_project_id_idx").on(table.project_id),
    index("chat_messages_created_at_idx").on(table.created_at),
    index("chat_messages_user_id_idx").on(table.user_id),
  ]
);

export const promptLibrary = pgTable(
  "prompt_library",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    category: varchar("category", { length: 50 }).default("general"),
    image_url: text("image_url"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("prompt_library_project_id_idx").on(table.project_id),
    index("prompt_library_category_idx").on(table.category),
  ]
);

export const inspirationFolders = pgTable(
  "inspiration_folders",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull().default("新建文件夹"),
    parent_id: varchar("parent_id", { length: 36 }),
    sort_order: integer("sort_order").default(0),
    color: varchar("color", { length: 20 }).default("#6366f1"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("inspiration_folders_project_id_idx").on(table.project_id),
    index("inspiration_folders_parent_id_idx").on(table.parent_id),
    index("inspiration_folders_user_id_idx").on(table.user_id),
  ]
);

export const inspirationItems = pgTable(
  "inspiration_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    folder_id: varchar("folder_id", { length: 36 }).references(() => inspirationFolders.id),
    project_id: varchar("project_id", { length: 36 }).references(() => projects.id),
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    image_url: text("image_url"),
    image_key: varchar("image_key", { length: 512 }),
    file_name: varchar("file_name", { length: 200 }),
    source: varchar("source", { length: 50 }).default("upload"),
    dominant_color: varchar("dominant_color", { length: 20 }),
    width: integer("width").default(0),
    height: integer("height").default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("inspiration_items_folder_id_idx").on(table.folder_id),
    index("inspiration_items_project_id_idx").on(table.project_id),
    index("inspiration_items_user_id_idx").on(table.user_id),
  ]
);
