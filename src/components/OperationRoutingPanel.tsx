"use client";

import { SettingsSection, SettingsCard, SettingsRow } from "@/components/platform/Settings";
import { ModelPicker } from "@/components/creation/CreationControls";
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
          <SettingsSection key={definition.key} title={definition.label} description={definition.hint}>
            <SettingsCard>
              <SettingsRow label="服务商" description={route?.providerId ? '独立配置此操作' : '跟随默认能力'}>
                <NeutralSelect aria-label={`${definition.label}服务商`} value={route?.providerId || ''} onChange={e=>onSelectProvider(definition.key,e.target.value)}><option value="">跟随默认能力</option>{providerCandidates.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</NeutralSelect>
              </SettingsRow>
              {definition.requiresModel&&route?.providerId&&<SettingsRow label="模型" description={!providerModels.length?'先检测服务商模型目录':undefined}><ModelPicker label={`${definition.label}模型`} value={route.modelId||''} options={[{value:'',label:'选择模型'},...providerModels.map(m=>({value:m.id,label:getModelLabel(m,m.id),group:selectedProvider?.name}))]} onChange={v=>onSelectModel(definition.key,v)}/></SettingsRow>}
            </SettingsCard>
            {route?.providerId&&<div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground"><span className="truncate" title={selectedProvider?.baseUrl}>{selectedProvider?.name||route.providerId}</span><button type="button" className="motif-link" onClick={()=>onClearRoute(definition.key)}>恢复默认</button></div>}
          </SettingsSection>
        );
      })}
    </div>
  );
}
