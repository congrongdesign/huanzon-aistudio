'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Tag, Package, FileText, BarChart3, Plus, Search, Edit3,
  Trash2, ChevronRight, ChevronDown, X, ArrowRight,
  FolderPlus, Settings, TrendingUp, Eye,
  Layers, Zap, BookOpen, Star, Download, Upload, Globe,
  FlaskConical, Image as ImageIcon, Play,
  Minus, Save, RotateCcw, CheckCircle2, ExternalLink,
  Home, Clock, Library, Copy, Check, Code, Wand2, Lightbulb,
  Heart, RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import NeutralSelect from '@/components/ui/neutral-select';

// ─── Types ───
interface Category {
  id: number;
  name: string;
  parent_id: number;
  type: number;
  sort: number;
  status: number;
  children?: Category[];
}

interface Atom {
  id: number;
  name: string;
  content: string;
  category_id: number;
  use_count: number;
  is_hot: number;
  source?: string;
  tags?: string;
  sort_order?: number;
}

interface Pkg {
  id: number;
  name: string;
  content: string;
  atom_ids: string;
  category_id: number;
  use_count: number;
  tags?: string;
  sort_order?: number;
}

interface Template {
  id: number;
  name: string;
  content: string;
  category_id: number;
  model: string;
  aspect_ratio: string;
  use_count: number;
  tags?: string;
  sort_order?: number;
  vars: { id?: number; var_key: string; var_label: string; var_type: string; default_value: string; sub_category_id?: number | null; sort: number }[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  site_name?: string;
  content?: string;
}

interface TestRecord {
  id: number;
  project_id: string;
  reference_image_url: string;
  prompt: string;
  generated_image_url: string;
  score: number;
  notes: string;
  model: string;
  aspect_ratio: string;
  created_at: string;
}

interface TestResult {
  prompt: string;
  imageUrl: string;
  loading: boolean;
  score: number;
  progress: number;
  elapsedSec: number;
  error?: string;
}

interface PromptLibrary {
  id: number;
  project_id: string;
  name: string;
  description: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface Version {
  id: number;
  library_id: number;
  version_name: string;
  created_at: string;
}

type NavPage = 'home' | 'lab' | 'atoms' | 'packages' | 'templates' | 'knowledge';

const WORKSPACE_SURFACE_CLASS =
  'prompt-manager-workspace-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-card';
const WORKSPACE_SURFACE_STYLE: React.CSSProperties = {
  boxShadow: 'var(--app-card-shadow)',
};

function isLocalPromptEndpoint(url?: string): boolean {
  if (!url) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url.trim());
}

function extractPlannedPromptBlocks(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const normalizePrompt = (raw: string) => raw
    .replace(/```(?:prompt|text|markdown|中文|english)?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:#{1,6}\s*)?(?:提示词|Prompt)\s*[0-9一二三四五六七八九十]*\s*[：:｜|-]?\s*/gim, '')
    .replace(/^\s*(?:用途|说明|亮点|方案说明)\s*[：:].*$/gim, '')
    .replace(/^\s*[-—]{3,}\s*$/gm, '')
    .replace(/\[GENERATE:\s*([\s\S]*?)\]/gi, '$1')
    .replace(/^\s*(?:以下是|下面是).*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const fenced = Array.from(clean.matchAll(/```(?:prompt|text|markdown|中文|english)?\s*([\s\S]*?)```/gi))
    .map((m) => normalizePrompt(m[1] || ''))
    .filter((item) => item.length > 8);
  if (fenced.length > 0) return fenced;
  const sections = clean
    .split(/(?=^\s*(?:#{2,3}\s*)?(?:提示词|方案|Prompt)\s*[0-9一二三四五六七八九十]+[：:｜|\s])/gim)
    .map((part) => normalizePrompt(part))
    .filter((part) => part.length > 20);
  return sections.length > 1 ? sections : [normalizePrompt(clean)].filter(Boolean);
}

function ratioToCssValue(ratio: string): string {
  const [w, h] = ratio.split(':').map((n) => Number(n));
  if (!w || !h) return '1 / 1';
  return `${w} / ${h}`;
}

interface PromptManagerProps {
  projectId: string | null;
  onInsertPrompt: (text: string) => void;
  onGoBack: () => void;
  authHeaders: Record<string, string>;
  canvasImages?: any[];
  chatModel?: string;
  chatApiKey?: string;
  chatBaseUrl?: string;
  imageModel?: string;
  imageSize?: string;
  imageResolution?: string;
  imageApiKey?: string;
  imageBaseUrl?: string;
}

export default function PromptManager({ projectId, onInsertPrompt, onGoBack, authHeaders, canvasImages, chatModel, chatApiKey, chatBaseUrl, imageModel, imageSize, imageResolution, imageApiKey, imageBaseUrl }: PromptManagerProps) {
  const effectiveProjectId = projectId || '';

  // ─── State ───
  const [activePage, setActivePage] = useState<NavPage>('home');
  const [libraries, setLibraries] = useState<PromptLibrary[]>([]);
  const [currentLibraryId, setCurrentLibraryId] = useState<number | null>(null);
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const [showNewLibraryForm, setShowNewLibraryForm] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [creatingLibrary, setCreatingLibrary] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [showCategoryPanel, setShowCategoryPanel] = useState(true);
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [keyword, setKeyword] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editItem, setEditItem] = useState<Atom | Pkg | Template | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  // Form state
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategoryId, setFormCategoryId] = useState<number>(0);
  const [formModel, setFormModel] = useState('');
  const [formAspectRatio, setFormAspectRatio] = useState('');
  const [formVars, setFormVars] = useState<{ var_key: string; var_label: string; var_type: string; default_value: string; sub_category_id?: number | null; sort: number }[]>([]);
  const [formAtomIds, setFormAtomIds] = useState<string>('');
  const [formTags, setFormTags] = useState<string>('');
  const [atomSearchQuery, setAtomSearchQuery] = useState<string>('');

  // Detail panel
  const [detailItem, setDetailItem] = useState<Atom | Pkg | Template | { id: number; name: string; content: string; source: string; tags: string; project_id: string; library_id: number | null; use_count: number; created_at: string; updated_at: string } | null>(null);

  // Sort & filter
  const [sortBy, setSortBy] = useState<'name' | 'use_count' | 'created_at'>('use_count');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterTag, setFilterTag] = useState<string>('');

  // Drag state for items
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [itemDragOverCatId, setItemDragOverCatId] = useState<number | null>(null);
  const [catDragOver, setCatDragOver] = useState<{ idx: number; pos: 'before' | 'after' | 'before-child' | 'after-child'; childIdx?: number } | null>(null);

  // Drag state for categories (separate from item drag)
  const [dragCatId, setDragCatId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; position: 'before' | 'after' | 'inside' } | null>(null);
  const [dragOverInsertLine, setDragOverInsertLine] = useState<{ afterId: number | null } | null>(null);

  // Category form
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [catFormName, setCatFormName] = useState('');
  const [catFormParentId, setCatFormParentId] = useState(0);
  const [catFormType, setCatFormType] = useState(1);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Template variable fill
  const [fillTemplate, setFillTemplate] = useState<Template | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  // Web search (home page)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchSummary, setSearchSummary] = useState('');
  const [searching, setSearching] = useState(false);
  const [adoptingIndex, setAdoptingIndex] = useState<number | null>(null);
  const [adoptedSet, setAdoptedSet] = useState<Set<number>>(new Set());
  const [analysisResult, setAnalysisResult] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [searchCategory, setSearchCategory] = useState('');
  const [favSet, setFavSet] = useState<Set<number>>(new Set());

  // Test mode (lab page)
  const [testRefImages, setTestRefImages] = useState<string[]>([]);
  const [testPrompts, setTestPrompts] = useState<string[]>(['']);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testRecords, setTestRecords] = useState<TestRecord[]>([]);
  const [testGenerating, setTestGenerating] = useState(false);
  const [testAspectRatio, setTestAspectRatio] = useState(imageSize || '1:1');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Prompt planner (lab page)
  const [plannerBrief, setPlannerBrief] = useState('');
  const [plannerUseCase, setPlannerUseCase] = useState('AI生图');
  const [plannerTone, setPlannerTone] = useState('');
  const [plannerConstraints, setPlannerConstraints] = useState('');
  const [plannerLanguage, setPlannerLanguage] = useState('中文');
  const [plannerCount, setPlannerCount] = useState(3);
  const [plannerOutput, setPlannerOutput] = useState('');
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState('');
  const [copiedPlannerIndex, setCopiedPlannerIndex] = useState<number | null>(null);
  const [savedPlannerIndex, setSavedPlannerIndex] = useState<number | null>(null);

  // Reverse prompt (lab page)
  const [reverseRefImage, setReverseRefImage] = useState<string | null>(null);
  const [reverseResult, setReverseResult] = useState<string | null>(null);
  const [reverseGenerating, setReverseGenerating] = useState(false);
  const [reverseCanvasPicker, setReverseCanvasPicker] = useState(false);
  const [reverseImportLibId, setReverseImportLibId] = useState<number | null>(null);
  const [showReverseImportModal, setShowReverseImportModal] = useState(false);
  const reverseFileRef = useRef<HTMLInputElement>(null);
  const [testCanvasPicker, setTestCanvasPicker] = useState(false);

  // Knowledge base
  const [knowledgeItems, setKnowledgeItems] = useState<{ id: number; name: string; content: string; source: string; tags: string; project_id: string; library_id: number | null; use_count: number; created_at: string; updated_at: string }[]>([]);
  const [knowledgeKeyword, setKnowledgeKeyword] = useState('');
  const [previewKnowledge, setPreviewKnowledge] = useState<any>(null);

  // Stats (home page)
  const [stats, setStats] = useState<Record<string, { total: number; items: Record<string, number> }> | null>(null);

  // Versions
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [restoringVersion, setRestoringVersion] = useState(false);

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMode, setExportMode] = useState<'library' | 'pack'>('pack'); // library=entire lib, pack=selective
  const [exportSelection, setExportSelection] = useState({ atoms: true, packages: true, templates: true, categories: true });

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'library' | 'pack'>('pack'); // library=as new lib, pack=into current lib
  const [importPreviewData, setImportPreviewData] = useState<Record<string, unknown> | null>(null);
  const [importSelection, setImportSelection] = useState({ atoms: true, packages: true, templates: true, categories: true });

  // Reverse prompt (lab page)
  const [reverseImage, setReverseImage] = useState<string>('');
  const [reverseAnalyzing, setReverseAnalyzing] = useState(false);
  const [reverseImportLib, setReverseImportLib] = useState<number | null>(null);

  // AI analysis (home page search)
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisContent, setAnalysisContent] = useState<string>('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisImportLib, setAnalysisImportLib] = useState<number | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState<{ id: number; name: string; content: string; source: string; tags: string; created_at: string }[]>([]);
  const [knowledgePreview, setKnowledgePreview] = useState<any>(null);

  const headers = { ...authHeaders, 'Content-Type': 'application/json' };

  // ─── Knowledge Space Key Handler ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && activePage === 'knowledge' && detailItem && !knowledgePreview && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        const ki = knowledgeItems.find(k => k.id === detailItem.id);
        if (ki) setKnowledgePreview(ki);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activePage, detailItem, knowledgeItems, knowledgePreview]);

  // ─── Data Loading ───
  const buildTree = (cats: Category[]): Category[] => {
    const map: Record<number, Category> = {};
    const roots: Category[] = [];
    cats.forEach(c => { map[c.id] = { ...c, children: [] }; });
    cats.forEach(c => {
      if (c.parent_id === 0) { roots.push(map[c.id]); }
      else if (map[c.parent_id]) { map[c.parent_id].children!.push(map[c.id]); }
    });
    return roots;
  };

  const loadLibraries = useCallback(async () => {
    try {
      const res = await fetch(`/api/prompt-libraries?projectId=${effectiveProjectId}`, { headers });
      const json = await res.json();
      if (json.data) {
        setLibraries(json.data);
        if (json.data.length > 0) {
          setCurrentLibraryId(prev => prev ?? json.data[0].id);
        }
      }
    } catch (err) { console.error('Load libraries failed:', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProjectId]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/prompt-categories', { headers });
      const json = await res.json();
      if (json.data) setCategories(buildTree(json.data));
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAtoms = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategoryId) params.set('categoryId', String(selectedCategoryId));
      if (keyword) params.set('keyword', keyword);
      if (currentLibraryId) params.set('libraryId', String(currentLibraryId));
      const res = await fetch(`/api/prompt-atoms?${params}`, { headers });
      const json = await res.json();
      if (json.data) setAtoms(json.data);
    } catch (err) { console.error('Load atoms failed:', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLibraryId, selectedCategoryId, keyword]);

  const loadPackages = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategoryId) params.set('categoryId', String(selectedCategoryId));
      if (keyword) params.set('keyword', keyword);
      if (currentLibraryId) params.set('libraryId', String(currentLibraryId));
      const res = await fetch(`/api/prompt-packages?${params}`, { headers });
      const json = await res.json();
      if (json.data) setPackages(json.data);
    } catch (err) { console.error('Load packages failed:', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLibraryId, selectedCategoryId, keyword]);

  const loadTemplates = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategoryId) params.set('categoryId', String(selectedCategoryId));
      if (keyword) params.set('keyword', keyword);
      if (currentLibraryId) params.set('libraryId', String(currentLibraryId));
      const res = await fetch(`/api/prompt-templates?${params}`, { headers });
      const json = await res.json();
      if (json.data) setTemplates(json.data);
    } catch (err) { console.error('Load templates failed:', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLibraryId, selectedCategoryId, keyword]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/prompt-use-log?projectId=${effectiveProjectId}`, { headers });
      const json = await res.json();
      if (json.data) setStats(json.data);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProjectId]);

  const loadTestRecords = useCallback(async () => {
    try {
      const res = await fetch(`/api/prompt-test?projectId=${effectiveProjectId}&limit=20`, { headers });
      const json = await res.json();
      if (json.data) setTestRecords(json.data);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProjectId]);

  const loadVersions = useCallback(async () => {
    if (!currentLibraryId) return;
    try {
      const res = await fetch(`/api/prompt-versions?libraryId=${currentLibraryId}`, { headers });
      const json = await res.json();
      if (json.data) setVersions(json.data);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLibraryId]);

  const loadKnowledge = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (effectiveProjectId) params.set('projectId', effectiveProjectId);
      if (currentLibraryId) params.set('libraryId', String(currentLibraryId));
      if (knowledgeKeyword) params.set('keyword', knowledgeKeyword);
      const res = await fetch(`/api/prompt-knowledge?${params}`, { headers });
      const json = await res.json();
      if (json.data) {
        console.log('[PromptManager] loadKnowledge success, count:', json.data.length, 'items:', json.data.map((i: any) => i.name));
        setKnowledgeItems(json.data);
      } else {
        console.log('[PromptManager] loadKnowledge response missing data field:', json);
      }
    } catch (err) { console.error('Load knowledge failed:', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProjectId, currentLibraryId, knowledgeKeyword]);

  useEffect(() => { loadLibraries(); }, [loadLibraries]);
  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadTestRecords(); loadStats(); }, [loadTestRecords, loadStats]);
  useEffect(() => {
    if (currentLibraryId || effectiveProjectId) {
      loadAtoms(); loadPackages(); loadTemplates(); loadVersions(); loadKnowledge();
    }
  }, [currentLibraryId, loadAtoms, loadPackages, loadTemplates, loadVersions, loadKnowledge]);

  // Also load when activePage changes to a data page
  useEffect(() => {
    if (activePage === 'atoms') loadAtoms();
    else if (activePage === 'packages') loadPackages();
    else if (activePage === 'templates') loadTemplates();
    else if (activePage === 'knowledge') loadKnowledge();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  // ─── Actions ───
  const logUsage = async (type: string, id: number) => {
    try {
      await fetch('/api/prompt-use-log', { method: 'POST', headers, body: JSON.stringify({ prompt_type: type, prompt_id: id, project_id: effectiveProjectId }) });
    } catch {}
  };

  const handleInsert = async (text: string, type: string, id: number) => {
    onInsertPrompt(text);
    await logUsage(type, id);
  };

  const applyTemplate = async (tpl: Template, values: Record<string, string>) => {
    let content = tpl.content;
    tpl.vars.forEach(v => {
      const val = values[v.var_key] || v.default_value || `{${v.var_label}}`;
      content = content.replace(new RegExp(`\\{\\{${v.var_key}\\}\\}`, 'g'), val);
    });
    onInsertPrompt(content);
    await logUsage('template', tpl.id);
    setFillTemplate(null);
    setVarValues({});
  };

  const requestJson = async (url: string, init: RequestInit) => {
    const res = await fetch(url, init);
    const text = await res.text();
    let json: { error?: string } | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new Error(json?.error || text || `请求失败：${res.status}`);
    }
    return json;
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    const libId = currentLibraryId;
    if (activePage === 'knowledge') {
      try {
        const body = { name: formName, content: formContent, tags: formTags, project_id: effectiveProjectId, library_id: libId };
        if (editItem) { await requestJson('/api/prompt-knowledge', { method: 'PATCH', headers, body: JSON.stringify({ id: (editItem as { id: number }).id, ...body }) }); }
        else { await requestJson('/api/prompt-knowledge', { method: 'POST', headers, body: JSON.stringify(body) }); }
        loadKnowledge();
        closeModal();
      } catch (err) {
        console.error('Save knowledge failed:', err);
        alert(err instanceof Error ? err.message : '保存知识条目失败');
      }
      return;
    }
    if (!libId) { alert('请先选择或创建提示词库'); return; }
    try {
      if (activePage === 'atoms') {
        const body = { name: formName, content: formContent, category_id: formCategoryId, project_id: effectiveProjectId, library_id: libId, tags: formTags };
        if (editItem) { await requestJson('/api/prompt-atoms', { method: 'PATCH', headers, body: JSON.stringify({ id: editItem.id, ...body }) }); }
        else { await requestJson('/api/prompt-atoms', { method: 'POST', headers, body: JSON.stringify(body) }); }
        loadAtoms();
      } else if (activePage === 'packages') {
        const body = { name: formName, content: formContent, atom_ids: formAtomIds, category_id: formCategoryId, project_id: effectiveProjectId, library_id: libId, tags: formTags };
        if (editItem) { await requestJson('/api/prompt-packages', { method: 'PATCH', headers, body: JSON.stringify({ id: editItem.id, ...body }) }); }
        else { await requestJson('/api/prompt-packages', { method: 'POST', headers, body: JSON.stringify(body) }); }
        loadPackages();
      } else if (activePage === 'templates') {
        const body = { name: formName, content: formContent, category_id: formCategoryId, model: formModel, aspect_ratio: formAspectRatio, vars: formVars, project_id: effectiveProjectId, library_id: libId, tags: formTags };
        if (editItem) { await requestJson('/api/prompt-templates', { method: 'PATCH', headers, body: JSON.stringify({ id: editItem.id, ...body }) }); }
        else { await requestJson('/api/prompt-templates', { method: 'POST', headers, body: JSON.stringify(body) }); }
        loadTemplates();
      }
      closeModal();
    } catch (err) {
      console.error('Save failed:', err);
      alert(err instanceof Error ? err.message : '保存提示词失败');
    }
  };

  const handleDelete = async (type: string, id: number) => {
    const typeLabel = type === 'atoms' ? '原子词' : type === 'packages' ? '词包' : type === 'templates' ? '提示词模板' : '知识条目';
    setConfirmDialog({
      title: '删除确认',
      message: `确定要删除此${typeLabel}吗？此操作不可撤销。`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const endpoint = type === 'atoms' ? 'prompt-atoms' : type === 'packages' ? 'prompt-packages' : type === 'templates' ? 'prompt-templates' : 'prompt-knowledge';
          await fetch(`/api/${endpoint}?id=${id}`, { method: 'DELETE', headers });
          if (type === 'atoms') loadAtoms();
          else if (type === 'packages') loadPackages();
          else if (type === 'templates') loadTemplates();
          else loadKnowledge();
        } catch {}
      },
    });
  };

  const handleBatchInsert = async () => {
    const items = activePage === 'atoms'
      ? atoms.filter(a => selectedItems.has(a.id))
      : activePage === 'packages'
        ? packages.filter(p => selectedItems.has(p.id))
        : templates.filter(t => selectedItems.has(t.id));
    const text = items.map(i => i.content).join(', ');
    if (text) {
      onInsertPrompt(text);
      for (const item of items) { await logUsage(activePage === 'atoms' ? 'atom' : activePage === 'packages' ? 'package' : 'template', item.id); }
    }
    setSelectedItems(new Set());
  };

  const openCreateModal = () => {
    if (activePage === 'knowledge') {
      // For knowledge, use a simpler creation flow
      setEditItem(null); setFormName(''); setFormContent('');
      setFormTags('');
      setShowCreateModal(true);
      return;
    }
    setEditItem(null); setFormName(''); setFormContent('');
    setFormCategoryId(selectedCategoryId || 0); setFormModel('');
    setFormAspectRatio(''); setFormVars([]); setFormAtomIds(''); setFormTags('');
    setShowCreateModal(true);
  };

  const openEditModal = (item: Atom | Pkg | Template | { id: number; name: string; content: string; source: string; tags: string; project_id: string; library_id: number | null; use_count: number; created_at: string; updated_at: string }) => {
    setEditItem('category_id' in item ? item as Atom | Pkg | Template : null);
    setFormName(item.name); setFormContent(item.content);
    setFormCategoryId('category_id' in item ? (item as Atom | Pkg | Template).category_id : 0);
    setFormTags(item.tags || '');
    if ('model' in item) { setFormModel((item as Template).model || ''); setFormAspectRatio((item as Template).aspect_ratio || ''); setFormVars((item as Template).vars || []); }
    if ('atom_ids' in item) setFormAtomIds((item as Pkg).atom_ids || '');
    setShowCreateModal(true);
  };

  const closeModal = () => { setShowCreateModal(false); setEditItem(null); setFormTags(''); };

  // Category CRUD
  const saveCategory = async () => {
    if (!catFormName.trim()) return;
    try {
      if (editingCategory) {
        await fetch('/api/prompt-categories', { method: 'PATCH', headers, body: JSON.stringify({ id: editingCategory.id, name: catFormName, parent_id: catFormParentId, type: catFormType }) });
      } else {
        await fetch('/api/prompt-categories', { method: 'POST', headers, body: JSON.stringify({ name: catFormName, parent_id: catFormParentId, type: catFormType, project_id: effectiveProjectId }) });
      }
      loadCategories(); setShowCategoryForm(false); setCatFormName(''); setEditingCategory(null);
    } catch {}
  };

  const deleteCategory = async (id: number) => {
    setConfirmDialog({
      title: '删除分类',
      message: '删除分类将影响关联的提示词，确认删除？',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await fetch(`/api/prompt-categories?id=${id}`, { method: 'DELETE', headers });
          loadCategories();
          if (selectedCategoryId === id) setSelectedCategoryId(null);
        } catch {}
      },
    });
  };

  // Library CRUD
  const createLibrary = async () => {
    const name = newLibName.trim();
    if (!name || creatingLibrary) return;
    setCreatingLibrary(true);
    try {
      const res = await fetch('/api/prompt-libraries', {
        method: 'POST',
        headers,
        body: JSON.stringify({ project_id: effectiveProjectId, projectId: effectiveProjectId, name }),
      });
      const json = await res.json();
      const created = json.data || json.library || (json.id ? json : null);
      if (res.ok && created) {
        const createdId = Number(created.id);
        await loadLibraries();
        if (Number.isFinite(createdId)) setCurrentLibraryId(createdId);
        setNewLibName('');
        setShowNewLibraryForm(false);
        setShowLibraryMenu(false);
      } else {
        alert(json.error || '创建失败');
      }
    } catch (err) {
      console.error('Create library error:', err);
      alert('创建提示词库失败');
    } finally {
      setCreatingLibrary(false);
    }
  };

  const deleteLibrary = async (id: number) => {
    try {
      await fetch(`/api/prompt-libraries?id=${id}`, { method: 'DELETE', headers });
      await loadLibraries();
      if (currentLibraryId === id) {
        setCurrentLibraryId(libraries.find(l => l.id !== id)?.id ?? null);
      }
    } catch {}
  };

  // Web search
  const handleWebSearch = async (isRefresh = false) => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    if (!isRefresh) setAdoptedSet(new Set());
    try {
      const res = await fetch('/api/prompt-search', { method: 'POST', headers, body: JSON.stringify({ query: `${searchCategory ? searchCategory + ' ' : ''}${searchQuery}`, count: 20, refresh: isRefresh }) });
      const json = await res.json();
      setSearchResults(json.results || []);
      setSearchSummary(json.summary || '');
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  // Analyze search results with AI
  const analyzeSearchResults = async () => {
    if (searchResults.length === 0) return;
    setAnalyzing(true);
    setAnalysisResult('');
    setShowAnalysisModal(true);
    try {
      const content = searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet || r.content || ''}\n来源: ${r.url || r.site_name || ''}`).join('\n\n');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `请分析以下搜索到的提示词相关内容，提炼出有用的提示词框架、方法和技巧：\n\n${content}`,
          projectId: '',
          systemPrompt: '你是一个专业的AI提示词分析专家。用户会给你从全网搜索到的提示词相关文章内容。你需要：1.筛选出真正有价值的提示词框架和方法论 2.提炼出通用的提示词结构模板 3.总结关键的提示词写作技巧 4.剔除广告和无效信息 5.用结构化的方式呈现分析结果。输出格式：先给出总结，再分点列出提炼的框架和技巧，最后给出可直接使用的提示词模板。',
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const json = JSON.parse(data);
              const text = json.content || '';
              fullText += text;
              setAnalysisResult(fullText);
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error('Analyze failed:', err);
      setAnalysisResult('分析失败，请重试');
    } finally {
      setAnalyzing(false);
    }
  };

  // Save analysis to knowledge base
  const saveAnalysisToKnowledge = async () => {
    try {
      await fetch('/api/prompt-knowledge', {
        method: 'POST', headers,
        body: JSON.stringify({
          name: `全网检索分析 - ${searchQuery}`,
          content: analysisResult,
          source: searchResults.map(r => r.url || r.site_name || '').filter(Boolean).join(', '),
          tags: '全网检索,AI分析',
          project_id: effectiveProjectId,
          library_id: currentLibraryId,
        }),
      });
      loadKnowledge();
      setShowAnalysisModal(false);
    } catch (err) { console.error('Save to knowledge failed:', err); }
  };

  // Adopt search result with analysis
  const adoptSearchResult = async (result: SearchResult, index: number) => {
    setAdoptingIndex(index);
    try {
      // Use the snippet/content as the prompt content
      let promptContent = result.snippet || result.content || '';
      // If too short, try to extract useful parts
      if (promptContent.length < 20) {
        promptContent = result.title + ' - ' + promptContent;
      }
      const catId = searchCategory ? (categories.find(c => c.name.includes(searchCategory) && c.type === 1)?.id || 0) : 0;
      await fetch('/api/prompt-atoms', {
        method: 'POST', headers,
        body: JSON.stringify({
          name: (result.title || '来自网络').slice(0, 50),
          content: promptContent,
          category_id: catId,
          project_id: effectiveProjectId,
          library_id: currentLibraryId,
          source: result.url,
        }),
      });
      loadAtoms();
      setAdoptedSet(prev => new Set(prev).add(index));
    } catch (err) { console.error('Adopt failed:', err); }
    finally { setAdoptingIndex(null); }
  };

  // Adopt all search results
  const adoptAllResults = async () => {
    for (let i = 0; i < searchResults.length; i++) {
      if (!adoptedSet.has(i)) {
        await adoptSearchResult(searchResults[i], i);
      }
    }
  };

  // Export
  const handleExport = () => {
    setExportSelection({ atoms: true, packages: true, templates: true, categories: true });
    setShowExportModal(true);
  };

  const doExport = async () => {
    try {
      if (exportMode === 'library') {
        // Library export: all content + library metadata
        const params = new URLSearchParams({ type: 'atoms,packages,templates,categories' });
        if (currentLibraryId) params.set('libraryId', String(currentLibraryId));
        else params.set('projectId', effectiveProjectId);
        const res = await fetch(`/api/prompt-export?${params}`, { headers });
        const data = await res.json();
        const lib = libraries.find(l => l.id === currentLibraryId);
        data.libraryInfo = { name: lib?.name || '未命名库', description: lib?.description || '', isLibraryExport: true };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `提示词库-${lib?.name || 'export'}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Pack export: selective
        const types = [];
        if (exportSelection.atoms) types.push('atoms');
        if (exportSelection.packages) types.push('packages');
        if (exportSelection.templates) types.push('templates');
        if (types.length === 0) { alert('请至少选择一项导出内容'); return; }
        const params = new URLSearchParams({ type: types.join(',') });
        if (currentLibraryId) params.set('libraryId', String(currentLibraryId));
        else params.set('projectId', effectiveProjectId);
        const res = await fetch(`/api/prompt-export?${params}`, { headers });
        const data = await res.json();
        if (!exportSelection.categories) delete data.categories;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `提示词包-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setShowExportModal(false);
    } catch { alert('导出失败'); }
  };

  // Import
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.version) { alert('无效的文件'); return; }
      // Auto-detect library vs pack import
      const isLib = !!(data as Record<string, unknown>).libraryInfo;
      setImportMode(isLib ? 'library' : 'pack');
      setImportPreviewData(data);
      setImportSelection({ atoms: true, packages: true, templates: true, categories: true });
      setShowImportModal(true);
    } catch { alert('文件格式不正确'); }
    if (importFileRef.current) importFileRef.current.value = '';
  };

  const doImport = async () => {
    if (!importPreviewData) return;
    try {
      const filteredData: Record<string, unknown> = { version: importPreviewData.version };
      if (importSelection.categories && (importPreviewData as Record<string, unknown>).categories) filteredData.categories = (importPreviewData as Record<string, unknown>).categories;
      if (importSelection.atoms && (importPreviewData as Record<string, unknown>).atoms) filteredData.atoms = (importPreviewData as Record<string, unknown>).atoms;
      if (importSelection.packages && (importPreviewData as Record<string, unknown>).packages) filteredData.packages = (importPreviewData as Record<string, unknown>).packages;
      if (importSelection.templates && (importPreviewData as Record<string, unknown>).templates) filteredData.templates = (importPreviewData as Record<string, unknown>).templates;
      if ((importPreviewData as Record<string, unknown>).templateVars) filteredData.templateVars = (importPreviewData as Record<string, unknown>).templateVars;

      let targetLibraryId = currentLibraryId;

      if (importMode === 'library') {
        // Library import: create a new library first
        const libInfo = (importPreviewData as Record<string, unknown>).libraryInfo as { name?: string; description?: string } | undefined;
        const newLibRes = await fetch('/api/prompt-libraries', {
          method: 'POST', headers,
          body: JSON.stringify({ projectId: effectiveProjectId, name: libInfo?.name || '导入的提示词库', description: libInfo?.description || '' }),
        });
        const newLib = await newLibRes.json();
        const createdLib = newLib.data || newLib.library || (newLib.id ? newLib : null);
        if (createdLib?.id) {
          targetLibraryId = createdLib.id;
          await loadLibraries();
          setCurrentLibraryId(Number(createdLib.id));
        }
      }

      const res = await fetch('/api/prompt-export', {
        method: 'POST', headers,
        body: JSON.stringify({ projectId: effectiveProjectId, libraryId: targetLibraryId, data: filteredData }),
      });
      const json = await res.json();
      if (json.success) {
        alert(importMode === 'library' 
          ? `提示词库导入成功！已创建新库，分类:${json.imported.categories} 原子词:${json.imported.atoms} 词包:${json.imported.packages} 模板:${json.imported.templates}`
          : `提示词包导入成功！分类:${json.imported.categories} 原子词:${json.imported.atoms} 词包:${json.imported.packages} 模板:${json.imported.templates}`);
        loadCategories(); loadAtoms(); loadPackages(); loadTemplates();
        setShowImportModal(false);
        setImportPreviewData(null);
      } else { alert('导入失败: ' + (json.error || '')); }
    } catch { alert('导入失败，文件格式不正确'); }
  };

  // Version management
  const createVersion = async () => {
    if (!currentLibraryId) return;
    try {
      await fetch('/api/prompt-versions', {
        method: 'POST', headers,
        body: JSON.stringify({ libraryId: currentLibraryId, versionName: versionName || `版本 ${new Date().toLocaleString()}` }),
      });
      setVersionName('');
      loadVersions();
    } catch {}
  };

  const restoreVersion = async (versionId: number) => {
    setConfirmDialog({
      title: '恢复历史版本',
      message: '恢复此版本将替换当前所有内容（会先自动备份），确认恢复？',
      onConfirm: async () => {
        setConfirmDialog(null);
        setRestoringVersion(true);
        try {
          await fetch('/api/prompt-versions', {
            method: 'PATCH', headers,
            body: JSON.stringify({ versionId }),
          });
          loadAtoms(); loadPackages(); loadTemplates(); loadVersions();
        } catch {}
        setRestoringVersion(false);
      },
    });
  };

  const deleteVersion = async (id: number) => {
    try {
      await fetch(`/api/prompt-versions?id=${id}`, { method: 'DELETE', headers });
      loadVersions();
    } catch {}
  };

  const handlePlanPrompts = async () => {
    if (!plannerBrief.trim() || plannerLoading) return;
    const plannerBaseUrl = (chatBaseUrl || imageBaseUrl || '').trim();
    const plannerApiKey = (chatApiKey || imageApiKey || '').trim();
    if (!plannerApiKey && !isLocalPromptEndpoint(plannerBaseUrl)) {
      setPlannerError('请先在左侧配置里设置对话模型 API Key，或配置本地模型地址。');
      return;
    }

    setPlannerLoading(true);
    setPlannerError('');
    setPlannerOutput('');

    const systemPrompt = `你是资深 AI 设计提示词策划师，擅长为 image2.0 / GPT Image / Nano Banana 等生图和图片编辑模型编写可直接使用的高质量提示词。
要求：
1. 先理解用户目标，但最终只输出可直接复制使用的提示词本体。
2. 提示词要具体、可执行，包含主体、画面结构、风格、材质、光线、色彩、构图、品质要求、负面约束。
3. 如果用户要求保留文字/素材/参考图约束，必须写成强约束。
4. 不要泛泛而谈，不要输出教程，不要输出“以下是”、用途、说明、亮点、解释、分隔线。
5. 绝对不要输出 [GENERATE:...] 格式。
6. 严格按格式输出，每个方案都用代码块包住提示词：
### 提示词 1｜短标题
\`\`\`prompt
这里写完整提示词
\`\`\``;

    const userMessage = [
      `用途：${plannerUseCase}`,
      `希望生成 ${plannerCount} 条提示词`,
      `输出语言：${plannerLanguage}`,
      plannerTone ? `风格/调性：${plannerTone}` : '',
      plannerConstraints ? `必须遵守的约束：${plannerConstraints}` : '',
      `用户需求：${plannerBrief}`,
    ].filter(Boolean).join('\n');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: userMessage,
          history: [],
          projectId: '',
          chatModel: chatModel || 'gpt-4o',
          apiKey: plannerApiKey || undefined,
          baseUrl: plannerBaseUrl || undefined,
          systemPrompt,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `策划失败（HTTP ${res.status}）`);
      }
      if (!res.body) throw new Error('策划响应为空');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            const text = parsed.content || '';
            if (text) {
              fullText += text;
              setPlannerOutput(fullText);
            }
          } catch (err) {
            if (err instanceof Error && err.message) throw err;
          }
        }
      }
      if (!fullText.trim()) setPlannerError('没有生成有效内容，请补充需求后重试。');
    } catch (err) {
      setPlannerError(err instanceof Error ? err.message : '提示词策划失败');
    } finally {
      setPlannerLoading(false);
    }
  };

  const copyPlannerPrompt = async (prompt: string, index: number) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedPlannerIndex(index);
    window.setTimeout(() => setCopiedPlannerIndex(null), 1200);
  };

  const addPlannerPromptToTest = (prompt: string) => {
    setTestPrompts((prev) => {
      if (prev.length === 1 && !prev[0].trim()) return [prompt];
      return [...prev, prompt];
    });
  };

  const savePlannerPrompt = async (prompt: string, index?: number) => {
    if (!effectiveProjectId) {
      setPlannerError('请先创建或选择一个项目，再保存到提示词库。');
      return;
    }
    if (!currentLibraryId) {
      setPlannerError('请先创建或选择提示词库，再执行入库。');
      return;
    }
    try {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt) {
        setPlannerError('提示词为空，无法入库。');
        return;
      }
      const res = await fetch('/api/prompt-atoms', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: cleanPrompt.slice(0, 30) || '策划提示词',
          content: cleanPrompt,
          category_id: 0,
          project_id: effectiveProjectId,
          library_id: currentLibraryId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '保存失败');
      }
      setPlannerError('');
      setSavedPlannerIndex(index ?? null);
      window.setTimeout(() => setSavedPlannerIndex(null), 1200);
      loadAtoms();
    } catch (err) {
      setPlannerError(err instanceof Error ? err.message : '保存到提示词库失败');
    }
  };

  // Test mode: generate images with prompts
  const handleReversePrompt = async () => {
    if (!reverseRefImage) return;
    setReverseGenerating(true);
    setReverseResult(null);
    try {
      const res = await fetch('/api/chat?analyze=true', {
        method: 'POST', headers,
        body: JSON.stringify({ message: '请分析这张图片，反推出可以用于生成类似图片的提示词。要求：1.描述图片的主体、风格、色彩、构图等关键要素 2.输出一份完整的英文提示词 3.再输出一份中文提示词翻译', referenceImageUrls: [reverseRefImage] }),
      });
      if (!res.ok) throw new Error('反推失败');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try { fullText += JSON.parse(data).content || ''; } catch {}
          }
        }
      }
      setReverseResult(fullText || '未能反推出提示词');
    } catch (e) {
      setReverseResult('反推失败，请重试');
    } finally {
      setReverseGenerating(false);
    }
  };

  const handleTestGenerate = async () => {
    const validPrompts = testPrompts.filter(p => p.trim());
    if (validPrompts.length === 0) return;

    setTestGenerating(true);
    const newResults: TestResult[] = validPrompts.map(p => ({ prompt: p, imageUrl: '', loading: true, score: 0, progress: 3, elapsedSec: 0 }));
    setTestResults(newResults);

    const runOne = async (prompt: string, i: number) => {
      const startTime = Date.now();
      const progressTimer = window.setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const maxTime = 120;
        setTestResults(prev => prev.map((r, idx) => idx === i ? {
          ...r,
          elapsedSec: Math.floor(elapsed),
          progress: Math.min(95, Math.max(r.progress, Math.round((elapsed / maxTime) * 100))),
        } : r));
      }, 700);

      try {
        const res = await fetch('/api/generate', {
          method: 'POST', headers,
          body: JSON.stringify({
            prompt,
            model: imageModel || 'gpt-image-2',
            size: testAspectRatio,
            imageSize: imageResolution,
            referenceImages: testRefImages,
            projectId: effectiveProjectId,
            apiKey: imageApiKey,
            baseUrl: imageBaseUrl,
          }),
        });
        window.clearInterval(progressTimer);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `生成失败（HTTP ${res.status}）`);
        const imageUrl = json.imageUrl || json.image_url || json.record?.image_url || json.record?.imageUrl;
        if (imageUrl) {
          setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, imageUrl, loading: false, progress: 100, elapsedSec: Math.floor((Date.now() - startTime) / 1000) } : r));
          await fetch('/api/prompt-test', {
            method: 'POST', headers,
            body: JSON.stringify({
              project_id: effectiveProjectId,
              reference_image_url: testRefImages.join(','),
              prompt,
              generated_image_url: imageUrl,
              score: 0, model: imageModel || 'gpt-image-2', aspect_ratio: testAspectRatio,
            }),
          });
        } else {
          setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, loading: false, progress: 100, error: '接口未返回图片地址' } : r));
        }
      } catch (err) {
        window.clearInterval(progressTimer);
        const message = err instanceof Error ? err.message : '生成失败，请重试';
        setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, loading: false, progress: 100, error: message } : r));
      }
    };

    await Promise.all(validPrompts.map((prompt, i) => runOne(prompt, i)));
    setTestGenerating(false);
    loadTestRecords();
  };

  const handleTestResultScore = async (index: number, score: number) => {
    setTestResults(prev => prev.map((r, idx) => idx === index ? { ...r, score } : r));
  };

  // Save test score to DB
  const saveTestScore = async (index: number) => {
    const result = testResults[index];
    if (!result || result.score === 0) return;
    // Find the most recent test record matching this prompt
    const matching = testRecords.find(r => r.prompt === result.prompt && !r.score);
    if (matching) {
      await fetch('/api/prompt-test', {
        method: 'PATCH', headers,
        body: JSON.stringify({ id: matching.id, score: result.score }),
      });
      loadTestRecords();
    }
  };

  // Add prompt from test to library
  const addToLibraryFromTest = async (prompt: string) => {
    try {
      await fetch('/api/prompt-atoms', {
        method: 'POST', headers,
        body: JSON.stringify({ name: prompt.slice(0, 30), content: prompt, category_id: 0, project_id: effectiveProjectId, library_id: currentLibraryId }),
      });
      loadAtoms();
    } catch {}
  };

  // Upload reference image
  const handleRefImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // For FormData uploads, don't set Content-Type header (browser sets multipart/form-data automatically)
    const uploadHeaders = { ...authHeaders };
    delete (uploadHeaders as Record<string, string>)['Content-Type'];
    for (let i = 0; i < Math.min(files.length, 2 - testRefImages.length); i++) {
      try {
        const formData = new FormData();
        formData.append('file', files[i]);
        const res = await fetch('/api/upload', { method: 'POST', headers: uploadHeaders, body: formData });
        const json = await res.json();
        if (json.url) {
          setTestRefImages(prev => [...prev, json.url]);
        } else if (json.error) {
          console.error('Upload failed:', json.error);
        }
      } catch (err) { console.error('Upload error:', err); }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addTestRefFromCanvas = (url: string) => {
    if (!url) return;
    setTestRefImages(prev => {
      if (prev.includes(url)) return prev;
      if (prev.length >= 2) return [...prev.slice(1), url];
      return [...prev, url];
    });
  };

  // Helpers
  const filteredCategories = categories.filter(c => activePage === 'templates' ? c.type === 2 : c.type === 1);
  const getCategoryName = (id: number) => {
    const find = (cats: Category[]): string => {
      for (const c of cats) { if (c.id === id) return c.name; if (c.children) { const found = find(c.children); if (found) return found; } }
      return '';
    };
    return find(categories) || '未分类';
  };
  const flattenCategories = (cats: Category[], depth = 0): { id: number; name: string; depth: number }[] => {
    const result: { id: number; name: string; depth: number }[] = [];
    for (const c of cats) { result.push({ id: c.id, name: c.name, depth }); if (c.children) result.push(...flattenCategories(c.children, depth + 1)); }
    return result;
  };
  const currentItems = activePage === 'atoms' ? atoms : activePage === 'packages' ? packages : activePage === 'templates' ? templates : activePage === 'knowledge' ? knowledgeItems : [];

  // Collect all unique tags from current items
  const allTags = Array.from(new Set(currentItems.flatMap(item => (item.tags || '').split(',').map(t => t.trim()).filter(Boolean))));

  // Sort and filter current items
  const sortedFilteredItems = React.useMemo(() => {
    let items = [...currentItems];
    // Filter by tag
    if (filterTag) {
      items = items.filter(item => {
        const tags = (item.tags || '').split(',').map(t => t.trim());
        return tags.includes(filterTag);
      });
    }
    // Sort
    items.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'use_count') cmp = (a.use_count || 0) - (b.use_count || 0);
      else cmp = 0; // created_at not available client-side, fall back to id
      if (cmp === 0) cmp = a.id - b.id;
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    return items;
  }, [currentItems, sortBy, sortOrder, filterTag]);

  const totalCount = atoms.length + packages.length + templates.length;
  const currentLibName = libraries.find(l => l.id === currentLibraryId)?.name || '提示词库';
  const plannedPromptCards = React.useMemo(() => extractPlannedPromptBlocks(plannerOutput), [plannerOutput]);

  // ─── Render: Category Panel (inside content area) ───
  const renderCategoryPanel = () => {
    const pageLabel = activePage === 'atoms' ? '原子词' : activePage === 'packages' ? '词包' : '提示词模板';
    const endpoint = activePage === 'atoms' ? 'prompt-atoms' : activePage === 'packages' ? 'prompt-packages' : 'prompt-templates';
    const handleItemDropToCategory = async (categoryId: number) => {
      if (!dragItemId) return;
      await fetch(`/api/${endpoint}`, { method: 'PATCH', headers, body: JSON.stringify({ id: dragItemId, category_id: categoryId }) });
      if (activePage === 'atoms') loadAtoms(); else if (activePage === 'packages') loadPackages(); else loadTemplates();
      setDragItemId(null);
      setItemDragOverCatId(null);
    };
    const handleCatDragStart = (e: React.DragEvent, catId: number) => {
      e.dataTransfer.setData('text/cat-id', String(catId));
      e.dataTransfer.effectAllowed = 'move';
    };
    const handleCatDragOver = (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? 'before' : 'after';
      setCatDragOver({ idx, pos });
    };
    const handleCatDrop = async (e: React.DragEvent, targetCatId: number) => {
      const srcCatId = Number(e.dataTransfer.getData('text/cat-id'));
      setCatDragOver(null);
      if (!srcCatId || srcCatId === targetCatId) return;
      // Reorder: move src category next to target
      const sorted = [...filteredCategories].sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const srcIdx = sorted.findIndex(c => c.id === srcCatId);
      if (srcIdx < 0) return;
      const [moved] = sorted.splice(srcIdx, 1);
      const targetIdx = sorted.findIndex(c => c.id === targetCatId);
      const insertIdx = catDragOver?.pos === 'after' ? targetIdx + 1 : targetIdx;
      sorted.splice(insertIdx, 0, moved);
      // Update sort orders
      for (let i = 0; i < sorted.length; i++) {
        const cat = sorted[i];
        if (cat.sort !== i) {
          await fetch(`/api/prompt-categories/${cat.id}`, { method: 'PATCH', headers, body: JSON.stringify({ sort: i }) });
        }
      }
      loadCategories();
    };
    return (
    <div className="w-56 border-l border-border/30 flex flex-col shrink-0 bg-background/50"
      onDragOver={e => { e.preventDefault(); }}
      onDrop={e => {
        e.preventDefault();
        // If dragging an item, drop to uncategorized
        if (dragItemId) { handleItemDropToCategory(0); }
        setItemDragOverCatId(null);
        setCatDragOver(null);
      }}>
      <div className="p-3 border-b border-border/30 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">分类筛选</span>
        <div className="flex items-center gap-1">
          <button onClick={() => { setEditingCategory(null); setCatFormName(''); setCatFormParentId(0); setCatFormType(activePage === 'templates' ? 2 : 1); setShowCategoryForm(!showCategoryForm); }} className="text-muted-foreground/40 hover:text-foreground" title="新建分类"><Plus className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {showCategoryForm && (
        <div className="p-3 border-b border-border/30 bg-muted/10 space-y-2">
          <input className="w-full bg-background border border-border/50 rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="分类名称" value={catFormName} onChange={e => setCatFormName(e.target.value)} />
          <NeutralSelect className="w-full bg-background border border-border/50 rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={catFormParentId} onChange={e => setCatFormParentId(Number(e.target.value))}>
            <option value={0}>一级分类</option>
            {flattenCategories(filteredCategories).map(c => (<option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.name}</option>))}
          </NeutralSelect>
          <div className="flex gap-2">
            <button onClick={saveCategory} className="flex-1 bg-primary text-primary-foreground text-xs py-1.5 rounded hover:bg-primary/90">保存</button>
            <button onClick={() => { setShowCategoryForm(false); setEditingCategory(null); }} className="flex-1 border border-border text-xs py-1.5 rounded hover:bg-muted/30">取消</button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {/* "All" button - drop target for uncategorized (item drag only) */}
        <div className={cn('w-full text-left py-2 px-3 rounded-md text-sm flex items-center gap-2 transition-colors cursor-pointer', !selectedCategoryId ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50', dragItemId && itemDragOverCatId === -1 && 'bg-primary/10 ring-2 ring-primary/30')}
          onClick={() => setSelectedCategoryId(null)}
          onDragOver={e => { if (dragItemId) { e.preventDefault(); setItemDragOverCatId(-1); } }}
          onDragLeave={() => setItemDragOverCatId(null)}
          onDrop={e => { e.preventDefault(); setItemDragOverCatId(null); handleItemDropToCategory(0); }}>
          <Layers className="w-3.5 h-3.5 shrink-0" /><span>全部</span>
          {dragItemId && itemDragOverCatId === -1 && <span className="text-[10px] text-primary ml-auto">松开移动</span>}
        </div>
        {filteredCategories.map((cat, catIdx) => (
          <div key={cat.id}>
            {/* Category reorder: insert line before this category */}
            {catDragOver && catDragOver.idx === catIdx && catDragOver.pos === 'before' && (
              <div className="h-[2px] bg-primary mx-2 rounded-full relative z-10">
                <div className="absolute -left-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
                <div className="absolute -right-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
              </div>
            )}
            <div className={cn('flex items-center group rounded-md transition-all', dragItemId && itemDragOverCatId === cat.id && 'bg-primary/10 ring-1 ring-primary/30')}
              draggable={!dragItemId}
              onDragStart={e => handleCatDragStart(e, cat.id)}
              onDragOver={e => {
                if (dragItemId) { e.preventDefault(); setItemDragOverCatId(cat.id); }
                else { handleCatDragOver(e, catIdx); }
              }}
              onDragLeave={() => { setItemDragOverCatId(null); if (catDragOver?.idx === catIdx) setCatDragOver(null); }}
              onDrop={e => {
                e.preventDefault(); e.stopPropagation();
                if (dragItemId) { setItemDragOverCatId(null); handleItemDropToCategory(cat.id); }
                else { handleCatDrop(e, cat.id); }
              }}>
              <button className={cn('flex-1 text-left py-2 px-3 rounded-md text-sm flex items-center gap-2 transition-colors cursor-grab active:cursor-grabbing', selectedCategoryId === cat.id ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50')} onClick={() => setSelectedCategoryId(selectedCategoryId === cat.id ? null : cat.id)}>
                {cat.children?.length ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" /> : <FolderPlus className="w-3.5 h-3.5 shrink-0 opacity-50" />}
                <span className="truncate">{cat.name}</span>
                <span className="text-[10px] text-muted-foreground/40 ml-auto">{cat.children?.length || 0}</span>
              </button>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                <button onClick={() => { setEditingCategory(null); setCatFormName(''); setCatFormParentId(cat.id); setCatFormType(activePage === 'templates' ? 2 : 1); setShowCategoryForm(true); }} className="p-0.5 text-muted-foreground hover:text-foreground" title="添加子分类"><Plus className="w-3 h-3" /></button>
                <button onClick={() => { setEditingCategory(cat); setCatFormName(cat.name); setCatFormParentId(0); setShowCategoryForm(true); }} className="p-0.5 text-muted-foreground hover:text-foreground"><Edit3 className="w-3 h-3" /></button>
                <button onClick={() => deleteCategory(cat.id)} className="p-0.5 text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
            {/* Category reorder: insert line after this category */}
            {catDragOver && catDragOver.idx === catIdx && catDragOver.pos === 'after' && (
              <div className="h-[2px] bg-primary mx-2 rounded-full relative z-10">
                <div className="absolute -left-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
                <div className="absolute -right-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
              </div>
            )}
            {/* Children always expanded */}
            {(cat.children?.length ?? 0) > 0 && (
              <div className="ml-4 space-y-0.5">
                {cat.children!.map((child, childIdx) => (
                  <div key={child.id}>
                    {/* Insert line before child */}
                    {catDragOver && catDragOver.idx === catIdx && catDragOver.pos === 'before-child' && catDragOver.childIdx === childIdx && (
                      <div className="h-[2px] bg-primary mx-2 rounded-full relative z-10">
                        <div className="absolute -left-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
                        <div className="absolute -right-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
                      </div>
                    )}
                    <div className={cn('flex items-center group rounded-md transition-all', dragItemId && itemDragOverCatId === child.id && 'bg-primary/10 ring-1 ring-primary/30')}
                      draggable={!dragItemId}
                      onDragStart={e => handleCatDragStart(e, child.id)}
                      onDragOver={e => {
                        if (dragItemId) { e.preventDefault(); setItemDragOverCatId(child.id); }
                        else {
                          e.preventDefault();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const pos = e.clientY < rect.top + rect.height / 2 ? 'before-child' : 'after-child';
                          setCatDragOver({ idx: catIdx, pos, childIdx });
                        }
                      }}
                      onDragLeave={() => { setItemDragOverCatId(null); if (catDragOver?.idx === catIdx) setCatDragOver(null); }}
                      onDrop={e => {
                        e.preventDefault(); e.stopPropagation();
                        if (dragItemId) { setItemDragOverCatId(null); handleItemDropToCategory(child.id); }
                        else { handleCatDrop(e, child.id); }
                      }}>
                      <button className={cn('flex-1 text-left py-1.5 px-3 rounded-md text-xs flex items-center gap-2 transition-colors cursor-grab active:cursor-grabbing', selectedCategoryId === child.id ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50')} onClick={() => setSelectedCategoryId(child.id)}>
                        <FolderPlus className="w-3 h-3 shrink-0 opacity-50" /><span className="truncate">{child.name}</span>
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                        <button onClick={() => { setEditingCategory(child); setCatFormName(child.name); setCatFormParentId(cat.id); setShowCategoryForm(true); }} className="p-0.5 text-muted-foreground hover:text-foreground"><Edit3 className="w-2.5 h-2.5" /></button>
                        <button onClick={() => deleteCategory(child.id)} className="p-0.5 text-muted-foreground hover:text-destructive"><Trash2 className="w-2.5 h-2.5" /></button>
                      </div>
                    </div>
                    {/* Insert line after child */}
                    {catDragOver && catDragOver.idx === catIdx && catDragOver.pos === 'after-child' && catDragOver.childIdx === childIdx && (
                      <div className="h-[2px] bg-primary mx-2 rounded-full relative z-10">
                        <div className="absolute -left-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
                        <div className="absolute -right-1 -top-[2px] w-[6px] h-[6px] rounded-full bg-primary" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Bottom hint */}
      {dragItemId && (
        <div className="px-3 py-2 border-t border-border/30 text-[10px] text-primary/60 text-center">
          拖拽{pageLabel}到分类上移动
        </div>
      )}
      {!dragItemId && (
        <div className="px-3 py-2 border-t border-border/30 text-[10px] text-muted-foreground/40 text-center">
          拖拽分类可调整顺序
        </div>
      )}
    </div>
  );
  };

  // ─── Render: Item Cards ───
  const renderAtomCard = (atom: Atom) => (
    <div key={atom.id} className={cn('group relative bg-card border border-border/50 rounded-lg p-4 hover:border-primary/30 transition-all cursor-pointer', selectedItems.has(atom.id) && 'border-primary/50 bg-primary/5', detailItem?.id === atom.id && 'ring-1 ring-primary/50')}
      draggable
      onDragStart={() => setDragItemId(atom.id)}
      onDragEnd={() => setDragItemId(null)}
      onClick={() => { if (selectedItems.size > 0) { setSelectedItems(prev => { const next = new Set(prev); next.has(atom.id) ? next.delete(atom.id) : next.add(atom.id); return next; }); } else { setDetailItem(atom); } }}>
      {atom.is_hot === 1 && <div className="absolute top-2 right-2"><Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" /></div>}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-medium text-foreground truncate">{atom.name}</h4>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={(e) => { e.stopPropagation(); openEditModal(atom); }} className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"><Edit3 className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete('atoms', atom.id); }} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{atom.content}</p>
      {/* Tags */}
      {(atom.tags || '').split(',').map(t => t.trim()).filter(Boolean).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {(atom.tags || '').split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
            <span key={i} className="text-[10px] bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">{getCategoryName(atom.category_id)}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5"><Eye className="w-3 h-3" />{atom.use_count}</span>
          <button onClick={(e) => { e.stopPropagation(); handleInsert(atom.content, 'atom', atom.id); }} className="text-[10px] text-primary hover:text-primary/80 font-medium flex items-center gap-0.5"><ArrowRight className="w-3 h-3" />插入</button>
        </div>
      </div>
    </div>
  );

  const renderPackageCard = (pkg: Pkg) => (
    <div key={pkg.id} className="group relative bg-card border border-border/50 rounded-lg p-4 hover:border-primary/30 transition-all cursor-pointer"
      draggable
      onDragStart={() => setDragItemId(pkg.id)}
      onDragEnd={() => setDragItemId(null)}
      onClick={() => { if (selectedItems.size > 0) { setSelectedItems(prev => { const next = new Set(prev); next.has(pkg.id) ? next.delete(pkg.id) : next.add(pkg.id); return next; }); } else { setDetailItem(pkg); } }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2"><Package className="w-4 h-4 text-primary/70 shrink-0" /><h4 className="text-sm font-medium text-foreground truncate">{pkg.name}</h4></div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={(e) => { e.stopPropagation(); openEditModal(pkg); }} className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"><Edit3 className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete('packages', pkg.id); }} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{pkg.content}</p>
      <div className="flex flex-wrap gap-1 mb-3">{pkg.atom_ids.split(',').filter(Boolean).map(aid => { const atom = atoms.find(a => a.id === Number(aid)); return (<span key={aid} className="text-[10px] bg-primary/10 text-primary/70 px-1.5 py-0.5 rounded">{atom ? atom.name : `#${aid}`}</span>); })}</div>
      {/* Tags */}
      {(pkg.tags || '').split(',').map(t => t.trim()).filter(Boolean).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {(pkg.tags || '').split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
            <span key={i} className="text-[10px] bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">{getCategoryName(pkg.category_id)}</span>
        <button onClick={(e) => { e.stopPropagation(); handleInsert(pkg.content, 'package', pkg.id); }} className="text-[10px] text-primary hover:text-primary/80 font-medium flex items-center gap-0.5"><ArrowRight className="w-3 h-3" />插入</button>
      </div>
    </div>
  );

  const renderTemplateCard = (tpl: Template) => (
    <div key={tpl.id} className="group relative bg-card border border-border/50 rounded-lg p-4 hover:border-primary/30 transition-all cursor-pointer"
      draggable
      onDragStart={() => setDragItemId(tpl.id)}
      onDragEnd={() => setDragItemId(null)}
      onClick={() => { if (selectedItems.size > 0) { setSelectedItems(prev => { const next = new Set(prev); next.has(tpl.id) ? next.delete(tpl.id) : next.add(tpl.id); return next; }); } else { setDetailItem(tpl); } }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground shrink-0" /><h4 className="text-sm font-medium text-foreground truncate">{tpl.name}</h4></div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={(e) => { e.stopPropagation(); openEditModal(tpl); }} className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"><Edit3 className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete('templates', tpl.id); }} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{tpl.content}</p>
      <div className="flex flex-wrap gap-1 mb-3">
        {tpl.model && <span className="text-[10px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded">{tpl.model}</span>}
        {tpl.aspect_ratio && <span className="text-[10px] bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded">{tpl.aspect_ratio}</span>}
        {tpl.vars.map(v => (<span key={v.var_key} className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">{'{'}{v.var_label}{'}'}</span>))}
      </div>
      {/* Tags */}
      {(tpl.tags || '').split(',').map(t => t.trim()).filter(Boolean).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {(tpl.tags || '').split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
            <span key={i} className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded">{getCategoryName(tpl.category_id)}</span>
        <button onClick={(e) => { e.stopPropagation(); if (tpl.vars.length > 0) { setFillTemplate(tpl); setVarValues(Object.fromEntries(tpl.vars.map(v => [v.var_key, v.default_value || '']))); } else { applyTemplate(tpl, {}); } }} className="text-[10px] text-primary hover:text-primary/80 font-medium flex items-center gap-0.5"><Zap className="w-3 h-3" />使用</button>
      </div>
    </div>
  );

  // ─── Render: Knowledge Card ───
  const renderKnowledgeCard = (item: any) => (
    <div key={item.id} className="group relative bg-card border border-border/50 rounded-lg p-4 hover:border-primary/30 transition-all cursor-pointer"
      onClick={() => setDetailItem(item)}
      onDoubleClick={() => setKnowledgePreview(item)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500/70 shrink-0" /><h4 className="text-sm font-medium text-foreground truncate">{item.name || '未命名'}</h4></div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={(e) => { e.stopPropagation(); setKnowledgePreview(item); }} className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary" title="预览"><Eye className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete('knowledge', item.id); }} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3 mb-2 whitespace-pre-wrap">{item.content || ''}</p>
      {item.source_url && (
        <a href={item.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="flex items-center gap-1 mb-2 hover:text-primary transition-colors">
          <ExternalLink className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          <span className="text-[10px] text-muted-foreground/60 truncate max-w-[200px] hover:text-primary">{(() => { try { return new URL(item.source_url).hostname; } catch { return item.source_url; } })()}</span>
        </a>
      )}
      {(item.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(item.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean).map((tag: string, i: number) => (
            <span key={i} className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );

  // ─── Render: Home Page (Search + Stats) ───
  const renderHomePage = () => {
    const atomStats = stats?.atom || { total: 0, items: {} };
    const pkgStats = stats?.package || { total: 0, items: {} };
    const tplStats = stats?.template || { total: 0, items: {} };
    const totalUses = atomStats.total + pkgStats.total + tplStats.total;

    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '原子词', count: atoms.length, icon: <Tag className="w-5 h-5" />, color: 'text-foreground', bg: 'bg-muted/70' },
              { label: '词包', count: packages.length, icon: <Package className="w-5 h-5" />, color: 'text-foreground', bg: 'bg-muted/70' },
              { label: '提示词模板', count: templates.length, icon: <FileText className="w-5 h-5" />, color: 'text-foreground', bg: 'bg-muted/70' },
              { label: '总调用次数', count: totalUses, icon: <TrendingUp className="w-5 h-5" />, color: 'text-foreground', bg: 'bg-muted/70' },
            ].map(card => (
              <div key={card.label} className="bg-card border border-border/50 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2"><div className={cn('p-2 rounded-lg', card.bg, card.color)}>{card.icon}</div><span className="text-sm text-muted-foreground">{card.label}</span></div>
                <div className="text-2xl font-bold text-foreground">{card.count}</div>
              </div>
            ))}
          </div>

          {/* Web Search */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-5 h-5 text-primary" />
              <h3 className="text-base font-semibold text-foreground">全网检索</h3>
              <span className="text-xs text-muted-foreground ml-2">搜索优质AI生图提示词并智能分析</span>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <input
                  className="w-full bg-muted/20 border border-border/50 rounded-lg pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="搜索优质AI生图提示词..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleWebSearch()}
                />
              </div>
              <NeutralSelect className="bg-muted/20 border border-border/50 rounded-lg px-3 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={searchCategory} onChange={e => setSearchCategory(e.target.value)}>
                <option value="">全部分类</option>
                {categories.filter(c => c.type === 1).map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
              </NeutralSelect>
              <button onClick={() => handleWebSearch()} disabled={searching} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-xs hover:bg-primary/90 disabled:opacity-50">
                {searching ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                {searching ? '搜索中...' : '搜索'}
              </button>
            </div>

            {searchSummary && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4">
                <div className="text-xs text-primary font-medium mb-1">AI 摘要</div>
                <p className="text-xs text-foreground/80 leading-relaxed">{searchSummary}</p>
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">找到 {searchResults.length} 条结果</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleWebSearch(true)} disabled={searching} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-50 transition-colors">
                      <RefreshCw className={`w-3 h-3 ${searching ? 'animate-spin' : ''}`} />换一批
                    </button>
                    <button onClick={analyzeSearchResults} disabled={analyzing} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-50 transition-colors">
                      <Zap className="w-3 h-3" />{analyzing ? '分析中...' : '智能分析'}
                    </button>
                  </div>
                </div>
                {searchResults.map((result, i) => (
                  <div key={i} className="bg-muted/10 border border-border/30 rounded-lg p-4 hover:border-primary/30 transition-all group">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-medium text-foreground truncate">{result.title}</h4>
                          {result.url && (
                            <a
                              href={result.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                              title="打开原链接"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          {result.site_name && <span className="text-[10px] text-muted-foreground/50">{result.site_name}</span>}
                          {result.url && (
                            <a
                              href={result.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-primary/40 hover:text-primary/70 truncate max-w-[200px] transition-colors"
                            >
                              {(() => { try { return new URL(result.url).hostname; } catch { return result.url; } })()}
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{result.snippet}</p>
                      </div>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        <button
                          onClick={async () => {
                            const next = new Set(favSet);
                            if (next.has(i)) {
                              next.delete(i);
                              setFavSet(next);
                            } else {
                              // Save to knowledge base on favorite
                              try {
                                await fetch('/api/prompt-knowledge', {
                                  method: 'POST',
                                  headers,
                                  body: JSON.stringify({
                                    name: result.title,
                                    content: result.snippet || result.title,
                                    source_url: result.url || '',
                                    category: searchCategory || '全网检索',
                                    project_id: projectId,
                                    library_id: currentLibraryId || undefined,
                                  }),
                                });
                                next.add(i);
                                setFavSet(next);
                              } catch {
                                // Still mark as favorite even if save fails
                                next.add(i);
                                setFavSet(next);
                              }
                            }
                          }}
                          className={`text-[10px] px-2.5 py-1.5 rounded flex items-center gap-1 transition-all ${favSet.has(i) ? 'text-rose-400 bg-rose-500/10 hover:bg-rose-500/20' : 'text-muted-foreground hover:text-rose-400 bg-muted/20 hover:bg-rose-500/10'}`}
                        >
                          <Heart className={`w-3 h-3 ${favSet.has(i) ? 'fill-current' : ''}`} />{favSet.has(i) ? '已收藏' : '收藏'}
                        </button>
                        <button
                          onClick={() => analyzeSearchResults()}
                          disabled={analyzing}
                          className="text-[10px] px-2.5 py-1.5 rounded flex items-center gap-1 transition-all text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20"
                        >
                          {analyzing ? <><RotateCcw className="w-3 h-3 animate-spin" />分析中</> : <><Zap className="w-3 h-3" />分析</>}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!searching && searchResults.length === 0 && !searchQuery && (
              <div className="text-center py-8 text-muted-foreground/30">
                <Globe className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-xs">输入关键词搜索全网优质提示词</p>
              </div>
            )}
          </div>

          {/* Usage Heatmap */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { title: '原子词热度', data: atomStats, items: atoms },
              { title: '词包热度', data: pkgStats, items: packages },
              { title: '模板热度', data: tplStats, items: templates },
            ].map(section => {
              const maxCount = Math.max(...Object.values(section.data.items), 1);
              return (
                <div key={section.title} className="bg-card border border-border/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">{section.title}</h3>
                  <div className="space-y-2">
                    {Object.entries(section.data.items).sort(([, a], [, b]) => b - a).slice(0, 5).map(([id, count]) => {
                      const item = section.items.find(i => String(i.id) === id);
                      if (!item) return null;
                      return (
                        <div key={id} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground truncate flex-1">{item.name}</span>
                          <div className="w-24 h-1.5 bg-muted/30 rounded-full overflow-hidden"><div className="h-full bg-primary/60 rounded-full" style={{ width: `${(count / maxCount) * 100}%` }} /></div>
                          <span className="text-[10px] text-muted-foreground/60 w-6 text-right">{count}</span>
                        </div>
                      );
                    })}
                    {Object.keys(section.data.items).length === 0 && <p className="text-xs text-muted-foreground/40 text-center py-4">暂无使用数据</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Lab Page (Test) ───
  const renderLabPage = () => (
      <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Prompt Planner */}
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-5 h-5 text-amber-500" />
            <h3 className="text-base font-semibold text-foreground">提示词策划</h3>
            <span className="text-xs text-muted-foreground ml-2">写需求，自动策划可直接测试和入库的提示词</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5">
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">你想做什么</label>
                <textarea
                  value={plannerBrief}
                  onChange={e => setPlannerBrief(e.target.value)}
                  placeholder="例如：帮我写一组适合科技峰会主视觉海报的生图提示词，画面要高级、通透、有AI科技感，不要太花。"
                  className="w-full h-28 bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">用途</label>
                  <NeutralSelect value={plannerUseCase} onChange={e => setPlannerUseCase(e.target.value)} className="w-full bg-muted/20 border border-border/50 rounded-md px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                    {['AI生图','图片编辑','PPT美化','海报KV','品牌视觉','产品图','社媒配图','电商图','其他'].map(item => <option key={item} value={item}>{item}</option>)}
                  </NeutralSelect>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">生成数量</label>
                  <NeutralSelect value={plannerCount} onChange={e => setPlannerCount(Number(e.target.value))} className="w-full bg-muted/20 border border-border/50 rounded-md px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                    {[1,2,3,4,6].map(n => <option key={n} value={n}>{n} 条</option>)}
                  </NeutralSelect>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">输出语言</label>
                  <NeutralSelect value={plannerLanguage} onChange={e => setPlannerLanguage(e.target.value)} className="w-full bg-muted/20 border border-border/50 rounded-md px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                    {['中文','英文','中英双语'].map(item => <option key={item} value={item}>{item}</option>)}
                  </NeutralSelect>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">风格/调性</label>
                  <input value={plannerTone} onChange={e => setPlannerTone(e.target.value)} placeholder="高级、通透、极简、商业..." className="w-full bg-muted/20 border border-border/50 rounded-md px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">必须遵守的约束</label>
                <textarea value={plannerConstraints} onChange={e => setPlannerConstraints(e.target.value)} placeholder="例如：不要出现文字；不要照搬参考图元素；保留原稿文字；不要低清晰度。" className="w-full h-20 bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>
              <button onClick={handlePlanPrompts} disabled={plannerLoading || !plannerBrief.trim()} className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-xs hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                {plannerLoading ? <><RotateCcw className="w-3.5 h-3.5 animate-spin" />正在策划...</> : <><Wand2 className="w-3.5 h-3.5" />生成提示词方案</>}
              </button>
              {plannerError && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{plannerError}</div>}
            </div>

            <div className="min-h-[320px]">
              {plannerOutput ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">策划结果 · {plannedPromptCards.length} 条</div>
                    <button onClick={() => setPlannerOutput('')} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" />清空</button>
                  </div>
                  <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                    {plannedPromptCards.map((prompt, i) => (
                      <div key={i} className="rounded-xl border border-border/40 bg-muted/10 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-xs font-medium text-foreground">提示词方案 {i + 1}</div>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => copyPlannerPrompt(prompt, i)} className="px-2 py-1 rounded-md border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 flex items-center gap-1">{copiedPlannerIndex === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copiedPlannerIndex === i ? '已复制' : '复制'}</button>
                            <button onClick={() => addPlannerPromptToTest(prompt)} className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-[10px] text-primary hover:bg-primary/15">放入测试</button>
                            <button onClick={() => onInsertPrompt(prompt)} className="px-2 py-1 rounded-md border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30">插入画布</button>
                            <button onClick={() => savePlannerPrompt(prompt, i)} className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-[10px] hover:bg-primary/90">{savedPlannerIndex === i ? '已入库' : '入库'}</button>
                          </div>
                        </div>
                        <pre className="whitespace-pre-wrap break-words rounded-lg bg-background/70 border border-border/30 p-3 text-[11px] leading-relaxed text-foreground font-sans">{prompt}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[320px] rounded-xl border border-dashed border-border/50 bg-muted/10 flex flex-col items-center justify-center text-center px-8">
                  <Code className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-foreground font-medium">先写需求，再让 AI 帮你策划提示词</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">生成后可以一键复制、放入测试、插入画布输入框或保存到提示词库。</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Image Reverse Prompt */}
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">反推提示词</h3>
            <span className="text-xs text-muted-foreground ml-2">上传图片或从画布选择，AI反推生成提示词</span>
          </div>
          <div className="flex items-start gap-6">
            <div className="shrink-0">
              <div className="text-xs text-muted-foreground mb-2">参考图片</div>
              <div className="flex gap-2">
                {reverseRefImage && (
                  <div className="relative w-28 h-28 rounded-lg overflow-hidden border border-border/50">
                    <img src={reverseRefImage} alt="反推参考图" className="w-full h-full object-cover" />
                    <button onClick={() => setReverseRefImage(null)} className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-full text-white"><X className="w-3 h-3" /></button>
                  </div>
                )}
                {!reverseRefImage && (
                  <div className="flex gap-2">
                    <button onClick={() => reverseFileRef.current?.click()} className="w-28 h-28 rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 hover:text-muted-foreground hover:border-primary/30 transition-colors">
                      <Upload className="w-5 h-5" />
                      <span className="text-[10px]">上传图片</span>
                    </button>
                    <button onClick={() => setReverseCanvasPicker(true)} className="w-28 h-28 rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 hover:text-muted-foreground hover:border-border-secondary transition-colors">
                      <ImageIcon className="w-5 h-5" />
                      <span className="text-[10px]">从画布选择</span>
                    </button>
                  </div>
                )}
              </div>
              <input ref={reverseFileRef} type="file" accept="image/*" className="hidden" onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setReverseRefImage(ev.target?.result as string);
                reader.readAsDataURL(file);
              }} />
            </div>
            <div className="flex-1">
              {reverseResult ? (
                <div className="space-y-3">
                  <div className="bg-muted/20 border border-border/40 rounded-lg p-3">
                    <p className="text-xs text-foreground whitespace-pre-wrap">{reverseResult}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setReverseImportLibId(currentLibraryId); setShowReverseImportModal(true); }} className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-xs hover:bg-primary/90">
                      <Plus className="w-3 h-3" />导入到提示词库
                    </button>
                    <button onClick={() => { setReverseResult(null); }} className="flex items-center gap-1 border border-border px-3 py-1.5 rounded-md text-xs hover:bg-muted/30">
                      <RotateCcw className="w-3 h-3" />重新反推
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={handleReversePrompt} disabled={!reverseRefImage || reverseGenerating} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-md text-xs hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                  {reverseGenerating ? <><RotateCcw className="w-3.5 h-3.5 animate-spin" />分析中...</> : <><Wand2 className="w-3.5 h-3.5" />开始反推</>}
                </button>
              )}
            </div>
          </div>
          {/* Canvas image picker modal */}
          {reverseCanvasPicker && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setReverseCanvasPicker(false)}>
              <div className="bg-card rounded-xl p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-foreground">从画布选择图片</h4>
                  <button onClick={() => setReverseCanvasPicker(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                </div>
                {canvasImages && canvasImages.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {canvasImages.map((img: any) => (
                      <button key={img.id} onClick={() => { setReverseRefImage(img.image_url); setReverseCanvasPicker(false); }} className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-border-secondary transition-colors">
                        <img src={img.image_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground/40 text-xs">画布上暂无图片</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Prompt Testing */}
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <FlaskConical className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-foreground">提示词实验室</h3>
            <span className="text-xs text-muted-foreground ml-2">上传参考图，用不同提示词测试生图效果并打分</span>
          </div>

          {/* Reference Images (up to 2) */}
          <div className="flex items-start gap-6 mb-5">
            <div className="shrink-0">
              <div className="text-xs text-muted-foreground mb-2">参考图（最多2张）</div>
              <div className="flex gap-2">
                {testRefImages.map((img, i) => (
                  <div key={i} className="relative w-28 h-28 rounded-lg overflow-hidden border border-border/50">
                    <img src={img} alt={`参考图${i + 1}`} className="w-full h-full object-cover" />
                    <button onClick={() => setTestRefImages(prev => prev.filter((_, j) => j !== i))} className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-full text-white"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                {testRefImages.length < 2 && (
                  <>
                    <button onClick={() => fileInputRef.current?.click()} className="w-28 h-28 rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 hover:text-muted-foreground hover:border-primary/30 transition-colors">
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-[10px]">上传参考图</span>
                    </button>
                    <button onClick={() => setTestCanvasPicker(true)} className="w-28 h-28 rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 hover:text-muted-foreground hover:border-border-secondary transition-colors">
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-[10px]">从画布选择</span>
                    </button>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleRefImageUpload} />
              {testCanvasPicker && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setTestCanvasPicker(false)}>
                  <div className="bg-card rounded-xl p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-semibold text-foreground">选择实验室参考图</h4>
                      <button onClick={() => setTestCanvasPicker(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                    </div>
                    {canvasImages && canvasImages.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {canvasImages.map((img: any) => (
                          <button key={img.id} onClick={() => { addTestRefFromCanvas(img.image_url); setTestCanvasPicker(false); }} className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-border-secondary transition-colors">
                            <img src={img.image_url} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground/40 text-xs">画布上暂无图片</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground">测试提示词</div>
                <button onClick={() => setTestPrompts([...testPrompts, ''])} className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"><Plus className="w-3 h-3" />添加</button>
              </div>
              <div className="space-y-2">
                {testPrompts.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground/50 w-4 shrink-0">#{i + 1}</span>
                    <input
                      className="flex-1 bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="输入提示词..."
                      value={p}
                      onChange={e => setTestPrompts(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                    />
                    {testPrompts.length > 1 && (
                      <button onClick={() => setTestPrompts(prev => prev.filter((_, j) => j !== i))} className="p-1 text-muted-foreground/40 hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <NeutralSelect value={testAspectRatio} onChange={e => setTestAspectRatio(e.target.value)} className="bg-muted/20 border border-border/50 rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                  {['1:1','16:9','9:16','4:3','3:4','3:2','2:3'].map(r => <option key={r} value={r}>{r}</option>)}
                </NeutralSelect>
                <button onClick={handleTestGenerate} disabled={testGenerating || testPrompts.filter(p => p.trim()).length === 0} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-md text-xs hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                  {testGenerating ? <><RotateCcw className="w-3.5 h-3.5 animate-spin" />生成中...</> : <><Play className="w-3.5 h-3.5" />开始测试</>}
                </button>
              </div>
              {testGenerating && <p className="mt-2 text-[10px] text-muted-foreground">正在并行生成 {testResults.filter((item) => item.loading).length} 张，完成后会自动显示结果。</p>}
            </div>
          </div>

          {/* Test Results */}
          {testResults.length > 0 && (
            <div className="border-t border-border/30 pt-4">
              <div className="text-xs text-muted-foreground mb-3">测试结果对比</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {testResults.map((result, i) => (
                  <div key={i} className="bg-muted/10 border border-border/30 rounded-lg overflow-hidden">
                    <div className="relative bg-muted/20" style={{ aspectRatio: ratioToCssValue(testAspectRatio) }}>
                      {result.loading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4">
                          <RotateCcw className="w-6 h-6 text-primary animate-spin" />
                          <div className="w-full max-w-28 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary/70 rounded-full transition-all duration-500" style={{ width: `${result.progress}%` }} />
                          </div>
                          <p className="text-[10px] text-muted-foreground">{result.progress}% · {result.elapsedSec}s</p>
                        </div>
                      ) : result.imageUrl ? (
                        <img src={result.imageUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
                      ) : result.error ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
                          <ImageIcon className="w-7 h-7 text-destructive/50" />
                          <p className="line-clamp-4 text-[10px] leading-relaxed text-destructive">{result.error}</p>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30"><ImageIcon className="w-8 h-8" /></div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-[10px] text-muted-foreground line-clamp-2 mb-2">{result.prompt}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <button key={s} onClick={() => handleTestResultScore(i, s)} className={cn('p-0.5', result.score >= s ? 'text-amber-500' : 'text-muted-foreground/30 hover:text-amber-400')}>
                              <Star className="w-3 h-3" fill={result.score >= s ? 'currentColor' : 'none'} />
                            </button>
                          ))}
                        </div>
                        {result.score > 0 && !result.loading && (
                          <button onClick={() => { saveTestScore(i); addToLibraryFromTest(result.prompt); }} className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"><Plus className="w-2.5 h-2.5" />入库</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* History Records */}
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">测试记录</h3>
            <span className="text-xs text-muted-foreground ml-2">共 {testRecords.length} 条</span>
          </div>
          {testRecords.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground/30 text-xs">暂无测试记录</div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {testRecords.map(record => (
                <div key={record.id} className="flex items-center gap-3 p-3 bg-muted/10 rounded-lg hover:bg-muted/20 transition-colors">
                  {record.reference_image_url && <img src={record.reference_image_url.split(',')[0]} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                  {record.generated_image_url && <img src={record.generated_image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{record.prompt}</p>
                    <p className="text-[10px] text-muted-foreground/50">{new Date(record.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} className={cn('w-3 h-3', record.score >= s ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground/20')} />
                    ))}
                  </div>
                  {record.score >= 4 && (
                    <button onClick={() => addToLibraryFromTest(record.prompt)} className="text-[10px] text-primary hover:text-primary/80 shrink-0">入库</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Render: Content Tab (atoms/packages/templates) ───
  // ─── TagInput Component ───
  const TagInput = ({ existingTags, onAddTag }: { existingTags: string[]; onAddTag: (tag: string) => void }) => {
    const [input, setInput] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const filtered = existingTags.filter(t => t.toLowerCase().includes(input.toLowerCase()) && t !== input);
    return (
      <div className="relative">
        <input className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary" placeholder="输入标签..." value={input} onChange={e => { setInput(e.target.value); setShowSuggestions(true); }} onKeyDown={e => { if (e.key === 'Enter' && input.trim()) { e.preventDefault(); onAddTag(input.trim()); setInput(''); setShowSuggestions(false); } }} onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} />
        {showSuggestions && filtered.length > 0 && (
          <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-card border border-border/50 rounded-lg shadow-xl max-h-32 overflow-y-auto">
            {filtered.map(tag => (<button key={tag} className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors" onMouseDown={() => { onAddTag(tag); setInput(''); setShowSuggestions(false); }}>{tag}</button>))}
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Detail Panel (gallery-style) ───
  const renderDetailPanel = () => {
    if (!detailItem) return null;
    const tags = (detailItem.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const isAtom = 'is_hot' in detailItem;
    const isPkg = 'atom_ids' in detailItem;
    const isTpl = 'vars' in detailItem;
    const isKnowledge = 'source' in detailItem && !isAtom && !isPkg && !isTpl;
    const typeLabel = isAtom ? '原子词' : isPkg ? '词包' : isKnowledge ? '知识条目' : '提示词模板';
    const endpoint = isAtom ? 'prompt-atoms' : isPkg ? 'prompt-packages' : isKnowledge ? 'prompt-knowledge' : 'prompt-templates';

    const updateTags = async (newTags: string) => {
      await fetch(`/api/${endpoint}`, { method: 'PATCH', headers, body: JSON.stringify({ id: detailItem.id, tags: newTags }) });
      if (isAtom) loadAtoms(); else if (isPkg) loadPackages(); else if (isKnowledge) loadKnowledge(); else loadTemplates();
      setDetailItem(prev => prev ? { ...prev, tags: newTags } : null);
    };

    const addTag = (tag: string) => {
      const current = (detailItem.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      if (!current.includes(tag)) { current.push(tag); updateTags(current.join(', ')); }
    };
    const removeTag = (tag: string) => {
      const current = (detailItem.tags || '').split(',').map(t => t.trim()).filter(Boolean).filter(t => t !== tag);
      updateTags(current.join(', '));
    };

    return (
      <div className="w-80 border-l border-border/30 flex flex-col shrink-0 bg-background/80 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">详情</span>
          <button onClick={() => setDetailItem(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Type badge */}
          <div className="flex items-center gap-2">
            <span className={cn('text-[10px] px-2 py-0.5 rounded font-medium', isAtom || isPkg || isKnowledge || isTpl ? 'bg-muted/70 text-muted-foreground' : 'bg-muted/70 text-muted-foreground')}>{typeLabel}</span>
            {isAtom && (detailItem as Atom).is_hot === 1 && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
          </div>
          {/* Name */}
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-0.5">名称</label>
            <p className="text-sm font-medium text-foreground">{detailItem.name}</p>
          </div>
          {/* Content */}
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-0.5">提示词内容</label>
            <div className="text-xs text-foreground/90 bg-muted/20 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">{detailItem.content}</div>
          </div>
          {/* Category */}
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-0.5">分类</label>
            <span className="text-xs bg-muted/30 text-muted-foreground px-2 py-1 rounded">{'category_id' in detailItem ? getCategoryName(detailItem.category_id) : '知识库'}</span>
          </div>
          {/* Package-specific: linked atoms */}
          {isPkg && (
            <div>
              <label className="text-[10px] text-muted-foreground/60 block mb-1">关联原子词</label>
              <div className="flex flex-wrap gap-1">
                {(detailItem as Pkg).atom_ids.split(',').filter(Boolean).map(aid => {
                  const atom = atoms.find(a => a.id === Number(aid));
                  return <span key={aid} className="text-[10px] bg-primary/10 text-primary/70 px-1.5 py-0.5 rounded">{atom ? atom.name : `#${aid}`}</span>;
                })}
              </div>
            </div>
          )}
          {/* Template-specific: model & ratio */}
          {isTpl && (
            <div className="flex gap-3">
              {(detailItem as Template).model && <div><label className="text-[10px] text-muted-foreground/60 block mb-0.5">模型</label><span className="text-xs bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded">{(detailItem as Template).model}</span></div>}
              {(detailItem as Template).aspect_ratio && <div><label className="text-[10px] text-muted-foreground/60 block mb-0.5">比例</label><span className="text-xs bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded">{(detailItem as Template).aspect_ratio}</span></div>}
            </div>
          )}
          {/* Template variables */}
          {isTpl && (detailItem as Template).vars.length > 0 && (
            <div>
              <label className="text-[10px] text-muted-foreground/60 block mb-1">模板变量</label>
              <div className="space-y-1">
                {(detailItem as Template).vars.map(v => (
                  <div key={v.var_key} className="text-xs bg-amber-500/10 text-amber-600 px-2 py-1 rounded flex items-center gap-1">
                    <Code className="w-3 h-3" />
                    <span className="font-medium">{v.var_label}</span>
                    {v.default_value && <span className="text-muted-foreground/50 ml-1">默认: {v.default_value.substring(0, 20)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Use count */}
          {'use_count' in detailItem && (
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-0.5">使用次数</label>
            <span className="text-xs text-foreground flex items-center gap-1"><Eye className="w-3 h-3 text-muted-foreground/50" />{detailItem.use_count}</span>
          </div>
          )}
          {/* Tags */}
          <div>
            <label className="text-[10px] text-muted-foreground/60 block mb-1">标签</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map(tag => (
                <span key={tag} className="text-[10px] bg-primary/10 text-primary/70 px-1.5 py-0.5 rounded flex items-center gap-0.5">{tag}<button onClick={() => removeTag(tag)} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button></span>
              ))}
            </div>
            <TagInput existingTags={allTags} onAddTag={addTag} />
          </div>
          {/* Actions */}
          <div className="pt-2 border-t border-border/30 space-y-2">
            {!isKnowledge && <button onClick={() => handleInsert(detailItem.content, isAtom ? 'atom' : isPkg ? 'package' : 'template', detailItem.id)} className="w-full text-xs bg-primary text-primary-foreground px-3 py-2 rounded-md hover:bg-primary/90 flex items-center justify-center gap-1.5"><ArrowRight className="w-3.5 h-3.5" />插入到对话框</button>}
            <div className="flex gap-2">
              <button onClick={() => { openEditModal(detailItem); }} className="flex-1 text-xs border border-border px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 flex items-center justify-center gap-1"><Edit3 className="w-3 h-3" />编辑</button>
              <button onClick={() => { handleDelete(isAtom ? 'atoms' : isPkg ? 'packages' : isKnowledge ? 'knowledge' : 'templates', detailItem.id); setDetailItem(null); }} className="flex-1 text-xs border border-border px-3 py-2 rounded-md text-muted-foreground hover:text-destructive hover:border-destructive/30 flex items-center justify-center gap-1"><Trash2 className="w-3 h-3" />删除</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderContentPage = () => {
    return (
      <div className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="px-6 py-3 border-b border-border/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                <input className="bg-muted/20 border border-border/30 rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary w-48" placeholder={`搜索${activePage === 'atoms' ? '原子词' : activePage === 'packages' ? '词包' : activePage === 'templates' ? '提示词模板' : '知识库'}...`} value={activePage === 'knowledge' ? knowledgeKeyword : keyword} onChange={e => activePage === 'knowledge' ? setKnowledgeKeyword(e.target.value) : setKeyword(e.target.value)} />
              </div>
              {/* Sort controls */}
              <NeutralSelect className="bg-muted/20 border border-border/30 rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={`${sortBy}-${sortOrder}`} onChange={e => { const [by, order] = e.target.value.split('-') as [typeof sortBy, typeof sortOrder]; setSortBy(by); setSortOrder(order); }}>
                <option value="use_count-desc">热度降序</option>
                <option value="use_count-asc">热度升序</option>
                <option value="name-asc">名称A-Z</option>
                <option value="name-desc">名称Z-A</option>
              </NeutralSelect>
              {/* Tag filter */}
              {allTags.length > 0 && (
                <NeutralSelect className="bg-muted/20 border border-border/30 rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={filterTag} onChange={e => setFilterTag(e.target.value)}>
                  <option value="">全部标签</option>
                  {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                </NeutralSelect>
              )}
              {sortedFilteredItems.length > 0 && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <button className="hover:text-foreground" onClick={() => { if (selectedItems.size === sortedFilteredItems.length) setSelectedItems(new Set()); else setSelectedItems(new Set(sortedFilteredItems.map(i => i.id))); }}>
                    {selectedItems.size === sortedFilteredItems.length ? '取消全选' : '全选'}
                  </button>
                  <span className="text-muted-foreground/40">|</span>
                  <span>共 {sortedFilteredItems.length} 条</span>
                  {selectedCategoryId && <span className="text-muted-foreground/40">· {getCategoryName(selectedCategoryId)}</span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedItems.size > 0 && (
                <button onClick={handleBatchInsert} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 flex items-center gap-1"><ArrowRight className="w-3 h-3" />批量插入({selectedItems.size})</button>
              )}
              <button onClick={() => setShowCategoryPanel(!showCategoryPanel)} className={cn('p-1.5 rounded-md transition-colors', showCategoryPanel ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30')} title="分类面板">
                <Layers className="w-4 h-4" />
              </button>
              <button onClick={openCreateModal} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-xs hover:bg-primary/90">
                <Plus className="w-3.5 h-3.5" />新建{activePage === 'atoms' ? '原子词' : activePage === 'packages' ? '词包' : activePage === 'templates' ? '提示词模板' : '知识条目'}
              </button>
            </div>
          </div>

          {/* Content grid */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {activePage === 'atoms' && sortedFilteredItems.map(item => renderAtomCard(item as Atom))}
              {activePage === 'packages' && sortedFilteredItems.map(item => renderPackageCard(item as Pkg))}
              {activePage === 'templates' && sortedFilteredItems.map(item => renderTemplateCard(item as Template))}
              {activePage === 'knowledge' && sortedFilteredItems.map(item => renderKnowledgeCard(item as { id: number; name: string; content: string; source: string; source_url?: string; tags: string; project_id: string; library_id: number | null; use_count?: number; created_at: string; updated_at: string }))}
            </div>
            {sortedFilteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
                <BookOpen className="w-12 h-12 mb-3" />
                <p className="text-sm">暂无{activePage === 'atoms' ? '原子词' : activePage === 'packages' ? '词包' : activePage === 'templates' ? '提示词模板' : '知识条目'}</p>
                <p className="text-xs mt-1">点击右上角按钮创建</p>
              </div>
            )}
          </div>
        </div>
        {/* Category panel */}
        {showCategoryPanel && renderCategoryPanel()}
        {/* Detail panel */}
        {detailItem && renderDetailPanel()}
      </div>
    );
  };

  // ─── Render: Version Panel ───
  const renderVersionPanel = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowVersionPanel(false)}>
      <div className="bg-background border border-border/50 rounded-xl w-[480px] max-h-[70vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <h3 className="text-sm font-semibold text-foreground">版本历史</h3>
          <button onClick={() => setShowVersionPanel(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 border-b border-border/30">
          <div className="flex items-center gap-2">
            <input className="flex-1 bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="版本名称..." value={versionName} onChange={e => setVersionName(e.target.value)} />
            <button onClick={createVersion} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-md text-xs hover:bg-primary/90"><Save className="w-3.5 h-3.5" />保存版本</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground/30 text-xs">暂无版本记录</div>
          ) : versions.map(v => (
            <div key={v.id} className="flex items-center gap-3 p-3 bg-muted/10 rounded-lg hover:bg-muted/20 transition-colors group">
              <Clock className="w-4 h-4 text-muted-foreground/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">{v.version_name}</p>
                <p className="text-[10px] text-muted-foreground/50">{new Date(v.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => restoreVersion(v.id)} disabled={restoringVersion} className="text-[10px] text-primary hover:text-primary/80 px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 disabled:opacity-50">恢复</button>
                <button onClick={() => deleteVersion(v.id)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ─── Main Render ───
  return (
    <div data-theme-scope="prompt-manager" className="prompt-manager h-full bg-app-canvas p-3">
      <div className="prompt-manager-shell flex h-full min-h-0 overflow-hidden rounded-[28px] border border-border/60 bg-app-panel shadow-app-card">
        {/* ─── Left Navigation Sidebar ─── */}
        <div className="prompt-manager-sidebar flex w-56 shrink-0 flex-col border-r border-border/50 bg-app-sidebar">
          {/* Back button */}
          <div className="p-3 border-b border-border/30">
            <button onClick={onGoBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-4 h-4 rotate-180" /><span>返回画布</span>
            </button>
          </div>

          {/* Library switcher */}
          <div className="p-3 border-b border-border/30">
            <div className="relative">
              <button onClick={() => setShowLibraryMenu(!showLibraryMenu)} className="w-full flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border/50 rounded-lg text-xs text-foreground hover:bg-muted/30 transition-colors">
                <Library className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1 truncate text-left">{currentLibName}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
              {showLibraryMenu && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border/50 rounded-lg shadow-xl z-20 max-h-60 overflow-y-auto">
                  {libraries.map(lib => (
                    <button key={lib.id} onClick={() => { setCurrentLibraryId(lib.id); setShowLibraryMenu(false); setSelectedCategoryId(null); }} className={cn('w-full text-left px-3 py-2 text-xs hover:bg-muted/30 flex items-center gap-2 transition-colors', lib.id === currentLibraryId ? 'bg-primary/10 text-primary' : 'text-foreground')}>
                      <Library className="w-3.5 h-3.5 shrink-0" />
                      <span className="flex-1 truncate">{lib.name}</span>
                      {lib.is_default === 1 && <span className="text-[10px] text-muted-foreground/50">默认</span>}
                    </button>
                  ))}
                  <div className="border-t border-border/30 p-2">
                    {showNewLibraryForm ? (
                      <div className="flex items-center gap-2">
                        <input className="flex-1 bg-muted/20 border border-border/50 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="库名称" value={newLibName} onChange={e => setNewLibName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createLibrary()} autoFocus />
                        <button onClick={createLibrary} disabled={creatingLibrary || !newLibName.trim()} className="text-[10px] text-primary hover:text-primary/80 disabled:opacity-50">{creatingLibrary ? '创建中' : '创建'}</button>
                        <button onClick={() => { setShowNewLibraryForm(false); setNewLibName(''); }} className="text-[10px] text-muted-foreground hover:text-foreground">取消</button>
                      </div>
                    ) : (
                      <button onClick={() => setShowNewLibraryForm(true)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-primary hover:text-primary/80">
                        <Plus className="w-3 h-3" />新建提示词库
                      </button>
                    )}
                  </div>
                  <div className="border-t border-border/30 p-2 space-y-0.5">
                    <div className="px-2 py-1 text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">提示词库</div>
                    <button onClick={() => { setShowLibraryMenu(false); setExportMode('library'); setShowExportModal(true); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
                      <Download className="w-3.5 h-3.5" />导出提示词库
                    </button>
                    <button onClick={() => { setShowLibraryMenu(false); setImportMode('library'); importFileRef.current?.click(); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
                      <Upload className="w-3.5 h-3.5" />导入提示词库
                    </button>
                    <div className="border-t border-border/20 my-1" />
                    <div className="px-2 py-1 text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">提示词包</div>
                    <button onClick={() => { setShowLibraryMenu(false); setExportMode('pack'); setShowExportModal(true); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
                      <Download className="w-3.5 h-3.5" />导出提示词包
                    </button>
                    <button onClick={() => { setShowLibraryMenu(false); setImportMode('pack'); importFileRef.current?.click(); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
                      <Upload className="w-3.5 h-3.5" />导入提示词包
                    </button>
                    <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
                    <div className="border-t border-border/20 my-1" />
                    <button onClick={() => { setShowLibraryMenu(false); setShowVersionPanel(true); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
                      <Clock className="w-3.5 h-3.5" />版本历史
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Navigation items */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {[
              { key: 'home' as NavPage, label: '首页', icon: <Home className="w-4 h-4" /> },
              { key: 'lab' as NavPage, label: '提示词实验室', icon: <FlaskConical className="w-4 h-4" /> },
              { key: 'atoms' as NavPage, label: '原子词', icon: <Tag className="w-4 h-4" />, count: atoms.length },
              { key: 'packages' as NavPage, label: '词包', icon: <Package className="w-4 h-4" />, count: packages.length },
              { key: 'templates' as NavPage, label: '提示词模板', icon: <FileText className="w-4 h-4" />, count: templates.length },
              { key: 'knowledge' as NavPage, label: '知识库', icon: <Lightbulb className="w-4 h-4" />, count: knowledgeItems.length },
            ].map(nav => (
              <button
                key={nav.key}
                data-active={activePage === nav.key}
                className={cn(
                  'prompt-manager-nav-item w-full text-left py-2.5 px-3 rounded-xl text-sm flex items-center gap-2.5 transition-colors',
                  activePage === nav.key ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
                onClick={() => { setActivePage(nav.key); setSelectedItems(new Set()); setSelectedCategoryId(null); }}
              >
                {nav.icon}
                <span className="flex-1">{nav.label}</span>
                {'count' in nav && nav.count !== undefined && <span className="text-[10px] text-muted-foreground/50">{nav.count}</span>}
              </button>
            ))}
          </div>

          {/* Bottom actions */}
          <div className="p-3 border-t border-border/30 space-y-1">
            <button onClick={() => setShowVersionPanel(true)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
              <Clock className="w-3.5 h-3.5" />版本历史
            </button>
            <button onClick={() => { setExportMode('pack'); handleExport(); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
              <Download className="w-3.5 h-3.5" />导出提示词包
            </button>
            <button onClick={() => { setImportMode('pack'); importFileRef.current?.click(); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors">
              <Upload className="w-3.5 h-3.5" />导入提示词包
            </button>
            {libraries.length > 1 && currentLibraryId && libraries.find(l => l.id === currentLibraryId)?.is_default !== 1 && (
              <button onClick={() => {
                setConfirmDialog({
                  title: '删除提示词库',
                  message: `确定要删除「${currentLibName}」及其所有内容吗？此操作不可撤销。`,
                  onConfirm: () => { setConfirmDialog(null); deleteLibrary(currentLibraryId); },
                });
              }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-destructive/60 hover:text-destructive hover:bg-destructive/10 rounded transition-colors">
                <Trash2 className="w-3.5 h-3.5" />删除当前库
              </button>
            )}
          </div>
        </div>

        {/* ─── Main Content Area ─── */}
        <div className="prompt-manager-main flex flex-1 min-w-0 flex-col bg-app-canvas p-4">
          <div className={WORKSPACE_SURFACE_CLASS} style={WORKSPACE_SURFACE_STYLE}>
            {/* Header */}
            <div className="prompt-manager-header flex items-center justify-between border-b border-border/40 bg-app-toolbar px-6 py-3 backdrop-blur">
              <h2 className="text-lg font-semibold text-foreground">{activePage === 'home' ? '提示词资产管理' : activePage === 'lab' ? '提示词实验室' : activePage === 'atoms' ? '原子词管理' : activePage === 'packages' ? '词包管理' : '提示词模板管理'}</h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Library className="w-3.5 h-3.5" />
                <span>{currentLibName}</span>
                <span className="text-muted-foreground/40">·</span>
                <span>{totalCount} 条</span>
              </div>
            </div>

            {/* Page content */}
            <div className="flex flex-1 min-h-0 flex-col bg-app-canvas">
              {activePage === 'home' && renderHomePage()}
              {activePage === 'lab' && renderLabPage()}
              {['atoms', 'packages', 'templates', 'knowledge'].includes(activePage) && renderContentPage()}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Version Panel Modal ─── */}
      {showVersionPanel && renderVersionPanel()}

      {/* ─── Create/Edit Modal ─── */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={closeModal}>
          <div className="bg-background border border-border/50 rounded-xl w-[560px] max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
              <h3 className="text-sm font-semibold text-foreground">{editItem ? '编辑' : '新建'}{activePage === 'atoms' ? '原子词' : activePage === 'packages' ? '词包' : activePage === 'templates' ? '提示词模板' : '知识条目'}</h3>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="text-xs text-muted-foreground mb-1 block">名称</label><input className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="输入名称..." value={formName} onChange={e => setFormName(e.target.value)} /></div>
              <div><label className="text-xs text-muted-foreground mb-1 block">提示词内容</label>
                {/* Variable insertion toolbar for templates */}
                {activePage === 'templates' && formVars.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    <span className="text-[10px] text-muted-foreground/50 py-0.5">插入变量：</span>
                    {formVars.filter(v => v.var_key).map((v, i) => (
                      <button key={i} onClick={() => { const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="输入提示词内容..."]'); if (textarea) { const start = textarea.selectionStart; const end = textarea.selectionEnd; const text = formContent; const before = text.substring(0, start); const after = text.substring(end); const catName = categories.find(c => c.id === parseInt(v.var_key))?.name || v.var_key; const insertion = `{{${catName}}}`; setFormContent(before + insertion + after); setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = start + insertion.length; textarea.focus(); }, 0); } }} className="text-[10px] bg-primary/10 text-primary/70 px-2 py-0.5 rounded hover:bg-primary/20 transition-colors cursor-pointer flex items-center gap-0.5">
                        <Code className="w-2.5 h-2.5" />{categories.find(c => c.id === parseInt(v.var_key))?.name || v.var_key}
                      </button>
                    ))}
                  </div>
                )}
                <textarea className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[100px] resize-y" placeholder="输入提示词内容..." value={formContent} onChange={e => setFormContent(e.target.value)} />
              </div>
              {activePage !== 'knowledge' && (<div>
                <label className="text-xs text-muted-foreground mb-1 block">分类</label>
                <NeutralSelect className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={formCategoryId} onChange={e => setFormCategoryId(Number(e.target.value))}>
                  <option value={0}>选择分类</option>
                  {flattenCategories(activePage === 'templates' ? categories.filter(c => c.type === 2) : categories.filter(c => c.type === 1)).map(c => (<option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.name}</option>))}
                </NeutralSelect>
              </div>)}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">标签 <span className="text-muted-foreground/40">(逗号分隔)</span></label>
                <input className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="标签1, 标签2, ..." value={formTags} onChange={e => setFormTags(e.target.value)} />
                {formTags && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {formTags.split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
                      <span key={i} className="text-[10px] bg-primary/10 text-primary/70 px-1.5 py-0.5 rounded flex items-center gap-0.5">{tag}<button onClick={() => setFormTags(formTags.split(',').map(s => s.trim()).filter((_, j) => j !== i).join(', '))} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button></span>
                    ))}
                  </div>
                )}
              </div>
              {activePage === 'packages' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">关联原子词</label>
                  {/* Selected atoms as tags */}
                  <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
                    {formAtomIds.split(',').filter(Boolean).map(aid => { const atom = atoms.find(a => a.id === Number(aid)); return atom ? (<span key={aid} className="text-[10px] bg-primary/10 text-primary/70 px-2 py-1 rounded flex items-center gap-1">{atom.name}<button onClick={() => setFormAtomIds(formAtomIds.split(',').map(s => s.trim()).filter(id => id !== String(aid)).join(','))} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button></span>) : null; })}
                  </div>
                  {/* Atom picker by category dropdown */}
                  <div className="border border-border/30 rounded-lg overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      {(() => {
                        const availableAtoms = atoms.filter(a => !formAtomIds.split(',').map(s => s.trim()).includes(String(a.id)));
                        const attrCats = categories.filter(c => c.type === 1);
                        const atomsByCat = attrCats.filter(c => c.parent_id === 0).map(cat => ({
                          cat,
                          catAtoms: availableAtoms.filter(a => a.category_id === cat.id),
                          subCats: attrCats.filter(sc => sc.parent_id === cat.id).map(sc => ({
                            sc,
                            scAtoms: availableAtoms.filter(a => a.category_id === sc.id),
                          })).filter(g => g.scAtoms.length > 0),
                        })).filter(g => g.catAtoms.length > 0 || g.subCats.length > 0);
                        return atomsByCat.map(({ cat, catAtoms, subCats }) => (
                          <div key={cat.id}>
                            <div className="px-3 py-1.5 bg-muted/30 text-[10px] font-medium text-muted-foreground sticky top-0">{cat.name}</div>
                            {catAtoms.map(a => (
                              <button key={a.id} className="w-full text-left px-5 py-2 text-xs hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between group" onClick={() => setFormAtomIds(formAtomIds ? `${formAtomIds},${a.id}` : String(a.id))}>
                                <span className="truncate">{a.name}</span>
                                <Plus className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary/60 shrink-0 ml-2" />
                              </button>
                            ))}
                            {subCats.map(({ sc, scAtoms }) => (
                              <div key={sc.id}>
                                <div className="px-5 py-1 text-[10px] text-muted-foreground/60">{sc.name}</div>
                                {scAtoms.map(a => (
                                  <button key={a.id} className="w-full text-left px-7 py-1.5 text-xs hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between group" onClick={() => setFormAtomIds(formAtomIds ? `${formAtomIds},${a.id}` : String(a.id))}>
                                    <span className="truncate">{a.name}</span>
                                    <Plus className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary/60 shrink-0 ml-2" />
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        ));
                      })()}
                      {atoms.filter(a => !formAtomIds.split(',').map(s => s.trim()).includes(String(a.id))).length === 0 && (
                        <div className="px-3 py-3 text-xs text-muted-foreground/40 text-center">没有可选的原子词</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {activePage === 'templates' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs text-muted-foreground mb-1 block">模型</label><input className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="gpt-image-2" value={formModel} onChange={e => setFormModel(e.target.value)} /></div>
                    <div><label className="text-xs text-muted-foreground mb-1 block">宽高比</label><input className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="16:9" value={formAspectRatio} onChange={e => setFormAspectRatio(e.target.value)} /></div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1"><label className="text-xs text-muted-foreground">模板变量</label><button onClick={() => setFormVars([...formVars, { var_key: '', var_label: '', var_type: 'atom', default_value: '', sub_category_id: null, sort: formVars.length }])} className="text-[10px] text-primary hover:text-primary/80">+ 添加变量</button></div>
                    {formVars.map((v, i) => {
                      const varCategories = categories.filter(c => c.type === 1 && c.parent_id === 0);
                      const subCategories = v.var_key ? categories.filter(c => c.type === 1 && c.parent_id === parseInt(v.var_key)) : [];
                      const defaultItems = v.var_type === 'package' 
                        ? packages.filter(p => !v.var_key || p.category_id === parseInt(v.var_key))
                        : atoms.filter(a => !v.var_key || a.category_id === parseInt(v.var_key) || a.category_id === v.sub_category_id);
                      return (
                      <div key={i} className="bg-muted/10 border border-border/30 rounded-lg p-3 mb-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground mb-0.5 block">变量名(一级分类)</label>
                            <NeutralSelect className="w-full bg-muted/20 border border-border/50 rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={v.var_key} onChange={e => { const next = [...formVars]; next[i] = { ...next[i], var_key: e.target.value, sub_category_id: null, default_value: '' }; setFormVars(next); }}>
                              <option value="">选择分类...</option>
                              {varCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </NeutralSelect>
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground mb-0.5 block">子变量(二级分类)</label>
                            <NeutralSelect className="w-full bg-muted/20 border border-border/50 rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={v.sub_category_id || ''} onChange={e => { const next = [...formVars]; next[i] = { ...next[i], sub_category_id: e.target.value ? parseInt(e.target.value) : null, default_value: '' }; setFormVars(next); }}>
                              <option value="">不限制</option>
                              {subCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </NeutralSelect>
                          </div>
                          <div className="w-24">
                            <label className="text-[10px] text-muted-foreground mb-0.5 block">类型</label>
                            <NeutralSelect className="w-full bg-muted/20 border border-border/50 rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={v.var_type} onChange={e => { const next = [...formVars]; next[i] = { ...next[i], var_type: e.target.value, default_value: '' }; setFormVars(next); }}>
                              <option value="atom">原子词</option>
                              <option value="package">词包</option>
                            </NeutralSelect>
                          </div>
                          <button onClick={() => setFormVars(formVars.filter((_, j) => j !== i))} className="mt-4 text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground mb-0.5 block">默认值</label>
                          <NeutralSelect className="w-full bg-muted/20 border border-border/50 rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={v.default_value} onChange={e => { const next = [...formVars]; next[i] = { ...next[i], default_value: e.target.value }; setFormVars(next); }}>
                            <option value="">选择默认值(可选)</option>
                            {defaultItems.map(item => <option key={item.id} value={item.content}>{item.name}</option>)}
                          </NeutralSelect>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                          <Code className="w-3 h-3" />
                          <span>插入: {'{{'}{v.var_key ? categories.find(c => c.id === parseInt(v.var_key))?.name || v.var_key : '...'}{'}}'}</span>
                        </div>
                      </div>
                      );
                    })}
                    <p className="text-[10px] text-muted-foreground/40">变量名对应一级分类，使用时在对话框点击变量可选择具体提示词</p>
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border/30 flex justify-end gap-2">
              <button onClick={closeModal} className="px-4 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30">取消</button>
              <button onClick={handleSave} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90">{editItem ? '保存' : '创建'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Template Variable Fill Modal ─── */}
      {fillTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setFillTemplate(null)}>
          <div className="bg-background border border-border/50 rounded-xl w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
              <h3 className="text-sm font-semibold text-foreground">使用模板: {fillTemplate.name}</h3>
              <button onClick={() => setFillTemplate(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-xs text-muted-foreground bg-muted/20 rounded p-3 line-clamp-3">{fillTemplate.content}</div>
              {fillTemplate.vars.map(v => (
                <div key={v.var_key}>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                    {v.var_label}
                    {v.var_type === 'atom' && <Tag className="w-2.5 h-2.5 text-primary/50" />}
                    {v.var_type === 'package' && <Package className="w-2.5 h-2.5 text-muted-foreground/60" />}
                    {v.var_type === 'group' && <FolderPlus className="w-2.5 h-2.5 text-amber-500/50" />}
                  </label>
                  {(v.var_type === 'atom' || v.var_type === 'package' || v.var_type === 'group') ? (
                    <div className="flex gap-1.5">
                      <input className="flex-1 bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder={v.default_value || `请选择${v.var_label}...`} value={varValues[v.var_key] || ''} onChange={e => setVarValues(prev => ({ ...prev, [v.var_key]: e.target.value }))} readOnly={!!varValues[v.var_key]} />
                      <button onClick={() => {
                        const items = v.var_type === 'atom' ? atoms : v.var_type === 'package' ? packages : [];
                        const groupItems = v.var_type === 'group' ? categories.filter(c => c.type === 1 && c.parent_id === 0) : [];
                        const allItems = v.var_type === 'group' ? groupItems.map(c => ({ id: c.id, name: c.name, content: c.name })) : items;
                        if (allItems.length === 0) return;
                        const dropdown = document.getElementById(`var-dropdown-${v.var_key}`);
                        if (dropdown) { dropdown.classList.toggle('hidden'); }
                      }} className="px-2 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded-md flex items-center gap-1 shrink-0">
                        {v.var_type === 'atom' && <><Tag className="w-3 h-3" />选原子词</>}
                        {v.var_type === 'package' && <><Package className="w-3 h-3" />选词包</>}
                        {v.var_type === 'group' && <><FolderPlus className="w-3 h-3" />选分组</>}
                      </button>
                      {varValues[v.var_key] && <button onClick={() => setVarValues(prev => ({ ...prev, [v.var_key]: '' }))} className="px-1.5 text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>}
                      {/* Dropdown picker */}
                      <div id={`var-dropdown-${v.var_key}`} className="hidden absolute z-50 mt-1 bg-card border border-border/50 rounded-lg shadow-xl max-h-48 overflow-y-auto" style={{ width: 'calc(100% - 60px)' }}>
                        {(v.var_type === 'atom' ? atoms : v.var_type === 'package' ? packages : categories.filter(c => c.type === 1 && c.parent_id === 0).map(c => ({ id: c.id, name: c.name, content: c.name }))).map(item => (
                          <button key={item.id} className="w-full text-left px-3 py-2 text-xs hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors truncate" onClick={() => { setVarValues(prev => ({ ...prev, [v.var_key]: item.content })); const dd = document.getElementById(`var-dropdown-${v.var_key}`); if (dd) dd.classList.add('hidden'); }}>
                            {item.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <input className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder={v.default_value || `请输入${v.var_label}...`} value={varValues[v.var_key] || ''} onChange={e => setVarValues(prev => ({ ...prev, [v.var_key]: e.target.value }))} />
                  )}
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">预览</label>
                <div className="text-xs text-foreground bg-muted/20 border border-border/30 rounded p-3">
                  {fillTemplate.vars.reduce((text, v) => { const val = varValues[v.var_key] || v.default_value || `{${v.var_label}}`; return text.replace(new RegExp(`\\{\\{${v.var_key}\\}\\}`, 'g'), val); }, fillTemplate.content)}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-border/30 flex justify-end gap-2">
              <button onClick={() => setFillTemplate(null)} className="px-4 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30">取消</button>
              <button onClick={() => applyTemplate(fillTemplate, varValues)} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-1"><Zap className="w-3 h-3" />插入到输入框</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Confirm Dialog ─── */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirmDialog(null)}>
          <div className="bg-background border border-border/50 rounded-xl w-[400px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border/30">
              <h3 className="text-sm font-semibold text-foreground">{confirmDialog.title}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-muted-foreground">{confirmDialog.message}</p>
            </div>
            <div className="px-5 py-3 border-t border-border/30 flex justify-end gap-2">
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30">取消</button>
              <button onClick={() => confirmDialog.onConfirm()} className="px-4 py-1.5 text-xs bg-destructive text-white rounded-md hover:bg-destructive/90">确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Export Modal ─── */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowExportModal(false)}>
          <div className="bg-background border border-border/50 rounded-xl w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{exportMode === 'library' ? '导出提示词库' : '导出提示词包'}</h3>
              <button onClick={() => setShowExportModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {exportMode === 'library' ? (
                <p className="text-xs text-muted-foreground">将导出整个提示词库的所有内容（原子词、词包、提示词模板、分类体系），可作为完整的提示词库文件分享给他人。</p>
              ) : (
                <p className="text-xs text-muted-foreground">选择性导出部分提示词内容，可作为提示词包分享给他人导入到已有库中。</p>
              )}
              {exportMode === 'pack' && [
                { key: 'atoms' as const, label: '原子词', count: atoms.length },
                { key: 'packages' as const, label: '词包', count: packages.length },
                { key: 'templates' as const, label: '提示词模板', count: templates.length },
                { key: 'categories' as const, label: '分类体系', count: categories.length },
              ].map(item => (
                <label key={item.key} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportSelection[item.key]}
                    onChange={e => setExportSelection(prev => ({ ...prev, [item.key]: e.target.checked }))}
                    className="rounded border-border/50 accent-primary"
                  />
                  <span className="text-sm text-foreground flex-1">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.count} 条</span>
                </label>
              ))}
              {exportMode === 'library' && (
                <div className="space-y-1">
                  {[
                    { label: '原子词', count: atoms.length },
                    { label: '词包', count: packages.length },
                    { label: '提示词模板', count: templates.length },
                    { label: '分类体系', count: categories.length },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="text-foreground">{item.label}</span>
                      <span className="text-muted-foreground">{item.count} 条</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border/30 flex justify-end gap-2">
              <button onClick={() => setShowExportModal(false)} className="px-4 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30">取消</button>
              <button onClick={doExport} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-1"><Download className="w-3 h-3" />{exportMode === 'library' ? '导出提示词库' : '导出提示词包'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Import Modal ─── */}
      {showImportModal && importPreviewData && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowImportModal(false); setImportPreviewData(null); }}>
          <div className="bg-background border border-border/50 rounded-xl w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{importMode === 'library' ? '导入提示词库' : '导入提示词包'}</h3>
              <button onClick={() => { setShowImportModal(false); setImportPreviewData(null); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {importMode === 'library' ? (
                <>
                  <p className="text-xs text-muted-foreground">将创建新的提示词库并导入所有内容，不会影响现有库的数据。</p>
                  {(importPreviewData as Record<string, unknown>).libraryInfo && (
                    <div className="p-2 bg-primary/5 rounded-lg border border-primary/10">
                      <p className="text-xs font-medium text-foreground">库名：{((importPreviewData as Record<string, unknown>).libraryInfo as Record<string, string>)?.name || '未命名'}</p>
                      {((importPreviewData as Record<string, unknown>).libraryInfo as Record<string, string>)?.description && <p className="text-[10px] text-muted-foreground mt-0.5">{((importPreviewData as Record<string, unknown>).libraryInfo as Record<string, string>).description}</p>}
                    </div>
                  )}
                  <div className="space-y-1">
                    {[
                      { label: '分类体系', count: Array.isArray((importPreviewData as Record<string, unknown>).categories) ? ((importPreviewData as Record<string, unknown>).categories as unknown[]).length : 0 },
                      { label: '原子词', count: Array.isArray((importPreviewData as Record<string, unknown>).atoms) ? ((importPreviewData as Record<string, unknown>).atoms as unknown[]).length : 0 },
                      { label: '词包', count: Array.isArray((importPreviewData as Record<string, unknown>).packages) ? ((importPreviewData as Record<string, unknown>).packages as unknown[]).length : 0 },
                      { label: '提示词模板', count: Array.isArray((importPreviewData as Record<string, unknown>).templates) ? ((importPreviewData as Record<string, unknown>).templates as unknown[]).length : 0 },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-foreground">{item.label}</span>
                        <span className="text-muted-foreground">{item.count} 条</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">选择性导入提示词内容到当前库，ID将自动重映射。</p>
                  {[
                    { key: 'categories' as const, label: '分类体系', count: Array.isArray((importPreviewData as Record<string, unknown>).categories) ? ((importPreviewData as Record<string, unknown>).categories as unknown[]).length : 0 },
                    { key: 'atoms' as const, label: '原子词', count: Array.isArray((importPreviewData as Record<string, unknown>).atoms) ? ((importPreviewData as Record<string, unknown>).atoms as unknown[]).length : 0 },
                    { key: 'packages' as const, label: '词包', count: Array.isArray((importPreviewData as Record<string, unknown>).packages) ? ((importPreviewData as Record<string, unknown>).packages as unknown[]).length : 0 },
                    { key: 'templates' as const, label: '提示词模板', count: Array.isArray((importPreviewData as Record<string, unknown>).templates) ? ((importPreviewData as Record<string, unknown>).templates as unknown[]).length : 0 },
                  ].map(item => (
                    <label key={item.key} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/30 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importSelection[item.key]}
                        onChange={e => setImportSelection(prev => ({ ...prev, [item.key]: e.target.checked }))}
                        className="rounded border-border/50 accent-primary"
                      />
                      <span className="text-sm text-foreground flex-1">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.count} 条</span>
                    </label>
                  ))}
                  <div className="mt-3 p-3 bg-muted/20 rounded-lg">
                    <p className="text-[10px] text-muted-foreground">导入目标：<span className="text-foreground">{currentLibName}</span></p>
                    <p className="text-[10px] text-muted-foreground mt-1">ID将自动重映射，不会覆盖现有数据</p>
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border/30 flex justify-end gap-2">
              <button onClick={() => { setShowImportModal(false); setImportPreviewData(null); }} className="px-4 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30">取消</button>
              <button onClick={doImport} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-1"><Upload className="w-3 h-3" />{importMode === 'library' ? '创建新库并导入' : '导入到当前库'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse Prompt Import Modal */}
      {showReverseImportModal && reverseResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowReverseImportModal(false)}>
          <div className="bg-background border border-border/50 rounded-xl w-[480px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">导入反推提示词到库</h3>
              <button onClick={() => setShowReverseImportModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">选择目标提示词库</label>
                <NeutralSelect className="w-full bg-background border border-border/50 rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" value={reverseImportLibId || ''} onChange={e => setReverseImportLibId(Number(e.target.value))}>
                  {libraries.map(lib => (<option key={lib.id} value={lib.id}>{lib.name}</option>))}
                </NeutralSelect>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">提示词内容（可编辑）</label>
                <textarea className="w-full bg-muted/20 border border-border/50 rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[120px]" defaultValue={reverseResult} id="reverse-import-content" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">导入为</label>
                <div className="flex gap-2">
                  <button onClick={() => {
                    const content = (document.getElementById('reverse-import-content') as HTMLTextAreaElement)?.value || reverseResult;
                    fetch('/api/prompt-atoms', { method: 'POST', headers, body: JSON.stringify({ name: '反推提示词', content, library_id: reverseImportLibId || currentLibraryId }) }).then(() => { loadAtoms(); setShowReverseImportModal(false); });
                  }} className="flex-1 bg-primary text-primary-foreground px-3 py-2 rounded-md text-xs hover:bg-primary/90">原子词</button>
                  <button onClick={() => {
                    const content = (document.getElementById('reverse-import-content') as HTMLTextAreaElement)?.value || reverseResult;
                    fetch('/api/prompt-packages', { method: 'POST', headers, body: JSON.stringify({ name: '反推提示词', content, library_id: reverseImportLibId || currentLibraryId }) }).then(() => { loadPackages(); setShowReverseImportModal(false); });
                  }} className="flex-1 border border-border-secondary text-muted-foreground px-3 py-2 rounded-md text-xs hover:bg-muted/50">词包</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Modal */}
      {showAnalysisModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAnalysisModal(false)}>
          <div className="bg-background border border-border/50 rounded-xl w-[640px] max-h-[80vh] shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />智能分析结果</h3>
              <button onClick={() => setShowAnalysisModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 flex-1 overflow-y-auto">
              {analyzing && !analysisResult ? (
                <div className="flex items-center justify-center py-8"><RotateCcw className="w-5 h-5 animate-spin text-primary mr-2" /><span className="text-sm text-muted-foreground">AI 正在分析搜索结果...</span></div>
              ) : (
                <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{analysisResult}</div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-muted-foreground">分析结果可归档到知识库供后续参考</span>
              <div className="flex gap-2">
                <button onClick={() => setShowAnalysisModal(false)} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/50 rounded-md">关闭</button>
                <button onClick={saveAnalysisToKnowledge} disabled={!analysisResult || analyzing} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"><Lightbulb className="w-3 h-3" />归档到知识库</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Preview Modal */}
      {knowledgePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setKnowledgePreview(null)}>
          <div className="relative w-full max-w-2xl max-h-[80vh] bg-card rounded-2xl border border-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-card/95 backdrop-blur border-b border-border">
              <h3 className="text-lg font-semibold text-foreground truncate">{knowledgePreview.name}</h3>
              <button onClick={() => setKnowledgePreview(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5 space-y-4" style={{maxHeight: 'calc(80vh - 64px)'}}>
              {knowledgePreview.tags && (
                <div className="flex flex-wrap gap-1.5">
                  {knowledgePreview.tags.split(',').filter(Boolean).map((tag: string) => (
                    <span key={tag} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">{tag.trim()}</span>
                  ))}
                </div>
              )}
              <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{knowledgePreview.content}</div>
              {knowledgePreview.source_url && (
                <div className="pt-3 border-t border-border">
                  <a href={knowledgePreview.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <Globe className="w-3.5 h-3.5" />
                    {(() => { try { return new URL(knowledgePreview.source_url).hostname; } catch { return knowledgePreview.source_url; } })()}
                  </a>
                </div>
              )}
              {knowledgePreview.source && !knowledgePreview.source_url && (
                <div className="pt-3 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1">来源链接</div>
                  <div className="space-y-1">
                    {knowledgePreview.source.split(',').filter(Boolean).map((url: string, i: number) => {
                      const trimmed = url.trim();
                      try {
                        const u = new URL(trimmed);
                        return <a key={i} href={trimmed} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:underline truncate"><Globe className="w-3 h-3 shrink-0" />{u.hostname + u.pathname.slice(0, 30)}</a>;
                      } catch {
                        return <span key={i} className="text-xs text-muted-foreground truncate block">{trimmed}</span>;
                      }
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Prompt Quick Picker (embedded in chat panel) ───
interface PromptQuickPickerProps {
  projectId: string | null;
  authHeaders: Record<string, string>;
  onSelect: (text: string) => void;
  onOpenFullManager: () => void;
  onClose: () => void;
}

// Picker items list component - fetches atoms/packages by category on demand
function PickerItemsList({ pickerType, categoryId, subCategoryId, libraryId, headers, onSelect }: {
  pickerType: 'atoms' | 'packages';
  categoryId: number | null;
  subCategoryId: number | null;
  libraryId: number | null;
  headers: Record<string, string>;
  onSelect: (content: string) => void;
}) {
  const [items, setItems] = React.useState<Array<{ id: number; name: string; content: string; category_id: number }>>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!categoryId && !subCategoryId) { setItems([]); return; }
    setLoading(true);
    const params = new URLSearchParams();
    if (libraryId) params.set('libraryId', String(libraryId));
    const fetchCatIds = subCategoryId ? [subCategoryId] : (categoryId ? [categoryId] : []);
    // We fetch all for the library and filter client-side
    const url = pickerType === 'atoms' ? `/api/prompt-atoms?${params}` : `/api/prompt-packages?${params}`;
    fetch(url, { headers })
      .then(res => res.json())
      .then(json => {
        const all = (json.data || []) as Array<{ id: number; name: string; content: string; category_id: number }>;
        const filtered = all.filter(item => fetchCatIds.length === 0 || fetchCatIds.includes(item.category_id));
        setItems(filtered);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerType, categoryId, subCategoryId, libraryId]);

  if (loading) return <p className="text-[10px] text-muted-foreground text-center py-2">加载中...</p>;
  return (
    <div className="max-h-40 overflow-y-auto space-y-1">
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.content)}
          className="w-full text-left p-1.5 rounded hover:bg-muted transition-colors"
        >
          <p className="text-[10px] text-foreground font-medium">{item.name}</p>
          <p className="text-[9px] text-muted-foreground truncate">{item.content}</p>
        </button>
      ))}
      {items.length === 0 && <p className="text-[10px] text-muted-foreground/70 text-center py-2">该分类下暂无{pickerType === 'atoms' ? '原子词' : '词包'}</p>}
    </div>
  );
}

export function PromptQuickPicker({ projectId, authHeaders, onSelect, onOpenFullManager, onClose }: PromptQuickPickerProps) {
  const [activeTab, setActiveTab] = useState<'atoms' | 'packages' | 'templates'>('templates');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<{ id: number; name: string; content: string; category_id: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [fillingTemplate, setFillingTemplate] = useState<{ name: string; content: string; vars: { key: string; categoryId: number | null; subCategoryId: number | null; defaultValue: string }[] } | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [pickerVar, setPickerVar] = useState<string | null>(null);
  const [pickerType, setPickerType] = useState<'atoms' | 'packages'>('atoms');
  const [categories, setCategories] = useState<{ id: number; name: string; parent_id: number }[]>([]);
  const effectiveProjectId = projectId || '';
  const headers = { ...authHeaders, 'Content-Type': 'application/json' };

  // Extract {{var}} from content - var key can be categoryId (numeric) or custom name
  const extractVarKeys = (content: string): string[] => {
    const matches = content.match(/\{\{(\w+)\}\}/g);
    return matches ? [...new Set(matches.map(m => m.slice(2, -2)))] : [];
  };

  // Load library first
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/prompt-libraries?projectId=${effectiveProjectId}`, { headers });
        const json = await res.json();
        if (json.data?.length > 0) setLibraryId(json.data[0].id);
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProjectId]);

  // Load items when tab/keyword/library changes
  useEffect(() => {
    if (!libraryId) return;
    setLoading(true);
    const endpoint = activeTab === 'atoms' ? 'prompt-atoms' : activeTab === 'packages' ? 'prompt-packages' : 'prompt-templates';
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    params.set('libraryId', String(libraryId));
    fetch(`/api/${endpoint}?${params}`, { headers })
      .then(res => res.json())
      .then(json => { setItems(json.data || []); })
      .catch(() => { setItems([]); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, keyword, libraryId]);


  const handleInsert = async (item: { name: string; content: string }) => {
    const varKeys = extractVarKeys(item.content);
    if (varKeys.length > 0) {
      // Load template vars from API to get subCategoryId and defaultValue
      const templateId = (item as { id?: number }).id;
      let varDefs: { key: string; categoryId: number | null; subCategoryId: number | null; defaultValue: string }[] = [];
      if (templateId) {
        try {
          const res = await fetch(`/api/prompt-templates?projectId=${effectiveProjectId}&libraryId=${libraryId || ''}`, { headers });
          const json = await res.json();
          const tpl = (json.data || []).find((t: { id: number }) => t.id === templateId);
          if (tpl?.vars_json) {
            varDefs = typeof tpl.vars_json === 'string' ? JSON.parse(tpl.vars_json) : tpl.vars_json;
          }
        } catch {}
      }
      // Load categories first so we can resolve var keys to category IDs
      const catRes = await fetch(`/api/prompt-categories?type=1&projectId=${effectiveProjectId}`, { headers });
      const catJson = await catRes.json();
      const catList: Array<{ id: number; name: string; parent_id: number }> = catJson.data || [];
      
      // Merge: use varDefs if available, otherwise create basic entries
      // Resolve var key to categoryId by matching category name
      const vars = varKeys.map(key => {
        const def = varDefs.find(d => d.key === key);
        const matchedCat = catList.find(c => c.name === key);
        const categoryId = def?.categoryId || (matchedCat ? matchedCat.id : null);
        const subCategoryId = def?.subCategoryId || null;
        return { key, categoryId, subCategoryId, defaultValue: def?.defaultValue || '' };
      });
      setFillingTemplate({ name: item.name, content: item.content, vars });
      setVarValues(Object.fromEntries(vars.map(v => [v.key, v.defaultValue || ''])));
    } else {
      onSelect(item.content);
    }
  };

  const handleConfirmFill = () => {
    if (!fillingTemplate) return;
    let content = fillingTemplate.content;
    for (const [key, value] of Object.entries(varValues)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || `{{${key}}}`);
    }
    onSelect(content);
    setFillingTemplate(null);
    setVarValues({});
  };

  const tabLabels: Record<string, string> = { atoms: '原子词', packages: '词包', templates: '模板' };

  // Variable filling mode
  if (fillingTemplate) {
    return (
      <div className="prompt-quick-picker flex-1 overflow-y-auto p-3 space-y-3 flex flex-col bg-card text-foreground">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-foreground">填充模板变量 - {fillingTemplate.name}</h3>
          <button onClick={() => { setFillingTemplate(null); setPickerVar(null); }} className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"><X className="w-3.5 h-3.5" /></button>
        </div>

        {fillingTemplate.vars.map(v => {
          const vKey = v.key;
          const catInfo = v.categoryId ? categories.find(c => c.id === v.categoryId) : null;
          const subCatInfo = v.subCategoryId ? categories.find(c => c.id === v.subCategoryId) : null;
          return (
            <div key={vKey} className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground font-medium">
                变量: <span className="text-primary">{`{{${vKey}}}`}</span>
                {catInfo && <span className="text-muted-foreground/80 ml-1">({catInfo.name}{subCatInfo ? ` / ${subCatInfo.name}` : ''})</span>}
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={varValues[vKey] || ''}
                  onChange={e => setVarValues(prev => ({ ...prev, [vKey]: e.target.value }))}
                  placeholder={v.defaultValue || `输入${vKey}的值...`}
                  className="flex-1 bg-muted/60 border border-border rounded px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />
                {v.categoryId && (
                  <>
                    <button
                      onClick={() => { setPickerVar(vKey); setPickerType('atoms'); }}
                      className="px-1.5 py-1 text-[9px] bg-emerald-900/50 text-emerald-400 rounded hover:bg-emerald-800/50 transition-colors whitespace-nowrap"
                      title="选择原子词"
                    >原子词</button>
                    <button
                      onClick={() => { setPickerVar(vKey); setPickerType('packages'); }}
                      className="px-1.5 py-1 text-[9px] bg-muted text-foreground rounded hover:bg-muted/80 transition-colors whitespace-nowrap"
                      title="选择词包"
                    >词包</button>
                  </>
                )}
              </div>
              {v.defaultValue && !varValues[vKey] && <p className="text-[10px] text-muted-foreground/70">默认值: <span className="text-muted-foreground">{v.defaultValue}</span></p>}
              {varValues[vKey] && <p className="text-[10px] text-muted-foreground">当前值: <span className="text-foreground">{varValues[vKey]}</span></p>}
            </div>
          );
        })}

        {/* Picker for selecting atom/package as variable value */}
        {pickerVar && (
          <div className="border border-border rounded-lg bg-muted/50 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">选择{pickerType === 'atoms' ? '原子词' : '词包'}填充 &quot;{pickerVar}&quot;</span>
              <div className="flex gap-1">
                <button onClick={() => setPickerType('atoms')} className={`px-1.5 py-0.5 text-[9px] rounded ${pickerType === 'atoms' ? 'bg-emerald-600 text-white' : 'bg-card text-muted-foreground'}`}>原子词</button>
                <button onClick={() => setPickerType('packages')} className={`px-1.5 py-0.5 text-[9px] rounded ${pickerType === 'packages' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>词包</button>
              </div>
            </div>
            {/* Category-filtered items - fetched on demand */}
            <PickerItemsList
              pickerType={pickerType}
              categoryId={fillingTemplate?.vars?.find(v => v.key === pickerVar)?.categoryId || null}
              subCategoryId={fillingTemplate?.vars?.find(v => v.key === pickerVar)?.subCategoryId || null}
              libraryId={libraryId}
              headers={headers}
              onSelect={(content: string) => { setVarValues(prev => ({ ...prev, [pickerVar || '']: content })); setPickerVar(null); }}
            />
            <button onClick={() => setPickerVar(null)} className="text-[9px] text-muted-foreground hover:text-foreground">取消选择</button>
          </div>
        )}

        {/* Preview */}
        <div className="border border-border rounded-lg p-2">
          <p className="text-[10px] text-muted-foreground mb-1">预览:</p>
          <p className="text-[10px] text-foreground whitespace-pre-wrap">
            {fillingTemplate.content.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => varValues[key] || `{{${key}}}`)}
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={() => { setFillingTemplate(null); setPickerVar(null); }} className="flex-1 px-3 py-1.5 text-[11px] bg-muted text-muted-foreground rounded hover:bg-muted/80 hover:text-foreground transition-colors">取消</button>
          <button onClick={handleConfirmFill} className="flex-1 px-3 py-1.5 text-[11px] bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors">插入</button>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-quick-picker flex-1 overflow-y-auto p-3 space-y-2 flex flex-col bg-card text-foreground">
      {/* Header with tabs */}
      <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5 bg-muted rounded p-0.5">
          {(['templates', 'packages', 'atoms'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setKeyword(''); }}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${activeTab === tab ? 'bg-primary/15 text-primary ring-1 ring-primary/20' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
        <button
          onClick={onOpenFullManager}
          className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
        >
          管理平台 <ExternalLink className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={onClose}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          title="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索提示词..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          className="w-full bg-muted/60 border border-border rounded pl-7 pr-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
        />
      </div>

      {/* Items */}
      {loading ? (
        <div className="text-center text-muted-foreground text-xs mt-8">加载中...</div>
      ) : items.length === 0 ? (
        <div className="text-center text-muted-foreground text-xs mt-8">
          <p>暂无{tabLabels[activeTab]}</p>
          <button onClick={onOpenFullManager} className="mt-2 text-primary hover:text-primary/80">去管理平台添加</button>
        </div>
      ) : (
        <div className="space-y-1.5 overflow-y-auto flex-1">
          {items.map(item => (
            <div
              key={item.id}
              className="bg-muted/50 border border-border rounded-lg p-2 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-foreground font-medium truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{item.content}</p>
                </div>
                <button
                  onClick={() => handleInsert(item)}
                  className="shrink-0 px-2 py-0.5 text-[10px] bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                >
                  插入
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
