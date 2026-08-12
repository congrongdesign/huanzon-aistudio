import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";

// GET /api/prompt-export - Export prompt package as JSON
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const libraryId = searchParams.get("libraryId");
    const type = searchParams.get("type"); // atoms, packages, templates, or all

    if (!projectId && !libraryId) {
      return NextResponse.json({ error: "缺少项目ID或提示词库ID" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const exportData: Record<string, unknown> = {
      version: "1.0",
      exportTime: new Date().toISOString(),
      projectId,
      libraryId,
    };

    const filterField = libraryId ? "library_id" : "project_id";
    const filterValue = libraryId || projectId;

    if (type === "atoms" || type === "all" || !type) {
      const { data } = await supabase.from("prompt_atom").select("*").eq(filterField, filterValue);
      exportData.atoms = data || [];
    }
    if (type === "packages" || type === "all" || !type) {
      const { data } = await supabase.from("prompt_package").select("*").eq(filterField, filterValue);
      exportData.packages = data || [];
    }
    if (type === "templates" || type === "all" || !type) {
      const { data: templates } = await supabase.from("prompt_template").select("*").eq(filterField, filterValue);
      // Also export template variables
      if (templates && templates.length > 0) {
        const templateIds = templates.map((t: { id: number }) => t.id);
        const { data: vars } = await supabase.from("template_var").select("*").in("template_id", templateIds);
        exportData.templates = templates;
        exportData.templateVars = vars || [];
      } else {
        exportData.templates = [];
        exportData.templateVars = [];
      }
    }

    // Export categories
    const { data: categories } = await supabase.from("sys_category").select("*");
    exportData.categories = categories || [];

    return NextResponse.json(exportData);
  } catch (error) {
    console.error("Export prompts error:", error);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}

// POST /api/prompt-export - Import prompt package from JSON
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, libraryId, data } = body;

    if (!data) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const idMapping: Record<string, Record<number, number>> = {
      categories: {},
      atoms: {},
      packages: {},
      templates: {},
    };

    // Import categories first (needed for foreign keys)
    if (data.categories && Array.isArray(data.categories)) {
      for (const cat of data.categories) {
        const oldId = cat.id;
        const { data: newCat } = await supabase
          .from("sys_category")
          .insert({
            name: cat.name,
            parent_id: cat.parent_id ? (idMapping.categories[cat.parent_id] || 0) : 0,
            type: cat.type,
            sort: cat.sort,
            status: cat.status,
          })
          .select("id")
          .single();
        if (newCat) {
          idMapping.categories[oldId] = newCat.id;
        }
      }
    }

    // Import atoms
    if (data.atoms && Array.isArray(data.atoms)) {
      for (const atom of data.atoms) {
        const oldId = atom.id;
        const { data: newAtom } = await supabase
          .from("prompt_atom")
          .insert({
            name: atom.name,
            content: atom.content,
            category_id: idMapping.categories[atom.category_id] || atom.category_id,
            use_count: 0,
            is_hot: atom.is_hot || 0,
            project_id: projectId || null,
            library_id: libraryId || null,
          })
          .select("id")
          .single();
        if (newAtom) {
          idMapping.atoms[oldId] = newAtom.id;
        }
      }
    }

    // Import packages
    if (data.packages && Array.isArray(data.packages)) {
      for (const pkg of data.packages) {
        const oldId = pkg.id;
        // Remap atom_ids to new IDs
        const newAtomIds = (pkg.atom_ids || "").split(",")
          .map((id: string) => idMapping.atoms[parseInt(id)] || parseInt(id))
          .filter(Boolean)
          .join(",");

        const { data: newPkg } = await supabase
          .from("prompt_package")
          .insert({
            name: pkg.name,
            content: pkg.content,
            atom_ids: newAtomIds,
            category_id: idMapping.categories[pkg.category_id] || pkg.category_id,
            use_count: 0,
            project_id: projectId || null,
            library_id: libraryId || null,
          })
          .select("id")
          .single();
        if (newPkg) {
          idMapping.packages[oldId] = newPkg.id;
        }
      }
    }

    // Import templates
    if (data.templates && Array.isArray(data.templates)) {
      for (const tpl of data.templates) {
        const oldId = tpl.id;
        const { data: newTpl } = await supabase
          .from("prompt_template")
          .insert({
            name: tpl.name,
            content: tpl.content,
            category_id: idMapping.categories[tpl.category_id] || tpl.category_id,
            model: tpl.model,
            aspect_ratio: tpl.aspect_ratio,
            use_count: 0,
            project_id: projectId || null,
            library_id: libraryId || null,
          })
          .select("id")
          .single();

        if (newTpl) {
          idMapping.templates[oldId] = newTpl.id;

          // Import template vars
          if (data.templateVars && Array.isArray(data.templateVars)) {
            const varsForTemplate = data.templateVars.filter(
              (v: { template_id: number }) => v.template_id === oldId
            );
            for (const v of varsForTemplate) {
              await supabase.from("template_var").insert({
                template_id: newTpl.id,
                var_key: v.var_key,
                var_label: v.var_label,
                var_type: v.var_type,
                default_value: v.default_value,
                sort: v.sort,
              });
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported: {
        categories: Object.keys(idMapping.categories).length,
        atoms: Object.keys(idMapping.atoms).length,
        packages: Object.keys(idMapping.packages).length,
        templates: Object.keys(idMapping.templates).length,
      },
    });
  } catch (error) {
    console.error("Import prompts error:", error);
    return NextResponse.json({ error: "导入失败" }, { status: 500 });
  }
}
