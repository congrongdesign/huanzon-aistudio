import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import { isLocalBackendEnabled, listPrompts } from "@/lib/local-backend";

// GET /api/prompt-versions - List versions for a library
export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const libraryId = searchParams.get("libraryId");
    if (!libraryId) return NextResponse.json({ error: "缺少提示词库ID" }, { status: 400 });
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ data: [] });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("prompt_versions")
      .select("id, version_name, created_at")
      .eq("library_id", libraryId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error("Get versions error:", error);
    return NextResponse.json({ error: "获取版本列表失败" }, { status: 500 });
  }
}

// POST /api/prompt-versions - Create a version snapshot
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { libraryId, versionName } = await request.json();
    if (!libraryId) return NextResponse.json({ error: "缺少提示词库ID" }, { status: 400 });
    if (isLocalBackendEnabled()) {
      const snapshot = listPrompts(userId).filter((item) => Number(item.library_id || 0) === Number(libraryId));
      return NextResponse.json({
        data: {
          id: Date.now(),
          version_name: versionName || `版本 ${new Date().toLocaleString()}`,
          snapshot,
          created_at: new Date().toISOString(),
        },
      });
    }

    const supabase = getSupabaseClient();

    // Snapshot all data for this library
    const [atomsRes, packagesRes, templatesRes] = await Promise.all([
      supabase.from("prompt_atom").select("*").eq("library_id", libraryId),
      supabase.from("prompt_package").select("*").eq("library_id", libraryId),
      supabase.from("prompt_template").select("*").eq("library_id", libraryId),
    ]);

    const snapshot = {
      atoms: atomsRes.data || [],
      packages: packagesRes.data || [],
      templates: templatesRes.data || [],
      timestamp: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("prompt_versions")
      .insert({
        library_id: libraryId,
        version_name: versionName || `版本 ${new Date().toLocaleString()}`,
        snapshot,
      })
      .select("id, version_name, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Create version error:", error);
    return NextResponse.json({ error: "创建版本失败" }, { status: 500 });
  }
}

// PATCH /api/prompt-versions - Restore a version
export async function PATCH(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { versionId } = await request.json();
    if (!versionId) return NextResponse.json({ error: "缺少版本ID" }, { status: 400 });
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();

    // Get the version snapshot
    const { data: version } = await supabase.from("prompt_versions").select("*").eq("id", versionId).single();
    if (!version) return NextResponse.json({ error: "版本不存在" }, { status: 404 });

    const snapshot = version.snapshot as { atoms: { id: number; name: string; content: string; category_id: number; is_hot: number; source?: string }[]; packages: { id: number; name: string; content: string; atom_ids: string; category_id: number }[]; templates: { id: number; name: string; content: string; category_id: number; model: string; aspect_ratio: string }[] };
    const libraryId = version.library_id;

    // Create a version of current state before restoring
    const [currentAtoms, currentPkgs, currentTpls] = await Promise.all([
      supabase.from("prompt_atom").select("*").eq("library_id", libraryId),
      supabase.from("prompt_package").select("*").eq("library_id", libraryId),
      supabase.from("prompt_template").select("*").eq("library_id", libraryId),
    ]);
    await supabase.from("prompt_versions").insert({
      library_id: libraryId,
      version_name: `恢复前自动备份 ${new Date().toLocaleString()}`,
      snapshot: { atoms: currentAtoms.data || [], packages: currentPkgs.data || [], templates: currentTpls.data || [], timestamp: new Date().toISOString() },
    });

    // Delete current data in library
    await supabase.from("prompt_atom").delete().eq("library_id", libraryId);
    await supabase.from("prompt_package").delete().eq("library_id", libraryId);
    await supabase.from("prompt_template").delete().eq("library_id", libraryId);

    // Restore from snapshot
    if (snapshot.atoms?.length) {
      const atomsToInsert = snapshot.atoms.map((a: { name: string; content: string; category_id: number; is_hot: number; source?: string }) => ({
        name: a.name, content: a.content, category_id: a.category_id, is_hot: a.is_hot || 0, source: a.source || '', library_id: libraryId, project_id: '', use_count: 0,
      }));
      await supabase.from("prompt_atom").insert(atomsToInsert);
    }
    if (snapshot.packages?.length) {
      const pkgsToInsert = snapshot.packages.map((p: { name: string; content: string; atom_ids: string; category_id: number }) => ({
        name: p.name, content: p.content, atom_ids: p.atom_ids, category_id: p.category_id, library_id: libraryId, project_id: '', use_count: 0,
      }));
      await supabase.from("prompt_package").insert(pkgsToInsert);
    }
    if (snapshot.templates?.length) {
      const tplsToInsert = snapshot.templates.map((t: { name: string; content: string; category_id: number; model: string; aspect_ratio: string }) => ({
        name: t.name, content: t.content, category_id: t.category_id, model: t.model, aspect_ratio: t.aspect_ratio, library_id: libraryId, project_id: '', use_count: 0,
      }));
      await supabase.from("prompt_template").insert(tplsToInsert);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Restore version error:", error);
    return NextResponse.json({ error: "恢复版本失败" }, { status: 500 });
  }
}

// DELETE /api/prompt-versions - Delete a version
export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少版本ID" }, { status: 400 });
    if (isLocalBackendEnabled()) {
      return NextResponse.json({ success: true });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("prompt_versions").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete version error:", error);
    return NextResponse.json({ error: "删除版本失败" }, { status: 500 });
  }
}
