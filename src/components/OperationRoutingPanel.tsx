"use client";

import NeutralSelect from "@/components/ui/neutral-select";
import type {
  OperationDefinition,
  OperationKey,
  OperationRoute,
  ProviderType,
} from "@/lib/provider-routing";

type OperationRoutingProvider = {
  id: string;
  name: string;
  baseUrl: string;
  type: ProviderType;
};

type OperationRoutingModel = {
  id: string;
  displayName?: string;
};

type OperationRoutingPanelProps = {
  definitions: OperationDefinition[];
  routes: OperationRoute[];
  providers: OperationRoutingProvider[];
  getProviderModels: (providerId: string) => OperationRoutingModel[];
  onSelectProvider: (operation: OperationKey, providerId: string) => void;
  onSelectModel: (operation: OperationKey, modelId: string) => void;
  onClearRoute: (operation: OperationKey) => void;
};

function getModelLabel(model?: OperationRoutingModel | null, fallbackId?: string) {
  return model?.displayName || model?.id || fallbackId || "";
}

export default function OperationRoutingPanel({
  definitions,
  routes,
  providers,
  getProviderModels,
  onSelectProvider,
  onSelectModel,
  onClearRoute,
}: OperationRoutingPanelProps) {
  const routeByKey = new Map(routes.map((route) => [route.operation, route]));
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));

  return (
    <div className="space-y-3">
      {definitions.map((definition) => {
        const route = routeByKey.get(definition.key) || null;
        const providerCandidates = providers.filter((provider) => (
          !definition.supportedProviderTypes
          || definition.supportedProviderTypes.includes(provider.type)
        ));
        const selectedProvider = route?.providerId ? providerById.get(route.providerId) || null : null;
        const providerModels = selectedProvider ? getProviderModels(selectedProvider.id) : [];
        const selectedModel = route?.modelId
          ? providerModels.find((model) => model.id === route.modelId) || null
          : null;

        return (
          <section
            key={definition.key}
            className="rounded-2xl border border-border bg-muted/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">{definition.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{definition.hint}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                route?.providerId
                  ? "bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground"
              }`}>
                {route?.providerId ? "独立路由" : "跟随默认"}
              </span>
            </div>

            <div className="mt-3 grid gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">服务商</label>
                <NeutralSelect
                  value={route?.providerId || ""}
                  onChange={(event) => onSelectProvider(definition.key, event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">跟随默认能力</option>
                  {providerCandidates.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </NeutralSelect>
              </div>

              {definition.requiresModel && route?.providerId && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">模型</label>
                  <NeutralSelect
                    value={route.modelId || ""}
                    onChange={(event) => onSelectModel(definition.key, event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                  >
                    <option value="">
                      {providerModels.length > 0 ? "选择模型" : "当前服务商还没有检测到模型"}
                    </option>
                    {providerModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {getModelLabel(model, model.id)}
                      </option>
                    ))}
                  </NeutralSelect>
                  {providerModels.length === 0 && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-300">
                      先到服务商页检测模型，再回来绑定这个操作。
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
              {route?.providerId ? (
                <div className="space-y-1">
                  <div>
                    当前绑定：
                    <span className="ml-1 text-foreground">
                      {selectedProvider?.name || route.providerId}
                    </span>
                  </div>
                  {selectedProvider && (
                    <div className="break-all">{selectedProvider.baseUrl}</div>
                  )}
                  {definition.requiresModel && (
                    <div>
                      模型：
                      <span className="ml-1 text-foreground">
                        {getModelLabel(selectedModel, route.modelId) || "未选择"}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {definition.key === "conversion.pdf_to_ppt"
                    ? "未单独配置时，转换中心继续使用默认 Codia 配置。"
                    : "未单独配置时，继续跟随图像工具默认能力路由。"}
                </div>
              )}
            </div>

            {route?.providerId && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => onClearRoute(definition.key)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  清除单独路由
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
