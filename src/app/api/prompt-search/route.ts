import { NextRequest, NextResponse } from "next/server";
import { SearchClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getCurrentUserId } from "@/lib/auth";

// POST /api/prompt-search - Search web for quality prompts
export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { query, count, refresh } = await request.json();
    if (!query?.trim()) {
      return NextResponse.json({ error: "搜索关键词不能为空" }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new SearchClient(config, customHeaders);

    // Use user's query directly for broader results, add prompt-related context only when query is short
    let searchQuery = query.trim().length <= 4 ? `AI 提示词 prompt ${query}` : query;
    // For "refresh" (换一批), append a random keyword to get different results
    if (refresh) {
      const randomHints = ['技巧', '教程', '进阶', '高级', '实战', '案例', '方法', '最佳实践', '指南', '攻略'];
      const hint = randomHints[Math.floor(Math.random() * randomHints.length)];
      searchQuery = `${searchQuery} ${hint}`;
    }
    const response = await client.webSearch(searchQuery, count || 20, true);

    return NextResponse.json({
      summary: response.summary,
      results: (response.web_items || []).map(item => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        site_name: item.site_name,
        content: item.content?.slice(0, 800),
      })),
    });
  } catch (error) {
    console.error("Prompt search error:", error);
    return NextResponse.json({ error: "搜索失败" }, { status: 500 });
  }
}
