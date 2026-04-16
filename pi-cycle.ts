import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ScopedModelsSelectorComponent } from "/home/kyle/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/index.js";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

interface Config {
  shortcut: string;
  tiers: {
    1: string[];
    2: string[];
    3: string[];
  };
}

const DEFAULT_CONFIG: Config = {
  shortcut: "z",
  tiers: {
    1: ["anthropic/claude-opus-4-6"],
    2: ["anthropic/claude-sonnet-4-6"],
    3: ["anthropic/claude-haiku-4-5"],
  },
}; 

export default function (pi: ExtensionAPI) {
  const configPath = join(homedir(), ".pi", "agent", "pi-cycle.json");
  let config: Config = structuredClone(DEFAULT_CONFIG);
  const nextIndex: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };

  function normalizeConfig(raw: unknown): Config {
    const input = raw as Partial<Config> & { tiers?: Record<string, string | string[]> };
    const result: Config = structuredClone(DEFAULT_CONFIG);

    if (typeof input?.shortcut === "string" && input.shortcut.trim().length > 0) {
      result.shortcut = input.shortcut.trim();
    }

    for (const tier of [1, 2, 3] as const) {
      const value = input?.tiers?.[String(tier)] ?? input?.tiers?.[tier];
      if (Array.isArray(value)) {
        const cleaned = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
        if (cleaned.length > 0) result.tiers[tier] = cleaned;
      } else if (typeof value === "string" && value.trim()) {
        result.tiers[tier] = [value.trim()];
      }
    }

    return result;
  }

  async function loadConfig() {
    try {
      const data = await readFile(configPath, "utf8");
      config = normalizeConfig(JSON.parse(data));
    } catch {
      config = structuredClone(DEFAULT_CONFIG);
    }
  }

  async function saveConfig() {
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  }

  function currentTierText() {
    return [1, 2, 3]
      .map((tier) => {
        const models = config.tiers[tier as 1 | 2 | 3];
        return `${tier}: ${models.join(" -> ")}`;
      })
      .join("\n");
  }

  async function configureTier(ctx: any, tier: 1 | 2 | 3) {
    const models = await ctx.modelRegistry.getAvailable();
    const saved = new Set(config.tiers[tier]);
    let selectedIds = [...config.tiers[tier]].filter((id) => models.some((m: any) => `${m.provider}/${m.id}` === id));

    if (selectedIds.length === 0 && models.length > 0) {
      selectedIds = [`${models[0].provider}/${models[0].id}`];
    }

    const result = await ctx.ui.custom<string[] | null>((tui, _theme, _kb, done) => {
      const component = new ScopedModelsSelectorComponent(
        {
          allModels: models,
          enabledModelIds: new Set(selectedIds),
          hasEnabledModelsFilter: true,
        },
        {
          onModelToggle: (modelId: string, enabled: boolean) => {
            if (enabled) {
              if (!selectedIds.includes(modelId)) selectedIds.push(modelId);
            } else {
              selectedIds = selectedIds.filter((id) => id !== modelId);
            }
          },
          onPersist: (enabledModelIds: string[]) => done(enabledModelIds),
          onEnableAll: (allModelIds: string[]) => {
            selectedIds = [...allModelIds];
          },
          onClearAll: () => {
            selectedIds = [];
          },
          onToggleProvider: (_provider: string, _modelIds: string[], _enabled: boolean) => {
            // Component state is authoritative; selectedIds is only needed for fallback bookkeeping.
          },
          onCancel: () => done(null),
        },
      );

      component.focused = true;
      return {
        render: (width: number) => component.render(width),
        invalidate: () => component.invalidate(),
        handleInput: (data: string) => {
          component.handleInput(data);
          tui.requestRender();
        },
      };
    });

    if (result === null) return false;
    if (result.length === 0) {
      ctx.ui.notify(`Tier ${tier} needs at least one model`, "error");
      return false;
    }

    config.tiers[tier] = result;
    nextIndex[tier] = 0;
    await saveConfig();

    const changed = JSON.stringify([...saved]) !== JSON.stringify(result);
    if (changed) {
      ctx.ui.notify(`Tier ${tier} updated: ${result.join(" -> ")}`, "success");
    }
    return true;
  }

  pi.on("session_start", async () => {
    await loadConfig();
  });

  pi.on("input", async (event, ctx) => {
    const escaped = config.shortcut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = event.text.match(new RegExp(`^((?:${escaped}){1,3})(?:\\s+([\\s\\S]*)|$)`));
    if (match && match[1].length % config.shortcut.length !== 0) return;
    if (!match) return;

    const tier = (match[1].length / config.shortcut.length) as 1 | 2 | 3;
    const body = (match[2] || "").trim();
    const modelsForTier = config.tiers[tier];

    if (modelsForTier.length === 0) {
      ctx.ui.notify(`Tier ${tier} has no configured models. Run /cycle-models ${tier}.`, "error");
      return { action: "transform", text: body };
    }

    const modelSpec = modelsForTier[nextIndex[tier] % modelsForTier.length];
    nextIndex[tier] = (nextIndex[tier] + 1) % modelsForTier.length;

    const [provider, ...idParts] = modelSpec.split("/");
    const id = idParts.join("/");
    const model = ctx.modelRegistry.find(provider, id);

    if (model) {
      const success = await pi.setModel(model);
      if (success) {
        const cycleInfo = modelsForTier.length > 1 ? ` (${nextIndex[tier] || modelsForTier.length}/${modelsForTier.length})` : "";
        ctx.ui.notify(`Tier ${tier}: ${model.provider}/${model.id}${cycleInfo}`, "info");
      } else {
        ctx.ui.notify(`Failed to switch to Tier ${tier}: ${modelSpec}`, "error");
      }
    } else {
      ctx.ui.notify(`Tier ${tier} model not found: ${modelSpec}`, "error");
    }

    return { action: "transform", text: body };
  });

  pi.registerCommand("cycle-models", {
    description: "Configure one or more models for each pi-cycle tier",
    getArgumentCompletions: (prefix) => {
      const values = ["1", "2", "3", "show", "shortcut"];
      return values
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({
          value,
          label: value === "show" ? "show current tier mappings" : value === "shortcut" ? "set shortcut key" : `configure tier ${value}`,
        }));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed === "show") {
        ctx.ui.notify(currentTierText(), "info");
        return;
      }

      if (trimmed === "1" || trimmed === "2" || trimmed === "3") {
        await configureTier(ctx, Number(trimmed) as 1 | 2 | 3);
        return;
      }

      if (trimmed.startsWith("shortcut ")) {
        const newShortcut = trimmed.slice("shortcut ".length).trim();
        if (!newShortcut) {
          ctx.ui.notify("Usage: /cycle-models shortcut {shortcut}", "error");
          return;
        }
        config.shortcut = newShortcut;
        await saveConfig();
        ctx.ui.notify(`Shortcut set to "${newShortcut}" — use ${newShortcut}, ${newShortcut.repeat(2)}, ${newShortcut.repeat(3)} to switch tiers`, "success");
        return;
      }

      if (trimmed) {
        ctx.ui.notify("Usage: /cycle-models | /cycle-models <1|2|3> | /cycle-models show | /cycle-models shortcut {shortcut}", "error");
        return;
      }

      for (const tier of [1, 2, 3] as const) {
        const ok = await configureTier(ctx, tier);
        if (!ok) return;
      }

      ctx.ui.notify("pi-cycle tiers updated.", "success");
    },
  });
}
